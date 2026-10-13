/**
 * The key of a shortcut, lower case, whatever the keyboard layout: with a Russian layout
 * Ctrl+Z arrives as "я", so a non-Latin letter falls back to the physical key (KeyZ → "z").
 */
export function shortcutKey(e: KeyboardEvent): string {
  const k = e.key.toLowerCase()
  if (k.length === 1 && /[a-z0-9]/.test(k)) return k
  const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code)
  if (m) return (m[1] ?? m[2]).toLowerCase()
  return k
}
