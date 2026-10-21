/**
 * Clinic Mx database: Drizzle schema, the client, and seed data. Migrations are generated
 * from the schema into `supabase/migrations` (`pnpm db:generate`); see
 * docs/runbooks/supabase.md.
 */
export * from './schema';
export { createDb, type Db } from './client';
export {
  RecordNotFoundError,
  updateVersioned,
  type DbOrTransaction,
  type VersionedResult,
  type VersionedTable,
} from './versioned';
export {
  JOB_LEASE_MINUTES,
  MAX_JOB_ATTEMPTS,
  claimJobs,
  completeJob,
  describeError,
  enqueueJob,
  failJob,
  retryDelayMinutes,
  staleJobs,
  type EnqueueOptions,
} from './jobs/queue';
export {
  runDueJobs,
  type JobHandler,
  type JobHandlers,
  type TickOptions,
  type TickResult,
} from './jobs/runner';
export {
  isActor,
  logAccessEvent,
  logRecordView,
  patientActor,
  recordAccessEvent,
  setAuditContext,
  staffActor,
  systemActor,
  withActor,
  type AccessAction,
  type Actor,
  type AuditContext,
} from './audit';
export {
  SETTINGS_CACHE_SECONDS,
  SettingsError,
  createSettingsReader,
  parseSettings,
  readSettingRows,
  updateSetting,
  type SettingsReader,
  type SettingsReaderOptions,
} from './settings';
export { claimsForStaff, withStaffAccess } from './access';
export {
  centreOptions,
  endStaffSessions,
  insertStaffMember,
  linkStaffLogin,
  setStaffMemberActive,
  staffEmailTaken,
  staffList,
  staffRecord,
  updateStaffMember,
  type StaffListEntry,
  type StaffRecord,
} from './staff';
export {
  centreNamesForStaff,
  currentStaffClaims,
  staffForSignIn,
  supportLoginWithoutGrant,
  type StaffMember,
} from './identity';
export {
  activeGrant,
  endSupportGrant,
  endSupportSessions,
  insertSupportGrant,
  logSupportRequest,
  supportGrantHistory,
  supportLogins,
  type SupportGrantEntry,
  type SupportGrantWithActivity,
  type SupportLoginEntry,
  type SupportRequestEntry,
} from './support';
