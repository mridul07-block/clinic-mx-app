import 'server-only';
import { centreRecord, type StaffMember } from '@clinic-mx/db';
import { can, currentHealthFormVersion, healthForms, paperForm } from '@clinic-mx/schemas';
import { asStaff } from '../access/staff-db';
import { getSetting } from '../settings/settings';
import { PaperForms } from './paper-forms';
import { renderPdf } from './render';

/**
 * The paper health form and Part A consent of a centre (OPS-05), for those who check patients in
 * there (`check_in.manage`: the Super Admin, its Centre Managers and its front desk), to print and
 * keep for launch week and outages. Blank, about no patient: neither stored nor logged. Undefined
 * for anyone else or a centre that is not there.
 */
export async function paperFormsPdf(
  actor: StaffMember,
  centreId: string,
  now = new Date(),
): Promise<Uint8Array | undefined> {
  if (!can(actor, 'check_in.manage', { centreId })) return undefined;
  const centre = await asStaff(actor, (tx) => centreRecord(tx, centreId));
  if (!centre) return undefined;
  const definition = healthForms[currentHealthFormVersion];
  if (!definition) return undefined;
  return renderPdf(
    <PaperForms
      centre={{ name: centre.name, address: centre.address, phone: centre.phone }}
      form={paperForm(definition)}
      adultAge={await getSetting('patients.adult_age_years')}
      generatedAt={now}
    />,
  );
}
