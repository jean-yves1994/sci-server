import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { describePhotoCategory } from '../inspections/domain/completeness';
import { StorageProvider } from '../providers/storage/storage.provider';

export interface ReportData {
  organization: { name: string; legalName: string | null; addressLine: string | null; phone: string | null; email: string | null };
  reportNumber: string; version: number; generatedAt: Date; generatedBy: string;
  inspection: { inspectionNumber: string; loanReference: string; clientName: string | null; status: string; submittedAt: Date | null; approvedAt: Date | null; branch: string };
  property: { reference: string; propertyType: string; addressLine: string; titleNumber: string | null; division: string | null };
  owner: { fullName: string; phone: string | null; email: string | null; occupancyStatus: string | null; ownershipType: string | null } | null;
  people: { inspector: string | null; reviewer: string | null };
  location: { latitude: number; longitude: number; accuracyM: number | null; capturedAt: Date; distanceFromPropertyM: number | null } | null;
  assessments: Array<{ categoryName: string; rating: number | null; condition: string | null; notes: string | null }>;
  valuation: { currency: string; landValue: number | null; mainBuildingValue: number | null; totalEstimatedValue: number | null; comments: string | null } | null;
  fieldValues: Array<{ section: string; label: string; value: string }>;
  photos: Array<{ category: string; storageKey: string; caption: string | null; capturedAt: Date | null }>;
  reviewerMap: { storageKey: string; mimeType: string } | null;
}

const C = { ink: '#0f172a', muted: '#64748b', rule: '#cbd5e1', brand: '#1d4ed8', panel: '#f1f5f9' };
const MARGIN = 50;
const PAGE_WIDTH = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

@Injectable()
export class ReportRenderer {
  private readonly logger = new Logger(ReportRenderer.name);
  constructor(private readonly storage: StorageProvider) {}

  async render(data: ReportData): Promise<Buffer> {
    // Do not let PDFKit create its implicit first page. Every page is created
    // explicitly, so no footer/text operation can accidentally create a new
    // blank page.
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.addPage();
    this.header(doc);
    this.summary(doc, data);
    this.property(doc, data);
    this.owner(doc, data);
    this.location(doc, data);
    this.fields(doc, data);
    this.assessments(doc, data);
    if (data.reportNumber.startsWith('DRF-')) this.estimation(doc, data);
    await this.reviewerMap(doc, data);
    await this.photos(doc, data);
    this.approval(doc, data);

    this.pageNumbers(doc);
    doc.end();
    return finished;
  }

  private header(doc: PDFKit.PDFDocument) {
    doc.rect(0, 0, PAGE_WIDTH, 92).fill(C.brand);
    const tw = CONTENT_WIDTH;
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(15).text('REAL COVENANTS LTD', MARGIN, 16, { width: tw, align: 'center' });
    doc.fontSize(10.5).text('SCI – PROPERTY INSPECTION & VERIFICATION REPORT', MARGIN, 38, { width: tw, align: 'center' });
    doc.font('Helvetica').fontSize(8.5).text('SUMMARIZED INSPECTION REPORT', MARGIN, 57, { width: tw, align: 'center' });
    doc.fillColor(C.ink);
    doc.y = 118;
  }

  private summary(doc: PDFKit.PDFDocument, data: ReportData) {
    this.ensure(doc, 92);
    const y0 = doc.y;
    doc.rect(MARGIN, y0, CONTENT_WIDTH, 74).fill(C.panel);
    doc.fillColor(C.ink);
    const col = CONTENT_WIDTH / 3;
    [['Inspection', data.inspection.inspectionNumber], ['Loan reference', data.inspection.loanReference], ['Branch', data.inspection.branch], ['Client', data.inspection.clientName ?? '—'], ['Inspector', data.people.inspector ?? '—'], ['Reviewer', data.people.reviewer ?? '—']].forEach(([l, v], i) => {
      const x = MARGIN + 12 + (i % 3) * col;
      const y = y0 + 12 + Math.floor(i / 3) * 30;
      doc.font('Helvetica').fontSize(7).fillColor(C.muted).text(l.toUpperCase(), x, y);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.ink).text(v, x, y + 10, { width: col - 16, ellipsis: true });
    });
    doc.y = y0 + 92;
  }

  private property(doc: PDFKit.PDFDocument, data: ReportData) {
    this.section(doc, 'Property');
    this.kv(doc, [['Reference', data.property.reference], ['Type', data.property.propertyType], ['Location', data.property.addressLine || 'Not recorded']]);
    this.section(doc, 'Land registration');
    this.kv(doc, [['UPI', data.property.titleNumber?.trim() || 'Not recorded']]);
  }

  private owner(doc: PDFKit.PDFDocument, data: ReportData) {
    this.section(doc, 'Owner');
    if (!data.owner) { this.note(doc, 'No owner information was recorded.'); return; }
    this.kv(doc, [['Name', data.owner.fullName], ['Phone', data.owner.phone ?? '—'], ['Email', data.owner.email ?? '—'], ['Occupancy', this.human(data.owner.occupancyStatus)], ['Ownership', this.human(data.owner.ownershipType)]]);
  }

  private location(doc: PDFKit.PDFDocument, data: ReportData) {
    this.section(doc, 'Location verification');
    if (!data.location) { this.note(doc, 'No GPS reading was captured for this inspection.'); return; }
    const rows: Array<[string, string]> = [['Latitude', data.location.latitude.toFixed(6)], ['Longitude', data.location.longitude.toFixed(6)], ['Accuracy', data.location.accuracyM ? `${Math.round(data.location.accuracyM)} m` : '—'], ['Captured', this.dt(data.location.capturedAt)]];
    if (data.location.distanceFromPropertyM !== null) rows.push(['Distance from registered position', `${data.location.distanceFromPropertyM} m`]);
    this.kv(doc, rows);
  }

  private fields(doc: PDFKit.PDFDocument, data: ReportData) {
    const visible = data.fieldValues.filter(e => !this.isLegacyPlotNumber(e));
    if (!visible.length) return;
    this.section(doc, 'Recorded information');
    let current = '';
    for (const e of visible) {
      if (e.section !== current) {
        current = e.section;
        this.ensure(doc, 34);
        doc.moveDown(0.3).font('Helvetica-Bold').fontSize(8.5).fillColor(C.brand).text(current.toUpperCase(), MARGIN, doc.y);
        doc.moveDown(0.2);
      }
      this.kv(doc, [[e.label, e.value]]);
    }
  }

  private isLegacyPlotNumber(e: { section: string; label: string; value: string }) {
    const normalized = `${e.section} ${e.label}`.toLowerCase().replace(/[_-]+/g, ' ');
    return /\bplot\s*(number|no|num)\b/.test(normalized) || normalized.includes('plot no.');
  }

  private assessments(doc: PDFKit.PDFDocument, data: ReportData) {
    this.section(doc, 'Condition assessment');
    if (!data.assessments.length) { this.note(doc, 'No assessment categories were recorded.'); return; }
    const x1 = MARGIN + 6, x2 = MARGIN + 210, x3 = MARGIN + 285;
    this.ensure(doc, 26);
    doc.rect(MARGIN, doc.y, CONTENT_WIDTH, 18).fill(C.panel);
    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(7.5);
    doc.text('CATEGORY', x1, doc.y + 5.5); doc.text('RATING', x2, doc.y + 5.5); doc.text('CONDITION', x3, doc.y + 5.5);
    doc.y += 22;
    for (const a of data.assessments) {
      this.ensure(doc, 30);
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(a.categoryName, x1, y, { width: 195 });
      doc.font('Helvetica').fontSize(9).text(a.rating !== null ? `${a.rating} / 5` : '—', x2, y, { width: 70 });
      doc.text(this.human(a.condition), x3, y, { width: 120 });
      let bottom = Math.max(doc.y, y + 12);
      if (a.notes) { doc.font('Helvetica-Oblique').fontSize(8).fillColor(C.muted).text(a.notes, x1, bottom + 2, { width: CONTENT_WIDTH - 12 }); bottom = doc.y; }
      doc.moveTo(MARGIN, bottom + 5).lineTo(MARGIN + CONTENT_WIDTH, bottom + 5).strokeColor(C.rule).lineWidth(0.4).stroke();
      doc.y = bottom + 11;
    }
  }

  private estimation(doc: PDFKit.PDFDocument, data: ReportData) {
    this.section(doc, 'Estimation');
    if (!data.valuation) { this.note(doc, 'No estimation was recorded.'); return; }
    const v = data.valuation;
    const rows: Array<[string, string]> = [];
    if (v.landValue !== null) rows.push(['Land value', this.money(v.landValue, v.currency)]);
    if (v.mainBuildingValue !== null) rows.push(['Main building value', this.money(v.mainBuildingValue, v.currency)]);
    rows.push(['Total estimated value', this.money(v.totalEstimatedValue, v.currency)]);
    this.kv(doc, rows);
  }

  private async reviewerMap(doc: PDFKit.PDFDocument, data: ReportData) {
    if (!data.reviewerMap) return;
    try {
      const image = await this.storage.get(data.reviewerMap.storageKey);
      // A map is content, so only create a page when the map cannot fit on
      // the current page. The image itself is never preceded by an empty page.
      const required = 220;
      this.ensure(doc, required);
      const availableH = Math.min(450, Math.max(120, doc.page.height - MARGIN - doc.y - 35));
      doc.image(image, MARGIN, doc.y, { fit: [CONTENT_WIDTH, availableH], align: 'center', valign: 'center' });
      doc.y += availableH + 10;
      doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text('Map supplied during professional review.', MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'center' });
      doc.moveDown(0.5);
    } catch (e) {
      this.logger.warn(`Reviewer map unavailable: ${String(e)}`);
      this.note(doc, 'The reviewer map could not be loaded.');
    }
  }

  private async photos(doc: PDFKit.PDFDocument, data: ReportData) {
    if (!data.photos.length) return;
    const gap = 14, cell = (CONTENT_WIDTH - gap) / 2, imageH = 138, rowH = imageH + 40, bottom = doc.page.height - MARGIN;
    let col = 0, rowTop = doc.y;
    for (const p of data.photos) {
      if (col === 0 && rowTop + rowH > bottom) { doc.addPage(); rowTop = doc.y; }
      const x = MARGIN + col * (cell + gap);
      try {
        const b = await this.storage.get(p.storageKey);
        doc.image(b, x, rowTop, { fit: [cell, imageH], align: 'center', valign: 'center' });
      } catch (e) {
        this.logger.warn(`Photo unavailable: ${String(e)}`);
        doc.rect(x, rowTop, cell, imageH).fill(C.panel);
        doc.fillColor(C.muted).fontSize(8).text('Image unavailable', x, rowTop + imageH / 2 - 4, { width: cell, align: 'center' });
      }
      doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(8).text(describePhotoCategory(p.category), x, rowTop + imageH + 5, { width: cell, ellipsis: true });
      if (p.caption) doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(p.caption, x, rowTop + imageH + 16, { width: cell, ellipsis: true });
      col++;
      if (col >= 2) { col = 0; rowTop += rowH; doc.y = rowTop; }
    }
    doc.y = col > 0 ? rowTop + rowH : rowTop;
  }

  private approval(doc: PDFKit.PDFDocument, data: ReportData) {
    this.section(doc, 'Approval');
    const organizationName = (data.organization.legalName || data.organization.name || 'Real Covenants Ltd').trim();
    this.kv(doc, [['Submitted', data.inspection.submittedAt ? this.dt(data.inspection.submittedAt) : '—'], ['Approved', data.inspection.approvedAt ? this.dt(data.inspection.approvedAt) : '—'], ['Generated by', `${data.generatedBy.trim()} - ${organizationName}`]]);
  }

  private pageNumbers(doc: PDFKit.PDFDocument) {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - MARGIN - 10;
      // lineBreak:false is critical: the footer must never cause PDFKit to
      // advance to another page while it is being written.
      doc.font('Helvetica').fontSize(7).fillColor(C.muted).text(`Page ${i + 1} of ${range.count}`, MARGIN, footerY, {
        width: CONTENT_WIDTH,
        align: 'center',
        lineBreak: false,
      });
    }
  }

  private section(doc: PDFKit.PDFDocument, title: string) {
    this.ensure(doc, 42);
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(C.ink).text(title, MARGIN, doc.y);
    doc.moveTo(MARGIN, doc.y + 4).lineTo(MARGIN + CONTENT_WIDTH, doc.y + 4).strokeColor(C.rule).lineWidth(0.6).stroke();
    doc.moveDown(0.45);
  }

  private kv(doc: PDFKit.PDFDocument, rows: Array<[string, string]>) {
    for (const [l, v] of rows) {
      this.ensure(doc, 22);
      const y = doc.y;
      doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(l, MARGIN + 6, y, { width: 150, lineBreak: false });
      doc.font('Helvetica').fontSize(9).fillColor(C.ink).text(v, MARGIN + 160, y, { width: CONTENT_WIDTH - 166, ellipsis: true, lineBreak: false });
      doc.moveDown(0.45);
    }
  }

  private note(doc: PDFKit.PDFDocument, t: string) {
    this.ensure(doc, 28);
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(C.muted).text(t, MARGIN + 6, doc.y, { lineBreak: false });
    doc.moveDown(0.5);
  }

  private ensure(doc: PDFKit.PDFDocument, h: number) {
    if (doc.y + h > doc.page.height - MARGIN) doc.addPage();
  }

  private human(v: string | null) { if (!v) return '—'; return v.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
  private money(v: number | null, c: string) { return v === null ? '—' : `${c} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
  private dt(v: Date) { return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Kigali' }).format(v); }
}
