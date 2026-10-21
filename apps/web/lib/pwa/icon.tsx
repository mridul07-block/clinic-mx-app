import { tokenValues } from '@clinic-mx/ui';
import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * App icons, drawn at build time: the Movementology mark (the client's SVG file) centred on a
 * white square. Launchers round or mask the square themselves.
 */
export const pwaIcons = {
  'icon-192.png': { size: 192, mark: 0.72 },
  'icon-512.png': { size: 512, mark: 0.72 },
  // Maskable icons may be cropped to a circle: the mark stays inside the 80% safe zone.
  'maskable-512.png': { size: 512, mark: 0.56 },
} as const;

export type PwaIconName = keyof typeof pwaIcons;

export async function renderIcon(size: number, mark: number): Promise<ImageResponse> {
  // Built from the app folder (local, CI and Vercel all build from apps/web).
  const svg = await readFile(join(process.cwd(), 'public', 'brand', 'movementology-mark.svg'));
  const src = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  const side = Math.round(size * mark);
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: tokenValues.surface,
      }}
    >
      {/* next/og draws with Satori, which takes a plain img, not next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain img only */}
      <img src={src} width={side} height={side} alt="" />
    </div>,
    { width: size, height: size },
  );
}
