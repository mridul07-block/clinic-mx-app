'use client';

/**
 * Shown when an edit could not be saved because the record was changed elsewhere meanwhile.
 * Nothing is overwritten until the person chooses (decision of 21 October 2026).
 */
export function ConflictNotice({
  keepMine,
  takeSaved,
}: {
  keepMine: () => void;
  takeSaved: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-panel border border-waiting-line bg-waiting-soft p-4 text-waiting"
    >
      <p className="font-medium">
        This was changed on another device while you were editing. Choose which version to keep.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={keepMine}
          className="inline-flex h-row items-center rounded-control border border-transparent bg-accent px-3.5 font-medium text-on-accent shadow-xs hover:bg-accent-hover pointer-coarse:h-row-touch"
        >
          Keep my version
        </button>
        <button
          type="button"
          onClick={takeSaved}
          className="inline-flex h-row items-center rounded-control border border-line-strong bg-surface px-3.5 font-medium text-ink shadow-xs hover:border-line-control hover:bg-surface-hover pointer-coarse:h-row-touch"
        >
          Use the saved version
        </button>
      </div>
    </div>
  );
}
