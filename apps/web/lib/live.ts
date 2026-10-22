/**
 * A live screen checking for changes on its own (SCH-05, the calendar every few seconds) sends
 * this header. The proxy never counts it as activity, so an unattended desktop still signs out
 * (IAM-07), nor as a page a support login asked for (IAM-08).
 */
export const LIVE_HEADER = 'x-clinic-live';
