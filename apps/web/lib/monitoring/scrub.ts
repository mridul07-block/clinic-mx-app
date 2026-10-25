import type { Breadcrumb, ErrorEvent, Event } from '@sentry/nextjs';

/**
 * Patient data never reaches the error reports (rule 12, FND-12). Every event and breadcrumb
 * passes through here on the server, the edge and in the browser before it is sent; Sentry's own
 * server side scrubbers are the second layer (docs/runbooks/monitoring.md).
 *
 * Error text is cut down rather than allowed through: quoted values, email addresses, phone
 * numbers, patient numbers, ids and tokens all go, as does everything after a failed query's
 * `params:`. The error's type and stack are what the report is for.
 */
const SCRUBBED = '[scrubbed]';

// Every pattern is linear (no nested repeats): this runs on any error text, in the browser too.
const replacements: readonly (readonly [RegExp, (match: string) => string])[] = [
  // Drizzle's failed query message lists the values sent: drop everything after it.
  [/params:[\s\S]*$/, () => `params: ${SCRUBBED}`],
  // Postgres constraint details: Key (phone)=(9876543210) already exists.
  [/=\([^)]*\)/g, () => `=(${SCRUBBED})`],
  [/"[^"]*"/g, () => `"${SCRUBBED}"`],
  [/'[^']*'/g, () => `'${SCRUBBED}'`],
  [/`[^`]*`/g, () => `\`${SCRUBBED}\``],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, () => SCRUBBED],
  [/\bMVH-\d+\b/gi, () => SCRUBBED],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, () => SCRUBBED],
  // Link tokens and keys: long runs of letters and digits that hold a digit, or longer ones that
  // mix upper and lower case (a random token may hold no digit at all; plain words rarely mix).
  [/(?=[\w-]*\d)[\w-]{20,}|(?=[\w-]*[a-z])(?=[\w-]*[A-Z])[\w-]{24,}/g, () => SCRUBBED],
  // Phone numbers: 10 or more digits, with or without +91, spaces or dashes between them.
  [/\+?\d[\d\s-]{8,}\d/g, (match) => (match.replace(/\D/g, '').length >= 10 ? SCRUBBED : match)],
];

export function scrubText(text: string): string {
  return replacements.reduce((result, [pattern, by]) => result.replace(pattern, by), text);
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenLike = /^(?:(?=[\w.-]*\d)[\w.-]{16,}|(?=[\w.-]*[a-z])(?=[\w.-]*[A-Z])[\w.-]{24,})$/;

/**
 * Keeps the place, never what was in the address: no query or fragment, ids and tokens replaced.
 * `/p/<token>?from=sms` becomes `/p/[token]`.
 */
export function scrubUrl(url: string): string {
  const [head = ''] = url.split(/[?#]/, 1);
  const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(head)?.[0] ?? '';
  const segments = head.slice(origin.length).split('/');
  const path = segments.map((segment, index) => {
    if (segments[index - 1] === 'p' && segment !== '') return '[token]';
    if (uuid.test(segment)) return '[id]';
    if (tokenLike.test(segment)) return '[token]';
    return scrubText(segment);
  });
  return origin + path.join('/');
}

function scrubValues<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      typeof value === 'string' ? scrubText(value) : value,
    ]),
  ) as T;
}

/** `beforeBreadcrumb`: console lines are dropped; the rest keep only where and how, scrubbed. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') return null;
  const data = breadcrumb.data ?? {};
  const kept: Record<string, unknown> = {};
  for (const key of ['url', 'from', 'to']) {
    if (typeof data[key] === 'string') kept[key] = scrubUrl(data[key]);
  }
  for (const key of ['method', 'status_code']) {
    if (data[key] !== undefined) kept[key] = data[key];
  }
  return {
    ...breadcrumb,
    message: breadcrumb.message === undefined ? undefined : scrubText(breadcrumb.message),
    data: kept,
  };
}

/** `beforeSend`: what was asked, who asked and local values go; text and addresses are scrubbed. */
export function scrubEvent<E extends Event = ErrorEvent>(event: E): E {
  const scrubbed: E = { ...event };
  delete scrubbed.user;
  delete scrubbed.extra;
  if (event.request) {
    scrubbed.request = {
      method: event.request.method,
      url: event.request.url === undefined ? undefined : scrubUrl(event.request.url),
    };
  }
  if (event.transaction) scrubbed.transaction = scrubUrl(event.transaction);
  if (event.message) scrubbed.message = scrubText(event.message);
  if (event.logentry) {
    scrubbed.logentry = {
      message: event.logentry.message === undefined ? undefined : scrubText(event.logentry.message),
    };
  }
  if (event.exception?.values) {
    scrubbed.exception = {
      values: event.exception.values.map((exception) => ({
        ...exception,
        value: exception.value === undefined ? undefined : scrubText(exception.value),
        stacktrace: exception.stacktrace && {
          ...exception.stacktrace,
          frames: exception.stacktrace.frames?.map(({ vars: _vars, ...frame }) => frame),
        },
      })),
    };
  }
  if (event.breadcrumbs) {
    scrubbed.breadcrumbs = event.breadcrumbs
      .map(scrubBreadcrumb)
      .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null);
  }
  if (event.tags) scrubbed.tags = scrubValues(event.tags);
  if (event.contexts) {
    scrubbed.contexts = Object.fromEntries(
      Object.entries(event.contexts).map(([name, context]) => [
        name,
        context && scrubValues(context),
      ]),
    );
  }
  return scrubbed;
}
