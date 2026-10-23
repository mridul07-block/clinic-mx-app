import 'server-only';
import { reportContentTypes, type ReportContentType } from '@clinic-mx/schemas';

/** A refused report file, in words for whoever added it. */
export class ReportError extends Error {
  override name = 'ReportError';
}

/** The first bytes each kind of file starts with: the browser's word for the type is not enough. */
const signatures: Record<ReportContentType, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
};

const isReportType = (type: string): type is ReportContentType =>
  (reportContentTypes as readonly string[]).includes(type);

export interface CheckedReport {
  bytes: Uint8Array;
  contentType: ReportContentType;
}

/**
 * Report photos and PDF scans as posted (INT-02), checked before anything is stored: a photo or
 * PDF by its first bytes, at most `maxMegabytes` each. Empty file inputs are skipped.
 */
export async function checkReportFiles(
  files: readonly File[],
  maxMegabytes: number,
): Promise<CheckedReport[]> {
  const checked: CheckedReport[] = [];
  for (const file of files.filter((posted) => posted.size > 0)) {
    if (!isReportType(file.type)) {
      throw new ReportError(`${file.name} is not a photo or PDF.`);
    }
    if (file.size > maxMegabytes * 1024 * 1024) {
      throw new ReportError(`${file.name} is larger than ${String(maxMegabytes)} MB.`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!signatures[file.type].every((byte, i) => bytes[i] === byte)) {
      throw new ReportError(`${file.name} is not a photo or PDF.`);
    }
    checked.push({ bytes, contentType: file.type });
  }
  return checked;
}
