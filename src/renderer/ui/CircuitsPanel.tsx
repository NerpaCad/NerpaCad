/** Right panel of the Circuits tab: parts to drag in, the selected part's settings, Start/Stop. */
import { type LedColor, LED_COLORS, type Part, type PartKind, ROOM_ITEM_KINDS, WIRE_COLORS } from '../core/circuit/model'
import { formatOhms } from '../core/circuit/parts'
import { circuit, circuitKnobs, circuitLive, circuitRoom, circuitSelection, circuitServos, circuitState, circuitTime } from '../core/circuit/state'
import { ROOM_LIGHT_RANGE, ROOM_TEMP_RANGE, roomOf } from '../core/circuit/room'
import { type Key, lang, t } from '../i18n'
import { ArduinoArt, BreadboardArt, LED_FILL, LedArt, PartArt, PotArt, ResistorArt, ServoArt } from './circuitArt'
import { RoomItemArt, meterText, partViewBox } from './circuitArt2'
import * as C from './circuitActions'
import { beginItemDrag, beginPartDrag } from './CircuitView'
import { setRunKnob, toggleCircuit } from './circuitSim'
import { Icon } from './icons'
import { NumberField } from './common'

/** the panel's groups of parts */
const GROUPS: [Key, PartKind[]][] = [
  ['ckt.group.base', ['arduino', 'breadboard', 'resistor', 'battery', 'meter']],
  ['ckt.group.light', ['led', 'rgb', 'seg7', 'buzzer', 'lcd']],
  ['ckt.group.control', ['button', 'switch', 'pot', 'joystick']],
  ['ckt.group.motion', ['servo', 'motor', 'npn', 'diode']],
  ['ckt.group.sensors', ['ldr', 'tmp36', 'hcsr04', 'ir', 'pir']]
]
/** parts whose settings panel only has a hint */
const HINTS: Partial<Record<PartKind, Key>> = {
  button: 'ckt.buttonHint',
  rgb: 'ckt.rgbHint',
  ldr: 'ckt.ldrHint',
  seg7: 'ckt.seg7Hint',
  motor: 'ckt.motorHint',
  npn: 'ckt.npnHint',
  diode: 'ckt.diodeHint',
  lcd: 'ckt.lcdHint',
  joystick: 'ckt.joystickHint',
  tmp36: 'ckt.tmp36Hint',
  hcsr04: 'ckt.hcsr04Hint',
  ir: 'ckt.irHint',
  pir: 'ckt.pirHint'
}
const OHMS = [100, 220, 330, 1000, 10000]
const POT_OHMS = [1000, 10000, 100000]

function Thumb({ kind }: { kind: PartKind }) {
  if (!['arduino', 'resistor', 'breadboard', 'pot', 'servo', 'led'].includes(kind)) {
    const sample: Part = { id: 'thumb', kind, x: 0, y: 0, rot: 0, volts: 9, mode: 'V' }
    return (
      <svg width="44" height="36" viewBox={partViewBox(kind)} preserveAspectRatio="xMidYMid meet">
        <PartArt part={sample} show={{ lit: (pin) => (['R', 'a', 'b', 'g', 'e', 'd'].includes(pin) ? 0.8 : 0) }} />
      </svg>
    )
  }
  if (kind === 'arduino')
    return (
      <svg width="44" height="36" viewBox="-7 -1 77 56">
        <ArduinoArt />
      </svg>
    )
  if (kind === 'resistor')
    return (
      <svg width="44" height="36" viewBox="-1 -5 12.2 10">
        <ResistorArt ohms={220} />
      </svg>
    )
  if (kind === 'breadboard')
    return (
      <svg width="44" height="36" viewBox="-4 -4 82 51">
        <BreadboardArt />
      </svg>
    )
  if (kind === 'pot')
    return (
      <svg width="44" height="36" viewBox="-3.5 -11.5 12 13">
        <PotArt knob={0.3} />
      </svg>
    )
  if (kind === 'servo')
    return (
      <svg width="44" height="36" viewBox="-12 -35 29 37">
        <ServoArt angle={120} />
      </svg>
    )
  return (
    <svg width="44" height="36" viewBox="-3.5 -10 9.5 11">
      <LedArt color="red" brightness={0.8} />
    </svg>
  )
}

export function CircuitsPanel() {
  void lang.value
  const running = circuitState.value === 'running'
  const c = circuit.value
  const sel = circuitSelection.value
  const part = sel.length === 1 ? c.parts.find((p) => p.id === sel[0]) : undefined
  const wire = sel.length === 1 ? c.wires.find((w) => w.id === sel[0]) : undefined
  return (
    <aside class="shapes-panel robo-panel ckt-panel" data-testid="ckt-panel">
      {GROUPS.map(([title, kinds]) => (
        <>
          <div class="panel-title">{t(title)}</div>
          <div class="shape-grid three">
            {kinds.map((k) => (
              <button
                class="shape-tile small"
                title={t('ckt.partHint')}
                data-testid={`add-${k}`}
                disabled={running}
                onPointerDown={(e) => beginPartDrag(k, e as unknown as PointerEvent)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && C.addPart(k, 0, 0)}
              >
                <Thumb kind={k} />
                <span>{t(`ckt.part.${k}` as Key)}</span>
              </button>
            ))}
          </div>
        </>
      ))}

      {part && (
        <div class="ckt-props" data-testid="ckt-props">
          <div class="panel-title">{t(`ckt.part.${part.kind}` as Key)}</div>
          {part.kind === 'resistor' && (
            <>
              <div class="field-row two">
                <NumberField
                  label={t('ckt.ohm')}
                  value={part.ohms ?? 220}
                  min={1}
                  max={10_000_000}
                  step={10}
                  digits={0}
                  onCommit={(v) => C.setOhms(part.id, v)}
                  testId="ohms"
                  disabled={running}
                />
              </div>
              <div class="chip-row">
                {OHMS.map((o) => (
                  <button class={`chip${part.ohms === o ? ' on' : ''}`} disabled={running} onClick={() => C.setOhms(part.id, o)}>
                    {formatOhms(o, t('ckt.kohm'), t('ckt.mohm'), t('ckt.ohm'))}
                  </button>
                ))}
              </div>
            </>
          )}
          {part.kind === 'led' && (
            <div class="chip-row">
              {LED_COLORS.map((col: LedColor) => (
                <button
                  class={`swatch-btn${part.color === col ? ' on' : ''}`}
                  style={{ background: LED_FILL[col] }}
                  title={t(`ckt.color.${col}` as Key)}
                  disabled={running}
                  onClick={() => C.setLedColor(part.id, col)}
                  data-testid={`led-${col}`}
                />
              ))}
            </div>
          )}
          {part.kind === 'arduino' && <p class="insp-note">{t('ckt.arduinoHint')}</p>}
          {part.kind === 'breadboard' && <p class="insp-note">{t('ckt.breadboardHint')}</p>}
          {part.kind === 'pot' && (
            <>
              <div class="field-row two">
                <NumberField
                  label={t('ckt.ohm')}
                  value={part.ohms ?? 10_000}
                  min={10}
                  max={10_000_000}
                  step={100}
                  digits={0}
                  onCommit={(v) => C.setOhms(part.id, v)}
                  testId="pot-ohms"
                  disabled={running}
                />
              </div>
              <div class="chip-row">
                {POT_OHMS.map((o) => (
                  <button class={`chip${part.ohms === o ? ' on' : ''}`} disabled={running} onClick={() => C.setOhms(part.id, o)}>
                    {formatOhms(o, t('ckt.kohm'), t('ckt.mohm'), t('ckt.ohm'))}
                  </button>
                ))}
              </div>
              <label class="knob-row">
                <span class="muted">{t('ckt.knob')}</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(100 * (running ? (circuitKnobs.value[part.id] ?? part.knob ?? 0.5) : (part.knob ?? 0.5)))}
                  data-testid="pot-knob"
                  onInput={(e) => running && setRunKnob(part.id, Number((e.target as HTMLInputElement).value) / 100)}
                  onChange={(e) => !running && C.setKnob(part.id, Number((e.target as HTMLInputElement).value) / 100)}
                />
                <span class="knob-val">{Math.round(100 * (running ? (circuitKnobs.value[part.id] ?? part.knob ?? 0.5) : (part.knob ?? 0.5)))} %</span>
              </label>
              <p class="insp-note">{t('ckt.potHint')}</p>
            </>
          )}
          {part.kind === 'battery' && (
            <div class="seg small" data-testid="battery-volts">
              {([9, 3] as const).map((v) => (
                <button class={(part.volts ?? 9) === v ? 'on' : ''} disabled={running} onClick={() => C.setVolts(part.id, v)} data-testid={`volts-${v}`}>
                  {t(v === 9 ? 'ckt.battery9' : 'ckt.battery3')}
                </button>
              ))}
            </div>
          )}
          {part.kind === 'battery' && <p class="insp-note">{t('ckt.batteryHint')}</p>}
          {part.kind === 'meter' && (
            <>
              <div class="seg small">
                {(['V', 'A'] as const).map((m) => (
                  <button class={(part.mode ?? 'V') === m ? 'on' : ''} disabled={running} onClick={() => C.setMeterMode(part.id, m)} data-testid={`meter-${m}`}>
                    {t(m === 'V' ? 'ckt.meterV' : 'ckt.meterA')}
                  </button>
                ))}
              </div>
              {running && (
                <div class="sim-row">
                  <span class="muted">{t('ckt.reading')}</span>
                  <span data-testid="meter-reading">{meterText(part.mode, circuitLive.value[part.id]?.reading)}</span>
                </div>
              )}
              <p class="insp-note">{t('ckt.meterHint')}</p>
            </>
          )}
          {part.kind === 'buzzer' && (
            <>
              <div class="seg small">
                {[false, true].map((a) => (
                  <button class={!!part.active === a ? 'on' : ''} disabled={running} onClick={() => C.setBuzzerActive(part.id, a)} data-testid={`buzzer-${a ? 'active' : 'passive'}`}>
                    {t(a ? 'ckt.buzzerActive' : 'ckt.buzzerPassive')}
                  </button>
                ))}
              </div>
              <p class="insp-note">{t('ckt.buzzerHint')}</p>
            </>
          )}
          {part.kind === 'switch' && (
            <>
              <div class="seg small">
                {[false, true].map((on) => (
                  <button class={!!part.on === on ? 'on' : ''} disabled={running} onClick={() => C.setSwitchSide(part.id, on)}>
                    {on ? 'C — 2' : '1 — C'}
                  </button>
                ))}
              </div>
              <p class="insp-note">{t('ckt.switchHint')}</p>
            </>
          )}
          {HINTS[part.kind] && <p class="insp-note">{t(HINTS[part.kind]!)}</p>}
          {part.kind === 'servo' && (
            <>
              {running && circuitServos.value[part.id] && (
                <div class="sim-row">
                  <span class="muted">{t('ckt.servoAngle')}</span>
                  <span data-testid="servo-angle">{Math.round(circuitServos.value[part.id].angle)}°</span>
                </div>
              )}
              <p class="insp-note">{t('ckt.servoHint')}</p>
            </>
          )}
          <div class="sim-controls">
            <button class="btn small" disabled={running} onClick={() => C.rotateSelectedParts(1)} title="R">
              ↻ {t('ckt.rotate')}
            </button>
            <button class="btn small" disabled={running} onClick={C.deleteCircuitSelection} title="Delete">
              <Icon.trash size={14} /> {t('tb.delete')}
            </button>
          </div>
        </div>
      )}
      {wire && (
        <div class="ckt-props" data-testid="wire-props">
          <div class="panel-title">{t('ckt.wire')}</div>
          <div class="chip-row">
            {WIRE_COLORS.map((col) => (
              <button class={`swatch-btn${wire.color === col ? ' on' : ''}`} style={{ background: col }} disabled={running} onClick={() => C.setWireColor(wire.id, col)} />
            ))}
          </div>
          <button class="btn small" disabled={running} onClick={C.deleteCircuitSelection}>
            <Icon.trash size={14} /> {t('tb.delete')}
          </button>
        </div>
      )}

      <RoomSection running={running} />

      <div class="panel-title">{t('robo.run')}</div>
      <div class="sim-controls">
        <button class={`btn primary sim-btn ${running ? 'on' : ''}`} onClick={toggleCircuit} data-testid={running ? 'ckt-stop' : 'ckt-start'}>
          {running ? <Icon.stop size={14} /> : <Icon.play size={16} />}
          {running ? t('ckt.stopSim') : t('ckt.startSim')}
        </button>
      </div>
      <div class="sim-row">
        <span class="muted">{t('robo.time')}</span>
        <span class="sim-time" data-testid="ckt-time">
          {circuitTime.value.toFixed(1)} {t('unit.s')}
        </span>
      </div>

      <div class="panel-title" style={{ marginTop: '14px' }}>
        {t('robo.examples')}
      </div>
      <button class="btn wide" onClick={C.loadBlinkDemo} disabled={running} data-testid="ckt-demo">
        <Icon.flag size={16} /> {t('ckt.demo')}
      </button>
      <button class="btn wide" onClick={C.loadBreadboardDemo} disabled={running} data-testid="ckt-demo2" style={{ marginTop: '6px' }}>
        <Icon.flag size={16} /> {t('ckt.demo2')}
      </button>
      {(['night', 'parking', 'motor'] as const).map((k, i) => (
        <button class="btn wide" onClick={() => C.loadExample(k)} disabled={running} data-testid={`ckt-demo-${k}`} style={{ marginTop: '6px' }}>
          <Icon.flag size={16} /> {t(`ckt.demo${i + 3}` as Key)}
        </button>
      ))}
      <p class="panel-hint">{t('ckt.hint')}</p>
    </aside>
  )
}

/** The room: its temperature and light (changed during a run too), and things to put on the table. */
function RoomSection({ running }: { running: boolean }) {
  const room = running ? (circuitRoom.value ?? roomOf(circuit.value)) : roomOf(circuit.value)
  return (
    <>
      <div class="panel-title">{t('ckt.room')}</div>
      <label class="knob-row" title={t('ckt.roomTemp')}>
        <span class="muted">{t('ckt.roomTemp')}</span>
        <input
          type="range"
          min={ROOM_TEMP_RANGE[0]}
          max={ROOM_TEMP_RANGE[1]}
          step="1"
          value={room.temp}
          data-testid="room-temp"
          onInput={(e) => running && C.setRoomLevels({ temp: Number((e.target as HTMLInputElement).value) })}
          onChange={(e) => !running && C.setRoomLevels({ temp: Number((e.target as HTMLInputElement).value) })}
        />
        <span class="knob-val">{Math.round(room.temp)} °C</span>
      </label>
      <label class="knob-row" title={t('ckt.roomLight')}>
        <span class="muted">{t('ckt.roomLight')}</span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={lightToSlider(room.light)}
          data-testid="room-light"
          onInput={(e) => running && C.setRoomLevels({ light: sliderToLight(Number((e.target as HTMLInputElement).value)) })}
          onChange={(e) => !running && C.setRoomLevels({ light: sliderToLight(Number((e.target as HTMLInputElement).value)) })}
        />
        <span class="knob-val">{room.light < 20 ? t('ckt.roomLightNight') : room.light > 700 ? t('ckt.roomLightDay') : `${Math.round(room.light)} lx`}</span>
      </label>
      <div class="shape-grid four">
        {ROOM_ITEM_KINDS.map((k) => (
          <button
            class="shape-tile small"
            title={t('ckt.roomHint')}
            data-testid={`add-item-${k}`}
            disabled={running}
            onPointerDown={(e) => beginItemDrag(k, e as unknown as PointerEvent)}
          >
            <svg width="40" height="34" viewBox="-42 -42 84 84">
              <RoomItemArt item={{ id: 't', kind: k, x: 0, y: 0, on: true }} />
            </svg>
            <span>{t(`ckt.item.${k}` as Key)}</span>
          </button>
        ))}
      </div>
    </>
  )
}

/** The light slider is even in brightness as the eye sees it: 0…100 → 0…1000 lux, squared. */
const sliderToLight = (v: number) => Math.round(((v / 100) ** 2 * ROOM_LIGHT_RANGE[1]) * 10) / 10
const lightToSlider = (lux: number) => Math.round(Math.sqrt(Math.max(0, lux) / ROOM_LIGHT_RANGE[1]) * 100)

