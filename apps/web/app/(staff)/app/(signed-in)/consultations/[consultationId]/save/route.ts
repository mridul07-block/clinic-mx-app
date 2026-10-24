import { draftSaveRequestSchema, consultationSectionsSchema } from '@clinic-mx/schemas';
import { z } from 'zod';
import { NotAllowedError } from '../../../../../../../modules/access/guard';
import { serviceContext } from '../../../../../../../modules/access/staff-db';
import { currentStaff } from '../../../../../../../modules/auth/session';
import {
  ConsultationError,
  saveConsultation,
} from '../../../../../../../modules/consultations/services';

// The consultation's autosave endpoint (CLN-02, FND-08): PUT `{ value, baseVersion }`, answered
// 200 `saved` or 409 `conflict` with what is saved. Anything else leaves the draft on the device,
// "Not saved yet". Our own domain only (rule 9).
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ consultationId: string }> };

const saveRequest = draftSaveRequestSchema(consultationSectionsSchema);

export async function PUT(request: Request, { params }: Context) {
  if (!(await currentStaff())) return Response.json({ error: 'Sign in again.' }, { status: 401 });
  const parsed = saveRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid draft' }, { status: 400 });
  try {
    const result = await saveConsultation(await serviceContext(), {
      consultationId: (await params).consultationId,
      ...parsed.data,
    });
    return Response.json(result, { status: result.status === 'conflict' ? 409 : 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Invalid draft' }, { status: 400 });
    }
    if (error instanceof ConsultationError) {
      return Response.json(
        { error: error.message },
        { status: error.reason === 'not_found' ? 404 : 403 },
      );
    }
    if (error instanceof NotAllowedError) {
      return Response.json({ error: 'Not allowed' }, { status: 403 });
    }
    throw error;
  }
}
