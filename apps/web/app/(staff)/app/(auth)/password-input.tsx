'use client';

import { useState } from 'react';
import { TextField } from '../../../../components/forms';

/** A password field with "Show password", for typing on a phone. */
export function PasswordInput({
  label,
  autoComplete,
  helper,
}: {
  label: string;
  autoComplete: 'current-password' | 'new-password';
  helper?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <TextField
        label={label}
        name="password"
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        required
        helper={helper}
      />
      <label className="flex items-center gap-2 self-start text-ink-secondary pointer-coarse:min-h-row-touch">
        <input
          type="checkbox"
          checked={shown}
          onChange={(event) => {
            setShown(event.target.checked);
          }}
        />
        Show password
      </label>
    </div>
  );
}
