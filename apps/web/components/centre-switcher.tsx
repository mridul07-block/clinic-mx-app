'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId, useRef, useTransition } from 'react';
import { chooseCentreAction } from '../modules/navigation/actions';
import { useDetailsClose } from './use-details-close';

/** The screens the switcher opens a centre on; they name it in the address as `centre`. */
const centreScreens = ['/app/today', '/app/calendar'];

interface Centre {
  id: string;
  name: string;
  code: string;
}

/**
 * The centre shown and choosing another (UI-02): on Today or the Calendar the centre on screen,
 * elsewhere the one chosen; choosing keeps it on the device and, on those screens, opens it at
 * once, keeping the date and the rest of the address.
 */
function useCentreChoice(centres: readonly Centre[], chosen: string) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const onCentreScreen = centreScreens.includes(pathname);
  const addressed = params.get('centre');
  const shown =
    onCentreScreen && addressed && centres.some((c) => c.id === addressed) ? addressed : chosen;
  const choose = (centre: string, then?: () => void) => {
    const form = new FormData();
    form.set('centre', centre);
    startTransition(async () => {
      await chooseCentreAction(form);
      if (onCentreScreen) {
        const next = new URLSearchParams(params.toString());
        next.set('centre', centre);
        router.replace(`${pathname}?${next.toString()}`);
      }
      then?.();
    });
  };
  return { shown, pending, choose };
}

// The sidebar's centre switcher (UI-02), from 1280 px: a labelled choice.
export function CentreSwitcher({
  centres,
  chosen,
}: {
  centres: readonly Centre[];
  chosen: string;
}) {
  const { shown, pending, choose } = useCentreChoice(centres, chosen);
  const id = useId();
  return (
    <form className="flex flex-col gap-1 px-2">
      <label htmlFor={id} className="text-xs text-ink-muted">
        Centre
      </label>
      <select
        id={id}
        name="centre"
        value={shown}
        disabled={pending}
        onChange={(event) => {
          choose(event.target.value);
        }}
        className="h-row w-full rounded-control border border-line-control bg-surface px-2 text-ink shadow-xs pointer-coarse:h-row-touch"
        data-testid="centre-switcher"
      >
        {centres.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </form>
  );
}

// The rail's centre switcher (UI-03), 768 to 1279 px: the centre's code in a 44 px button, opening
// the centres beside it, the one on screen marked current. After a choice, focus is back on the
// button.
export function RailCentreSwitcher({
  centres,
  chosen,
}: {
  centres: readonly Centre[];
  chosen: string;
}) {
  const { shown, pending, choose } = useCentreChoice(centres, chosen);
  const menu = useDetailsClose();
  const panel = useRef<HTMLDivElement>(null);
  const current = centres.find((c) => c.id === shown);
  return (
    <details
      ref={menu}
      data-testid="rail-centre-switcher"
      onToggle={(event) => {
        // Beside the button wherever the rail has scrolled to.
        const summary = event.currentTarget.querySelector('summary');
        if (event.currentTarget.open && summary && panel.current) {
          panel.current.style.top = `${String(summary.getBoundingClientRect().top)}px`;
        }
      }}
    >
      <summary
        aria-label={`Centre: ${current ? `${current.code}, ${current.name}` : 'none'}. Change`}
        title={current?.name}
        className="flex min-h-11 cursor-pointer list-none items-center justify-center rounded-control border border-line-control bg-surface text-xs font-semibold text-ink shadow-xs [&::-webkit-details-marker]:hidden"
      >
        {current?.code ?? '—'}
      </summary>
      <div
        ref={panel}
        role="group"
        aria-label="Centre"
        className="fixed top-16 left-[calc(var(--rail-width)+0.5rem)] z-50 flex w-56 flex-col gap-1 rounded-panel border border-line bg-surface p-2 shadow-float"
      >
        {centres.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={pending}
            aria-current={c.id === shown ? 'true' : undefined}
            onClick={() => {
              choose(c.id, () => {
                if (menu.current) {
                  menu.current.open = false;
                  menu.current.querySelector('summary')?.focus();
                }
              });
            }}
            className={[
              'flex min-h-11 items-center rounded-control px-2 text-left',
              c.id === shown ? 'bg-surface-hover font-medium text-ink' : 'text-ink-secondary',
            ].join(' ')}
          >
            {c.name}
          </button>
        ))}
      </div>
    </details>
  );
}
