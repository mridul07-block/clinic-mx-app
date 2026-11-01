'use client';

import { Search } from 'lucide-react';
import { openSearchEvent } from '../../../../components/nav-shell';

// The phone top bar's search (UIX-12): opens the same Search or jump to palette that Ctrl K and
// "/" open on a computer.
export function SearchButton({ findsPatients }: { findsPatients: boolean }) {
  return (
    <button
      type="button"
      aria-label={findsPatients ? 'Search screens and patients' : 'Search screens'}
      onClick={() => window.dispatchEvent(new Event(openSearchEvent))}
      className="flex size-11 items-center justify-center rounded-control text-ink-secondary hover:bg-surface-hover hover:text-ink"
      data-testid="top-search"
    >
      <Search aria-hidden size={20} strokeWidth={1.75} />
    </button>
  );
}
