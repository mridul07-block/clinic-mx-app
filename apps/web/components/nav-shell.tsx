'use client';

import { matchNavItems, type NavItem } from '@clinic-mx/schemas';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { SideNav } from './side-nav';

// The rail or sidebar with Search or jump to (UI-02; design system v2 section 7: "Command
// palette on Ctrl K or /"). The palette finds the person's screens by their words and, for those
// who may find patients, searches patients for what was typed. Arrow keys move, Enter opens,
// Escape closes. From 768 px only; phones have the bottom tabs and Home.

interface Choice {
  label: string;
  href: string;
}

export function NavShell({
  items,
  counts,
  findsPatients,
  centreSwitcher,
  personMenu,
}: {
  items: readonly NavItem[];
  counts: Record<string, number>;
  findsPatients: boolean;
  centreSwitcher: ReactNode;
  personMenu: ReactNode;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();

  const open = useCallback(() => {
    setTyped('');
    setActive(0);
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.isContentEditable === true ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '');
      // Tablets and computers only, never over another open dialog or mid composition.
      if (event.isComposing || !window.matchMedia('(min-width: 768px)').matches) return;
      if (document.querySelector('dialog[open]') && !dialog.current?.open) return;
      if ((event.key === 'k' || event.key === 'K') && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        open();
      } else if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const words = typed.trim();
  const choices: Choice[] = [
    ...matchNavItems(items, words).map((item) => ({ label: item.label, href: item.href })),
    ...(findsPatients && words
      ? [
          {
            label: `Find patients: ${words}`,
            href: `/app/patients?${new URLSearchParams({ q: words }).toString()}`,
          },
        ]
      : []),
  ];
  const chosen = Math.min(active, Math.max(choices.length - 1, 0));

  // Keep the highlighted result in view as the arrow keys move it.
  useEffect(() => {
    document
      .getElementById([listId, String(chosen)].join('-'))
      ?.scrollIntoView({ block: 'nearest' });
  }, [chosen, listId]);

  const go = (choice: Choice | undefined) => {
    if (!choice) return;
    dialog.current?.close();
    router.push(choice.href);
  };

  return (
    <>
      <SideNav
        items={items}
        counts={counts}
        centreSwitcher={centreSwitcher}
        personMenu={personMenu}
        onSearch={open}
      />
      <dialog
        ref={dialog}
        aria-label="Search or jump to"
        className="m-auto mt-[12vh] w-[min(36rem,calc(100vw-2rem))] rounded-panel border border-line bg-surface p-0 text-ink shadow-float backdrop:bg-transparent"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current.close();
        }}
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search aria-hidden size={16} strokeWidth={1.75} className="text-ink-muted" />
          <input
            role="combobox"
            aria-label="Search or jump to"
            aria-expanded
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={choices.length ? [listId, String(chosen)].join('-') : undefined}
            autoComplete="off"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((chosen + 1) % Math.max(choices.length, 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((chosen - 1 + choices.length) % Math.max(choices.length, 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                go(choices[chosen]);
              }
            }}
            placeholder={findsPatients ? 'A screen, or a patient’s name or mobile' : 'A screen'}
            className="h-row-touch w-full bg-transparent text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
        <ul
          id={listId}
          role="listbox"
          aria-label="Results"
          className="max-h-80 overflow-y-auto p-1"
        >
          {choices.map((choice, index) => (
            <li
              key={choice.href}
              id={[listId, String(index)].join('-')}
              role="option"
              aria-selected={index === chosen}
              onMouseEnter={() => {
                setActive(index);
              }}
              onClick={() => {
                go(choice);
              }}
              className={[
                'flex min-h-row cursor-pointer items-center rounded-control px-2 pointer-coarse:min-h-row-touch',
                index === chosen ? 'bg-surface-hover text-ink' : 'text-ink-secondary',
              ].join(' ')}
            >
              {choice.label}
            </li>
          ))}
        </ul>
        <p role="status" className="px-3 pb-2 text-ink-muted">
          {choices.length === 0 ? 'No screen with those words.' : ''}
        </p>
      </dialog>
    </>
  );
}
