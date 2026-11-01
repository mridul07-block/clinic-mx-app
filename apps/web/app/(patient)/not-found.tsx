import { ErrorState } from '@clinic-mx/ui/components/error-state';

// A patient page that is not there (UIX-11), in the patient voice: 16 px, plain words, no staff
// links and nowhere to send them but back to the clinic's message.
export default function PatientNotFound() {
  return (
    <main data-voice="patient" className="min-h-dvh bg-surface px-4 py-6">
      <div className="mx-auto flex w-full max-w-[40rem] flex-col gap-6">
        <p className="font-semibold text-ink-secondary">Movementology Clinics</p>
        <ErrorState kind="not-found" title="This page is not here">
          The link may be incomplete or old. Please open it again from the clinic&apos;s message, or
          ask the clinic for a new one.
        </ErrorState>
      </div>
    </main>
  );
}
