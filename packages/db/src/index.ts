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
export {
  completePatientLinkRow,
  findPatientLink,
  insertPatientLink,
  readPatientLink,
  revokeMyPlanLinks,
  signPatientLink,
  withPatientAccess,
  type NewPatientLink,
  type PatientLinkAccess,
  type PatientLinkClaim,
  type PatientLinkKeys,
} from './patient-links';
export {
  clearKioskLink,
  findKioskByToken,
  findKioskDevice,
  hashKioskToken,
  insertKioskDevice,
  kioskDevices,
  newKioskToken,
  patientLinkState,
  sendLinkToKiosk,
  stopKioskDevice,
  type KioskDeviceEntry,
  type KioskDeviceWithCentre,
  type NewKioskDevice,
  type PatientLinkState,
} from './kiosk';
export {
  clearRateLimit,
  pruneRateLimits,
  rateLimitHits,
  rateLimitKeyHash,
  recordRateLimitHit,
  type RateLimitWindow,
} from './rate-limits';
export {
  activeCentreWithColour,
  centreCodeTaken,
  centreList,
  centreNameTaken,
  centreRecord,
  insertCentre,
  setCentreActive,
  updateCentre,
  type CentreEntry,
} from './centres';
export {
  PATIENT_SEARCH_LIMIT,
  insertPatient,
  patientRecord,
  patientsOnPhone,
  searchPatients,
  updatePatient,
  type PatientEntry,
  type PatientMatch,
} from './patients';
export {
  discountPresetList,
  discountPresetNameTaken,
  discountPresetRecord,
  insertDiscountPreset,
  insertPackageType,
  insertPriceItem,
  packageTypeList,
  packageTypeNameTaken,
  packageTypeRecord,
  priceItemKeyTaken,
  priceItemLabelTaken,
  priceItemList,
  priceItemRecord,
  setDiscountPresetActive,
  setPackageTypeActive,
  setPriceItemActive,
  updateDiscountPreset,
  updatePackageType,
  updatePriceItem,
  type DiscountPresetEntry,
  type PackageTypeEntry,
  type PriceItemEntry,
} from './prices';
export {
  appointmentTypeKeyTaken,
  appointmentTypeList,
  appointmentTypeNameTaken,
  appointmentTypeRecord,
  insertAppointmentType,
  lengthFor,
  physioLengths,
  setAppointmentTypeActive,
  setPhysioLengths,
  updateAppointmentType,
  type AppointmentTypeEntry,
} from './appointment-types';
export {
  assignedToCentre,
  availabilityOn,
  cancelLeave,
  cutOut,
  decideLeave,
  insertLeave,
  leaveFor,
  leaveRecord,
  pendingLeave,
  rosterOn,
  rosterVersions,
  saveRoster,
  teamMembers,
  versionsFrom,
  versionsOn,
  type LeaveEntry,
  type LeaveStatus,
  type RosterVersion,
  type TeamMember,
  type Window,
} from './rosters';
// The knowledge base readers. The importer (`src/knowledge/`, `pnpm kb:import`) is a script and is
// not exported, so its workbook reader never reaches the web app.
export {
  knowledgeConditions,
  knowledgeListings,
  latestKnowledgeVersion,
  redFlagPresentations,
  redFlagRules,
  type KnowledgeCondition,
  type KnowledgeListing,
  type KnowledgeRedFlagPresentation,
  type KnowledgeRedFlagRule,
  type KnowledgeVersion,
} from './knowledge';
