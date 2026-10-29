'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId, useTransition } from 'react';
import { chooseCentreAction } from '../modules/navigation/actions';

/** The screens the switcher opens a centre on; they name it in the address as `centre`. */
const centreScreens = ['/app/today', '/app/calendar'];

// The sidebar's centre switcher (UI-02): the centre Today and the Calendar open on. On either
// screen it shows the centre on screen and opens the one chosen there at once, keeping the date
// and the rest of the address.
export function CentreSwitcher({
  centres,
  chosen,
}: {
  centres: readonly { id: string; name: string }[];
  chosen: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const id = useId();
  const onCentreScreen = centreScreens.includes(pathname);
  const addressed = params.get('centre');
  const shown =
    onCentreScreen && addressed && centres.some((c) => c.id === addressed) ? addressed : chosen;
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
          const centre = event.target.value;
          const form = new FormData();
          form.set('centre', centre);
          startTransition(async () => {
            await chooseCentreAction(form);
            if (onCentreScreen) {
              const next = new URLSearchParams(params.toString());
              next.set('centre', centre);
              router.replace(`${pathname}?${next.toString()}`);
            }
          });
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
