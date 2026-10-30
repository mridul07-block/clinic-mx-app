import { z } from 'zod';
import { DOSE_MAX, EXERCISE_MAX } from './plan';

/**
 * The exercise library (SET-07; PRD M7 "home programme from the exercise library" and M13
 * "exercises with videos"; TAD `kb_exercise`: name, video file, default dose; Frontend
 * Specification "Exercise row: Name, dose, video, done tick"). The clinic's own list, kept by the
 * Super Admin: each exercise has a name, a default dose and, once the clinic films it, a short
 * video playable on phones. An exercise never changes once added; replacing it adds a new one and
 * retires the old, so a plan keeps the exercise it was written with. Recommended defaults chosen
 * under the user's standing approval, 30 October 2026 (DECISION SET-07;
 * docs/runbooks/exercise-library.md).
 */

export const exerciseInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'Name the exercise.' })
    .max(EXERCISE_MAX, { error: `Keep the name under ${String(EXERCISE_MAX)} characters.` }),
  defaultDose: z
    .string()
    .trim()
    .min(1, { error: 'Give the default dose, as "3 × 10, daily".' })
    .max(DOSE_MAX, { error: `Keep the dose under ${String(DOSE_MAX)} characters.` }),
});
export type ExerciseInput = z.infer<typeof exerciseInputSchema>;

/** The video kinds phones play: MP4 (H.264) and WebM. */
export const exerciseVideoTypes = ['video/mp4', 'video/webm'] as const;
export type ExerciseVideoType = (typeof exerciseVideoTypes)[number];

export const exerciseVideoExtensions: Record<ExerciseVideoType, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/**
 * The MP4 major brands phones play; an `ftyp` box also starts HEIC and AVIF images and QuickTime
 * files, which are refused.
 */
const mp4Brands = ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash'];

/**
 * What a video file is, from its first bytes (never the name or the browser's word): an MP4 has
 * `ftyp` at byte 4 and an MP4 brand after it; a WebM starts with the EBML mark 1A 45 DF A3.
 * Anything else: undefined.
 */
export function exerciseVideoType(bytes: Uint8Array): ExerciseVideoType | undefined {
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp' &&
    mp4Brands.includes(String.fromCharCode(...bytes.subarray(8, 12)))
  ) {
    return 'video/mp4';
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'video/webm';
  }
  return undefined;
}

/** Why a video cannot be added, or undefined when it can (`maxMegabytes` from the setting). */
export function exerciseVideoProblem(bytes: Uint8Array, maxMegabytes: number): string | undefined {
  if (bytes.length === 0) return undefined;
  if (bytes.length > maxMegabytes * 1_000_000) {
    return `Keep the video under ${String(maxMegabytes)} MB: a short clip, filmed for phones.`;
  }
  if (!exerciseVideoType(bytes)) return 'Add the video as an MP4 or WebM file.';
  return undefined;
}

/**
 * The byte range a video request asks for (`Range: bytes=a-b`), cut to at most `chunk` bytes so
 * each answer stays small. A Range the server does not serve (another unit, several ranges, a bad
 * one) is ignored, as RFC 9110 says: the first chunk of the whole file, as without one. Undefined
 * only when the range starts past the end (416).
 */
export function videoRange(
  header: string | null,
  size: number,
  chunk: number,
): { start: number; end: number; partial: boolean } | undefined {
  if (size === 0) return undefined;
  const whole = { start: 0, end: Math.min(size, chunk) - 1, partial: size > chunk };
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match) return whole;
  const [, from = '', to = ''] = match;
  let start: number;
  let end: number;
  if (from === '') {
    if (to === '' || Number(to) === 0) return whole;
    // The last `to` bytes.
    start = Math.max(0, size - Number(to));
    end = size - 1;
  } else {
    start = Number(from);
    end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
    if (to !== '' && Number(to) < start) return whole;
  }
  if (start >= size) return undefined;
  return { start, end: Math.min(end, start + chunk - 1), partial: true };
}
