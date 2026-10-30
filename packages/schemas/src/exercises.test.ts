import { describe, expect, it } from 'vitest';
import {
  exerciseInputSchema,
  exerciseVideoProblem,
  exerciseVideoType,
  videoRange,
} from './exercises';

// SET-07 done when: exercises with dose defaults and video playable on phones. Recommended defaults
// (30 October 2026): the Super Admin adds each exercise with its default dose and a short MP4 or
// WebM clip, at most `exercises.video_max_mb`; phones play it in byte ranges from our domain.

/** The first bytes of an MP4 (an `ftyp` box) and of a WebM (the EBML mark). Generated. */
const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);

describe('the exercise library', () => {
  it('needs a name and a default dose', () => {
    expect(exerciseInputSchema.parse({ name: ' Wall sit ', defaultDose: '3 × 30 s' })).toEqual({
      name: 'Wall sit',
      defaultDose: '3 × 30 s',
    });
    expect(
      exerciseInputSchema.safeParse({ name: 'Wall sit', defaultDose: ' ' }).error?.issues[0]
        ?.message,
    ).toBe('Give the default dose, as "3 × 10, daily".');
  });

  it('knows a video by its first bytes, and keeps it small', () => {
    expect(exerciseVideoType(mp4)).toBe('video/mp4');
    expect(exerciseVideoType(webm)).toBe('video/webm');
    expect(exerciseVideoType(new TextEncoder().encode('<html>video</html>'))).toBeUndefined();
    // An `ftyp` box with an image's or QuickTime's brand: not a video phones play.
    const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    expect(exerciseVideoType(heic)).toBeUndefined();
    expect(exerciseVideoProblem(mp4, 4)).toBeUndefined();
    expect(exerciseVideoProblem(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 4)).toBe(
      'Add the video as an MP4 or WebM file.',
    );
    const big = new Uint8Array(4_000_001);
    big.set(mp4);
    expect(exerciseVideoProblem(big, 4)).toBe(
      'Keep the video under 4 MB: a short clip, filmed for phones.',
    );
  });

  it('serves a video in ranges no larger than a chunk', () => {
    const size = 10_000;
    const chunk = 4_000;
    expect(videoRange(null, size, chunk)).toEqual({ start: 0, end: 3_999, partial: true });
    expect(videoRange(null, 1_000, chunk)).toEqual({ start: 0, end: 999, partial: false });
    expect(videoRange('bytes=0-', size, chunk)).toEqual({ start: 0, end: 3_999, partial: true });
    expect(videoRange('bytes=0-1', size, chunk)).toEqual({ start: 0, end: 1, partial: true });
    expect(videoRange('bytes=8000-', size, chunk)).toEqual({
      start: 8_000,
      end: 9_999,
      partial: true,
    });
    expect(videoRange('bytes=-500', size, chunk)).toEqual({
      start: 9_500,
      end: 9_999,
      partial: true,
    });
    expect(videoRange('bytes=10000-', size, chunk), 'past the end: 416').toBeUndefined();
    // Not served, so ignored (RFC 9110): as without a Range.
    const whole = { start: 0, end: 3_999, partial: true };
    expect(videoRange('bytes=5-2', size, chunk)).toEqual(whole);
    expect(videoRange('items=0-1', size, chunk)).toEqual(whole);
    expect(videoRange('bytes=0-1,4-5', size, chunk)).toEqual(whole);
  });
});
