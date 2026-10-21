'use client';

import { seesAllCentres, staffRoleLabels, staffRoles, type StaffRole } from '@clinic-mx/schemas';
import { useId, useState } from 'react';

export interface StaffFieldDefaults {
  name: string;
  role: StaffRole;
  treatsPatients: boolean;
  consultant: boolean;
  centreIds: string[];
  accessEndsOn: string;
}

interface StaffFieldsProps {
  centres: { id: string; name: string }[];
  defaults: StaffFieldDefaults;
  fieldErrors?: Record<string, string>;
  /** The Super Admin editing themselves: their own role cannot change. */
  roleLocked?: boolean;
}

const fieldError = (id: string, message?: string) =>
  message ? (
    <p id={id} className="text-sm text-danger">
      {message}
    </p>
  ) : null;

const choiceClass =
  'flex min-h-row items-center gap-3 rounded-control px-1 text-ink pointer-coarse:min-h-row-touch';
const boxClass = 'size-4 accent-accent';

/**
 * Role, ticks, centres and end date for a staff member (IAM-06). Physiotherapists always treat
 * patients; Super Admin and Finance see every centre. The server checks the same rules.
 */
export function StaffFields({ centres, defaults, fieldErrors = {}, roleLocked }: StaffFieldsProps) {
  const id = useId();
  const [role, setRole] = useState<StaffRole>(defaults.role);
  const allCentres = seesAllCentres(role);
  const physio = role === 'physiotherapist';

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-name`} className="font-medium text-ink">
          Name
        </label>
        <input
          id={`${id}-name`}
          name="name"
          defaultValue={defaults.name}
          autoComplete="off"
          aria-invalid={fieldErrors.name ? true : undefined}
          aria-describedby={fieldErrors.name ? `${id}-name-error` : undefined}
          className="h-row w-full rounded-control border border-line-control bg-surface px-3 text-ink shadow-xs hover:border-ink-muted aria-invalid:border-danger pointer-coarse:h-row-touch"
        />
        {fieldError(`${id}-name-error`, fieldErrors.name)}
      </div>

      <fieldset className="flex flex-col gap-1" disabled={roleLocked}>
        <legend className="mb-1 font-medium text-ink">Role</legend>
        {roleLocked ? (
          <p className="mb-1 text-sm text-ink-muted">You cannot change your own role.</p>
        ) : null}
        {staffRoles.map((option) => (
          <label key={option} className={choiceClass}>
            <input
              type="radio"
              name="role"
              value={option}
              checked={role === option}
              onChange={() => {
                setRole(option);
              }}
              className={boxClass}
            />
            {staffRoleLabels[option]}
          </label>
        ))}
        {fieldError(`${id}-role-error`, fieldErrors.role)}
      </fieldset>
      {/* A disabled fieldset sends nothing; the locked role still has to reach the server. */}
      {roleLocked ? <input type="hidden" name="role" value={role} /> : null}

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium text-ink">Clinical ticks</legend>
        <label className={choiceClass}>
          <input
            type="checkbox"
            name="treatsPatients"
            defaultChecked={defaults.treatsPatients || physio}
            disabled={physio}
            className={boxClass}
          />
          Treats patients
        </label>
        {physio ? (
          <p className="text-sm text-ink-muted">Physiotherapists always treat patients.</p>
        ) : null}
        <label className={choiceClass}>
          <input
            type="checkbox"
            name="consultant"
            defaultChecked={defaults.consultant}
            aria-describedby={`${id}-consultant-helper`}
            className={boxClass}
          />
          Consultant
        </label>
        <p id={`${id}-consultant-helper`} className="text-sm text-ink-muted">
          Consultations, diagnosis, plan of care, clearance and discharge. Needs Treats patients.
        </p>
        {fieldError(`${id}-consultant-error`, fieldErrors.consultant)}
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium text-ink">Centres</legend>
        {allCentres ? (
          <p className="text-ink-secondary">{staffRoleLabels[role]} sees all centres.</p>
        ) : (
          centres.map((centre) => (
            <label key={centre.id} className={choiceClass}>
              <input
                type="checkbox"
                name="centreIds"
                value={centre.id}
                defaultChecked={defaults.centreIds.includes(centre.id)}
                className={boxClass}
              />
              {centre.name}
            </label>
          ))
        )}
        {fieldError(`${id}-centres-error`, fieldErrors.centreIds)}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-ends`} className="font-medium text-ink">
          Access end date <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <input
          id={`${id}-ends`}
          type="date"
          name="accessEndsOn"
          defaultValue={defaults.accessEndsOn}
          aria-describedby={`${id}-ends-helper`}
          aria-invalid={fieldErrors.accessEndsOn ? true : undefined}
          className="h-row w-full rounded-control border border-line-control bg-surface px-3 text-ink shadow-xs hover:border-ink-muted aria-invalid:border-danger pointer-coarse:h-row-touch"
        />
        <p id={`${id}-ends-helper`} className="text-sm text-ink-muted">
          For temporary staff. They can sign in until the end of this day.
        </p>
        {fieldError(`${id}-ends-error`, fieldErrors.accessEndsOn)}
      </div>
    </>
  );
}

/** An invite link to send another way, with a copy button. Shown once. */
export function InviteLink({ link }: { link: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-panel border border-line bg-surface-subtle p-4">
      <label htmlFor={id} className="font-medium text-ink">
        Invite link
      </label>
      <input
        id={id}
        readOnly
        value={link}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
        className="h-row w-full rounded-control border border-line-control bg-surface px-3 text-sm text-ink pointer-coarse:h-row-touch"
      />
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(link).then(() => {
            setCopied(true);
          });
        }}
        className="self-start text-accent underline underline-offset-2 pointer-coarse:py-3"
      >
        {copied ? 'Copied' : 'Copy invite link'}
      </button>
      <p className="text-sm text-ink-muted">It works once and is not shown again.</p>
    </div>
  );
}
