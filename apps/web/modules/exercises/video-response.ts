import { videoRange, type ExerciseVideoType } from '@clinic-mx/schemas';

/**
 * Most a single answer carries: a video is at most `exercises.video_max_mb` (4 MB, the hosted
 * response limit), so one answer can hold the whole of it; ranges keep phones' players working.
 */
const CHUNK_BYTES = 4_000_000;

/**
 * An exercise video as phones play it (SET-07): the range the player asks for (`206`), or the
 * whole clip (`200`); never cached by shared caches, never sniffed.
 */
export function videoResponse(
  request: Request,
  bytes: Uint8Array,
  type: ExerciseVideoType,
): Response {
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  };
  const range = videoRange(request.headers.get('range'), bytes.length, CHUNK_BYTES);
  if (!range) {
    return new Response('Range not satisfiable', {
      status: 416,
      headers: { 'Content-Range': `bytes */${String(bytes.length)}` },
    });
  }
  const body = Buffer.from(bytes.subarray(range.start, range.end + 1));
  if (!range.partial) return new Response(body, { status: 200, headers });
  return new Response(body, {
    status: 206,
    headers: {
      ...headers,
      'Content-Range': `bytes ${String(range.start)}-${String(range.end)}/${String(bytes.length)}`,
    },
  });
}
