import 'server-only';
import { centreRecord, type StaffMember } from '@clinic-mx/db';
import { can } from '@clinic-mx/schemas';
import { asStaff } from '../access/staff-db';
import { renderPdf } from './render';
import { LetterheadSample } from './sample';

/**
 * The letterhead preview of a centre (ALT-05) for the Super Admin, who manages centres: the
 * sample on that centre's live details. Holds no patient data, so it is neither stored nor
 * logged; undefined for anyone else or a centre that is not there.
 */
export async function letterheadPreview(
  actor: StaffMember,
  centreId: string,
): Promise<Uint8Array | undefined> {
  if (!can(actor, 'centres.manage')) return undefined;
  const centre = await asStaff(actor, (tx) => centreRecord(tx, centreId));
  if (!centre) return undefined;
  return renderPdf(
    <LetterheadSample
      centre={{ name: centre.name, address: centre.address, phone: centre.phone }}
      centreCode={centre.code}
      generatedAt={new Date()}
    />,
  );
}
