'use client';

import { useActionState } from 'react';
import {
  FormMessage,
  dangerButtonClass,
  secondaryButtonClass,
} from '../../../../../../components/forms';
import { staffAccountAction, type StaffFormState } from '../../../../../../modules/staff/actions';
import { InviteLink } from '../staff-fields';

const initialState: StaffFormState = {};

interface AccountActionsProps {
  staffUserId: string;
  name: string;
  active: boolean;
  invitePending: boolean;
  hasLogin: boolean;
  /** The Super Admin's own page: they cannot deactivate themselves. */
  self: boolean;
}

const sectionClass = 'flex flex-col gap-3 rounded-panel border border-line bg-surface p-4';

/**
 * Invite, two step verification and access for one staff member (IAM-06). Deactivating can be
 * undone with Reactivate, so it asks for no confirmation (dialogs are for what cannot be undone);
 * nothing here deletes anyone.
 */
export function AccountActions({
  staffUserId,
  name,
  active,
  invitePending,
  hasLogin,
  self,
}: AccountActionsProps) {
  const [state, action, pending] = useActionState(staffAccountAction, initialState);
  const button = (intent: string, label: string, className = secondaryButtonClass) => (
    <button type="submit" name="intent" value={intent} disabled={pending} className={className}>
      {label}
    </button>
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="staffUserId" value={staffUserId} />
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {state.notice ? <FormMessage tone="info">{state.notice}</FormMessage> : null}
      {state.inviteLink ? <InviteLink link={state.inviteLink} /> : null}

      {invitePending ? (
        <section className={sectionClass}>
          <h2 className="font-semibold text-ink">Invite</h2>
          <p className="text-ink-secondary">{name} has not set a password yet.</p>
          {button('invite-again', 'Send invite again')}
          {button('invite-link', 'Copy invite link')}
        </section>
      ) : null}

      {hasLogin && !invitePending ? (
        <section className={sectionClass}>
          <h2 className="font-semibold text-ink">Two step verification</h2>
          <p className="text-ink-secondary">
            If they lost or replaced their phone, reset it. Their next sign in asks them to set it
            up again.
          </p>
          {button('reset-two-step', 'Reset two step verification')}
        </section>
      ) : null}

      {self ? null : (
        <section className={sectionClass}>
          <h2 className="font-semibold text-ink">Access</h2>
          {active ? (
            <>
              <p className="text-ink-secondary">
                Deactivating signs them out and stops them signing in. Their records stay attributed
                to them, and you can reactivate them later.
              </p>
              {button('deactivate', `Deactivate ${name}`, dangerButtonClass)}
            </>
          ) : (
            <>
              <p className="text-ink-secondary">
                Deactivated. Their records stay attributed to them.
              </p>
              {button('reactivate', `Reactivate ${name}`)}
            </>
          )}
        </section>
      )}
    </form>
  );
}
