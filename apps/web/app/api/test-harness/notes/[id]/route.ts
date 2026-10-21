import { draftSaveRequestSchema, testHarnessNoteSchema } from '@clinic-mx/schemas';
import {
  changeTestNoteElsewhere,
  readTestNote,
  saveTestNote,
  testHarnessEnabled,
} from '../../../../../lib/drafts/test-harness-store';

// Autosave test harness endpoint (end to end tests only; 404 unless CLINIC_MX_TEST_HARNESS=1).
// GET reads the note, PUT saves a draft against its version, POST saves it "on another device".
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: 'Not found' }, { status: 404 });
const saveRequest = draftSaveRequestSchema(testHarnessNoteSchema);

export async function GET(_request: Request, { params }: Context) {
  if (!testHarnessEnabled()) return notFound();
  return Response.json(readTestNote((await params).id));
}

export async function PUT(request: Request, { params }: Context) {
  if (!testHarnessEnabled()) return notFound();
  const parsed = saveRequest.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: 'Invalid draft' }, { status: 400 });
  const result = saveTestNote((await params).id, parsed.data.value, parsed.data.baseVersion);
  return Response.json(result, { status: result.status === 'conflict' ? 409 : 200 });
}

export async function POST(request: Request, { params }: Context) {
  if (!testHarnessEnabled()) return notFound();
  const parsed = testHarnessNoteSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: 'Invalid note' }, { status: 400 });
  return Response.json(changeTestNoteElsewhere((await params).id, parsed.data));
}
