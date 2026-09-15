import { Injectable, Logger } from '@nestjs/common';
import { InspectionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaginatedResult, paginate } from '../common/dto/pagination.dto';
import { BadRequestError, ForbiddenError, NotFoundError } from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { RequestMetadata, TenantContext, buildTenantScope, canAccessBranch } from '../common/tenant-context';
import { PrismaService } from '../database/prisma.service';
import { InspectionAction, evaluateTransition } from '../inspections/domain/inspection-state-machine';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageProvider } from '../providers/storage/storage.provider';
import { ReportData, ReportRenderer } from './report-renderer';

const DOWNLOAD_TTL_SECONDS = 300;

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  constructor(private readonly prisma: PrismaService, private readonly renderer: ReportRenderer, private readonly storage: StorageProvider, private readonly audit: AuditService, private readonly notifications: NotificationsService) {}

  async generateDraft(user: TenantContext, inspectionId: string, meta: RequestMetadata) {
    const inspection = await this.loadForReport(user.organizationId, inspectionId); if (!inspection) throw new NotFoundError(ErrorCode.INSPECTION_NOT_FOUND,'Inspection not found.');
    const statuses: InspectionStatus[]=[InspectionStatus.SUBMITTED,InspectionStatus.UNDER_REVIEW,InspectionStatus.RESUBMITTED];
    if(!statuses.includes(inspection.status))throw new BadRequestError(ErrorCode.REPORT_NOT_READY,'A draft report can only be generated after the inspection has been submitted.');
    if(!canAccessBranch(user,inspection.branchId))throw new ForbiddenError('This inspection belongs to a branch you do not have access to.',ErrorCode.AUTH_FORBIDDEN);
    const round=Math.max(inspection.submissionCount,1), reportNumber=this.buildDraftReportNumber(inspection.inspectionNumber,round);
    const existing=await this.prisma.report.findFirst({where:{organizationId:inspection.organizationId,inspectionId,reportNumber},orderBy:{version:'desc'}});if(existing)return existing;
    const version=1;const generatedByName=await this.generatedByName(user.userId);const pdf=await this.renderer.render(this.toReportData(inspection,reportNumber,version,generatedByName));const storageKey=`reports/${inspection.organizationId}/drafts/${reportNumber}-v${version}.pdf`;const stored=await this.storage.put(storageKey,pdf,'application/pdf');
    return this.prisma.runInTransaction(async(tx)=>{const duplicate=await tx.report.findFirst({where:{organizationId:inspection.organizationId,inspectionId,reportNumber}});if(duplicate)return duplicate;const created=await tx.report.create({data:{organizationId:inspection.organizationId,inspectionId,reportNumber,version,storageKey:stored.key,checksumSha256:stored.checksumSha256,sizeBytes:stored.sizeBytes,generatedById:user.userId}});await this.audit.record({organizationId:inspection.organizationId,userId:user.userId,action:'DRAFT_REPORT_GENERATED',entityType:'Report',entityId:created.id,metadata:{reportNumber,version,inspectionNumber:inspection.inspectionNumber,submissionRound:round,checksum:stored.checksumSha256},meta},tx);return created;});
  }

  async generate(user: TenantContext, inspectionId: string, meta: RequestMetadata) {
    const inspection=await this.loadForReport(user.organizationId,inspectionId);if(!inspection)throw new NotFoundError(ErrorCode.INSPECTION_NOT_FOUND,'Inspection not found.');
    const outcome=evaluateTransition({action:InspectionAction.GENERATE_REPORT,currentStatus:inspection.status,userId:user.userId,permissions:user.permissions,inspectorId:inspection.inspectorId,submittedById:null});if(!outcome.allowed)throw new BadRequestError(ErrorCode.REPORT_NOT_READY,outcome.reason);
    const reportNumber=this.buildReportNumber(inspection.inspectionNumber),version=1,generatedByName=await this.generatedByName(user.userId);const pdf=await this.renderer.render(this.toReportData(inspection,reportNumber,version,generatedByName));const storageKey=`reports/${inspection.organizationId}/${reportNumber}-v${version}.pdf`;const stored=await this.storage.put(storageKey,pdf,'application/pdf');

    return this.prisma.runInTransaction(async(tx)=>{
      // The report's compound unique key is the concurrency guard. Using an
      // upsert here makes regeneration safe even if two requests arrive at
      // nearly the same time (for example from a double-click or retry).
      const report=await tx.report.upsert({
        where:{organizationId_reportNumber_version:{organizationId:inspection.organizationId,reportNumber,version}},
        create:{organizationId:inspection.organizationId,inspectionId,reportNumber,version,storageKey:stored.key,checksumSha256:stored.checksumSha256,sizeBytes:stored.sizeBytes,generatedById:user.userId},
        update:{inspectionId,storageKey:stored.key,checksumSha256:stored.checksumSha256,sizeBytes:stored.sizeBytes,generatedById:user.userId,generatedAt:new Date()},
      });

      // Remove historical versions/duplicates of this final report so the
      // system continues to expose exactly one authoritative final report.
      await tx.report.deleteMany({where:{organizationId:inspection.organizationId,inspectionId,reportNumber,NOT:{id:report.id}}});

      // Only the first concurrent request should transition the inspection and
      // create the status event/notification. Regeneration itself remains safe
      // and does not create duplicate workflow events.
      const statusUpdate=await tx.inspection.updateMany({
        where:{id:inspectionId,status:{not:InspectionStatus.REPORT_GENERATED}},
        data:{status:InspectionStatus.REPORT_GENERATED,version:{increment:1}},
      });
      if(statusUpdate.count>0){
        await tx.inspectionStatusEvent.create({data:{inspectionId,fromStatus:inspection.status,toStatus:InspectionStatus.REPORT_GENERATED,actorId:user.userId,comment:`Report ${reportNumber} generated.`}});
        if(inspection.inspectorId)await this.notifications.create({userId:inspection.inspectorId,type:'REPORT_READY',title:'Report available',message:`The official report for ${inspection.inspectionNumber} is ready to download.`,entityType:'Report',entityId:report.id},tx);
      }

      await this.audit.record({organizationId:inspection.organizationId,userId:user.userId,action:'REPORT_GENERATED',entityType:'Report',entityId:report.id,metadata:{reportNumber,version,inspectionNumber:inspection.inspectionNumber,checksum:stored.checksumSha256,regenerated:statusUpdate.count===0},meta},tx);
      return report;
    });
  }

  async list(user:TenantContext,query:{page:number;pageSize:number;search?:string}):Promise<PaginatedResult<unknown>>{const scope=buildTenantScope(user);const where={organizationId:scope.organizationId,...(scope.branchId?{inspection:{branchId:scope.branchId}}:{}),...(query.search?{OR:[{reportNumber:{contains:query.search,mode:'insensitive' as const}},{inspection:{inspectionNumber:{contains:query.search,mode:'insensitive' as const}}},{inspection:{loanReference:{contains:query.search,mode:'insensitive' as const}}}]}:{})};const[rows,total]=await Promise.all([this.prisma.report.findMany({where,orderBy:{generatedAt:'desc'},skip:(query.page-1)*query.pageSize,take:query.pageSize,include:{inspection:{select:{id:true,inspectionNumber:true,loanReference:true,submittedAt:true,property:{select:{reference:true,addressLine:true,titleNumber:true,ownerClientName:true,propertyType:true,province:true,district:true,sector:true,cell:true,villageStreet:true}},inspector:{select:{firstName:true,lastName:true}},reviewer:{select:{firstName:true,lastName:true}}}},generatedBy:{select:{firstName:true,lastName:true}}}}),this.prisma.report.count({where})]);return paginate(rows,total,query.page,query.pageSize);}

  async getDownloadUrl(user:TenantContext,reportId:string,meta:RequestMetadata,disposition:'inline'|'attachment'='attachment'):Promise<{url:string;expiresIn:number;reportNumber:string}>{const report=await this.prisma.report.findFirst({where:{id:reportId,organizationId:user.organizationId},include:{inspection:{select:{branchId:true,inspectionNumber:true}}}});if(!report)throw new NotFoundError(ErrorCode.NOT_FOUND,'Report not found.');if(!canAccessBranch(user,report.inspection.branchId))throw new ForbiddenError('This report belongs to a branch you do not have access to.',ErrorCode.AUTH_FORBIDDEN);const url=await this.storage.getSignedUrl(report.storageKey,DOWNLOAD_TTL_SECONDS,disposition);await this.audit.record({organizationId:user.organizationId,userId:user.userId,action:'REPORT_DOWNLOADED',entityType:'Report',entityId:report.id,metadata:{reportNumber:report.reportNumber,disposition},meta});return{url,expiresIn:DOWNLOAD_TTL_SECONDS,reportNumber:report.reportNumber};}

  private async generatedByName(userId:string){const u=await this.prisma.user.findUnique({where:{id:userId},select:{firstName:true,lastName:true}});return u?`${u.firstName} ${u.lastName}`.trim():userId;}
  private buildReportNumber(n:string){return n.replace(/^INS-/,'RPT-');}
  private buildDraftReportNumber(n:string,r:number){return`DRF-${n.replace(/^INS-/,'')}-R${r}`;}

  private async loadForReport(organizationId:string,id:string){const inspection=await this.prisma.inspection.findFirst({where:{id,organizationId,deletedAt:null},include:{organization:true,branch:true,property:{include:{division:true}},owner:true,valuation:true,inspector:{select:{firstName:true,lastName:true}},reviewer:{select:{firstName:true,lastName:true}},assessments:{orderBy:{sortOrder:'asc'}},locations:{orderBy:{capturedAt:'desc'},take:1},photos:{where:{deletedAt:null},orderBy:{createdAt:'asc'}},values:{include:{field:{include:{section:true}}}},comments:{orderBy:{createdAt:'asc'},include:{author:{select:{firstName:true,lastName:true}}}},statusEvents:{orderBy:{createdAt:'asc'},include:{actor:{select:{firstName:true,lastName:true}}}}}});if(!inspection)return null;const rv=await this.prisma.$queryRaw<Array<{currency:string;landValue:any;mainBuildingValue:any;totalEstimatedValue:any;comments:string|null}>>`SELECT currency,land_value AS "landValue", main_building_value AS "mainBuildingValue", total_estimated_value AS "totalEstimatedValue", comments FROM reviewer_valuations WHERE inspection_id=${id} LIMIT 1`;return{...inspection,reviewerValuation:rv[0]??null};}

  private toReportData(inspection:NonNullable<Awaited<ReturnType<ReportsService['loadForReport']>>>,reportNumber:string,version:number,generatedByName:string):ReportData{
    const location=inspection.locations[0];const fieldValues=inspection.values.map(v=>({section:v.field.section.name,sortOrder:v.field.sortOrder,label:v.field.label,value:this.stringifyValue(v)})).filter(e=>e.value!=='').sort((a,b)=>a.section.localeCompare(b.section)||a.sortOrder-b.sortOrder);
    const address=[inspection.property.villageStreet,inspection.property.cell,inspection.property.sector,inspection.property.district,inspection.property.province].filter((v):v is string=>Boolean(v?.trim())).join(', ');
    const codeValues=new Map(inspection.values.map(v=>[v.field.code,this.rawValue(v)]));const improved=String(codeValues.get('PROPERTY_STATUS')??'').toUpperCase()==='IMPROVED';
    const rv=inspection.reviewerValuation;const currency=rv?.currency??'RWF';const landValue=rv?.landValue!=null?Number(rv.landValue):this.number(codeValues.get(improved?'IMPROVED_LAND_VALUE':'LAND_ESTIMATED_VALUE'));const mainBuildingValue=rv?.mainBuildingValue!=null?Number(rv.mainBuildingValue):this.number(codeValues.get('MAIN_BUILDING_VALUE'));const totalEstimatedValue=rv?.totalEstimatedValue!=null?Number(rv.totalEstimatedValue):this.number(codeValues.get(improved?'IMPROVED_TOTAL_VALUE':'LAND_ESTIMATED_VALUE'));const valuation={currency,landValue,mainBuildingValue,totalEstimatedValue,comments:rv?.comments??null};
    return{organization:{name:inspection.organization.name,legalName:inspection.organization.legalName,addressLine:inspection.organization.addressLine,phone:inspection.organization.phone,email:inspection.organization.email},reportNumber,version,generatedAt:new Date(),generatedBy:generatedByName,inspection:{inspectionNumber:inspection.inspectionNumber,loanReference:inspection.loanReference,clientName:inspection.clientName,status:inspection.status,submittedAt:inspection.submittedAt,approvedAt:inspection.approvedAt,branch:`${inspection.branch.code} — ${inspection.branch.name}`},property:{reference:inspection.property.reference,propertyType:inspection.property.propertyType,addressLine:address||inspection.property.addressLine||'—',titleNumber:inspection.property.titleNumber,division:inspection.property.division?.name??null},owner:inspection.owner?{fullName:inspection.owner.fullName,phone:inspection.owner.phone,email:inspection.owner.email,occupancyStatus:inspection.owner.occupancyStatus,ownershipType:inspection.owner.ownershipType}:null,people:{inspector:inspection.inspector?`${inspection.inspector.firstName} ${inspection.inspector.lastName}`:null,reviewer:inspection.reviewer?`${inspection.reviewer.firstName} ${inspection.reviewer.lastName}`:null},location:location?{latitude:Number(location.latitude),longitude:Number(location.longitude),accuracyM:location.accuracyM,capturedAt:location.capturedAt,distanceFromPropertyM:location.distanceFromPropertyM}:null,assessments:inspection.assessments.map(a=>({categoryName:a.categoryName,rating:a.rating,condition:a.condition,notes:a.notes})),valuation,fieldValues:fieldValues.map(({section,label,value})=>({section,label,value})),photos:inspection.photos.map(p=>({category:p.category,storageKey:p.storageKey,caption:p.caption,capturedAt:p.capturedAt}))};
  }
  private rawValue(v:{valueText:string|null;valueNumber:unknown;valueDate:Date|null;valueBool:boolean|null;valueJson:unknown}):unknown{if(v.valueText!==null)return v.valueText;if(v.valueNumber!==null&&v.valueNumber!==undefined)return v.valueNumber;if(v.valueBool!==null&&v.valueBool!==undefined)return v.valueBool;if(v.valueDate)return v.valueDate;if(v.valueJson!==null&&v.valueJson!==undefined)return v.valueJson;return null;}
  private number(v:unknown):number|null{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
  private stringifyValue(v:{valueText:string|null;valueNumber:unknown;valueDate:Date|null;valueBool:boolean|null;valueJson:unknown}):string{if(v.valueText)return v.valueText;if(v.valueNumber!==null&&v.valueNumber!==undefined)return String(v.valueNumber);if(v.valueDate)return new Date(v.valueDate).toLocaleDateString('en-GB');if(v.valueBool!==null&&v.valueBool!==undefined)return v.valueBool?'Yes':'No';if(Array.isArray(v.valueJson))return v.valueJson.join(', ');if(v.valueJson)return typeof v.valueJson==='object'?JSON.stringify(v.valueJson):String(v.valueJson);return '';}
}
