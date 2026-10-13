/** Checks a sketch read from a file. Returns a clean copy, or null when it is not usable. */
import { type ConstraintType, RESERVED, type SkConstraint, type SkCurve, type SkPoint, type Sketch } from './types'

const TYPES: ConstraintType[] = [
  'coincident',
  'horizontal',
  'vertical',
  'parallel',
  'perpendicular',
  'equal',
  'tangent',
  'pointOn',
  'midpoint',
  'symmetric',
  'lock',
  'distance',
  'distanceX',
  'distanceY',
  'radius',
  'diameter',
  'angle'
]

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/** '#' is reserved for the solver's internal ids */
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 64 && !v.includes('#')
const MAX_NEXT = 1e9

export function validateSketch(raw: unknown): Sketch | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Sketch>
  if (!Array.isArray(r.points) || !Array.isArray(r.curves) || !Array.isArray(r.constraints)) return null
  const ids = new Set<string>()
  const fresh = (id: unknown) => str(id) && !ids.has(id) && !RESERVED.has(id)

  const points: SkPoint[] = []
  for (const p of r.points as unknown[]) {
    const q = p as SkPoint
    if (!q || !fresh(q.id) || !num(q.x) || !num(q.y)) return null
    ids.add(q.id)
    points.push({ id: q.id, x: q.x, y: q.y })
  }
  const isPoint = (id: unknown) => str(id) && (id === 'O' || points.some((p) => p.id === id))

  const curves: SkCurve[] = []
  for (const c of r.curves as unknown[]) {
    const k = c as SkCurve
    if (!k || !fresh(k.id)) return null
    const construction = k.construction === true ? { construction: true } : {}
    if (k.kind === 'line' && isPoint(k.p1) && isPoint(k.p2) && k.p1 !== k.p2)
      curves.push({ id: k.id, kind: 'line', p1: k.p1, p2: k.p2, ...construction })
    else if (k.kind === 'circle' && isPoint(k.c) && num(k.r) && k.r > 0)
      curves.push({ id: k.id, kind: 'circle', c: k.c, r: k.r, ...construction })
    else if (
      k.kind === 'arc' &&
      isPoint(k.c) &&
      isPoint(k.start) &&
      isPoint(k.end) &&
      new Set([k.c, k.start, k.end]).size === 3 &&
      num(k.r) &&
      k.r > 0
    )
      curves.push({ id: k.id, kind: 'arc', c: k.c, start: k.start, end: k.end, r: k.r, ...construction })
    else if (
      k.kind === 'spline' &&
      Array.isArray(k.pts) &&
      k.pts.length >= (k.closed ? 3 : 2) &&
      k.pts.length <= 1000 &&
      k.pts.every(isPoint) &&
      new Set(k.pts).size === k.pts.length
    )
      curves.push({ id: k.id, kind: 'spline', pts: [...k.pts], ...(k.closed === true ? { closed: true } : {}), ...construction })
    else return null
    ids.add(k.id)
  }

  const constraints: SkConstraint[] = []
  for (const c of r.constraints as unknown[]) {
    const k = c as SkConstraint
    if (!k || !fresh(k.id) || !TYPES.includes(k.type) || !Array.isArray(k.refs)) return null
    if (k.refs.length < 1 || k.refs.length > 3) return null
    if (!k.refs.every((x) => str(x) && (ids.has(x) || RESERVED.has(x)))) return null
    if (k.value !== undefined && !num(k.value)) return null
    if (k.value2 !== undefined && !num(k.value2)) return null
    const out: SkConstraint = { id: k.id, type: k.type, refs: [...k.refs] }
    if (k.value !== undefined) out.value = k.value
    if (k.value2 !== undefined) out.value2 = k.value2
    // a dimension's own placement: dropped (not an error) when it is not a short list of numbers
    if (Array.isArray(k.place) && k.place.length >= 1 && k.place.length <= 2 && k.place.every((v) => num(v))) out.place = [...k.place]
    constraints.push(out)
    ids.add(k.id)
  }

  // new ids must never collide with loaded ones
  let next = num(r.next) && r.next >= 1 ? Math.floor(r.next) : 1
  for (const id of ids) {
    const m = /(\d+)$/.exec(id)
    if (m) next = Math.max(next, parseInt(m[1], 10) + 1)
  }
  if (next > MAX_NEXT) return null
  return { points, curves, constraints, next }
}
