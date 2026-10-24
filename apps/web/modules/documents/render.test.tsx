import { describe, expect, it } from 'vitest';
import { renderPdf } from './render';
import { LetterheadSample } from './sample';

// ALT-05: the letterhead renders on the server as an A4 PDF with IBM Plex embedded.
describe('renderPdf', () => {
  it('renders the letterhead sample as a two page A4 PDF with Plex Sans and Mono', async () => {
    const bytes = await renderPdf(
      <LetterheadSample
        centre={{ name: 'HSR Layout', address: '27th Main, HSR Layout', phone: '+918041234567' }}
        centreCode="HSR"
        generatedAt={new Date('2026-09-28T10:35:00Z')}
      />,
    );
    const text = Buffer.from(bytes).toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    // Page dictionaries and font descriptors are not compressed, so they can be read here.
    expect(text).toMatch(/\/Type \/Pages[^>]*\/Count 2/);
    expect(text).toMatch(/\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+IBMPlexSans\b/);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+IBMPlexSans-SmBld/);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+IBMPlexMono/);
    // The fonts are embedded, not referenced.
    expect(text).toContain('/FontFile2');
  }, 20_000);
});
