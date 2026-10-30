import { currentStaff } from '../../../../../../../modules/auth/session';
import { staffExerciseVideo } from '../../../../../../../modules/exercises/services';
import { videoResponse } from '../../../../../../../modules/exercises/video-response';

// A library exercise's video for staff (SET-07), from our own domain only (rule 9): fetched from
// the private bucket by our server; anyone not signed in gets "Sign in again".
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ exerciseId: string }> },
) {
  const staff = await currentStaff();
  if (!staff) return new Response('Sign in again.', { status: 401 });
  const { exerciseId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(exerciseId)) return new Response('Not found', { status: 404 });
  const video = await staffExerciseVideo(staff, exerciseId);
  if (!video) return new Response('Not found', { status: 404 });
  return videoResponse(request, video.bytes, video.type);
}
