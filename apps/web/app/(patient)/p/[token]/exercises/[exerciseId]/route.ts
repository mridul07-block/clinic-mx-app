import { clientIp } from '../../../../../../modules/auth/session';
import { patientExerciseVideo } from '../../../../../../modules/exercises/services';
import { videoResponse } from '../../../../../../modules/exercises/video-response';

// The video of an exercise in the patient's own plan (SET-07; PRD M13 "exercises with videos"),
// opened from My plan with its link, from our own domain only (rule 9). Anything else: "Not found".
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string; exerciseId: string }> },
) {
  const { token, exerciseId } = await params;
  if (!/^[A-Za-z0-9_-]{20,120}$/.test(token) || !/^[0-9a-f-]{36}$/i.test(exerciseId)) {
    return new Response('Not found', { status: 404 });
  }
  const video = await patientExerciseVideo(token, exerciseId, { ip: await clientIp() });
  if (!video) return new Response('Not found', { status: 404 });
  return videoResponse(request, video.bytes, video.type);
}
