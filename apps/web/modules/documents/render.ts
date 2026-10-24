import 'server-only';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import { registerFonts } from './fonts';

/** Renders a document element, a `LetterheadDocument`, to the PDF's bytes on the server. */
export async function renderPdf(element: ReactElement<DocumentProps>): Promise<Uint8Array> {
  registerFonts();
  return new Uint8Array(await renderToBuffer(element));
}
