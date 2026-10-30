import { consentRecord, createDb, systemActor, withActor } from '@clinic-mx/db';
import { partBStatementsFor } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';

// Part B consent for end to end tests (BIL-03, BIL-12): every statement the episode's Part B asks,
// agreed by the patient with a typed name, as if signed on their phone. Generated test data only.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** Agrees the episode's whole Part B (its signed plan's statements), so treatment may start. */
export async function partBAgreed(episodeId: string): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    const [row] = await tx.execute<{
      patient_id: string;
      part_b: { package: boolean; modalities: { key: string }[] };
    }>(sql`
      select e.patient_id, internal.part_b_core(e.id, false) as part_b
      from episode e where e.id = ${episodeId}`);
    if (!row) throw new Error('No such episode.');
    const asked = partBStatementsFor({
      package: row.part_b.package,
      modalities: row.part_b.modalities.map((modality) => modality.key),
    });
    await tx.insert(consentRecord).values(
      asked.map((statement) => ({
        patientId: row.patient_id,
        episodeId,
        stage: 'B' as const,
        statementKey: statement.key,
        statementVersion: statement.version,
        modality: statement.modality ?? null,
        accepted: true,
        signer: 'patient' as const,
        signatureKind: 'typed' as const,
        typedName: 'Test Patient',
      })),
    );
  });
}
