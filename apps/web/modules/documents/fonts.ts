import 'server-only';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Font } from '@react-pdf/renderer';

/**
 * IBM Plex, embedded in every PDF (TAD section 9): Sans at the design system's three weights and
 * Mono for OP and bill numbers (Frontend Specification section 11). Static files from IBM's own
 * packages, under the SIL Open Font License (fonts/OFL.txt); next.config.ts ships them with the
 * functions that render.
 */
export const SANS = 'IBM Plex Sans';
export const MONO = 'IBM Plex Mono';

function fontFolder(): string {
  // The app runs from apps/web (next start, Vercel); the unit tests from the repository root.
  const candidates = [
    join(process.cwd(), 'modules', 'documents', 'fonts'),
    join(process.cwd(), 'apps', 'web', 'modules', 'documents', 'fonts'),
  ];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- two fixed folders of this app
  const folder = candidates.find((candidate) => existsSync(candidate));
  if (!folder) throw new Error('The PDF fonts are missing from modules/documents/fonts.');
  return folder;
}

let registered = false;

/** Registers the fonts once per server process. */
export function registerFonts(): void {
  if (registered) return;
  const folder = fontFolder();
  Font.register({
    family: SANS,
    fonts: [
      { src: join(folder, 'IBMPlexSans-Regular.woff'), fontWeight: 400 },
      { src: join(folder, 'IBMPlexSans-Medium.woff'), fontWeight: 500 },
      { src: join(folder, 'IBMPlexSans-SemiBold.woff'), fontWeight: 600 },
    ],
  });
  Font.register({ family: MONO, src: join(folder, 'IBMPlexMono-Regular.woff') });
  // Clinical words and names are never broken across lines with a hyphen.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
