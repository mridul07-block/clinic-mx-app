/**
 * Zod schemas shared by the client and the server (rule 16). Every input and every
 * response that crosses the network boundary is described here once.
 */
export { healthResponseSchema, type HealthResponse } from './health';
export { staffRoles, staffRoleSchema, type StaffRole } from './staff';
export {
  draftSaveRequestSchema,
  draftSaveResponseSchema,
  recordVersionSchema,
  testHarnessNoteSchema,
  type DraftSaveResponse,
  type TestHarnessNote,
} from './drafts';
export {
  consultationFeeTimings,
  isSettingKey,
  parseSetting,
  settingDefinitions,
  settingKeys,
  type SettingKey,
  type SettingValue,
  type Settings,
} from './settings';
