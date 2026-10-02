/**
 * Evidence pack (F12, TRD section 9).
 *
 * pdfkit writes, in order: ring summary, the graph image the browser captured,
 * a role table with reasons, the taint table with recommended liens, the freeze
 * recommendation, likely recruits, and a footer stating the data is synthetic.
 *
 * The pack must always be produced. If the ML service is down the cached
 * defaults are used, and if a section is missing the document is still written
 * with a note saying so. A PDF that fails to generate mid-demo is worse than a
 * PDF with one thin section.
 */
import PDFDocument from 'pdfkit';
import { iso } from '../utilities/serialize.util.js';
import type { Account, FreezePayload, Recruit, Ring, TaintPayload } from '../interfaces/domain.interface.js';

const PAGE_MARGIN = 48;

const rupees = (n: number | null | undefined): string =>
  `Rs ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

const pct = (n: number | null | undefined): string => `${Math.round((Number(n) || 0) * 100)}%`;

interface Column {
  key: string;
  label: string;
  /** Fraction of the usable width. Should sum to 1. */
  width: number;
  muted?: boolean;
}

const heading = (doc: PDFKit.PDFDocument, text: string): void => {
  doc.moveDown(0.8).fontSize(13).fillColor('#111827').text(text);
  doc.moveDown(0.3);
};

/** Simple fixed-column table. Long reason cells wrap inside their column. */
const table = (doc: PDFKit.PDFDocument, { columns, rows }: { columns: Column[]; rows: Record<string, unknown>[] }): void => {
  const startX = PAGE_MARGIN;
  const usable = doc.page.width - PAGE_MARGIN * 2;
  const widths = columns.map((c) => c.width * usable);

  const drawHeader = (): void => {
    const y = doc.y;
    let x = startX;
    doc.fontSize(8).fillColor('#6b7280');
    columns.forEach((col, i) => {
      doc.text(col.label.toUpperCase(), x, y, { width: widths[i]! - 6 });
      x += widths[i]!;
    });
    doc.y = y + 12;
  };

  drawHeader();

  doc.fontSize(9).fillColor('#111827');
  for (const row of rows) {
    // Move to a new page before drawing if this row would overflow.
    if (doc.y > doc.page.height - PAGE_MARGIN - 24) {
      doc.addPage();
      drawHeader();
      doc.fontSize(9).fillColor('#111827');
    }
    const y = doc.y;
    let x = startX;
    let maxHeight = 0;
    columns.forEach((col, i) => {
      const cell = String(row[col.key] ?? '');
      const height = doc.heightOfString(cell, { width: widths[i]! - 6 });
      doc.fillColor(col.muted ? '#6b7280' : '#111827').text(cell, x, y, { width: widths[i]! - 6 });
      maxHeight = Math.max(maxHeight, height);
      x += widths[i]!;
    });
    doc.y = y + Math.max(maxHeight, 10) + 6;
    doc
      .moveTo(startX, doc.y - 3)
      .lineTo(startX + usable, doc.y - 3)
      .lineWidth(0.5)
      .strokeColor('#e5e7eb')
      .stroke();
  }
  doc.moveDown(0.4);
};

export interface EvidenceInput {
  ring: Ring;
  members: Account[];
  taint: TaintPayload;
  freeze: FreezePayload;
  recruits: Recruit[];
  /** Base64 PNG from cy.png(). */
  graphPng?: string | null;
  generatedAt?: string;
}

export const buildEvidencePdf = (input: EvidenceInput): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const { ring, members = [], taint, freeze, recruits = [], graphPng = null, generatedAt } = input;

    // Compression is left at pdfkit's default. Turning it off does not make the
    // text greppable: pdfkit writes glyph indices in hex either way, because
    // the embedded font uses WinAnsiEncoding. PDF readers extract the text
    // correctly regardless, so the only effect of disabling it would be a larger
    // file.
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const generated = generatedAt ?? new Date().toISOString();

    // ---------------------------------------------------------------- header
    doc.fontSize(18).fillColor('#111827').text(`Evidence pack: ${ring.id}`);
    doc
      .fontSize(9)
      .fillColor('#6b7280')
      .text(`Chakravyuh fraud network intelligence · generated ${iso(generated)}`);
    doc.moveDown(0.6);

    doc.fontSize(9).fillColor('#111827');
    doc.text(
      `Risk score ${pct(ring.risk)}    ·    ${ring.member_ids?.length ?? 0} linked accounts    ·    ${rupees(ring.volume)} moved`,
    );
    if (ring.victim_txn_ids?.length) doc.text(`Victim transaction: ${ring.victim_txn_ids.join(', ')}`);

    // ------------------------------------------------------- graph image (F12)
    if (graphPng) {
      heading(doc, 'Network graph');
      try {
        const image = Buffer.from(graphPng, 'base64');
        const usable = doc.page.width - PAGE_MARGIN * 2;
        doc.image(image, PAGE_MARGIN, doc.y, { fit: [usable, 240], align: 'center' });
        doc.y += 250;
      } catch {
        doc.fontSize(8).fillColor('#9ca3af').text('Graph image could not be embedded.');
        doc.moveDown(0.5);
      }
    }

    // ------------------------------------------------------------- role table
    heading(doc, 'Roles and the rule behind each');
    table(doc, {
      columns: [
        { key: 'id', label: 'Account', width: 0.16 },
        { key: 'role', label: 'Role', width: 0.16 },
        { key: 'risk', label: 'Risk', width: 0.1 },
        { key: 'reason', label: 'Why', width: 0.58 },
      ],
      rows: members.map((a) => ({
        id: a.id,
        role: a.role ?? 'member',
        risk: pct(a.risk_v2 ?? 0),
        reason: a.role_reason ?? '',
      })),
    });

    // ------------------------------------------------------------ taint table
    heading(doc, 'Money trail and recommended liens');
    if (taint?.as_of) {
      doc.fontSize(8).fillColor('#6b7280').text(`Traced as at ${iso(taint.as_of)}${taint.cached ? ' · precomputed' : ''}`);
      doc.moveDown(0.3);
    }
    const taintAccounts = taint?.accounts ?? [];
    if (!taintAccounts.length) {
      doc.fontSize(9).fillColor('#9ca3af').text('No taint trace available for this ring.');
      doc.moveDown(0.5);
    } else {
      table(doc, {
        columns: [
          { key: 'id', label: 'Account', width: 0.2 },
          { key: 'balance', label: 'Balance', width: 0.22 },
          { key: 'tainted', label: 'Tainted', width: 0.22 },
          { key: 'lien', label: 'Recommended lien', width: 0.36 },
        ],
        rows: taintAccounts.map((a) => ({
          id: a.id,
          balance: rupees(a.balance),
          tainted: rupees(a.tainted),
          lien: rupees(a.lien),
        })),
      });
      doc
        .fontSize(9)
        .fillColor('#111827')
        .text(
          `Of ${rupees(taint.victim_amount ?? 0)} traced, ${rupees(taint.lost_to_cash ?? 0)} has already been withdrawn and ${rupees(
            taintAccounts.reduce((s, a) => s + (a.tainted ?? 0), 0),
          )} remains in accounts.`,
        );
      doc.moveDown(0.4);
    }

    // ---------------------------------------------------------- freeze section
    heading(doc, 'Recommended freezes');
    const freezeIds = freeze?.freeze ?? [];
    if (!freezeIds.length) {
      doc.fontSize(9).fillColor('#9ca3af').text('No freeze recommendation available for this ring.');
      doc.moveDown(0.5);
    } else {
      doc
        .fontSize(9)
        .fillColor('#111827')
        .text(
          `Freeze ${freezeIds.join(', ')}. This secures ${rupees(freeze.secured)} of ${rupees(freeze.at_risk_before)} still at risk, ${pct(freeze.pct_stopped)}.`,
        );
      doc
        .fontSize(8)
        .fillColor('#6b7280')
        .text(
          'Liens above are proportionate to the tainted amount rather than a blanket freeze of the full balance. Money already withdrawn cannot be recovered by a freeze.',
        );
      doc.moveDown(0.4);
    }

    // -------------------------------------------------------- recruits section
    if (recruits.length) {
      heading(doc, 'Accounts likely to join next');
      table(doc, {
        columns: [
          { key: 'id', label: 'Account', width: 0.18 },
          { key: 'probability', label: 'Probability', width: 0.16 },
          { key: 'reasons', label: 'Top reasons', width: 0.66 },
        ],
        rows: recruits.map((r) => ({
          id: r.id,
          probability: pct(r.probability),
          reasons: (r.reasons ?? []).join('; '),
        })),
      });
    }

    // ------------------------------------------------------------------ footer
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      const y = doc.page.height - 34;
      doc
        .fontSize(7)
        .fillColor('#9ca3af')
        .text(
          'All data in this pack is synthetic. The fraud rings were planted by the Chakravyuh team to demonstrate detection, not drawn from real accounts.',
          PAGE_MARGIN,
          y,
          { width: doc.page.width - PAGE_MARGIN * 2 - 40, lineBreak: false },
        );
      doc
        .fontSize(7)
        .fillColor('#9ca3af')
        .text(`Page ${i + 1} of ${range.count}`, doc.page.width - PAGE_MARGIN - 40, y, {
          width: 40,
          align: 'right',
          lineBreak: false,
        });
    }

    doc.end();
  });
