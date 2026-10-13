/** Right panel of the Circuits tab: parts to drag in, the selected part's settings, Start/Stop. */
import { type LedColor, LED_COLORS, type PartKind, WIRE_COLORS } from '../core/circuit/model'
import { formatOhms } from '../core/circuit/parts'
import { circuit, circuitKnobs, circuitSelection, circuitServos, circuitState, circuitTime } from '../core/circuit/state'
import { type Key, lang, t } from '../i18n'
import { ArduinoArt, BreadboardArt, LED_FILL, LedArt, PotArt, ResistorArt, ServoArt } from './circuitArt'
import * as C from './circuitActions'
import { beginPartDrag } from './CircuitView'
import { setRunKnob, toggleCircuit } from './circuitSim'
import { Icon } from './icons'
import { NumberField } from './common'

const KINDS: PartKind[] = ['arduino', 'breadboard', 'resistor', 'led', 'pot', 'servo']
const OHMS = [100, 220, 330, 1000, 10000]
const POT_OHMS = [1000, 10000, 100000]

function Thumb({ kind }: { kind: PartKind }) {
  if (kind === 'arduino')
    return (
      <svg width="64" height="48" viewBox="-7 -1 77 56">
        <ArduinoArt />
      </svg>
    )
  if (kind === 'resistor')
    return (
      <svg width="64" height="48" viewBox="-1 -5 12.2 10">
        <ResistorArt ohms={220} />
      </svg>
    )
  if (kind === 'breadboard')
    return (
      <svg width="64" height="48" viewBox="-4 -4 82 51">
        <BreadboardArt />
      </svg>
    )
  if (kind === 'pot')
    return (
      <svg width="64" height="48" viewBox="-3.5 -11.5 12 13">
        <PotArt knob={0.3} />
      </svg>
    )
  if (kind === 'servo')
    return (
      <svg width="64" height="48" viewBox="-12 -35 29 37">
        <ServoArt angle={120} />
      </svg>
    )
  return (
    <svg width="64" height="48" viewBox="-3.5 -10 9.5 11">
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
      <div class="panel-title">{t('ckt.parts')}</div>
      <div class="shape-grid">
        {KINDS.map((k) => (
          <button
            class="shape-tile"
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
      <p class="panel-hint">{t('ckt.hint')}</p>
    </aside>
  )
}
