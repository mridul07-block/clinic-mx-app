import { buttonVariants } from '@clinic-mx/ui/components/button';
import { ErrorState } from '@clinic-mx/ui/components/error-state';
import { Page } from '@clinic-mx/ui/components/page';
import Link from 'next/link';

// A signed in page that is not there, or that the person may not open (UIX-11): every notFound()
// under the signed in layout shows this inside the navigation, still with a 404 status.
export default function SignedInNotFound() {
  return (
    <Page width="form">
      <ErrorState
        kind="not-found"
        title="We can't find that page"
        action={
          <Link href="/app" className={buttonVariants({ variant: 'primary' })}>
            See all screens
          </Link>
        }
      >
        The address may be wrong, or the page has moved or been removed. Pick the screen you need
        from the list.
      </ErrorState>
    </Page>
  );
}
