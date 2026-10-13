/** A block program is plain JSON: limit its size and nesting so a bad file cannot hang the app. */
export function validProgram(p: unknown): boolean {
  if (typeof p !== 'object' || p === null) return false
  let count = 0
  const walk = (v: unknown, d: number): boolean => {
    if (++count > 200_000 || d > 400) return false
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return true
    if (typeof v === 'string') return v.length < 10_000
    if (Array.isArray(v)) return v.every((x) => walk(x, d + 1))
    if (typeof v === 'object') return Object.entries(v as object).every(([k, x]) => k.length < 200 && walk(x, d + 1))
    return false
  }
  return walk(p, 0)
}
