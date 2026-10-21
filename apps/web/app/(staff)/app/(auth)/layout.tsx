import type { ReactNode } from 'react';

// Sign in and password reset (IAM-01): one 400 px panel centred on the canvas, the logo at the
// top, one primary button (design system v2, sign in and lock screens).
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-canvas px-4 py-10 sm:items-center">
      <div className="flex w-full max-w-signin flex-col gap-6 rounded-panel border border-line bg-surface p-6 shadow-xs">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG logo; next/image adds nothing */}
        <img
          src="/brand/movementology-logo.svg"
          alt="Movementology"
          className="h-6 w-auto self-start"
        />
        {children}
      </div>
    </main>
  );
}
