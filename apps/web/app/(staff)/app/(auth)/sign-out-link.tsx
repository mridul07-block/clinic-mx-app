import { signOut } from '../../../../modules/auth/actions';

/** Leaves a sign in part way through, for example to use another account. */
export function SignOutLink() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="text-accent underline underline-offset-2 pointer-coarse:py-3"
      >
        Sign out
      </button>
    </form>
  );
}
