/**
 * Constraint commands: which constraint a command adds for the current selection (as in
 * FreeCAD, a command is available only when the selection fits it).
 */
import { addConstraint, measure, mergePoints } from './ops'
import { endpointTangency } from './geometry'
import { type ConstraintType, ORIGIN, type Sketch, curvePoints, kindOf, pointPos } from './types'

export type ConstraintCmd =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'equal'
  | 'tangent'
  | 'midpoint'
  | 'symmetric'
  | 'lock'
  | 'dimension'
  | 'distanceX'
  | 'distanceY'

export const CONSTRAINT_CMDS: ConstraintCmd[] = [
  'coincident',
  'horizontal',
  'vertical',
  'parallel',
  'perpendicular',
  'equal',
  'tangent',
  'midpoint',
  'symmetric',
  'lock',
  'dimension',
  'distanceX',
  'distanceY'
]

export interface CmdResult {
  sketch: Sketch
  /** ids of the constraints added */
  added: string[]
}

type Kind = 'point' | 'line' | 'circle' | 'arc' | 'spline'

function kinds(s: Sketch, sel: string[]): Kind[] | null {
  const out: Kind[] = []
  for (const id of sel) {
    const k = kindOf(s, id)
    if (!k || k === 'constraint') return null
    out.push(k)
  }
  return out
}

const isRound = (k: Kind) => k === 'circle' || k === 'arc'

/** Curves that use both points (merging them would collapse the curve). */
function shareCurve(s: Sketch, a: string, b: string): boolean {
  return s.curves.some((c) => {
    const p = curvePoints(c)
    return p.includes(a) && p.includes(b)
  })
}

function addAll(s: Sketch, list: { type: ConstraintType; refs: string[]; value?: number; value2?: number }[]): CmdResult {
  let sk = s
  const added: string[] = []
  for (const c of list) {
    const r = addConstraint(sk, c.type, c.refs, c.value, c.value2)
    sk = r.sketch
    added.push(r.id)
  }
  return { sketch: sk, added }
}

/**
 * Apply a constraint command to the selection. Returns null when the selection does not fit
 * the command (the button is then disabled). Does not solve.
 */
export function applyCommand(s: Sketch, sel: string[], cmd: ConstraintCmd): CmdResult | null {
  const k = kinds(s, sel)
  if (!k || k.length === 0) return null
  const all = (kind: Kind) => k.every((x) => x === kind)
  const n = k.length

  switch (cmd) {
    case 'coincident': {
      if (n !== 2) return null
      if (k[0] === 'point' && k[1] === 'point') {
        const [a, b] = sel
        if (a === b || shareCurve(s, a, b)) return null
        // the points become one; the origin always survives
        const [keep, drop] = b === ORIGIN ? [b, a] : [a, b]
        if (drop === ORIGIN) return null
        return { sketch: mergePoints(s, keep, drop), added: [] }
      }
      // a point and a curve: the point lies on it
      const pi = k[0] === 'point' ? 0 : k[1] === 'point' ? 1 : -1
      if (pi < 0) return null
      const p = sel[pi]
      const c = sel[1 - pi]
      const curve = s.curves.find((x) => x.id === c)
      if (curve && curvePoints(curve).includes(p)) return null
      return addAll(s, [{ type: 'pointOn', refs: [p, c] }])
    }
    case 'horizontal':
    case 'vertical': {
      if (n === 2 && all('point')) {
        if (sel[0] === sel[1]) return null
        return addAll(s, [{ type: cmd, refs: [sel[0], sel[1]] }])
      }
      if (!all('line') || sel.some(isAxis)) return null
      return addAll(s, sel.map((id) => ({ type: cmd, refs: [id] })))
    }
    case 'parallel':
    case 'equal': {
      if (n < 2) return null
      // an axis is a fixed 1 mm helper line: parallel to it is fine, equal length is not
      if (cmd === 'equal' && sel.some(isAxis)) return null
      if (all('line')) return addAll(s, sel.slice(1).map((id) => ({ type: cmd, refs: [sel[0], id] })))
      if (cmd === 'equal' && k.every(isRound)) return addAll(s, sel.slice(1).map((id) => ({ type: 'equal' as const, refs: [sel[0], id] })))
      return null
    }
    case 'perpendicular':
      if (n === 2 && all('line')) return addAll(s, [{ type: 'perpendicular', refs: [sel[0], sel[1]] }])
      return null
    case 'tangent':
      if (n !== 2) return null
      if ((k[0] === 'line' && isRound(k[1])) || (isRound(k[0]) && k[1] === 'line') || (isRound(k[0]) && isRound(k[1]))) {
        const at = endpointTangency(s, sel[0], sel[1])
        return addAll(s, [{ type: 'tangent', refs: [sel[0], sel[1]], ...(at ? { value2: at.angle } : {}) }])
      }
      return null
    case 'midpoint': {
      if (n !== 2) return null
      const pi = k[0] === 'point' && k[1] === 'line' ? 0 : k[1] === 'point' && k[0] === 'line' ? 1 : -1
      if (pi < 0 || isAxis(sel[1 - pi])) return null
      const line = s.curves.find((c) => c.id === sel[1 - pi])
      if (line && curvePoints(line).includes(sel[pi])) return null
      return addAll(s, [{ type: 'midpoint', refs: [sel[pi], sel[1 - pi]] }])
    }
    case 'symmetric': {
      if (n !== 3) return null
      const pts = sel.filter((_, i) => k[i] === 'point')
      const lines = sel.filter((_, i) => k[i] === 'line')
      if (pts.length === 3) return addAll(s, [{ type: 'symmetric', refs: [pts[0], pts[1], pts[2]] }])
      if (pts.length === 2 && lines.length === 1) return addAll(s, [{ type: 'symmetric', refs: [pts[0], pts[1], lines[0]] }])
      return null
    }
    case 'lock': {
      if (!all('point') || sel.includes(ORIGIN)) return null
      return addAll(
        s,
        sel.map((id) => {
          const p = pointPos(s, id)!
          return { type: 'lock' as const, refs: [id], value: p[0], value2: p[1] }
        })
      )
    }
    case 'dimension': {
      let type: ConstraintType | null = null
      let refs: string[] = sel
      if (n === 1 && k[0] === 'line' && !isAxis(sel[0])) type = 'distance'
      else if (n === 1 && k[0] === 'circle') type = 'diameter'
      else if (n === 1 && k[0] === 'arc') type = 'radius'
      else if (n === 2 && all('point')) type = 'distance'
      else if (n === 2 && k.includes('point') && k.includes('line')) {
        type = 'distance'
        refs = k[0] === 'point' ? sel : [sel[1], sel[0]]
      } else if (n === 2 && all('line')) type = 'angle'
      if (!type) return null
      return dim(s, type, refs)
    }
    case 'distanceX':
    case 'distanceY': {
      if (n === 1 && k[0] === 'line' && !isAxis(sel[0])) return dim(s, cmd, sel)
      if (n === 2 && all('point')) return dim(s, cmd, sel)
      // one point: its distance from the origin
      if (n === 1 && k[0] === 'point' && sel[0] !== ORIGIN) return dim(s, cmd, [ORIGIN, sel[0]])
      return null
    }
  }
}

function dim(s: Sketch, type: ConstraintType, refs: string[]): CmdResult | null {
  const v = measure(s, type, refs)
  if (v === null) return null
  const positive = type === 'distance' || type === 'radius' || type === 'diameter'
  if (positive && v <= 1e-9) return null
  if (type === 'angle' && Math.abs(v) < 1e-6) return null
  return addAll(s, [{ type, refs, value: v }])
}

const isAxis = (id: string) => id === 'AX' || id === 'AY'
