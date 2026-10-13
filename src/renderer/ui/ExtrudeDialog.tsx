import { useEffect, useMemo, useState } from 'preact/hooks'
import type { ExtrudeDir, SketchOp } from '../core/doc/model'
import { doc } from '../core/doc/store'
import { buildProfile } from '../core/sketch/profile'
import { axisLine, revolveSetup } from '../core/sketch/revolve'
import { session, skSelection, sketch } from '../core/sketch/session'
import { AXIS_X, AXIS_Y, type Sketch } from '../core/sketch/types'
import { lang, t } from '../i18n'
import * as A from './actions'
import { focusOnMount } from './common'

/** Axes to revolve around: the sketch axes, then helper lines, then ordinary lines. */
function axisChoices(s: Sketch): { id: string; label: string }[] {
  const out = [
    { id: AXIS_Y, label: t('ex.axisY') },
    { id: AXIS_X, label: t('ex.axisX') }
  ]
  const lines = s.curves.filter((c) => c.kind === 'line')
  const helpers = lines.filter((c) => c.construction)
  const plain = lines.filter((c) => !c.construction)
  helpers.forEach((c, i) => out.push({ id: c.id, label: t('ex.axisHelper', { n: i + 1 }) }))
  plain.forEach((c, i) => out.push({ id: c.id, label: t('ex.axisLine', { n: i + 1 }) }))
  return out
}

/** The axis to offer first: the one used before, a selected line, a helper line, else the Y axis. */
function defaultAxis(s: Sketch, previous: string | undefined): string {
  if (previous && axisLine(s, previous)) return previous
  const sel = skSelection.peek()
  if (sel.length === 1 && axisLine(s, sel[0])) return sel[0]
  const helper = s.curves.find((c) => c.kind === 'line' && c.construction)
  return helper ? helper.id : AXIS_Y
}

/** Finishing a sketch: extrude (how tall, which way) or revolve (around what, how far), solid or hole. */
export function ExtrudeDialog() {
  void lang.value
  const ses = session.value
  const edited = ses?.nodeId ? doc.value.nodes.find((n) => n.id === ses.nodeId) : undefined
  const prev = edited && edited.kind === 'prim' ? edited : null
  const s = sketch.value
  const [op, setOp] = useState<SketchOp>(prev?.params.op ?? 'extrude')
  const [depth, setDepth] = useState(String(prev?.params.depth ?? 10))
  const [dir, setDir] = useState<ExtrudeDir>(prev?.params.extrude ?? 'up')
  const [axis, setAxis] = useState(() => defaultAxis(s, prev?.params.axis))
  const [angle, setAngle] = useState(String(prev?.params.angle ?? 360))
  const [hole, setHole] = useState(prev?.isHole ?? false)
  const prof = useMemo(() => buildProfile(s), [s])
  const axes = useMemo(() => axisChoices(s), [s])
  const rv = useMemo(() => (op === 'revolve' ? revolveSetup(s, prof.loops, axis) : null), [op, s, prof, axis])

  // show the chosen axis highlighted in the drawing
  useEffect(() => {
    if (op === 'revolve') skSelection.value = [axis]
  }, [op, axis])

  const num = (v: string) => parseFloat(v.replace(',', '.'))
  const depthOk = Number.isFinite(num(depth)) && num(depth) > 0
  const angleOk = Number.isFinite(num(angle)) && num(angle) > 0 && num(angle) <= 360
  const valid = op === 'extrude' ? depthOk : angleOk && !!rv
  const ok = () => {
    if (!valid) return
    void A.applySketchSolid(
      op === 'extrude'
        ? { op, depth: num(depth), dir, hole }
        : { op, depth: depthOk ? num(depth) : 10, dir, axis, angle: num(angle), hole }
    )
  }
  const none = prof.loops.length === 0
  const problems = prof.open.length + prof.crossing.length > 0

  return (
    <div class="modal-back" onClick={A.backToSketch}>
      <div
        class="modal extrude"
        data-testid="extrude-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') A.backToSketch()
        }}
      >
        <div class="modal-head">
          <h2>{t('ex.title')}</h2>
        </div>
        {none ? (
          <p class="warn" data-testid="extrude-none">
            {t('ex.noLoop')}
          </p>
        ) : (
          <>
            <div class="seg ex-mode">
              <button class={op === 'extrude' ? 'on' : ''} data-testid="op-extrude" onClick={() => setOp('extrude')}>
                {t('ex.opExtrude')}
              </button>
              <button class={op === 'revolve' ? 'on' : ''} data-testid="op-revolve" onClick={() => setOp('revolve')}>
                {t('ex.opRevolve')}
              </button>
            </div>
            <p class="ex-info">{t('ex.regions', { n: prof.loops.length })}</p>
            {problems && <p class="warn">{t('ex.problems')}</p>}
            {op === 'extrude' ? (
              <>
                <label class="ex-row">
                  <span>{t('ex.depth')}</span>
                  <input
                    key="depth"
                    type="text"
                    inputMode="decimal"
                    value={depth}
                    data-testid="extrude-depth"
                    class={depthOk ? '' : 'bad'}
                    ref={focusOnMount}
                    onInput={(e) => setDepth((e.currentTarget as HTMLInputElement).value)}
                    onKeyDown={(e) => e.key === 'Enter' && ok()}
                  />
                </label>
                <div class="ex-row">
                  <span>{t('ex.dir')}</span>
                  <div class="seg">
                    {(['up', 'down', 'both'] as ExtrudeDir[]).map((d) => (
                      <button class={dir === d ? 'on' : ''} data-testid={`extrude-${d}`} onClick={() => setDir(d)}>
                        {t(`ex.${d}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <label class="ex-row">
                  <span>{t('ex.axis')}</span>
                  <select
                    value={axis}
                    data-testid="revolve-axis"
                    onChange={(e) => setAxis((e.currentTarget as HTMLSelectElement).value)}
                  >
                    {axes.map((a) => (
                      <option value={a.id}>{a.label}</option>
                    ))}
                  </select>
                </label>
                <label class="ex-row">
                  <span>{t('ex.angle')}</span>
                  <input
                    key="angle"
                    type="text"
                    inputMode="decimal"
                    value={angle}
                    data-testid="revolve-angle"
                    class={angleOk ? '' : 'bad'}
                    ref={focusOnMount}
                    onInput={(e) => setAngle((e.currentTarget as HTMLInputElement).value)}
                    onKeyDown={(e) => e.key === 'Enter' && ok()}
                  />
                </label>
                <p class="ex-note">{t('ex.revolveHint')}</p>
                {rv?.crosses && (
                  <p class="warn" data-testid="revolve-crosses">
                    {t('ex.crossesAxis')}
                  </p>
                )}
              </>
            )}
            <div class="ex-row">
              <span>{t('ex.kind')}</span>
              <div class="seg">
                <button class={hole ? '' : 'on'} data-testid="extrude-solid" onClick={() => setHole(false)}>
                  {t('ex.solid')}
                </button>
                <button class={hole ? 'on' : ''} data-testid="extrude-hole" onClick={() => setHole(true)}>
                  {t('ex.hole')}
                </button>
              </div>
            </div>
          </>
        )}
        <div class="ex-actions">
          {!none && (
            <button class="btn primary" disabled={!valid} onClick={ok} data-testid="extrude-ok">
              {op === 'extrude' ? t('ex.ok') : t('ex.okRevolve')}
            </button>
          )}
          <button class="btn" onClick={A.backToSketch} data-testid="extrude-back">
            {t('ex.back')}
          </button>
          {none && (
            <button class="btn" onClick={A.leaveSketch} data-testid="extrude-leave">
              {t('ex.leave')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
