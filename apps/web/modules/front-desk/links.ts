/** The Today board's address (INT-01): its centre and the chip picked, if any. */
export function todayHref(view: { centreId: string; show?: string }): string {
  const query = new URLSearchParams({ centre: view.centreId });
  if (view.show) query.set('show', view.show);
  return `/app/today?${query.toString()}`;
}
