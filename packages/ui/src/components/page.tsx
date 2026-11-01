import { ChevronLeft } from 'lucide-react';
import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export type PageWidth = 'form' | 'content' | 'full';

/** Design system v3 section 7: form 640 px, content 1040 px, full for Today, calendar, dashboards. */
export const pageWidthClass: Record<PageWidth, string> = {
  form: 'max-w-[40rem]',
  content: 'max-w-[65rem]',
  full: '',
};

export interface PageProps extends HTMLAttributes<HTMLElement> {
  width?: PageWidth;
  /** Classes for the column inside the padding (gaps, extra layout); the <main> keeps its own. */
  className?: string;
  children: ReactNode;
}

/**
 * A page's <main>, inside the signed in layout's sheet (which holds id="page", the skip link's
 * target, so this has no id). Page padding is 16 px, 24 px from 1024 px and 32 px from 1280 px
 * (section 4.1); the column inside is centred at the page width, sections 24 px apart.
 */
export function Page({ width = 'content', className, children, ...props }: PageProps) {
  return (
    <main className="w-full px-4 py-6 lg:px-6 xl:p-8" {...props}>
      <div className={cn('mx-auto flex w-full flex-col gap-6', pageWidthClass[width], className)}>
        {children}
      </div>
    </main>
  );
}

/** What renders the back link: a plain <a> by default; the app passes Next's Link. */
export type LinkComponent = ElementType<{
  href: string;
  className?: string;
  children?: ReactNode;
}>;

export interface PageHeaderProps {
  title: ReactNode;
  /** One line under the title; parts are joined by a middle dot (the only place one is allowed). */
  context?: string | readonly string[];
  /** A back link above the title, never "Home" (the navigation does that). */
  back?: { href: string; label: string };
  /** Status tags beside the title. */
  tags?: ReactNode;
  /** Actions on the right from 768 px, under the title on phones; at most one primary. On phones
   * a screen's primary action goes in StickyActions instead. */
  actions?: ReactNode;
  link?: LinkComponent;
  className?: string;
}

/** Joins context parts with a middle dot, dropping empty ones. */
export function contextLine(context: string | readonly string[]): string {
  return typeof context === 'string' ? context : context.filter(Boolean).join(' · ');
}

/** The page header at the top of every sheet (design system v3 section 7). */
export function PageHeader({
  title,
  context,
  back,
  tags,
  actions,
  link: LinkAs = 'a',
  className,
}: PageHeaderProps) {
  const line = context === undefined ? '' : contextLine(context);
  return (
    <header
      className={cn(
        'flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {back ? (
          <LinkAs
            href={back.href}
            className="inline-flex items-center gap-1 self-start text-sm text-ink-muted hover:text-ink pointer-coarse:py-2"
          >
            <ChevronLeft aria-hidden size={14} strokeWidth={1.75} />
            {back.label}
          </LinkAs>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="min-w-0 text-title font-semibold text-ink">{title}</h1>
          {tags ? <div className="flex flex-wrap items-center gap-1.5">{tags}</div> : null}
        </div>
        {line ? <p className="text-sm text-ink-muted">{line}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
