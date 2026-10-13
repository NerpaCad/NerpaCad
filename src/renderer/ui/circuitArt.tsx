/** Drawings of the circuit parts (SVG, part-local millimetres, y down). */
import { memo } from 'preact/compat'
import type { LedColor, Part } from '../core/circuit/model'
import { BB_COLS, BB_RAILS, P, SPECS, railColumn, resistorBands } from '../core/circuit/parts'

const LED_FILL: Record<LedColor, string> = { red: '#e0322b', yellow: '#f2d40b', green: '#2bc24a', blue: '#2f7dff', white: '#f2f4f7' }

export function ArduinoArt({ l13 = 0, on = false }: { l13?: number; on?: boolean }) {
  const pins = SPECS.arduino.pins
  const groups: [number, number, number][] = []
  // header strips under the pin rows
  for (const [from, to] of [
    [0, 10],
    [10, 18],
    [18, 25],
    [25, 31]
  ]) {
    const g = pins.slice(from, to)
    groups.push([Math.min(...g.map((p) => p.x)), Math.max(...g.map((p) => p.x)), g[0].y])
  }
  return (
    <g>
      <rect x="-6.4" y="9.3" width="16" height="12" rx="0.6" fill="#c9ced6" stroke="#8a9099" stroke-width="0.3" />
      <rect x="-1.8" y="39.5" width="13.5" height="9" rx="0.8" fill="#26282c" />
      <rect x="0" y="0" width="68.6" height="53.3" rx="2.2" fill="#00979d" stroke="#006a6e" stroke-width="0.35" />
      <path d="M0 0h68.6v53.3H0z" fill="none" />
      {[
        [13.97, 5.2],
        [15.24, 47.8],
        [66.04, 7.62],
        [66.04, 35.56]
      ].map(([x, y]) => (
        <circle cx={x} cy={y} r="1.6" fill="#f5f3ee" stroke="#c9b37a" stroke-width="0.5" />
      ))}
      {/* chip and parts */}
      <rect x="31" y="31.5" width="29" height="7.6" rx="0.5" fill="#1d1f22" />
      {Array.from({ length: 14 }, (_, i) => (
        <>
          <rect x={31.7 + i * 2} y="30.6" width="0.9" height="0.9" fill="#b9bec6" />
          <rect x={31.7 + i * 2} y="39.1" width="0.9" height="0.9" fill="#b9bec6" />
        </>
      ))}
      <rect x="18" y="13" width="6" height="4" rx="0.4" fill="#d6d9de" stroke="#8a9099" stroke-width="0.2" />
      <circle cx="4.2" cy="4.2" r="1.9" fill="#d3d6da" />
      <circle cx="4.2" cy="4.2" r="1.2" fill="#d8352a" />
      <text x="38" y="23" font-size="5.2" font-weight="800" fill="#ffffff" font-family="Arial, sans-serif" letter-spacing="0.3">
        UNO
      </text>
      <text x="37.5" y="27.2" font-size="2.4" font-weight="700" fill="#e6f7f7" font-family="Arial, sans-serif" letter-spacing="0.2">
        ARDUINO
      </text>
      {/* "L" LED on pin 13 and the power LED */}
      <rect x="27.2" y="8.6" width="1.8" height="1" rx="0.2" fill={l13 > 0 ? '#ffb020' : '#7a5a24'} />
      {l13 > 0 && <circle cx="28.1" cy="9.1" r="2.6" fill="#ffb020" opacity={0.35 * l13} />}
      <text x="25.2" y="9.6" font-size="1.3" fill="#ffffff" font-family="Arial, sans-serif">
        L
      </text>
      <rect x="57" y="19" width="1.8" height="1" rx="0.2" fill={on ? '#58ff6a' : '#2c6a33'} />
      {on && <circle cx="57.9" cy="19.5" r="2.4" fill="#58ff6a" opacity="0.35" />}
      <text x="59.4" y="19.9" font-size="1.3" fill="#ffffff" font-family="Arial, sans-serif">
        ON
      </text>
      {groups.map(([x0, x1, y]) => (
        <rect x={x0 - 1.27} y={y - 1.27} width={x1 - x0 + 2.54} height="2.54" fill="#1a1a1a" />
      ))}
      {pins.map((p) => (
        <>
          <rect x={p.x - 0.55} y={p.y - 0.55} width="1.1" height="1.1" fill="#5d6168" />
          <text
            x={p.x + 0.45}
            y={p.y < 20 ? 4.3 : 49.2}
            font-size="1.25"
            fill="#ffffff"
            font-family="Arial, sans-serif"
            text-anchor={p.y < 20 ? 'end' : 'start'}
            transform={`rotate(-90 ${p.x + 0.45} ${p.y < 20 ? 4.3 : 49.2})`}
          >
            {p.label}
          </text>
        </>
      ))}
      <text x="47" y="9" font-size="1.7" fill="#ffffff" font-family="Arial, sans-serif">
        DIGITAL (PWM~)
      </text>
      <text x="54" y="46.5" font-size="1.7" fill="#ffffff" font-family="Arial, sans-serif">
        ANALOG IN
      </text>
      <text x="31" y="46.5" font-size="1.7" fill="#ffffff" font-family="Arial, sans-serif">
        POWER
      </text>
    </g>
  )
}

export function ResistorArt({ ohms = 220 }: { ohms?: number }) {
  const bands = resistorBands(ohms)
  return (
    <g>
      <line x1="0" y1="0" x2="10.16" y2="0" stroke="#9aa0a6" stroke-width="0.55" stroke-linecap="round" />
      <rect x="2.2" y="-1.25" width="5.76" height="2.5" rx="1.15" fill="#e3c79a" stroke="#b69b6c" stroke-width="0.2" />
      {[3.05, 4.05, 5.05, 6.75].map((x, i) => (
        <rect x={x} y="-1.2" width="0.55" height="2.4" fill={bands[i]} />
      ))}
    </g>
  )
}

export function LedArt({ color = 'red', brightness = 0, burnt = false }: { color?: LedColor; brightness?: number; burnt?: boolean }) {
  const c = LED_FILL[color]
  const b = burnt ? 0 : brightness
  return (
    <g>
      <line x1="0" y1="0" x2="0" y2="-4.2" stroke="#9aa0a6" stroke-width="0.45" />
      <polyline points="2.54,0 2.54,-2.6 1.9,-3.6 1.9,-4.2" fill="none" stroke="#9aa0a6" stroke-width="0.45" />
      {b > 0 && <circle cx="1.27" cy="-6.4" r={3 + 4 * b} fill={c} opacity={0.25 + 0.35 * b} />}
      <rect x="-1.4" y="-4.9" width="5.34" height="1.1" rx="0.4" fill={burnt ? '#4a4a4a' : c} opacity={burnt ? 1 : 0.9} />
      <circle cx="1.27" cy="-6.4" r="2.5" fill={burnt ? '#5a5a5a' : c} opacity={burnt ? 1 : 0.55 + 0.45 * b} stroke={burnt ? '#2a2a2a' : '#00000033'} stroke-width="0.2" />
      {b > 0 && <circle cx="1.27" cy="-6.4" r="1.6" fill="#ffffff" opacity={0.7 * b} />}
      <ellipse cx="0.5" cy="-7.4" rx="0.7" ry="1" fill="#ffffff" opacity="0.45" />
      {burnt && <path d="M0 -8.2l1 1.4-0.8 0.9 1.6 1.6M2.6 -8.4l-0.6 1.8 1 0.6" fill="none" stroke="#1a1a1a" stroke-width="0.3" />}
    </g>
  )
}

/** A 400-point breadboard: white body, the rails with red + and blue − lines, the centre groove. */
export const BreadboardArt = memo(BreadboardPicture)
function BreadboardPicture() {
  const b = SPECS.breadboard.box
  const W = (BB_COLS - 1) * P
  const holes = SPECS.breadboard.pins
  const rail = (y: number, plus: boolean) => (
    <line x1={railColumn(0) * P - 1.5} x2={railColumn(24) * P + 1.5} y1={y} y2={y} stroke={plus ? '#d8352a' : '#2f6fd6'} stroke-width="0.35" />
  )
  return (
    <g>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="1.4" fill="#f3f2ec" stroke="#c9c7bd" stroke-width="0.3" />
      {/* the groove in the middle, where chips straddle */}
      <rect x={b.x + 0.6} y={8.1 * P} width={b.w - 1.2} height={0.8 * P} fill="#e0ded5" />
      {/* rail lines just outside each pair of rails */}
      {rail(-1.3, false)}
      {rail(1.75 * P, true)}
      {rail(15.45 * P, true)}
      {rail(17 * P + 1.3, false)}
      {BB_RAILS.map((r) => (
        <text x={b.x + 0.9} y={r.y * P + 0.7} font-size="2" font-weight="700" fill={r.plus ? '#d8352a' : '#2f6fd6'} font-family="Arial, sans-serif">
          {r.plus ? '+' : '−'}
        </text>
      ))}
      {['a', 'b', 'c', 'd', 'e'].map((r, i) => (
        <text x={-2.6} y={(3 + i) * P + 0.55} font-size="1.4" fill="#8d8b82" font-family="Arial, sans-serif">
          {r}
        </text>
      ))}
      {['f', 'g', 'h', 'i', 'j'].map((r, i) => (
        <text x={-2.6} y={(10 + i) * P + 0.55} font-size="1.4" fill="#8d8b82" font-family="Arial, sans-serif">
          {r}
        </text>
      ))}
      {Array.from({ length: BB_COLS }, (_, c) => c + 1)
        .filter((c) => c === 1 || c % 5 === 0)
        .flatMap((c) => [
          <text x={(c - 1) * P} y={2.55 * P} font-size="1.2" fill="#8d8b82" text-anchor="middle" font-family="Arial, sans-serif">
            {c}
          </text>,
          <text x={(c - 1) * P} y={14.8 * P + 0.4} font-size="1.2" fill="#8d8b82" text-anchor="middle" font-family="Arial, sans-serif">
            {c}
          </text>
        ])}
      {holes.map((h) => (
        <rect x={h.x - 0.55} y={h.y - 0.55} width="1.1" height="1.1" rx="0.15" fill="#3b3a36" />
      ))}
      <path d={`M0 0h${W}`} fill="none" />
    </g>
  )
}

/** A blue trimmer potentiometer with a white knob; `knob` 0…1 turns its pointer through 270°. */
export function PotArt({ knob = 0.5, ohms = 10_000 }: { knob?: number; ohms?: number }) {
  const a = -135 + 270 * Math.max(0, Math.min(1, knob))
  const label = ohms >= 1000 ? `${Math.round(ohms / 100) / 10}k` : String(Math.round(ohms))
  return (
    <g>
      {[0, P, 2 * P].map((x) => (
        <line x1={x} y1="0" x2={x} y2="-2.2" stroke="#9aa0a6" stroke-width="0.5" />
      ))}
      <rect x={P - 4.9} y="-10" width="9.8" height="8.4" rx="0.8" fill="#2f63c7" stroke="#1f4591" stroke-width="0.3" />
      <circle cx={P} cy="-5.8" r="3.4" fill="#f1f3f6" stroke="#b8bec7" stroke-width="0.3" />
      <g transform={`rotate(${a} ${P} -5.8)`}>
        <rect x={P - 0.45} y="-8.9" width="0.9" height="3.4" rx="0.3" fill="#3a3f47" />
      </g>
      <text x={P + 4.4} y="-2.3" font-size="1.4" fill="#e8eefc" text-anchor="end" font-family="Arial, sans-serif">
        {label}
      </text>
    </g>
  )
}

/** A micro servo from above: blue body, white horn at `angle` (0° points right, 90° up), cable to its plug. */
export function ServoArt({ angle = 90, alarm = false }: { angle?: number; alarm?: boolean }) {
  const cx = P - 4.5
  const cy = -27.6
  const r = (angle * Math.PI) / 180
  const tip: [number, number] = [cx + 9 * Math.cos(r), cy - 9 * Math.sin(r)]
  const WIRES = ['#6b4423', '#d8352a', '#ef7d1a']
  return (
    <g>
      {WIRES.map((c, i) => (
        <path d={`M${i * P} -1.2 L${i * P} -5 Q${i * P} -10 ${P - 0.8 + 0.8 * i} -14 L${P - 0.8 + 0.8 * i} -21.4`} fill="none" stroke={c} stroke-width="0.8" stroke-linecap="round" />
      ))}
      <rect x="-1.5" y="-1.6" width={2 * P + 3} height="3.2" rx="0.4" fill="#1d1f22" />
      <rect x={P - 13.9} y="-29.4" width="27.8" height="3.6" rx="0.6" fill="#2a6fd0" stroke="#1b4f9c" stroke-width="0.25" />
      <rect x={P - 11.5} y="-33.6" width="23" height="12.2" rx="0.8" fill="#2f7ae0" stroke={alarm ? '#ff3b30' : '#1b4f9c'} stroke-width={alarm ? 0.8 : 0.3} />
      <circle cx={cx} cy={cy} r="3" fill="#2a6fd0" stroke="#1b4f9c" stroke-width="0.25" />
      <path
        d={`M${cx - 1.4 * Math.sin(r)} ${cy - 1.4 * Math.cos(r)} L${tip[0] - 0.7 * Math.sin(r)} ${tip[1] - 0.7 * Math.cos(r)} A0.8 0.8 0 0 1 ${tip[0] + 0.7 * Math.sin(r)} ${tip[1] + 0.7 * Math.cos(r)} L${cx + 1.4 * Math.sin(r)} ${cy + 1.4 * Math.cos(r)} Z`}
        fill="#f4f5f7"
        stroke="#b8bec7"
        stroke-width="0.25"
      />
      <circle cx={cx} cy={cy} r="1.8" fill="#f4f5f7" stroke="#b8bec7" stroke-width="0.25" />
      <circle cx={cx} cy={cy} r="0.5" fill="#8a9099" />
      <text x={P + 6.5} y="-26.4" font-size="2" font-weight="700" fill="#e6f0ff" text-anchor="middle" font-family="Arial, sans-serif">
        SG90
      </text>
    </g>
  )
}

/** The drawing of any part in its local frame. */
export function PartArt({
  part,
  l13,
  on,
  brightness,
  burnt,
  knob,
  angle,
  alarm
}: {
  part: Part
  l13?: number
  on?: boolean
  brightness?: number
  burnt?: boolean
  /** potentiometer: the knob during a run (otherwise the part's own) */
  knob?: number
  /** servo: its angle during a run */
  angle?: number
  /** servo: asked to move but has no power */
  alarm?: boolean
}) {
  if (part.kind === 'arduino') return <ArduinoArt l13={l13} on={on} />
  if (part.kind === 'resistor') return <ResistorArt ohms={part.ohms} />
  if (part.kind === 'breadboard') return <BreadboardArt />
  if (part.kind === 'pot') return <PotArt knob={knob ?? part.knob ?? 0.5} ohms={part.ohms} />
  if (part.kind === 'servo') return <ServoArt angle={angle ?? 90} alarm={alarm} />
  return <LedArt color={part.color} brightness={brightness} burnt={burnt} />
}

export { LED_FILL }
