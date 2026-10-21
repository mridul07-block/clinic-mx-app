'use client';

import type { TestHarnessNote } from '@clinic-mx/schemas';
import { useMemo } from 'react';
import { ConflictNotice } from '../../../../../lib/drafts/conflict-notice';
import { SaveStatus } from '../../../../../lib/drafts/save-status';
import { saveTestHarnessNote } from '../../../../../lib/drafts/savers';
import { useAutosave } from '../../../../../lib/drafts/use-autosave';

export function AutosaveNote({
  id,
  serverValue,
  serverVersion,
}: {
  id: string;
  serverValue: TestHarnessNote;
  serverVersion: number;
}) {
  const save = useMemo(() => saveTestHarnessNote(id), [id]);
  const note = useAutosave({ kind: 'test-harness-note', id, serverValue, serverVersion, save });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-title font-semibold">Note</h1>
        <SaveStatus status={note.status} />
      </div>
      {note.status === 'conflict' && (
        <ConflictNotice keepMine={note.keepMine} takeSaved={note.takeSaved} />
      )}
      <label className="flex flex-col gap-1.5">
        <span className="font-medium">Note text</span>
        <textarea
          value={note.value.text}
          onChange={(event) => {
            note.setValue({ text: event.target.value });
          }}
          rows={6}
          className="w-full rounded-control border border-line-control bg-surface px-3 py-2 text-md shadow-xs hover:border-ink-muted"
        />
      </label>
    </section>
  );
}
