import { pwaIcons, renderIcon, type PwaIconName } from '../../../lib/pwa/icon';

// /icons/icon-192.png, /icons/icon-512.png and /icons/maskable-512.png for the web app
// manifest, generated once at build.
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(pwaIcons).map((name) => ({ name }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const icon = pwaIcons[name as PwaIconName];
  return renderIcon(icon.size, icon.mark);
}
