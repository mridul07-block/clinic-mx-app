import type { Metadata } from 'next';
import { kioskBrowser } from '../../../modules/kiosk/device';
import { KioskEnded, KioskWelcome } from './kiosk-welcome';

// The clinic tablet's welcome screen (IAM-10, Frontend Specification section 7). A tablet set up
// as a centre's kiosk waits here for the form the front desk sends, and comes back here after a
// submit or when idle. Patient voice (16 px), the gold mark, nothing to tap: the front desk
// starts each form.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Movementology Clinics',
  robots: { index: false, follow: false },
};

export default async function KioskPage() {
  const browser = await kioskBrowser();
  return (
    <main
      data-voice="patient"
      className="flex min-h-dvh flex-col items-center justify-center bg-surface px-4 py-10 text-center"
    >
      <div className="flex w-full max-w-signin flex-col items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG mark; next/image adds nothing */}
        <img src="/brand/movementology-mark.svg" alt="" className="size-16" />
        {browser.status === 'active' ? (
          <KioskWelcome centreName={browser.device.centreName} />
        ) : (
          <KioskEnded stopped={browser.status === 'stopped' || browser.status === 'unknown'} />
        )}
      </div>
    </main>
  );
}
