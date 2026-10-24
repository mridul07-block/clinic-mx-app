import 'server-only';
import { formatRupees, type LetterheadCentre } from '@clinic-mx/schemas';
import { Fields, LetterheadDocument, Mono, Paragraph, Section, SignOff, Table } from './letterhead';

/**
 * The letterhead preview (ALT-05, user decision 25 October 2026): a two page sample on a centre's
 * letterhead for the Super Admin, and the clinic, to check before real documents use it. Sample
 * words only, about no real patient; never stored.
 */
export function LetterheadSample({
  centre,
  centreCode,
  generatedAt,
}: {
  centre: LetterheadCentre;
  centreCode: string;
  generatedAt: Date;
}) {
  return (
    <LetterheadDocument
      title="Letterhead preview"
      centre={centre}
      versionLabel="Letterhead preview"
      generatedAt={generatedAt}
    >
      <Paragraph>
        This sample shows how documents from this centre are printed: the letterhead, type, a table
        of amounts and the sign off. It is not about a patient.
      </Paragraph>
      <Section heading="Patient details">
        <Fields
          rows={[
            ['Name', 'Test Patient 0000'],
            ['OP number', <Mono key="op">{[centreCode, '000000'].join('-')}</Mono>],
            ['Date of consultation', 'The date of the visit'],
          ]}
        />
      </Section>
      <Section heading="Amounts">
        <Table
          columns={[
            { label: 'Item' },
            { label: 'Sessions', align: 'end' },
            { label: 'Amount', align: 'end' },
          ]}
          rows={[
            ['Sample consultation', '1', formatRupees(1_500_00)],
            ['Sample package', '10', formatRupees(12_500_00)],
            ['Sample programme', '100', formatRupees(1_20_000_00)],
            ['Total', '111', formatRupees(1_34_000_00)],
          ]}
        />
      </Section>
      <Section heading="Goals">
        <Table
          columns={[{ label: 'Goal' }, { label: 'Status' }]}
          rows={[
            ['Sample goal one', 'Met'],
            ['Sample goal two', 'Not met'],
          ]}
        />
      </Section>
      <Section heading="Second page" breakBefore>
        <Paragraph>
          Longer documents continue on the next page with the same letterhead, and the footer counts
          every page.
        </Paragraph>
      </Section>
      <SignOff name="Sample Clinician" credentials="BPT" signedAt={generatedAt} />
    </LetterheadDocument>
  );
}
