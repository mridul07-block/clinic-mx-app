import { renderIcon } from '../lib/pwa/icon';

// The home screen icon on iPhone and iPad (iOS reads apple-touch-icon, not the manifest).
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return renderIcon(size.width, 0.72);
}
