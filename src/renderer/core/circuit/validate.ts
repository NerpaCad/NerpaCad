/** Checks a circuit read from a file; returns a clean copy or null. */
import { validProgram } from '../io/program'
import { type Circuit, LED_COLORS, type LedColor, type Part, type Wire } from './model'
import { SPECS } from './parts'

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e6
const str = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length > 0 && v.length <= max

export function validateCircuit(raw: unknown): Circuit | null {
  const c = raw as Partial<Circuit> | null
  if (!c || typeof c !== 'object' || !Array.isArray(c.parts) || !Array.isArray(c.wires)) return null
  if (c.parts.length > 500 || c.wires.length > 2000) return null
  const ids = new Set<string>()
  const parts: Part[] = []
  for (const p of c.parts) {
    if (!p || !str(p.id) || p.id.includes(':') || p.id.includes('|') || ids.has(p.id) || !Object.hasOwn(SPECS, p.kind) || !num(p.x) || !num(p.y)) return null
    if (![0, 90, 180, 270].includes(p.rot)) return null
    ids.add(p.id)
    const part: Part = { id: p.id, kind: p.kind, x: p.x, y: p.y, rot: p.rot }
    if (p.kind === 'resistor' || p.kind === 'pot') {
      // the editor allows up to 10 MΩ
      if (typeof p.ohms !== 'number' || !Number.isFinite(p.ohms) || p.ohms <= 0 || p.ohms > 1e7) return null
      part.ohms = p.ohms
    }
    if (p.kind === 'pot' && p.knob !== undefined) {
      if (typeof p.knob !== 'number' || !Number.isFinite(p.knob)) return null
      part.knob = Math.max(0, Math.min(1, p.knob))
    }
    if (p.kind === 'led') {
      if (!LED_COLORS.includes(p.color as LedColor)) return null
      part.color = p.color
    }
    if (p.kind === 'arduino' && p.program !== undefined) {
      if (!validProgram(p.program)) return null
      part.program = p.program
    }
    parts.push(part)
  }
  const pinOk = (r: unknown) => {
    const ref = r as { part?: unknown; pin?: unknown }
    const part = parts.find((p) => p.id === ref?.part)
    return !!part && typeof ref.pin === 'string' && SPECS[part.kind].pins.some((q) => q.id === ref.pin)
  }
  const wires: Wire[] = []
  for (const w of c.wires) {
    if (!w || !str(w.id) || ids.has(w.id) || !pinOk(w.a) || !pinOk(w.b)) return null
    if (!Array.isArray(w.points) || w.points.length > 200 || !w.points.every((q) => Array.isArray(q) && q.length === 2 && num(q[0]) && num(q[1])))
      return null
    if (typeof w.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(w.color)) return null
    ids.add(w.id)
    wires.push({ id: w.id, a: { part: w.a.part, pin: w.a.pin }, b: { part: w.b.part, pin: w.b.pin }, points: w.points.map((q) => [q[0], q[1]]), color: w.color })
  }
  return { parts, wires }
}
