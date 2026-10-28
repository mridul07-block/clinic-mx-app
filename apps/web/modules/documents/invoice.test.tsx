import type { InvoiceFacts } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPdf } from './render';

const db = vi.hoisted(() => ({
  invoiceFacts: vi.fn(),
  documentByGenerationKey: vi.fn(),
  systemActor: (component: string) => `system:${component}`,
  withActor: vi.fn((_db: unknown, _actor: unknown, work: (tx: unknown) => unknown) =>
    work({ kind: 'transaction' }),
  ),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../settings/settings', () => ({ getSetting: () => Promise.resolve(3) }));

const { Invoice, generateInvoice, invoiceContent } = await import('./invoice');

// BIL-09: the invoice and receipt of a payment, with the package's expiry from the payment date,
// and a version marked cancelled once the payment is undone.
const paymentId = '00000000-0000-4000-8000-000000000c01';
const facts = (overrides: Partial<InvoiceFacts> = {}): InvoiceFacts => ({
  paymentId,
  invoiceNumber: 'HSR-INV-00007',
  billNumber: 'HSR-B-00012',
  billKind: 'package',
  patientId: '00000000-0000-4000-8000-000000000002',
  episodeId: '00000000-0000-4000-8000-000000000003',
  centreId: '00000000-0000-4000-8000-000000000004',
  centre: { name: 'HSR Layout', address: '27th Main, HSR Layout', phone: '+918041234567' },
  patient: { name: 'Test Patient 0000', opNumber: 'HSR-00001' },
  lines: [
    {
      description: 'Ten sessions',
      quantity: 1,
      unitPaise: 900000,
      amountPaise: 900000,
      discount: null,
    },
  ],
  totalPaise: 900000,
  method: 'upi',
  reference: 'UPI-4528',
  receivedBy: 'Test Desk',
  // 30 Nov 2026, 4:05 PM IST.
  paidAt: new Date('2026-11-30T10:35:00Z'),
  package: { name: 'Ten sessions', sessions: 10 },
  undone: null,
  ...overrides,
});

describe('invoiceContent', () => {
  it('prints the numbers, the patient, the items with the total and how it was paid', () => {
    const content = invoiceContent(facts(), 3);
    expect(content.notice).toBeNull();
    expect(content.invoice).toEqual([
      ['Invoice number', 'HSR-INV-00007'],
      ['Bill number', 'HSR-B-00012'],
      ['For', 'Package'],
      ['Date', '30 Nov 2026'],
      ['Centre', 'HSR Layout'],
    ]);
    expect(content.patient).toEqual([
      ['Name', 'Test Patient 0000'],
      ['OP number', 'HSR-00001'],
    ]);
    expect(content.items).toEqual([
      ['Ten sessions', '1', '₹9,000', '₹9,000'],
      ['Total', '', '', '₹9,000'],
    ]);
    expect(content.payment).toEqual([
      ['Paid by', 'UPI QR'],
      ['Reference', 'UPI-4528'],
      ['Amount paid', '₹9,000'],
      ['Received', '30 Nov 2026, 4:05 PM'],
      ['Received by', 'Test Desk'],
    ]);
  });

  it('dates the package from the payment, to the month’s last day when it is shorter', () => {
    expect(invoiceContent(facts(), 3).package).toBe(
      'Ten sessions · 10 sessions · Valid until 28 Feb 2027 (3 months from payment)',
    );
    expect(
      invoiceContent(facts({ paidAt: new Date('2026-10-25T06:00:00Z') }), 3).package,
    ).toContain('Valid until 25 Jan 2027');
  });

  it('prints a consultation without a package, cash without a reference, and no tax or discount', () => {
    const content = invoiceContent(
      facts({
        billKind: 'consultation',
        package: null,
        method: 'cash',
        reference: null,
        lines: [
          {
            description: 'Consultation',
            quantity: 1,
            unitPaise: 75000,
            amountPaise: 75000,
            discount: null,
          },
        ],
        totalPaise: 75000,
      }),
      3,
    );
    expect(content.package).toBeNull();
    expect(content.invoice).toContainEqual(['For', 'Consultation fee']);
    expect(content.payment.map(([label]) => label)).toEqual([
      'Paid by',
      'Amount paid',
      'Received',
      'Received by',
    ]);
    expect(JSON.stringify(content)).not.toMatch(/tax|GST|discount/i);
  });

  // BIL-07: a discount prints under its line, and the total is what was paid.
  it('prints a discount under its line and the paid total', () => {
    const content = invoiceContent(
      facts({
        lines: [
          {
            description: 'Ten sessions',
            quantity: 1,
            unitPaise: 900000,
            amountPaise: 900000,
            discount: { name: 'Staff family', percent: 10, paise: 90000 },
          },
        ],
        totalPaise: 810000,
      }),
      3,
    );
    expect(content.items).toEqual([
      ['Ten sessions', '1', '₹9,000', '₹9,000'],
      ['Less: Staff family (10%)', '', '', '-₹900'],
      ['Total', '', '', '₹8,100'],
    ]);
    expect(content.payment).toContainEqual(['Amount paid', '₹8,100']);
  });

  it('marks the version made after an undo as cancelled, with the reason', () => {
    expect(
      invoiceContent(
        facts({ undone: { at: new Date('2026-11-30T11:00:00Z'), reason: 'Wrong patient.' } }),
        3,
      ).notice,
    ).toBe('Cancelled: the payment was undone on 30 Nov 2026. Wrong patient.');
  });
});

describe('Invoice', () => {
  it('renders an A4 PDF on the letterhead with Plex embedded', async () => {
    const bytes = await renderPdf(
      <Invoice
        facts={facts()}
        content={invoiceContent(facts(), 3)}
        version={1}
        generatedAt={new Date()}
      />,
    );
    const text = Buffer.from(bytes).toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+IBMPlexSans\b/);
  }, 20_000);
});

describe('generateInvoice', () => {
  const generate = vi.fn(() => Promise.resolve({ id: 'doc', version: 1 }));
  const key = ['invoice', paymentId].join(':');
  beforeEach(() => {
    generate.mockClear();
  });

  it('makes the invoice of a payment, keyed by the job', async () => {
    db.documentByGenerationKey.mockResolvedValue(undefined);
    db.invoiceFacts.mockResolvedValue(facts());
    expect(await generateInvoice({} as never, paymentId, key, generate)).toEqual({
      id: 'doc',
      version: 1,
    });
    expect(generate).toHaveBeenCalledWith(
      { kind: 'transaction' },
      expect.objectContaining({ kind: 'invoice_receipt', sourceId: paymentId, generationKey: key }),
    );
  });

  it('makes nothing twice, nor for a payment without an invoice number', async () => {
    db.documentByGenerationKey.mockResolvedValue({ id: 'doc', version: 1 });
    expect(await generateInvoice({} as never, paymentId, key, generate)).toBe('already made');
    db.documentByGenerationKey.mockResolvedValue(undefined);
    db.invoiceFacts.mockResolvedValue(undefined);
    expect(await generateInvoice({} as never, paymentId, key, generate)).toBe('no invoice');
    expect(generate).not.toHaveBeenCalled();
  });
});
