import { NextResponse } from 'next/server';
import { currentStaff } from '../../../../modules/auth/session';

// The session of an open staff page (IAM-07). GET: is it still signed in? Open pages ask every
// minute, so deactivation, an end date that passed, or an idle sign out reach them at once.
// POST: the person is active on a desktop (proxy.ts keeps the last activity). Neither is cached.
export const dynamic = 'force-dynamic';

async function answer() {
  const staff = await currentStaff();
  return staff
    ? NextResponse.json({ signedIn: true }, { headers: { 'Cache-Control': 'no-store' } })
    : NextResponse.json(
        { signedIn: false, reason: 'ended' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
}

export const GET = answer;
export const POST = answer;
