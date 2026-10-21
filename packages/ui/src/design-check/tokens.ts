/** Colour tokens read from tokens.css: name (without `--`) to lower case `#rrggbb`. */
export type Tokens = ReadonlyMap<string, string>;

/** Reads every `--name: #hex;` declaration, following `var(--other)` aliases. */
export function parseTokens(css: string): Tokens {
  const raw = new Map<string, string>();
  for (const match of css.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) raw.set(name, value.trim());
  }
  const tokens = new Map<string, string>();
  for (const name of raw.keys()) {
    let value = raw.get(name);
    for (let depth = 0; value?.startsWith('var(--') && depth < 5; depth++) {
      value = raw.get(value.slice(6, -1));
    }
    if (value && /^#[0-9a-f]{6}$/i.test(value)) tokens.set(name, value.toLowerCase());
  }
  return tokens;
}

/** WCAG 2.2 relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio between two `#rrggbb` colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
