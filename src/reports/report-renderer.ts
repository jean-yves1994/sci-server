import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { describePhotoCategory } from '../inspections/domain/completeness';
import { StorageProvider } from '../providers/storage/storage.provider';

/**
 * Official report rendering.
 *
 * Everything printed comes from the stored inspection. Nothing is invented,
 * defaulted or computed here: a figure that appeared only in the PDF would be a
 * number the institution never actually recorded, and this document may be
 * relied upon in a lending decision.
 */

export interface ReportData {
  organization: {
    name: string;
    legalName: string | null;
    addressLine: string | null;
    phone: string | null;
    email: string | null;
  };
  reportNumber: string;
  version: number;
  generatedAt: Date;
  generatedBy: string;

  inspection: {
    inspectionNumber: string;
    loanReference: string;
    clientName: string | null;
    status: string;
    submittedAt: Date | null;
    approvedAt: Date | null;
    branch: string;
  };

  property: {
    reference: string;
    propertyType: string;
    addressLine: string;
    plotNumber: string | null;
    titleNumber: string | null;
    division: string | null;
  };

  owner: {
    fullName: string;
    phone: string | null;
    email: string | null;
    occupancyStatus: string | null;
    ownershipType: string | null;
  } | null;

  people: { inspector: string | null; reviewer: string | null };

  location: {
    latitude: number;
    longitude: number;
    accuracyM: number | null;
    capturedAt: Date;
    distanceFromPropertyM: number | null;
  } | null;

  assessments: Array<{
    categoryName: string;
    rating: number | null;
    condition: string | null;
    notes: string | null;
  }>;

  valuation: {
    currency: string;
    marketValue: number | null;
    forcedSaleValue: number | null;
    replacementCost: number | null;
    rentalEstimate: number | null;
    comments: string | null;
  } | null;

  fieldValues: Array<{ section: string; label: string; value: string }>;

  photos: Array<{ category: string; storageKey: string; caption: string | null; capturedAt: Date | null }>;

  reviewerComments: Array<{ author: string; body: string; createdAt: Date; type: string }>;

  timeline: Array<{ toStatus: string; actor: string | null; createdAt: Date; comment: string | null }>;
}

const COLOURS = {
  ink: '#0f172a',
  muted: '#64748b',
  rule: '#cbd5e1',
  brand: '#1d4ed8',
  panel: '#f1f5f9',
};

const MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4 portrait
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

@Injectable()
export class ReportRenderer {
  private readonly logger = new Logger(ReportRenderer.name);

  constructor(private readonly storage: StorageProvider) {}

  async render(data: ReportData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const finished = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    this.drawHeader(doc, data);
    this.drawSummary(doc, data);
    this.drawProperty(doc, data);
    this.drawOwner(doc, data);
    this.drawLocation(doc, data);
    this.drawFieldValues(doc, data);
    this.drawAssessments(doc, data);
    this.drawValuation(doc, data);
    this.drawComments(doc, data);
    await this.drawPhotos(doc, data);
    this.drawTimeline(doc, data);
    this.drawApproval(doc, data);
    this.drawPageNumbers(doc, data);

    doc.end();
    return finished;
  }

  // -------------------------------------------------------------------------

  private drawHeader(doc: PDFKit.PDFDocument, data: ReportData): void {
    doc.rect(0, 0, PAGE_WIDTH, 92).fill(COLOURS.brand);

    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(17)
      .text(data.organization.legalName ?? data.organization.name, MARGIN, 26);

    doc.font('Helvetica').fontSize(9)
      .text('Collateral Inspection Report', MARGIN, 48);

    doc.font('Helvetica-Bold').fontSize(11)
      .text(data.reportNumber, MARGIN, 26, { width: CONTENT_WIDTH, align: 'right' });

    doc.font('Helvetica').fontSize(8)
      .text(
        `Version ${data.version} · Generated ${this.formatDateTime(data.generatedAt)}`,
        MARGIN, 44, { width: CONTENT_WIDTH, align: 'right' },
      );

    doc.fillColor(COLOURS.ink);
    doc.y = 118;
  }

  private drawSummary(doc: PDFKit.PDFDocument, data: ReportData): void {
    const top = doc.y;
    doc.rect(MARGIN, top, CONTENT_WIDTH, 74).fill(COLOURS.panel);
    doc.fillColor(COLOURS.ink);

    const column = CONTENT_WIDTH / 3;
    const entries: Array<[string, string]> = [
      ['Inspection', data.inspection.inspectionNumber],
      ['Loan reference', data.inspection.loanReference],
      ['Branch', data.inspection.branch],
      ['Client', data.inspection.clientName ?? '—'],
      ['Inspector', data.people.inspector ?? '—'],
      ['Reviewer', data.people.reviewer ?? '—'],
    ];

    entries.forEach(([label, value], index) => {
      const x = MARGIN + 12 + (index % 3) * column;
      const y = top + 12 + Math.floor(index / 3) * 30;
      doc.font('Helvetica').fontSize(7).fillColor(COLOURS.muted).text(label.toUpperCase(), x, y);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLOURS.ink)
        .text(value, x, y + 10, { width: column - 16, ellipsis: true });
    });

    doc.y = top + 92;
  }

  private drawProperty(doc: PDFKit.PDFDocument, data: ReportData): void {
    this.sectionTitle(doc, 'Property');
    this.keyValues(doc, [
      ['Reference', data.property.reference],
      ['Type', data.property.propertyType],
      ['Address', data.property.addressLine],
      ['Administrative location', data.property.division ?? '—'],
      ['Plot number', data.property.plotNumber ?? '—'],
      ['Title number', data.property.titleNumber ?? '—'],
    ]);
  }

  private drawOwner(doc: PDFKit.PDFDocument, data: ReportData): void {
    this.sectionTitle(doc, 'Owner');

    if (!data.owner) {
      this.note(doc, 'No owner information was recorded.');
      return;
    }

    // The national ID is deliberately omitted. It is encrypted at rest, and a
    // PDF is forwarded by email and stored on shared drives; reproducing it
    // here would undo the protection for no operational benefit.
    this.keyValues(doc, [
      ['Name', data.owner.fullName],
      ['Phone', data.owner.phone ?? '—'],
      ['Email', data.owner.email ?? '—'],
      ['Occupancy', this.humanise(data.owner.occupancyStatus)],
      ['Ownership', this.humanise(data.owner.ownershipType)],
    ]);
  }

  private drawLocation(doc: PDFKit.PDFDocument, data: ReportData): void {
    this.sectionTitle(doc, 'Location verification');

    if (!data.location) {
      this.note(doc, 'No GPS reading was captured for this inspection.');
      return;
    }

    const rows: Array<[string, string]> = [
      ['Latitude', data.location.latitude.toFixed(6)],
      ['Longitude', data.location.longitude.toFixed(6)],
      ['Accuracy', data.location.accuracyM ? `${Math.round(data.location.accuracyM)} m` : '—'],
      ['Captured', this.formatDateTime(data.location.capturedAt)],
    ];

    if (data.location.distanceFromPropertyM !== null) {
      rows.push([
        'Distance from registered position',
        `${data.location.distanceFromPropertyM} m`,
      ]);
    }

    this.keyValues(doc, rows);
  }

  private drawFieldValues(doc: PDFKit.PDFDocument, data: ReportData): void {
    if (data.fieldValues.length === 0) return;

    this.sectionTitle(doc, 'Recorded information');

    let currentSection = '';
    for (const entry of data.fieldValues) {
      this.ensureSpace(doc, 34);

      if (entry.section !== currentSection) {
        currentSection = entry.section;
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLOURS.brand)
          .text(currentSection.toUpperCase(), MARGIN, doc.y);
        doc.moveDown(0.2);
      }

      this.keyValues(doc, [[entry.label, entry.value]]);
    }
  }

  private drawAssessments(doc: PDFKit.PDFDocument, data: ReportData): void {
    this.sectionTitle(doc, 'Condition assessment');

    if (data.assessments.length === 0) {
      this.note(doc, 'No assessment categories were recorded.');
      return;
    }

    const colCategory = MARGIN + 6;
    const colRating = MARGIN + 210;
    const colCondition = MARGIN + 285;

    this.ensureSpace(doc, 26);
    doc.rect(MARGIN, doc.y, CONTENT_WIDTH, 18).fill(COLOURS.panel);
    doc.fillColor(COLOURS.muted).font('Helvetica-Bold').fontSize(7.5);
    doc.text('CATEGORY', colCategory, doc.y + 5.5);
    doc.text('RATING', colRating, doc.y);
    doc.text('CONDITION', colCondition, doc.y);
    doc.y += 22;

    for (const assessment of data.assessments) {
      this.ensureSpace(doc, 30);
      const rowY = doc.y;

      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOURS.ink)
        .text(assessment.categoryName, colCategory, rowY, { width: 195 });

      doc.font('Helvetica').fontSize(9).fillColor(COLOURS.ink)
        .text(assessment.rating !== null ? `${assessment.rating} / 5` : '—', colRating, rowY, { width: 70 });

      doc.text(this.humanise(assessment.condition), colCondition, rowY, { width: 120 });

      let bottom = Math.max(doc.y, rowY + 12);

      if (assessment.notes) {
        doc.font('Helvetica-Oblique').fontSize(8).fillColor(COLOURS.muted)
          .text(assessment.notes, colCategory, bottom + 2, { width: CONTENT_WIDTH - 12 });
        bottom = doc.y;
      }

      doc.moveTo(MARGIN, bottom + 5).lineTo(MARGIN + CONTENT_WIDTH, bottom + 5)
        .strokeColor(COLOURS.rule).lineWidth(0.4).stroke();

      doc.y = bottom + 11;
    }
  }

  private drawValuation(doc: PDFKit.PDFDocument, data: ReportData): void {
    this.sectionTitle(doc, 'Valuation');

    if (!data.valuation) {
      this.note(doc, 'No valuation was recorded.');
      return;
    }

    const currency = data.valuation.currency;
    this.keyValues(doc, [
      ['Market value', this.money(data.valuation.marketValue, currency)],
      ['Forced sale value', this.money(data.valuation.forcedSaleValue, currency)],
      ['Replacement cost', this.money(data.valuation.replacementCost, currency)],
      ['Rental estimate', this.money(data.valuation.rentalEstimate, currency)],
    ]);

    if (data.valuation.comments) {
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(9).fillColor(COLOURS.ink)
        .text(data.valuation.comments, MARGIN + 6, doc.y, { width: CONTENT_WIDTH - 12 });
      doc.moveDown(0.5);
    }
  }

  private drawComments(doc: PDFKit.PDFDocument, data: ReportData): void {
    if (data.reviewerComments.length === 0) return;

    this.sectionTitle(doc, 'Reviewer comments');

    for (const comment of data.reviewerComments) {
      this.ensureSpace(doc, 44);
      const top = doc.y;

      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLOURS.ink)
        .text(comment.author, MARGIN + 6, top);
      doc.font('Helvetica').fontSize(7.5).fillColor(COLOURS.muted)
        .text(
          `${this.humanise(comment.type)} · ${this.formatDateTime(comment.createdAt)}`,
          MARGIN + 6, doc.y,
        );

      doc.font('Helvetica').fontSize(9).fillColor(COLOURS.ink)
        .text(comment.body, MARGIN + 6, doc.y + 2, { width: CONTENT_WIDTH - 12 });

      doc.moveDown(0.6);
    }
  }

  private async drawPhotos(doc: PDFKit.PDFDocument, data: ReportData): Promise<void> {
    if (data.photos.length === 0) return;

    doc.addPage();
    this.sectionTitle(doc, 'Photographic evidence');

    const columns = 2;
    const gap = 14;
    const cellWidth = (CONTENT_WIDTH - gap) / columns;
    const imageHeight = 138;

    let column = 0;
    let rowTop = doc.y;

    for (const photo of data.photos) {
      if (rowTop + imageHeight + 34 > doc.page.height - MARGIN) {
        doc.addPage();
        rowTop = doc.y;
        column = 0;
      }

      const x = MARGIN + column * (cellWidth + gap);

      try {
        const buffer = await this.storage.get(photo.storageKey);
        doc.image(buffer, x, rowTop, {
          fit: [cellWidth, imageHeight],
          align: 'center',
          valign: 'center',
        });
      } catch (error) {
        // A missing object must not abort the whole report; the caption still
        // records that the photograph existed.
        this.logger.warn(`Photo ${photo.storageKey} unavailable: ${String(error)}`);
        doc.rect(x, rowTop, cellWidth, imageHeight).fill(COLOURS.panel);
        doc.fillColor(COLOURS.muted).font('Helvetica').fontSize(8)
          .text('Image unavailable', x, rowTop + imageHeight / 2 - 4, {
            width: cellWidth, align: 'center',
          });
      }

      doc.fillColor(COLOURS.ink).font('Helvetica-Bold').fontSize(8)
        .text(describePhotoCategory(photo.category), x, rowTop + imageHeight + 5, {
          width: cellWidth, ellipsis: true,
        });

      if (photo.caption) {
        doc.font('Helvetica').fontSize(7.5).fillColor(COLOURS.muted)
          .text(photo.caption, x, rowTop + imageHeight + 16, { width: cellWidth, ellipsis: true });
      }

      column += 1;
      if (column >= columns) {
        column = 0;
        rowTop += imageHeight + 40;
        doc.y = rowTop;
      }
    }

    doc.y = rowTop + (column > 0 ? imageHeight + 40 : 0);
  }

  private drawTimeline(doc: PDFKit.PDFDocument, data: ReportData): void {
    if (data.timeline.length === 0) return;

    this.ensureSpace(doc, 90);
    this.sectionTitle(doc, 'Inspection history');

    for (const event of data.timeline) {
      this.ensureSpace(doc, 18);
      const y = doc.y;

      doc.circle(MARGIN + 8, y + 5, 2.6).fill(COLOURS.brand);
      doc.fillColor(COLOURS.ink).font('Helvetica-Bold').fontSize(8.5)
        .text(this.humanise(event.toStatus), MARGIN + 20, y, { width: 150 });
      doc.font('Helvetica').fontSize(8).fillColor(COLOURS.muted)
        .text(event.actor ?? 'System', MARGIN + 180, y, { width: 150 });
      doc.text(this.formatDateTime(event.createdAt), MARGIN + 330, y, {
        width: CONTENT_WIDTH - 330, align: 'right',
      });

      doc.y = Math.max(doc.y, y + 13);
    }
  }

  private drawApproval(doc: PDFKit.PDFDocument, data: ReportData): void {
    this.ensureSpace(doc, 88);
    doc.moveDown(0.6);

    const top = doc.y;
    doc.rect(MARGIN, top, CONTENT_WIDTH, 68).fill(COLOURS.panel);

    doc.fillColor(COLOURS.ink).font('Helvetica-Bold').fontSize(9.5)
      .text('Approval', MARGIN + 12, top + 11);

    doc.font('Helvetica').fontSize(8.5).fillColor(COLOURS.ink)
      .text(
        `Approved by ${data.people.reviewer ?? '—'} on ${
          data.inspection.approvedAt ? this.formatDateTime(data.inspection.approvedAt) : '—'
        }.`,
        MARGIN + 12, top + 27, { width: CONTENT_WIDTH - 24 },
      );

    doc.font('Helvetica').fontSize(7.5).fillColor(COLOURS.muted)
      .text(
        `This report was generated from inspection ${data.inspection.inspectionNumber} by ${data.generatedBy}. Report ${data.reportNumber}, version ${data.version}.`,
        MARGIN + 12, top + 44, { width: CONTENT_WIDTH - 24 },
      );

    doc.y = top + 80;
  }

  private drawPageNumbers(doc: PDFKit.PDFDocument, data: ReportData): void {
    const range = doc.bufferedPageRange();

    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(7.5).fillColor(COLOURS.muted)
        .text(
          `${data.reportNumber} · Page ${i - range.start + 1} of ${range.count}`,
          MARGIN,
          doc.page.height - 32,
          { width: CONTENT_WIDTH, align: 'center' },
        );
    }
  }

  // --- helpers -------------------------------------------------------------

  private sectionTitle(doc: PDFKit.PDFDocument, title: string): void {
    this.ensureSpace(doc, 46);
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLOURS.ink)
      .text(title, MARGIN, doc.y);

    const y = doc.y + 3;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y)
      .strokeColor(COLOURS.rule).lineWidth(0.8).stroke();

    doc.y = y + 8;
  }

  private keyValues(doc: PDFKit.PDFDocument, rows: Array<[string, string]>): void {
    for (const [label, value] of rows) {
      this.ensureSpace(doc, 18);
      const y = doc.y;

      doc.font('Helvetica').fontSize(8.5).fillColor(COLOURS.muted)
        .text(label, MARGIN + 6, y, { width: 168 });

      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOURS.ink)
        .text(value || '—', MARGIN + 180, y, { width: CONTENT_WIDTH - 186 });

      doc.y = Math.max(doc.y, y + 13);
    }
  }

  private note(doc: PDFKit.PDFDocument, text: string): void {
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(COLOURS.muted)
      .text(text, MARGIN + 6, doc.y, { width: CONTENT_WIDTH - 12 });
    doc.moveDown(0.4);
  }

  /** Starts a new page when the remaining space cannot hold the next block. */
  private ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
    if (doc.y + needed > doc.page.height - MARGIN - 24) doc.addPage();
  }

  private money(value: number | null, currency: string): string {
    if (value === null || value === undefined) return '—';
    return `${currency} ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)}`;
  }

  private humanise(value: string | null | undefined): string {
    if (!value) return '—';
    return value
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }

  private formatDateTime(value: Date): string {
    return new Date(value).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
}
