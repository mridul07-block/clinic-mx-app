import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';
import { Page, type PageWidth } from './page';

/**
 * A placeholder the size of what loads (design system v3 section 8), on surface-sunken. Static:
 * no pulse or shimmer. Size it with className ("h-8 w-48"). Hidden from screen readers; wrap a
 * loading area in LoadingRegion so they hear "Loading" once.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div aria-hidden className={cn('rounded-control bg-surface-sunken', className)} {...props} />
  );
}

/** Lines of text loading: 12 px bars, the last one shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className={cn(
            'h-3 rounded-tag bg-surface-sunken',
            index === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full',
          )}
        />
      ))}
    </div>
  );
}

export interface LoadingRegionProps extends HTMLAttributes<HTMLDivElement> {
  /** What screen readers hear. */
  label?: string;
  children: ReactNode;
}

/** A polite live region around skeletons: screen readers hear "Loading", not the placeholders. */
export function LoadingRegion({ label = 'Loading', children, ...props }: LoadingRegionProps) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" {...props}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/**
 * A whole page loading, in the page's own layout: a page header, then a panel of rows. For a
 * route's loading.tsx (never a full screen spinner).
 */
export function PageSkeleton({
  width = 'content',
  rows = 5,
}: {
  width?: PageWidth;
  rows?: number;
}) {
  return (
    <Page width={width}>
      <LoadingRegion className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-48 max-w-full" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="rounded-panel border border-line bg-surface shadow-xs">
          <div className="flex min-h-14 items-center px-5 py-3">
            <Skeleton className="h-5 w-40" />
          </div>
          <div className="flex flex-col">
            {Array.from({ length: rows }, (_, index) => (
              <div
                key={index}
                className="flex h-row-touch items-center gap-4 border-t border-line px-5 md:h-row"
              >
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="ml-auto h-3.5 w-16" />
              </div>
            ))}
          </div>
        </div>
      </LoadingRegion>
    </Page>
  );
}
