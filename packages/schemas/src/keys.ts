/**
 * The stable key a record the Super Admin names is known by in settings and code, made from its
 * name when it is added and never changed after: price items (SET-02, for example
 * `zero_gravity_treadmill`) and appointment types (SET-03). Lower case letters, digits and
 * underscores, starting with a letter.
 */
export function keyFromName(name: string): string {
  const key = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
    .replace(/_+$/, '');
  return /^[a-z]/.test(key) ? key : `item_${key}`;
}
