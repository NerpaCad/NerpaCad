/**
 * Drawings of the circuit parts added in 0.3 (SVG, part-local millimetres, y down, seen from
 * above), and of the things in the room. Each takes what it shows during a run: lit segments,
 * a motor's angle, the LCD's text, a multimeter's reading…
 */
import type { MeterMode, Part, RoomItem } from '../core/circuit/model'
import { P, SPECS } from '../core/circuit/parts'
import type { PartLive } from '../core/circuit/runner'
import { ITEM_SIZE } from '../core/circuit/room'

const LEG = '#9aa0a6'
const FONT = 'Arial, sans-serif'
const MONO = "'Cascadia Mono', Consolas, monospace"

/** What a part shows during a run. */
export interface PartShow {
  live?: PartLive
  /** brightness 0…1 of a light by its pin (an RGB chip, a segment) */
  lit?: (pin: string) => number
  /** a button or joystick held down */
  pressed?: boolean
  /** a switch's side during the run */
  on?: boolean
  /** a joystick's stick 0…1 on each axis */
  joy?: [number, number]
  running?: boolean
}

const legs = (xs: number[], to = -2.2) => xs.map((x) => <line x1={x} y1="0" x2={x} y2={to} stroke={LEG} stroke-width="0.45" />)

export function ButtonArt({ pressed = false }: { pressed?: boolean }) {
  return (
    <g>
      <rect x="-1.2" y={-2 * P - 1.2} width={2 * P + 2.4} height={2 * P + 2.4} rx="0.5" fill="#2a2c31" stroke="#15171a" stroke-width="0.25" />
      {[
        [-0.6, -2 * P - 0.6],
        [2 * P + 0.6, -2 * P - 0.6],
        [-0.6, 0.6],
        [2 * P + 0.6, 0.6]
      ].map(([x, y]) => (
        <circle cx={x} cy={y} r="0.35" fill="#70757d" />
      ))}
      <circle cx={P} cy={-P} r={pressed ? 1.6 : 1.9} fill={pressed ? '#a8261d' : '#d8352a'} stroke="#7a1a14" stroke-width="0.25" />
      {!pressed && <circle cx={P - 0.5} cy={-P - 0.6} r="0.5" fill="#ffffff" opacity="0.4" />}
    </g>
  )
}

export function SwitchArt({ on = false }: { on?: boolean }) {
  const x = on ? 2 * P - 1.6 : 0.2
  return (
    <g>
      {legs([0, P, 2 * P], -1.5)}
      <rect x="-1.8" y="-6" width={2 * P + 3.6} height="4.6" rx="0.5" fill="#2d6fd0" stroke="#1b4f9c" stroke-width="0.25" />
      <rect x="-0.6" y="-4.9" width={2 * P + 1.2} height="2.4" rx="0.4" fill="#163a72" />
      <rect x={x - 0.6} y="-5.3" width="2.8" height="3.2" rx="0.4" fill="#f4f5f7" stroke="#b8bec7" stroke-width="0.2" />
      <text x="-1.2" y="-6.6" font-size="1.3" fill="#8a9099" font-family={FONT}>
        1
      </text>
      <text x={2 * P + 1.2} y="-6.6" font-size="1.3" fill="#8a9099" font-family={FONT} text-anchor="end">
        2
      </text>
    </g>
  )
}

export function BuzzerArt({ freq, active = false }: { freq?: number; active?: boolean }) {
  const cx = 1.5 * P
  const cy = -6.2
  return (
    <g>
      {legs([0, 3 * P], -1)}
      {freq !== undefined &&
        [7.5, 9.5, 11.5].map((r, i) => (
          <path d={`M${cx + r * 0.7} ${cy - r * 0.7} A${r} ${r} 0 0 1 ${cx + r * 0.7} ${cy + r * 0.7}`} fill="none" stroke="#ffb020" stroke-width="0.45" opacity={0.9 - i * 0.25} />
        ))}
      <circle cx={cx} cy={cy} r="6" fill="#1d1f22" stroke="#000000" stroke-width="0.3" />
      <circle cx={cx} cy={cy} r="4.6" fill="none" stroke="#33363c" stroke-width="0.3" />
      <circle cx={cx} cy={cy} r="1" fill="#000000" />
      <text x={cx - 3.8} y={cy - 1.6} font-size="2.2" font-weight="700" fill="#d8352a" font-family={FONT}>
        +
      </text>
      {active && (
        <text x={cx} y={cy + 3.6} font-size="1.4" fill="#9aa0a6" text-anchor="middle" font-family={FONT}>
          ACT
        </text>
      )}
    </g>
  )
}

export function RgbArt({ lit = () => 0 }: { lit?: (pin: string) => number }) {
  const r = lit('R')
  const g = lit('G')
  const b = lit('B')
  const on = Math.max(r, g, b)
  const mix = `rgb(${Math.round(120 + 135 * r)}, ${Math.round(120 + 135 * g)}, ${Math.round(120 + 135 * b)})`
  const cx = 1.5 * P
  return (
    <g>
      {legs([0, P, 2 * P, 3 * P], -3.6)}
      {on > 0 && <circle cx={cx} cy="-6.4" r={3 + 4 * on} fill={mix} opacity={0.25 + 0.35 * on} />}
      <rect x={cx - 2.9} y="-4.9" width="5.8" height="1.1" rx="0.4" fill="#e8eaee" opacity="0.9" />
      <circle cx={cx} cy="-6.4" r="2.6" fill={on > 0 ? mix : '#eef0f3'} opacity={0.75 + 0.25 * on} stroke="#00000033" stroke-width="0.2" />
      {on > 0 && <circle cx={cx} cy="-6.4" r="1.5" fill="#ffffff" opacity={0.7 * on} />}
      <ellipse cx={cx - 0.8} cy="-7.4" rx="0.7" ry="1" fill="#ffffff" opacity="0.45" />
    </g>
  )
}

export function LdrArt({ lux }: { lux?: number }) {
  const cx = P
  return (
    <g>
      {legs([0, 2 * P], -2)}
      <circle cx={cx} cy="-4.6" r="2.9" fill="#d9a441" stroke="#8a6420" stroke-width="0.25" />
      <path
        d={`M${cx - 1.9} -5.8 h3.6 M${cx + 1.7} -5.8 v0.8 h-3.4 v0.8 h3.4 v0.8 h-3.4 v0.8 h3.6`}
        fill="none"
        stroke="#b2302a"
        stroke-width="0.35"
      />
      {lux !== undefined && (
        <text x={cx} y="-8.2" font-size="1.4" fill="#ffd27a" text-anchor="middle" font-family={FONT}>
          {lux < 10 ? lux.toFixed(1) : Math.round(lux)} lx
        </text>
      )}
    </g>
  )
}

export function BatteryArt({ volts = 9 }: { volts?: 9 | 3 }) {
  const bx = P / 2 - 13
  return (
    <g>
      <path d={`M0 -1 V-4 Q0 -8 ${P / 2 - 3} -9`} fill="none" stroke="#d8352a" stroke-width="0.8" stroke-linecap="round" />
      <path d={`M${P} -1 V-4 Q${P} -8 ${P / 2 + 3} -9`} fill="none" stroke="#222222" stroke-width="0.8" stroke-linecap="round" />
      <rect x="-1.2" y="-1.4" width={P + 2.4} height="2.8" rx="0.4" fill="#1d1f22" />
      {volts === 9 ? (
        <>
          <rect x={bx} y="-51" width="26" height="40" rx="1.2" fill="#2b2d33" stroke="#111216" stroke-width="0.3" />
          <rect x={bx} y="-51" width="26" height="16" rx="1.2" fill="#e8b10b" />
          <rect x={bx + 4} y="-11" width="7" height="2.4" rx="0.4" fill="#c9ced6" />
          <rect x={bx + 15} y="-11" width="7" height="2.4" rx="0.4" fill="#c9ced6" />
          <text x={bx + 13} y="-39" font-size="7" font-weight="800" fill="#1d1f22" text-anchor="middle" font-family={FONT}>
            9V
          </text>
        </>
      ) : (
        <>
          <rect x={bx} y="-51" width="26" height="42" rx="1" fill="#1d1f22" stroke="#000000" stroke-width="0.3" />
          {[bx + 1.5, bx + 13.5].map((x, i) => (
            <g>
              <rect x={x} y="-49" width="11" height="38" rx="2" fill={i ? '#2f6fd6' : '#d8352a'} />
              <rect x={x} y="-49" width="11" height="9" rx="2" fill="#c9ced6" />
              <text x={x + 5.5} y="-24" font-size="3" font-weight="700" fill="#ffffff" text-anchor="middle" font-family={FONT}>
                AA
              </text>
            </g>
          ))}
          <text x={bx + 13} y="-5.6" font-size="2.2" fill="#9aa0a6" text-anchor="middle" font-family={FONT}>
            3V
          </text>
        </>
      )}
    </g>
  )
}

/** A multimeter's number as it shows it: volts, or milliamps / amps. */
export function meterText(mode: MeterMode | undefined, v: number | undefined): string {
  if (v === undefined) return '--.--'
  if (mode === 'A') {
    const a = Math.abs(v)
    return a < 1 ? `${(v * 1000).toFixed(a < 0.01 ? 2 : 1)} mA` : `${v.toFixed(2)} A`
  }
  return `${v.toFixed(2)} V`
}

export function MeterArt({ mode = 'V', reading, running = false }: { mode?: MeterMode; reading?: number; running?: boolean }) {
  const cx = P
  return (
    <g>
      <path d={`M0 -1 V-5 Q0 -9 ${cx - 4} -10`} fill="none" stroke="#222222" stroke-width="0.8" stroke-linecap="round" />
      <path d={`M${2 * P} -1 V-5 Q${2 * P} -9 ${cx + 4} -10`} fill="none" stroke="#d8352a" stroke-width="0.8" stroke-linecap="round" />
      <rect x="-1.2" y="-1.4" width={2 * P + 2.4} height="2.8" rx="0.4" fill="#1d1f22" />
      <rect x={cx - 16} y="-61" width="32" height="51" rx="3" fill="#f2c230" stroke="#9c7a12" stroke-width="0.3" />
      <rect x={cx - 13.5} y="-58" width="27" height="46" rx="2" fill="#2a2c31" />
      <rect x={cx - 11.5} y="-55.5" width="23" height="10" rx="0.8" fill={running ? '#b9d7a0' : '#7d8f70'} />
      <text x={cx + 10.5} y="-48.6" font-size="4" font-weight="700" fill="#1a2a12" text-anchor="end" font-family={MONO}>
        {running ? meterText(mode, reading) : '--.--'}
      </text>
      <circle cx={cx} cy="-34" r="6.5" fill="#3b3e45" stroke="#15171a" stroke-width="0.3" />
      <g transform={`rotate(${mode === 'A' ? 40 : -40} ${cx} -34)`}>
        <rect x={cx - 0.6} y="-40" width="1.2" height="6" rx="0.4" fill="#f4f5f7" />
      </g>
      <text x={cx - 7.5} y="-40" font-size="2.6" font-weight="700" fill={mode === 'V' ? '#ffd60a' : '#8a9099'} font-family={FONT}>
        V
      </text>
      <text x={cx + 6} y="-40" font-size="2.6" font-weight="700" fill={mode === 'A' ? '#ffd60a' : '#8a9099'} font-family={FONT}>
        A
      </text>
      <circle cx={cx - 6} cy="-19" r="1.6" fill="#111111" stroke="#555" stroke-width="0.25" />
      <circle cx={cx + 6} cy="-19" r="1.6" fill="#b2302a" stroke="#555" stroke-width="0.25" />
      <text x={cx - 6} y="-15.2" font-size="1.5" fill="#c9ced6" text-anchor="middle" font-family={FONT}>
        COM
      </text>
      <text x={cx + 6} y="-15.2" font-size="1.5" fill="#c9ced6" text-anchor="middle" font-family={FONT}>
        V/A
      </text>
    </g>
  )
}

const SEG_PATHS: Record<string, string> = {
  a: 'M-2.4 -6.6 h4.8',
  b: 'M2.8 -6.2 v4.6',
  c: 'M2.8 0.2 v4.6',
  d: 'M-2.4 5.2 h4.8',
  e: 'M-2.8 0.2 v4.6',
  f: 'M-2.8 -6.2 v4.6',
  g: 'M-2.4 -0.7 h4.8'
}

export function Seg7Art({ lit = () => 0 }: { lit?: (pin: string) => number }) {
  const cx = 2 * P
  const cy = -3 * P
  return (
    <g>
      <rect x="-2.2" y={-6 * P - 1.4} width={4 * P + 4.4} height={6 * P + 2.8} rx="0.5" fill="#1d1f22" stroke="#000" stroke-width="0.25" />
      <g transform={`translate(${cx - 0.3} ${cy}) skewX(-8)`}>
        {Object.entries(SEG_PATHS).map(([s, d]) => {
          const b = lit(s)
          return (
            <>
              {b > 0 && <path d={d} stroke="#ff3b30" stroke-width="2.6" stroke-linecap="round" opacity={0.3 * b} />}
              <path d={d} stroke={b > 0 ? '#ff3b30' : '#3a2826'} stroke-width="1.2" stroke-linecap="round" opacity={b > 0 ? 0.6 + 0.4 * b : 1} />
            </>
          )
        })}
      </g>
      <circle cx={cx + 4.2} cy={cy + 5.4} r="0.7" fill={lit('dp') > 0 ? '#ff3b30' : '#3a2826'} />
    </g>
  )
}

export function MotorArt({ angle = 0, speed = 0 }: { angle?: number; speed?: number }) {
  const cx = 1.5 * P
  const cy = -14
  return (
    <g>
      <path d={`M0 -1 V-3 Q0 -5 ${cx - 3} -5.5`} fill="none" stroke="#d8352a" stroke-width="0.7" />
      <path d={`M${3 * P} -1 V-3 Q${3 * P} -5 ${cx + 3} -5.5`} fill="none" stroke="#222222" stroke-width="0.7" />
      <circle cx={cx} cy={cy} r="10" fill="#c9ced6" stroke="#7d838c" stroke-width="0.4" />
      <circle cx={cx} cy={cy} r="7.5" fill="#b4bac3" />
      <g transform={`rotate(${angle} ${cx} ${cy})`}>
        <rect x={cx - 1} y={cy - 8} width="2" height="16" rx="0.8" fill="#ef7d1a" />
        <circle cx={cx} cy={cy} r="2.6" fill="#ef7d1a" stroke="#a24f0a" stroke-width="0.3" />
      </g>
      <circle cx={cx} cy={cy} r="0.8" fill="#5d6168" />
      {Math.abs(speed) > 0.05 && (
        <path
          d={`M${cx + 11.5} ${cy - 3} A12 12 0 0 1 ${cx + 11.5} ${cy + 3}`}
          fill="none"
          stroke="#ffb020"
          stroke-width="0.5"
          marker-end=""
          transform={speed < 0 ? `scale(-1 1) translate(${-2 * cx} 0)` : undefined}
        />
      )}
    </g>
  )
}

/** A TO-92 package seen from above (a transistor, the TMP36): flat face down, the label on it. */
function To92({ label }: { label: string }) {
  return (
    <g>
      {legs([0, P, 2 * P], -1.2)}
      <path d={`M-1.2 -1.4 H${2 * P + 1.2} A3.6 3.6 0 0 0 ${-1.2} -1.4 Z`} transform={`translate(0 0)`} fill="#1d1f22" stroke="#000" stroke-width="0.2" />
      <rect x="-1.2" y="-2.1" width={2 * P + 2.4} height="0.8" fill="#33363c" />
      <text x={P} y="-2.6" font-size="1.2" fill="#c9ced6" text-anchor="middle" font-family={FONT}>
        {label}
      </text>
    </g>
  )
}

export const NpnArt = () => <To92 label="2222" />
export const Tmp36Art = ({ temp }: { temp?: number }) => (
  <g>
    <To92 label="TMP36" />
    {temp !== undefined && (
      <text x={P} y="-6.4" font-size="1.4" fill="#ffb080" text-anchor="middle" font-family={FONT}>
        {temp.toFixed(1)} °C
      </text>
    )}
  </g>
)

export function DiodeArt() {
  return (
    <g>
      <line x1="0" y1="0" x2={4 * P} y2="0" stroke={LEG} stroke-width="0.55" stroke-linecap="round" />
      <rect x="2.4" y="-1.25" width="5.36" height="2.5" rx="0.5" fill="#1d1f22" stroke="#000" stroke-width="0.2" />
      <rect x="6.6" y="-1.25" width="0.8" height="2.5" fill="#c9ced6" />
    </g>
  )
}

export function LcdArt({ lines, powered = false }: { lines?: string[]; powered?: boolean }) {
  const x0 = 1.5 * P - 40
  return (
    <g>
      {legs([0, P, 2 * P, 3 * P], -1.6)}
      <rect x={x0} y="-37" width="80" height="36" rx="1.6" fill="#1f7a3a" stroke="#0f4a22" stroke-width="0.3" />
      <rect x={x0 + 4} y="-33" width="72" height="24" rx="1" fill="#1d1f22" />
      <rect x={x0 + 6.5} y="-30.5" width="67" height="19" rx="0.6" fill={powered ? '#3f8ff0' : '#26364a'} />
      {(lines ?? ['', '']).map((l, i) => (
        <text x={x0 + 8} y={-24.4 + i * 8} font-size="5.4" fill="#f2f6ff" font-family={MONO} style={{ whiteSpace: 'pre' }} data-testid={powered ? `lcd-line-${i}` : undefined}>
          {powered ? l : ''}
        </text>
      ))}
      <text x={x0 + 40} y="-3" font-size="1.8" fill="#cfe9d6" text-anchor="middle" font-family={FONT}>
        LCD 1602 · I2C
      </text>
    </g>
  )
}

export function JoystickArt({ joy = [0.5, 0.5], pressed = false }: { joy?: [number, number]; pressed?: boolean }) {
  const cx = 2 * P
  const cy = -17
  const sx = cx + (joy[0] - 0.5) * 10
  // VRy grows downward on the screen (toward the pins), as on the usual module held pins down
  const sy = cy + (joy[1] - 0.5) * 10
  return (
    <g>
      {legs([0, P, 2 * P, 3 * P, 4 * P], -1.6)}
      <rect x={cx - 12.5} y="-31.5" width="25" height="30" rx="1.4" fill="#1d1f22" stroke="#000" stroke-width="0.3" />
      <circle cx={cx} cy={cy} r="9.5" fill="#33363c" stroke="#15171a" stroke-width="0.3" />
      <circle cx={sx} cy={sy} r={pressed ? 5.6 : 6.2} fill="#3b3e45" stroke="#5d6168" stroke-width="0.6" />
      <circle cx={sx} cy={sy} r="3.4" fill="#2a2c31" />
    </g>
  )
}

/**
 * The ultrasonic sensor seen from above: it stands on its pin header, the board upright, the two
 * transducers (cans) pointing forward (−y).
 */
export function SonarArt({ powered = false, cm }: { powered?: boolean; cm?: number }) {
  const cx = 1.5 * P
  return (
    <g>
      {powered && cm !== undefined && (
        <line x1={cx} y1="-13.6" x2={cx} y2={-13.6 - cm * 10} stroke="#00f0ff" stroke-width="0.5" stroke-dasharray="2 1.5" opacity="0.7" />
      )}
      {/* the cans: silver cylinders with the mesh at their front */}
      {[cx - 13, cx + 13].map((x) => (
        <>
          <rect x={x - 8} y="-13.6" width="16" height="11.2" rx="0.6" fill="#c9ced6" stroke="#7d838c" stroke-width="0.35" />
          <rect x={x - 6.4} y="-13.6" width="12.8" height="1.2" fill="#3b3e45" />
          <path d={`M${x - 8} -9 H${x + 8} M${x - 8} -5 H${x + 8}`} stroke="#aab0b8" stroke-width="0.3" />
        </>
      ))}
      {/* the crystal between them */}
      <rect x={cx - 3} y="-4.6" width="6" height="2.2" rx="1.1" fill="#d6d9de" stroke="#8a9099" stroke-width="0.2" />
      {/* the upright board and the pin header it stands on */}
      <rect x={cx - 22.5} y="-2.4" width="45" height="1.6" fill="#2f63c7" stroke="#1f4591" stroke-width="0.25" />
      <rect x={-1.27} y="-1.27" width={3 * P + 2.54} height="2.54" fill="#1a1a1a" />
      <text x={cx} y="-15.4" font-size="1.8" fill="#7d838c" text-anchor="middle" font-family={FONT}>
        HC-SR04
      </text>
      {powered && cm !== undefined && (
        <text x={cx} y="-7" font-size="2.2" fill="#1d1f22" text-anchor="middle" font-family={FONT} font-weight="700">
          {Math.round(cm)} cm
        </text>
      )}
    </g>
  )
}

export function IrArt({ active = false, powered = false }: { active?: boolean; powered?: boolean }) {
  const cx = P
  return (
    <g>
      {legs([0, P, 2 * P], -1.4)}
      <rect x={cx - 7} y="-31.5" width="14" height="30" rx="1" fill="#1d1f22" stroke="#000" stroke-width="0.3" />
      <circle cx={cx - 2.6} cy="-29" r="2" fill="#e8eaee" />
      <circle cx={cx + 2.6} cy="-29" r="2" fill="#2a2c31" stroke="#5d6168" stroke-width="0.25" />
      <rect x={cx - 3} y="-21" width="6" height="6" rx="0.6" fill="#2f63c7" />
      <circle cx={cx} cy="-18" r="1.6" fill="#f4f5f7" />
      <circle cx={cx - 3.5} cy="-10" r="0.9" fill={powered ? '#d8352a' : '#5a2320'} />
      <circle cx={cx + 3.5} cy="-10" r="0.9" fill={active ? '#2bff88' : '#1f4a2c'} />
      {active && <circle cx={cx + 3.5} cy="-10" r="2.2" fill="#2bff88" opacity="0.35" />}
    </g>
  )
}

export function PirArt({ active = false, powered = false }: { active?: boolean; powered?: boolean }) {
  const cx = P
  return (
    <g>
      {legs([0, P, 2 * P], -1.4)}
      <rect x={cx - 12} y="-24.5" width="24" height="23" rx="1" fill="#1f7a3a" stroke="#0f4a22" stroke-width="0.3" />
      <circle cx={cx} cy="-13" r="10.5" fill="#f4f5f7" stroke="#c9ced6" stroke-width="0.4" />
      {[3, 6, 9].map((r) => (
        <circle cx={cx} cy="-13" r={r} fill="none" stroke="#dfe3e8" stroke-width="0.35" />
      ))}
      {active && <circle cx={cx} cy="-13" r="12" fill="#ff3b30" opacity="0.18" />}
      <circle cx={cx + 9.5} cy="-3.5" r="0.9" fill={active ? '#ff3b30' : powered ? '#5a2320' : '#3a2826'} />
    </g>
  )
}

/** The drawing of one of the parts added in 0.3 (null: not one of them). */
export function NewPartArt({ part, show = {} }: { part: Part; show?: PartShow }) {
  const l = show.live
  switch (part.kind) {
    case 'button':
      return <ButtonArt pressed={show.pressed} />
    case 'switch':
      return <SwitchArt on={show.on ?? part.on} />
    case 'buzzer':
      return <BuzzerArt freq={l?.freq} active={part.active} />
    case 'rgb':
      return <RgbArt lit={show.lit} />
    case 'ldr':
      return <LdrArt lux={show.running ? l?.sense : undefined} />
    case 'battery':
      return <BatteryArt volts={part.volts} />
    case 'meter':
      return <MeterArt mode={part.mode} reading={l?.reading} running={show.running} />
    case 'seg7':
      return <Seg7Art lit={show.lit} />
    case 'motor':
      return <MotorArt angle={l?.angle} speed={l?.speed} />
    case 'npn':
      return <NpnArt />
    case 'diode':
      return <DiodeArt />
    case 'lcd':
      return <LcdArt lines={l?.lines} powered={l?.powered} />
    case 'joystick':
      return <JoystickArt joy={show.joy} pressed={show.pressed} />
    case 'tmp36':
      return <Tmp36Art temp={show.running && l?.powered ? l?.sense : undefined} />
    case 'hcsr04':
      return <SonarArt powered={l?.powered} cm={l?.sense} />
    case 'ir':
      return <IrArt active={l?.active} powered={l?.powered} />
    case 'pir':
      return <PirArt active={l?.active} powered={l?.powered} />
    default:
      return null
  }
}

/** A part's thumbnail for the panel: its drawing, fitted. */
export function partViewBox(kind: Part['kind']): string {
  const b = SPECS[kind].box
  const pad = Math.max(b.w, b.h) * 0.08
  return `${b.x - pad} ${b.y - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`
}

// ---------------------------------------------------------------- the room's things

export function RoomItemArt({ item }: { item: RoomItem }) {
  const s = ITEM_SIZE[item.kind]
  switch (item.kind) {
    case 'box':
      return (
        <g>
          <rect x={-s.hw} y={-s.hh} width={2 * s.hw} height={2 * s.hh} rx="2" fill="#c8955a" stroke="#8a5f2c" stroke-width="0.6" />
          <path d={`M${-s.hw} 0 H${s.hw} M0 ${-s.hh} V${s.hh}`} stroke="#a87a42" stroke-width="2.5" />
          <rect x={-8} y={-s.hh} width="16" height={2 * s.hh} fill="#d9c08a" opacity="0.55" />
        </g>
      )
    case 'lamp':
      return (
        <g>
          {item.on && <circle r="70" fill="url(#lamp-glow)" />}
          <circle r={s.hw} fill={item.on ? '#ffe680' : '#5d6168'} stroke={item.on ? '#d9a400' : '#33363c'} stroke-width="0.8" />
          <circle r={s.hw * 0.55} fill={item.on ? '#fff8d6' : '#8a9099'} />
          <path d="M-4 -2 h8 M-3 1 h6 M-2 4 h4" stroke={item.on ? '#b38600' : '#33363c'} stroke-width="0.8" />
        </g>
      )
    case 'heater':
      return (
        <g>
          <circle r={s.hw} fill="#f4f5f7" stroke="#b8bec7" stroke-width="0.6" />
          <circle r={s.hw - 3} fill="#7a4a24" />
          <path d={`M${s.hw - 1} -6 q9 0 9 6 q0 6 -9 6`} fill="none" stroke="#b8bec7" stroke-width="2.4" />
          {[-6, 0, 6].map((x) => (
            <path d={`M${x} -4 q-2.5 -4 0 -8 q2.5 -4 0 -8`} fill="none" stroke="#ffffff" stroke-width="1" opacity="0.8" />
          ))}
        </g>
      )
    case 'hand':
      return (
        <g fill="#f0c19a" stroke="#c48a5e" stroke-width="0.7">
          <ellipse cx="0" cy="8" rx="17" ry="20" />
          {[
            [-15, -8, -30],
            [-6, -16, -8],
            [3, -18, 0],
            [12, -14, 10]
          ].map(([x, y, a]) => (
            <rect x={x - 4} y={y - 14} width="8" height="22" rx="4" transform={`rotate(${a} ${x} ${y})`} />
          ))}
          <rect x="14" y="2" width="8" height="18" rx="4" transform="rotate(50 18 10)" />
        </g>
      )
  }
}
