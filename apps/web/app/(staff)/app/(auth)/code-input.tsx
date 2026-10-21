import { TextField } from '../../../../components/forms';

/** The 6 digit code from an authenticator app; phones offer the number pad (IAM-02). */
export function CodeInput({ label = '6 digit code' }: { label?: string }) {
  return (
    <TextField
      label={label}
      name="code"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      required
    />
  );
}
