'use client';

type Details = { name: string; phone: string; email: string; patient: string };

// Fails the way careless code would: the details go to the console, into a request address and
// into the error text.
export function FailingButton({ details }: { details: Details }) {
  return (
    <button
      type="button"
      className="inline-flex h-row items-center justify-center rounded-control border border-transparent bg-accent px-3.5 font-medium text-on-accent pointer-coarse:h-row-touch"
      onClick={() => {
        console.log(`Opening ${details.name} ${details.phone}`);
        void fetch(`/api/health?phone=${encodeURIComponent(details.phone)}`).finally(() => {
          throw new Error(
            `Could not open "${details.name}", ${details.phone}, ${details.email}, ${details.patient}`,
          );
        });
      }}
    >
      Open
    </button>
  );
}
