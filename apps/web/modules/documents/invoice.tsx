import 'server-only';
import { documentByGenerationKey, invoiceFacts, type Db, type InvoiceFacts } from '@clinic-mx/db';
import {
  billKindLabels,
  documentCalendarDate,
  documentDate,
  documentDateTime,
  formatRupees,
  packageValidUntil,
  paymentMethodLabels,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { systemService } from '../access/service';
import { getSetting } from '../settings/settings';
import { Fields, LetterheadDocument, Mono, Paragraph, Section, Table } from './letterhead';
import { generateDocument, type GeneratedDocument } from './services';

/**
 * The invoice and receipt (BIL-09; Frontend Specification section 11: bill number, date, centre,
 * patient, line items, total, payment method and reference, package details and expiry). Made by
 * the job a payment queues; when the payment is undone the next version prints it as cancelled
 * (user decisions, 25 October 2026). No discounts yet (BIL-07); no tax line or legal details until
 * the client lists them (decision 17, DECISION ALT-05).
 */

export interface InvoiceContent {
  /** The cancelled version's notice, first on the page. */
  notice: string | null;
  invoice: [string, string][];
  patient: [string, string][];
  items: string[][];
  payment: [string, string][];
  /** For a package bill: what was bought and until when it is valid. */
  package: string | null;
}

/** What the invoice prints; tested without rendering. Mono fields are marked by their label. */
export function invoiceContent(facts: InvoiceFacts, validityMonths: number): InvoiceContent {
  const payment: [string, string][] = [
    ['Paid by', paymentMethodLabels[facts.method]],
    ...(facts.reference ? [['Reference', facts.reference] as [string, string]] : []),
    ['Amount paid', formatRupees(facts.totalPaise)],
    ['Received', documentDateTime(facts.paidAt)],
    ...(facts.receivedBy ? [['Received by', facts.receivedBy] as [string, string]] : []),
  ];
  return {
    notice: facts.undone
      ? `Cancelled: the payment was undone on ${documentDate(facts.undone.at)}. ${facts.undone.reason}`
      : null,
    invoice: [
      ['Invoice number', facts.invoiceNumber],
      ['Bill number', facts.billNumber],
      ['For', billKindLabels[facts.billKind]],
      ['Date', documentDate(facts.paidAt)],
      ['Centre', facts.centre.name],
    ],
    patient: [
      ['Name', facts.patient.name],
      ['OP number', facts.patient.opNumber],
    ],
    items: [
      ...facts.lines.map((line) => [
        line.description,
        String(line.quantity),
        formatRupees(line.unitPaise),
        formatRupees(line.amountPaise),
      ]),
      ['Total', '', '', formatRupees(facts.totalPaise)],
    ],
    payment,
    package: facts.package
      ? `${facts.package.name} · ${String(facts.package.sessions)} sessions · Valid until ${documentCalendarDate(
          packageValidUntil(facts.paidAt, validityMonths),
        )} (${String(validityMonths)} months from payment)`
      : null,
  };
}

const monoLabels = new Set(['Invoice number', 'Bill number', 'OP number', 'Reference']);
const fields = (rows: [string, string][]) =>
  rows.map(
    ([label, value]) =>
      [label, monoLabels.has(label) ? <Mono key={label}>{value}</Mono> : value] as const,
  );

export function Invoice({
  facts,
  content,
  version,
  generatedAt,
}: {
  facts: InvoiceFacts;
  content: InvoiceContent;
  version: number;
  generatedAt: Date;
}) {
  return (
    <LetterheadDocument
      title={`Invoice ${facts.invoiceNumber}`}
      centre={facts.centre}
      versionLabel={`Version ${String(version)}`}
      generatedAt={generatedAt}
    >
      {content.notice ? <Paragraph>{content.notice}</Paragraph> : null}
      <Section heading="Invoice and receipt">
        <Fields rows={fields(content.invoice)} />
      </Section>
      <Section heading="Patient">
        <Fields rows={fields(content.patient)} />
      </Section>
      <Section heading="Items">
        <Table
          columns={[
            { label: 'Item' },
            { label: 'Quantity', align: 'end' },
            { label: 'Price', align: 'end' },
            { label: 'Amount', align: 'end' },
          ]}
          rows={content.items}
        />
      </Section>
      {content.package ? (
        <Section heading="Package">
          <Paragraph>{content.package}</Paragraph>
        </Section>
      ) : null}
      <Section heading="Payment">
        <Fields rows={fields(content.payment)} />
      </Section>
    </LetterheadDocument>
  );
}

/**
 * The job's work (`documents.invoice`): the next version of a payment's invoice, as the system,
 * keyed by the job so a rerun makes nothing new. Returns what it made, or why it made nothing.
 */
export async function generateInvoice(
  db: Db,
  paymentId: string,
  generationKey: string,
  generate: typeof generateDocument = generateDocument,
): Promise<GeneratedDocument | 'already made' | 'no invoice'> {
  const validityMonths = await getSetting('packages.validity_months');
  const service = systemService({
    component: 'documents',
    input: z.object({ paymentId: z.guid(), generationKey: z.string().min(1) }),
    run: async (tx, input): Promise<GeneratedDocument | 'already made' | 'no invoice'> => {
      if (await documentByGenerationKey(tx, input.generationKey)) return 'already made';
      const facts = await invoiceFacts(tx, input.paymentId);
      if (!facts) return 'no invoice';
      const content = invoiceContent(facts, validityMonths);
      return generate(tx, {
        kind: 'invoice_receipt',
        patientId: facts.patientId,
        episodeId: facts.episodeId,
        centreId: facts.centreId,
        sourceId: input.paymentId,
        generationKey: input.generationKey,
        build: ({ version, generatedAt }) => (
          <Invoice facts={facts} content={content} version={version} generatedAt={generatedAt} />
        ),
      });
    },
  });
  return service(db, { paymentId, generationKey });
}
