import type { DraftSaveResponse, TestHarnessNote } from '@clinic-mx/schemas';

/**
 * The autosave test harness's "server" (end to end tests only): notes in memory, each with a
 * version, saved the way updateVersioned saves a database row. Every harness page and endpoint
 * answers 404 unless CLINIC_MX_TEST_HARNESS=1, which only the Playwright web server sets.
 */

export function testHarnessEnabled(): boolean {
  return process.env.CLINIC_MX_TEST_HARNESS === '1';
}

interface StoredNote {
  value: TestHarnessNote;
  version: number;
}

// On globalThis so the page and the API route share one store within the server process.
const holder = globalThis as typeof globalThis & { __clinicMxTestNotes?: Map<string, StoredNote> };
const notes = (holder.__clinicMxTestNotes ??= new Map<string, StoredNote>());

export function readTestNote(id: string): StoredNote {
  let note = notes.get(id);
  if (!note) {
    note = { value: { text: '' }, version: 1 };
    notes.set(id, note);
  }
  return note;
}

export function saveTestNote(
  id: string,
  value: TestHarnessNote,
  baseVersion: number,
): DraftSaveResponse<TestHarnessNote> {
  const note = readTestNote(id);
  if (note.version !== baseVersion) {
    return { status: 'conflict', version: note.version, value: note.value };
  }
  note.value = value;
  note.version++;
  return { status: 'saved', version: note.version };
}

/** "Another device" saves the note, whatever version it is at. */
export function changeTestNoteElsewhere(id: string, value: TestHarnessNote): StoredNote {
  const note = readTestNote(id);
  note.value = value;
  note.version++;
  return note;
}
