import { withActor, systemActor } from '../audit';
import type { Db } from '../client';
import { insertPatient } from '../patients';
import { centreIds } from '../seed/data';

/**
 * Generated patients for database tests (rule 12: never real data): "Test Patient" and a short
 * id, on a +91 99 mobile with random digits.
 */
export function fakePatientDetails(registeredCentreId: string = centreIds.hsrLayout) {
  const digits = Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => byte % 10).join(
    '',
  );
  return {
    name: `Test Patient ${crypto.randomUUID().slice(0, 8)}`,
    phone: `+9199${digits}`,
    registeredCentreId,
  };
}

/** Adds a generated patient as the test system; returns their id. */
export async function fakePatientId(db: Db): Promise<string> {
  const { id } = await withActor(db, systemActor('tests'), (tx) =>
    insertPatient(tx, fakePatientDetails()),
  );
  return id;
}
