/**
 * Clinic Mx design system. Styles are imported as CSS (`@clinic-mx/ui/styles/*.css`: tokens,
 * theme, base, motion, hatch); components follow the Frontend Specification section 5 as the
 * screens that need them are built. `pnpm check:design` enforces the token rules.
 */
export {
  appointmentStatuses,
  toneByAppointmentStatus,
  type AppointmentStatus,
  type Tone,
} from './status';
export { tokenValues, type TokenValueName } from './token-values';
