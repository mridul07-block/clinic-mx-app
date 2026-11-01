'use client';

import { Button } from '@clinic-mx/ui/components/button';
import { Combobox } from '@clinic-mx/ui/components/combobox';
import { ConfirmDialog } from '@clinic-mx/ui/components/confirm-dialog';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@clinic-mx/ui/components/dialog';
import { Kbd } from '@clinic-mx/ui/components/kbd';
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLinkItem,
  MenuSeparator,
  MenuTrigger,
} from '@clinic-mx/ui/components/menu';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTrigger,
} from '@clinic-mx/ui/components/popover';
import { Sheet } from '@clinic-mx/ui/components/sheet';
import { Tab, Tabs, TabsList, TabsPanel } from '@clinic-mx/ui/components/tabs';
import { ToastProvider, useToast } from '@clinic-mx/ui/components/toast';
import { Tooltip, TooltipProvider } from '@clinic-mx/ui/components/tooltip';
import { Bell, CalendarClock, Info, Settings, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Which overlay the harness opens on load (`?open=`). */
export type ShownOpen =
  'sheet' | 'drawer' | 'dialog' | 'search' | 'confirm' | 'menu' | 'popover' | 'toast';

interface Option {
  id: string;
  name: string;
  code: string;
}

// Made up labels only: no patients, no staff.
const physios: Option[] = [
  { id: 'p1', name: 'Physio one', code: 'PH-01' },
  { id: 'p2', name: 'Physio two', code: 'PH-02' },
  { id: 'p3', name: 'Physio three', code: 'PH-03' },
  { id: 'p4', name: 'Physio four', code: 'PH-04' },
];

const records: Option[] = Array.from({ length: 12 }, (_, index) => ({
  id: `r${index + 1}`,
  name: `Sample record ${index + 1}`,
  code: `OP-${String(index + 1).padStart(4, '0')}`,
}));

const iconButtonClass =
  'inline-flex size-9 items-center justify-center rounded-control border border-line-strong bg-surface text-ink-secondary shadow-xs hover:bg-surface-hover pointer-coarse:size-11';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-4 shadow-xs sm:p-5">
      <h2 className="text-md font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-ink-muted">{term}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

/** A search done elsewhere: results arrive a moment after typing, as from the server. */
function useSampleSearch() {
  const [text, setTextState] = useState('');
  const [results, setResults] = useState<Option[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const setText = (next: string) => {
    setTextState(next);
    clearTimeout(timer.current);
    const query = next.trim().toLowerCase();
    if (query.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(() => {
      setResults(records.filter((record) => record.name.toLowerCase().includes(query)));
      setSearching(false);
    }, 300);
  };
  const status = searching
    ? 'Searching'
    : text.trim().length < 2
      ? 'Type 2 letters to search'
      : null;
  return { text, setText, results, status, typed: text.trim().length >= 2 };
}

function SearchDialog({ defaultOpen }: { defaultOpen: boolean }) {
  const search = useSampleSearch();
  const [chosen, setChosen] = useState<Option | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Dialog defaultOpen={defaultOpen}>
        <DialogTrigger render={<Button variant="secondary" />}>
          Search <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </DialogTrigger>
        <DialogContent title="Search" hideHeader placement="top" size="lg">
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
            <Combobox
              inline
              searched
              autoFocus
              aria-label="Search records"
              placeholder="Search or jump to"
              items={search.results}
              itemToString={(record) => record.name}
              itemKey={(record) => record.id}
              renderItem={(record) => (
                <span className="flex items-baseline justify-between gap-3">
                  <span>{record.name}</span>
                  <span className="font-mono text-sm text-ink-muted">{record.code}</span>
                </span>
              )}
              inputValue={search.text}
              onInputValueChange={search.setText}
              onValueChange={setChosen}
              status={search.status}
              emptyText={search.typed && !search.status ? 'Nothing matches' : ''}
            />
          </div>
        </DialogContent>
      </Dialog>
      <p className="text-sm text-ink-muted" data-testid="search-chosen">
        {chosen ? `Chose ${chosen.name}` : 'Nothing chosen'}
      </p>
    </div>
  );
}

function Demos({ open }: { open: ShownOpen | null }) {
  const toast = useToast();
  const [sheet, setSheet] = useState(open === 'sheet');
  const [drawer, setDrawer] = useState(open === 'drawer');
  const [confirmOpen, setConfirmOpen] = useState(open === 'confirm');
  const [tab, setTab] = useState('notes');
  const [physio, setPhysio] = useState<Option | null>(null);
  const shownToast = useRef(false);

  useEffect(() => {
    if (open !== 'toast' || shownToast.current) return;
    shownToast.current = true;
    toast({ title: 'Checked in', description: 'Sample record 3 is here.' });
  }, [open, toast]);

  const cancelSample = () =>
    new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
        toast({
          title: 'Cancelled',
          description: 'The sample booking is cancelled.',
          action: { label: 'Undo', onClick: () => toast({ title: 'Restored' }) },
        });
      }, 800);
    });

  return (
    <div className="flex flex-col gap-6">
      <Section title="Sheet">
        <p className="text-ink-secondary">
          A right drawer from 768 px, a bottom sheet below. The non-modal one leaves the page usable
          beside it, as the calendar does.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setSheet(true);
            }}
          >
            Open sheet
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setDrawer(true);
            }}
          >
            Open non-modal sheet
          </Button>
        </div>
        <Sheet
          open={sheet}
          onOpenChange={setSheet}
          title="Sample booking"
          subtitle="Today, 10:30 to 11:15"
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setSheet(false);
                }}
              >
                Reschedule
              </Button>
              <Button
                onClick={() => {
                  setSheet(false);
                }}
              >
                Check in
              </Button>
            </>
          }
        >
          <dl className="flex flex-col gap-3">
            <Detail term="With">Physio one at Centre one</Detail>
            <Detail term="Type">Follow up, 45 min</Detail>
            <Detail term="Booked">On WhatsApp</Detail>
          </dl>
          {Array.from({ length: 6 }, (_, index) => (
            <p key={index} className="text-ink-secondary">
              Sample paragraph {index + 1} so the body scrolls on a small screen while the footer
              stays pinned.
            </p>
          ))}
        </Sheet>
        <Sheet
          open={drawer}
          onOpenChange={setDrawer}
          modal={false}
          title="Free slot"
          subtitle="Physio two, 14:00"
        >
          <p className="text-ink-secondary">Fits a follow up of 45 minutes.</p>
        </Sheet>
      </Section>

      <Section title="Dialog">
        <div className="flex flex-wrap gap-3">
          <Dialog defaultOpen={open === 'dialog'}>
            <DialogTrigger render={<Button variant="secondary" />}>Open dialog</DialogTrigger>
            <DialogContent
              title="Sample dialog"
              description="A short task that needs the whole screen's attention."
              footer={
                <>
                  <DialogClose render={<Button variant="secondary" />}>Go back</DialogClose>
                  <DialogClose render={<Button />}>Save</DialogClose>
                </>
              }
            >
              <p className="text-ink-secondary">Body text of the sample dialog.</p>
            </DialogContent>
          </Dialog>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmOpen(true);
            }}
          >
            Cancel sample booking
          </Button>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            destructive
            title="Cancel the sample booking?"
            description="Its time becomes free for others to book."
            confirmLabel="Cancel booking"
            pendingLabel="Cancelling"
            onConfirm={cancelSample}
          />
        </div>
        <SearchDialog defaultOpen={open === 'search'} />
      </Section>

      <Section title="Menu, popover and tooltip">
        <div className="flex flex-wrap items-center gap-3">
          <Menu defaultOpen={open === 'menu'}>
            <MenuTrigger render={<Button variant="secondary" />}>Actions</MenuTrigger>
            <MenuContent>
              <MenuGroup label="Booking">
                <MenuItem onClick={() => toast({ title: 'Rescheduled' })}>
                  <CalendarClock aria-hidden strokeWidth={1.75} />
                  Reschedule
                </MenuItem>
                <MenuItem disabled>Mark no show</MenuItem>
              </MenuGroup>
              <MenuSeparator />
              <MenuLinkItem href="/app/test-harness/overlays?tab=notes">
                <Settings aria-hidden strokeWidth={1.75} />
                Open notes
              </MenuLinkItem>
            </MenuContent>
          </Menu>
          <Popover defaultOpen={open === 'popover'}>
            <PopoverTrigger openOnHover aria-label="About this figure" className={iconButtonClass}>
              <Info aria-hidden strokeWidth={1.75} className="size-4" />
            </PopoverTrigger>
            <PopoverContent title="Conversion">
              <PopoverDescription>
                The share of first visits that went on to book a package, last 30 days.
              </PopoverDescription>
            </PopoverContent>
          </Popover>
          <TooltipProvider>
            <Tooltip label="Notifications">
              <button type="button" className={iconButtonClass}>
                <Bell aria-hidden strokeWidth={1.75} className="size-4" />
              </button>
            </Tooltip>
            <Tooltip label="Dismiss">
              <button type="button" className={iconButtonClass}>
                <X aria-hidden strokeWidth={1.75} className="size-4" />
              </button>
            </Tooltip>
          </TooltipProvider>
        </div>
      </Section>

      <Section title="Toast">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => toast({ title: 'Checked in' })}>
            Show success
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                title: 'Not sent',
                description: 'WhatsApp did not answer. Try again.',
                tone: 'error',
              })
            }
          >
            Show error
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                title: 'Removed',
                tone: 'info',
                action: { label: 'Undo', onClick: () => toast({ title: 'Restored' }) },
              })
            }
          >
            Show with Undo
          </Button>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList label="Sample episode">
            <Tab value="notes">Notes</Tab>
            <Tab value="exercises" count={6}>
              Exercises
            </Tab>
            <Tab value="alerts" count={1} attention>
              Alerts
            </Tab>
            <Tab value="locked" disabled>
              Locked
            </Tab>
          </TabsList>
          <TabsPanel value="notes">
            <p className="text-ink-secondary">Notes of the sample episode.</p>
          </TabsPanel>
          <TabsPanel value="exercises">
            <p className="text-ink-secondary">Six sample exercises.</p>
          </TabsPanel>
          <TabsPanel value="alerts">
            <p className="text-ink-secondary">One sample alert.</p>
          </TabsPanel>
        </Tabs>
      </Section>

      <Section title="Combobox">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="overlay-physio" className="font-medium text-ink">
            Treating physio
          </label>
          <Combobox
            id="overlay-physio"
            name="physio"
            placeholder="Choose a physio"
            items={physios}
            itemToString={(option) => option.name}
            itemKey={(option) => option.id}
            value={physio}
            onValueChange={setPhysio}
          />
        </div>
      </Section>
    </div>
  );
}

/** The overlay demos; the toast stack lives here because the harness has no app shell. */
export function OverlayDemos({ open }: { open: ShownOpen | null }) {
  return (
    <ToastProvider>
      <Demos open={open} />
    </ToastProvider>
  );
}
