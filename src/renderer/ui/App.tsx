import { soundPlayer } from '../view/soundPlayer'
import { dismissRecover, recover, recoverOffer, startAutosave } from './autosave'
import { installedMods } from './mods'
import { localText } from '../core/robotics/robot'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { Vector3 } from 'three'
import { doc, gridStep, placingRuler, placingWorkplane, refPlanes, ruler, selection, workplane } from '../core/doc/store'
import { geom } from '../core/geom/client'
import { type Key, lang, t } from '../i18n'
import { Viewport } from '../view/Viewport'
import * as A from './actions'
import { ConstraintGlyph, Icon } from './icons'
import { shortcutKey } from '../keys'
import { fmtLen, GRID_STEPS, lenUnit } from '../units'
import { Inspector } from './Inspector'
import { DimensionLayer } from './DimensionLayer'
import { ShapesPanel } from './ShapesPanel'
import { Toolbar } from './Toolbar'
import { SketchPanel } from './SketchPanel'
import { SketchLayer } from './SketchLayer'
import { ExtrudeDialog } from './ExtrudeDialog'
import { inSketch, session, sketch, sketchPicking, settled, skSelection, skTool, solveInfo } from '../core/sketch/session'
import { followId, landBrush, roboticsMode, simActive, simState } from '../core/robotics/state'
import { RoboticsPanel } from './RoboticsPanel'
import { BlocklyPanel } from './BlocklyPanel'
import { pauseSim, simKey, startSim, stopSim } from './sim'
import { circuit, circuitResult, circuitSelection, circuitState, circuitServos, circuitKnobs, circuitSerial, circuitsMode } from '../core/circuit/state'
import { CircuitView, fitCircuit, wiring } from './CircuitView'
import { CircuitsPanel } from './CircuitsPanel'
import { arduinoProgram } from './arduinoProgram'
import * as C from './circuitActions'
import { stopCircuit, toggleCircuit } from './circuitSim'

const LEGEND = ['coincident', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'equal', 'regular', 'tangent', 'midpoint', 'symmetric', 'lock']

export function App() {
  const host = useRef<HTMLDivElement>(null)
  const [help, setHelp] = useState(false)
  const [about, setAbout] = useState(false)
  const [vp, setVp] = useState<Viewport | null>(null)
  const [glError, setGlError] = useState(false)

  useEffect(() => {
    let v: Viewport
    try {
      v = new Viewport(host.current!)
    } catch (e) {
      console.error(e)
      setGlError(true)
      return
    }
    A.setViewport(v)
    setVp(v)
    // test/debug hook: lets automated tests drive the app and project world points to the screen
    ;(window as unknown as { __cad: unknown }).__cad = {
      viewport: v,
      actions: A,
      lang,
      doc,
      selection,
      gridStep,
      workplane,
      ruler,
      project: (x: number, y: number, z: number) => {
        const r = v.renderer.domElement.getBoundingClientRect()
        const p = new Vector3(x, y, z).project(v.camera)
        return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height }
      },
      geomBusy: () => geom.busy.value,
      /** solve a sketch with the real (WebAssembly) solver — used by e2e tests */
      solveSketch: async (s: unknown) => (await import('@/core/sketch/client')).sketchSolver.solve(s as never),
      sketch,
      skSelection,
      skTool,
      solveInfo,
      sketchSettled: settled,
      sessionFrame: () => session.value?.frame ?? null,
      roboticsMode,
      soundPlayer,
      followId,
      simState,
      sim: { start: startSim, pause: pauseSim, stop: stopSim },
      circuit,
      circuitResult,
      circuitSelection,
      circuitState,
      circuitServos,
      circuitKnobs,
      circuitSerial,
      circuitActions: C
    }
    void A.loadStartupFile().then(() => startAutosave())
    return () => {
      A.setViewport(null)
      v.dispose()
    }
  }, [])

  // files dragged in from Explorer (anywhere in the window): never let the page navigate away
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    }
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return
      e.preventDefault()
      void A.openDroppedFiles(e.dataTransfer.files)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleKey(e, vp, () => setHelp((h) => !h))
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vp])

  void lang.value
  const robo = roboticsMode.value
  const circ = circuitsMode.value
  return (
    <div class="app">
      <Toolbar onHelp={() => setHelp(true)} onAbout={() => setAbout(true)} />
      <div class="main">
        <div class="center-col">
        <div
          class="viewport"
          style={circ ? { display: 'none' } : undefined}
          ref={host}
          data-testid="viewport"
        >
          <div class="view-controls" onPointerDown={(e) => e.stopPropagation()}>
            <button class="icon-btn" title={`${t('view.fit')} (F)`} onClick={() => vp?.fitView()} data-testid="view-fit">
              <Icon.fit size={18} />
            </button>
            <button class="icon-btn" title={t('view.zoomIn')} onClick={() => vp?.zoom(0.75)}>
              <Icon.plus size={18} />
            </button>
            <button class="icon-btn" title={t('view.zoomOut')} onClick={() => vp?.zoom(1.33)}>
              <Icon.minus size={18} />
            </button>
            {inSketch.value && (
              <button class="icon-btn" title={t('sk.view')} onClick={() => vp?.lookAtSketch()} data-testid="sk-look">
                <Icon.sketch size={18} />
              </button>
            )}
            {!robo && !circ && (
              <>
                <span class="vc-sep" />
                {(['zy', 'zx'] as const).map((id) => (
                  <button
                    class={`icon-btn plane-btn ${id}${refPlanes.value[id] ? ' on' : ''}`}
                    title={t(id === 'zy' ? 'view.planeZY' : 'view.planeZX')}
                    aria-pressed={refPlanes.value[id]}
                    onClick={() => (refPlanes.value = { ...refPlanes.value, [id]: !refPlanes.value[id] })}
                    data-testid={`plane-${id}`}
                  >
                    {id.toUpperCase()}
                  </button>
                ))}
                <span class="vc-sep" />
                {(['x', 'y'] as const).map((axis) => {
                  const on = !!doc.value.symmetry?.[axis]
                  const id = axis === 'x' ? 'zy' : 'zx'
                  return (
                    <button
                      class={`icon-btn sym-btn ${id}${on ? ' on' : ''}`}
                      title={t(axis === 'x' ? 'sym.x' : 'sym.y')}
                      aria-pressed={on}
                      disabled={inSketch.value}
                      onClick={() => A.toggleSymmetry(axis)}
                      data-testid={`sym-${id}`}
                    >
                      <span class="sym-glyph">⇋</span>
                      <span class="sym-axis">{id.toUpperCase()}</span>
                    </button>
                  )
                })}
              </>
            )}
          </div>
          {inSketch.value ? <SketchLayer /> : !robo && <DimensionLayer />}
          {!inSketch.value && <Inspector />}
          {!circ && <div class="grid-settings" onPointerDown={(e) => e.stopPropagation()}>
            <label>
              {t('grid.snap')}
              <select
                value={String(gridStep.value)}
                data-testid="grid-step"
                onChange={(e) => (gridStep.value = parseFloat((e.currentTarget as HTMLSelectElement).value))}
              >
                {GRID_STEPS[lenUnit.value].map((s) => (
                  <option value={String(s)}>{s === 0 ? t('grid.off') : fmtLen(s, true)}</option>
                ))}
              </select>
            </label>
          </div>}
          {simActive.value && (
            <div class="sim-badge" data-testid="sim-badge">
              {simState.value === 'running' ? t('robo.running') : t('robo.paused')}
            </div>
          )}
          {workplane.value && !inSketch.value && (
            <button
              class="wp-reset"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={A.resetWorkplane}
              data-testid="wp-reset"
            >
              <Icon.workplane size={16} /> {t('wp.reset')}
            </button>
          )}
          {placingWorkplane.value && <div class="mode-hint">{t('wp.hint')}</div>}
          {placingRuler.value && <div class="mode-hint">{t('ruler.hint')}</div>}
          {sketchPicking.value && <div class="mode-hint">{t('sk.pickHint')}</div>}
          <StatusLine />
          {doc.value.nodes.length === 0 && !glError && !inSketch.value && !sketchPicking.value && (
            <div class="empty-hint">{robo ? t('robo.emptyHint') : t('hint.empty')}</div>
          )}
          {glError && <div class="empty-hint error">{t('error.webgl')}</div>}
        </div>
        {circ && <CircuitView />}
        {robo && <BlocklyPanel />}
        {circ && <BlocklyPanel source={arduinoProgram} />}
        </div>
        {inSketch.value ? <SketchPanel /> : robo ? <RoboticsPanel /> : circ ? <CircuitsPanel /> : <ShapesPanel />}
      </div>
      <Toasts />
      {help && <HelpDialog onClose={() => setHelp(false)} />}
      {recoverOffer.value && <RecoverDialog />}
      {about && <AboutDialog onClose={() => setAbout(false)} />}
      {A.extrudeOpen.value && inSketch.value && <ExtrudeDialog />}
    </div>
  )
}

function StatusLine() {
  const busy = geom.busy.value > 0
  const n = selection.value.length
  return (
    <div class="status-line">
      {busy && <span class="busy">{t('status.computing')}</span>}
      {!busy && n > 0 && <span>{t('insp.selected', { n })}</span>}
    </div>
  )
}

function Toasts() {
  return (
    <div class="toasts">
      {A.toasts.value.map((x) => (
        <div class={`toast ${x.kind}`} key={x.id}>
          {x.text}
        </div>
      ))}
    </div>
  )
}

/** Logo, version and licence. Opened by a click on the logo in the toolbar. */
function AboutDialog({ onClose }: { onClose: () => void }) {
  // a layout effect so that Escape works from the very first frame
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div class="modal-back" onClick={onClose}>
      <div class="modal about" onClick={(e) => e.stopPropagation()} data-testid="about">
        <div class="modal-head">
          <h2>{t('about.title')}</h2>
          <button class="icon-btn" onClick={onClose} title={t('about.close')}>
            <Icon.close size={18} />
          </button>
        </div>
        <div class="about-logo">
          <img src="./logo.png" alt="NerpaCad" />
        </div>
        <div class="about-name">
          Nerpa<span class="brand-mark">Cad</span> <span class="about-stage">{stageName(__APP_VERSION__)}</span>
        </div>
        <p class="about-tagline">{t('about.tagline')}</p>
        <p class="about-license" data-testid="about-version">
          {t('about.version', { v: __APP_VERSION__ })}
        </p>
        <p class="about-license">
          {t('about.license')} {t('about.noWarranty')}
          <br />© 2026 NerpaCad authors
        </p>
        <p class="about-credits" data-testid="about-credits">
          {t('about.credits')}
        </p>
        <p class="about-credits" data-testid="about-sounds">
          {t('about.soundCredits')}
        </p>
        <ModsList />
        {LINKS.length > 0 && (
          <p class="about-links" data-testid="about-links">
            {LINKS.map(([k, url]) => (
              <a href={url} target="_blank" rel="noreferrer">
                {t(k)}
              </a>
            ))}
          </p>
        )}
      </div>
    </div>
  )
}

/** The installed mods (name, version, author, licence, robots, what is wrong) and the mods folder. */
function ModsList() {
  const mods = installedMods.value
  const L = lang.value
  return (
    <div class="about-mods" data-testid="about-mods">
      <h3>{t('mods.title')}</h3>
      {mods.length === 0 ? (
        <p>{t('mods.none')}</p>
      ) : (
        <ul>
          {mods.map((m) => (
            <li data-testid={`mod-${m.folder}`}>
              <b>{m.mod ? localText(m.mod.name, L) : m.folder}</b>
              {m.mod?.version ? ` ${m.mod.version}` : ''}
              {m.mod?.author ? ` — ${m.mod.author}` : ''}
              {m.mod?.license ? ` (${m.mod.license})` : ''}
              {m.mod && <span>. {t('mods.robots', { names: m.mod.robots.map((r) => localText(r.name, L) || r.id).join(', ') })}</span>}
              {m.errors.length > 0 && <div class="mod-err">{t(m.mod ? 'mods.notes' : 'mods.broken', { errors: m.errors.join('; ') })}</div>}
            </li>
          ))}
        </ul>
      )}
      {mods.length > 0 && <p>{t('mods.hint')}</p>}
      <button class="btn small" data-testid="mods-open" onClick={() => void window.api.modsOpenFolder()}>
        {t('mods.open')}
      </button>
    </div>
  )
}

/** «Alpha 0.1» from 0.1.0-alpha, «0.2» from 0.2.0. */
export function stageName(v: string): string {
  const m = /^(\d+)\.(\d+)(?:\.\d+)?(?:-(\w+))?/.exec(v)
  if (!m) return v
  const stage = m[3] ? m[3][0].toUpperCase() + m[3].slice(1) + ' ' : ''
  return `${stage}${m[1]}.${m[2]}`
}

/** the site and the code, when the release has them (placeholders are not shown) */
const LINKS = (
  [
    ['about.site', __APP_HOMEPAGE__],
    ['about.code', __APP_REPO__]
  ] as [Key, string][]
).filter(([, url]) => /^https:\/\//.test(url) && !/example\.(org|com)/.test(url))

/** After a crash: bring back the project that was not saved? */
function RecoverDialog() {
  const r = recoverOffer.value!
  const when = r.savedAt ? new Date(r.savedAt).toLocaleString(lang.value === 'zh' ? 'zh-CN' : lang.value === 'en' ? 'en-GB' : 'ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : ''
  return (
    <div class="modal-back">
      <div class="modal small" data-testid="recover">
        <div class="modal-head">
          <h2>{t('recover.title')}</h2>
        </div>
        <p>{t('recover.text', { name: r.name ?? t('file.defaultName'), when })}</p>
        <div class="modal-buttons">
          <button class="btn" onClick={dismissRecover} data-testid="recover-no">
            {t('recover.no')}
          </button>
          <button
            class="btn primary"
            onClick={() => {
              recover()
              setTimeout(() => A.viewport()?.fitView(), 300)
            }}
            data-testid="recover-yes"
          >
            {t('recover.yes')}
          </button>
        </div>
      </div>
    </div>
  )
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    [t('help.mouseLeft'), t('help.mouseLeftDo')],
    [t('help.mouseRight'), t('help.mouseRightDo')],
    [t('help.mouseMiddle'), t('help.mouseMiddleDo')],
    [t('help.wheel'), t('help.wheelDo')],
    ['Shift + ' + t('help.click'), t('help.shiftClick')],
    ['Ctrl+Z / Ctrl+Y', `${t('tb.undo')} / ${t('tb.redo')}`],
    ['Ctrl+C / Ctrl+V / Ctrl+D', `${t('tb.copy')} / ${t('tb.paste')} / ${t('tb.duplicate')}`],
    ['Ctrl+D, Ctrl+D…', t('help.dupRepeat')],
    ['Delete', t('tb.delete')],
    ['Ctrl+G / Ctrl+Shift+G', `${t('tb.group')} / ${t('tb.ungroup')}`],
    ['H / S', `${t('insp.hole')} / ${t('insp.solid')}`],
    ['D', t('tb.drop')],
    ['W', t('help.workplane')],
    ['L S R O A N Q G', `${t('help.sketchTools')}: ${t('help.sketchToolsDo')}`],
    ['C H V P K E T M D', `${t('help.sketchConstraints')}: ${t('help.sketchConstraintsDo')}`],
    ['R', `${t('tb.ruler')} / ${t('help.roboRotate')}`],
    [t('help.space'), t('help.spaceDo')],
    ['F', t('view.fit')],
    [t('help.arrows'), t('help.arrowsDo')],
    ['Ctrl + ↑ / ↓', t('help.ctrlArrowsDo')],
    ['Shift + ' + t('help.dragHandle'), t('help.shiftHandle')],
    ['Ctrl+S / Ctrl+O / Ctrl+N', `${t('tb.save')} / ${t('tb.open')} / ${t('tb.new')}`]
  ]
  const field: [string, string][] = [
    [t('help.brush'), t('help.brushDo')],
    [`Shift + ${t('help.stroke')}`, t('help.brushShift')],
    [`Ctrl + ${t('help.stroke')}`, t('help.brushCtrl')],
    ['Esc', t('help.brushEsc')],
    [t('help.terrain'), t('help.terrainDo')],
    [t('help.heroes'), t('help.heroesDo')],
    [t('help.surface'), t('help.surfaceDo')],
    [t('help.messages'), t('help.messagesDo')],
    [t('help.sounds'), t('help.soundsDo')],
    [t('help.pretty'), t('help.prettyDo')],
    [t('help.camera'), t('help.cameraDo')],
    [t('help.lineSensor'), t('help.lineSensorDo')],
    [t('help.examples'), t('help.examplesDo')]
  ]
  return (
    <div class="modal-back" onClick={onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()} data-testid="help">
        <div class="modal-head">
          <h2>{t('help.title')}</h2>
          <button class="icon-btn" onClick={onClose} title={t('insp.close')}>
            <Icon.close size={18} />
          </button>
        </div>
        <table class="help-table">
          {rows.map(([k, v]) => (
            <tr>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </table>
        <h3 class="help-sub">{t('help.field')}</h3>
        <table class="help-table" data-testid="help-field">
          {field.map(([k, v]) => (
            <tr>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </table>
        <h3 class="help-sub">{t('help.legend')}</h3>
        <div class="help-legend">
          {LEGEND.map((c) => (
            <div class="help-legend-item">
              <span class="sk-badge static">
                <ConstraintGlyph type={c} size={13} />
              </span>
              {t(`sk.c.${c}` as Key)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Keys typed into the block editor belong to it (Delete, Ctrl+Z there must not touch the shapes). */
function inBlockly(el: HTMLElement | null): boolean {
  return !!el?.closest?.('.blockly-panel, .blocklyWidgetDiv, .blocklyDropDownDiv, .blocklyTooltipDiv')
}

function handleKey(e: KeyboardEvent, vp: Viewport | null, toggleHelp: () => void): void {
  const el = e.target as HTMLElement
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
  // a focused button takes Space and Enter itself (a panel tile adds its thing, not also a run)
  if (el?.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return
  if (inBlockly(el) || inBlockly(document.activeElement as HTMLElement | null)) return
  // "Restore the project?" waits for an answer: nothing else happens meanwhile
  if (recoverOffer.peek()) return
  const ctrl = e.ctrlKey || e.metaKey
  const k = shortcutKey(e)
  const step = gridStep.value || 1
  const run = (fn: () => void) => {
    e.preventDefault()
    fn()
  }
  if (A.extrudeOpen.value) {
    if (e.key === 'Escape') run(A.backToSketch)
    return
  }
  const ed = vp?.sketchEditor
  if (ed) {
    if (ed.dragging) {
      if (ed.key(e)) e.preventDefault()
      return
    }
    if (ctrl) {
      if (k === 'z' && e.shiftKey) return run(A.redo)
      if (k === 'z') return run(A.undo)
      if (k === 'y') return run(A.redo)
      if (k === 's') return run(() => void A.saveProject(e.shiftKey))
      if (e.key === 'F12' || (e.shiftKey && k === 'i')) return run(() => window.api.toggleDevTools())
      return
    }
    if (ed.key(e)) {
      e.preventDefault()
      ed.refresh()
      return
    }
    if (k === 'f') return run(() => vp?.fitView())
    if (e.key === 'F1' || e.key === '?') return run(toggleHelp)
    return
  }
  if (circuitsMode.value) return circuitKey(e, ctrl, k, run, toggleHelp)
  if (roboticsMode.value) {
    // Space starts and pauses the run, Esc stops it; while it runs, only the view can change
    if (e.key === ' ' && !ctrl) return run(() => (simState.value === 'running' ? pauseSim() : void startSim()))
    if (simActive.value) {
      if (e.key === 'Escape') return run(stopSim)
      // "when key pressed" blocks of the programs (arrows, letters, digits)
      if (simKey(e)) return run(() => undefined)
      if (k === 'f') return run(() => vp?.fitView())
      if (e.key === 'F1' || e.key === '?') return run(toggleHelp)
      if (ctrl && k === 's') return run(() => void A.saveProject(e.shiftKey))
      return
    }
    if (!ctrl && !vp?.dragging && k === 'r') return run(() => A.rotateSelected90(e.shiftKey ? -1 : 1))
    if (!ctrl && (k === 'w' || k === 'h' || k === 's')) return
  }
  if (e.key === 'Escape') {
    if (sketchPicking.value) return run(() => (sketchPicking.value = false))
    if (placingWorkplane.value) return run(() => (placingWorkplane.value = false))
    if (placingRuler.value) return run(() => (placingRuler.value = false))
    if (landBrush.value) return run(() => (landBrush.value = null))
    if (vp?.dragging) return run(() => vp.cancelDrag())
    return run(() => (selection.value = []))
  }
  if (vp?.dragging) return
  if (ctrl) {
    if (k === 'z' && e.shiftKey) return run(A.redo)
    if (k === 'z') return run(A.undo)
    if (k === 'y') return run(A.redo)
    if (k === 'c') return run(A.copy)
    if (k === 'x') return run(A.cut)
    if (k === 'v') return run(A.paste)
    if (k === 'd') return run(A.duplicate)
    if (k === 'a') return run(A.selectAll)
    if (k === 'g' && e.shiftKey) return run(A.ungroup)
    if (k === 'g') return run(A.group)
    if (k === 's') return run(() => void A.saveProject(e.shiftKey))
    if (k === 'o') return run(() => void A.openProject())
    if (k === 'n') return run(A.newProject)
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && vp)
      return run(() => A.nudge(...vp.nudgeVector(e.key, step, true)))
    if (e.key === 'F12' || (e.shiftKey && k === 'i')) return run(() => window.api.toggleDevTools())
    return
  }
  if (e.key === 'Delete' || e.key === 'Backspace') return run(A.deleteSelected)
  if (k === 'h') return run(() => A.setSelectedHole(true))
  if (k === 's') return run(() => A.setSelectedHole(false))
  if (k === 'd') return run(A.dropSelected)
  if (k === 'w') return run(A.toggleWorkplanePicking)
  if (k === 'r') return run(A.toggleRulerPlacing)
  if (k === 'f') return run(() => vp?.fitView())
  if (e.key === 'F1' || e.key === '?') return run(toggleHelp)
  if (e.key === 'F12') return run(() => window.api.toggleDevTools())
  if (e.key.startsWith('Arrow') && vp) {
    // move along the workplane axis closest to where the camera looks
    const m = e.shiftKey ? 10 : 1
    return run(() => A.nudge(...vp.nudgeVector(e.key, step * m, false)))
  }
}

/** Keys in the Circuits tab: its own Delete, R and Esc; the 3D shortcuts do nothing here. */
function circuitKey(e: KeyboardEvent, ctrl: boolean, k: string, run: (fn: () => void) => void, toggleHelp: () => void): void {
  const running = circuitState.value === 'running'
  if (e.key === ' ' && !ctrl) return run(toggleCircuit)
  if (e.key === 'Escape') {
    if (wiring.value) return run(() => (wiring.value = null))
    if (running) return run(stopCircuit)
    return run(() => (circuitSelection.value = []))
  }
  if (e.key === 'F1' || e.key === '?') return run(toggleHelp)
  if (k === 'f' && !ctrl) return run(fitCircuit)
  if (ctrl) {
    if (k === 's') return run(() => void A.saveProject(e.shiftKey))
    if (k === 'o') return run(() => void A.openProject())
    if (k === 'n') return run(A.newProject)
    if (running) return
    if (k === 'z' && e.shiftKey) return run(A.redo)
    if (k === 'z') return run(A.undo)
    if (k === 'y') return run(A.redo)
    return
  }
  if (running) return
  if (e.key === 'Delete' || e.key === 'Backspace') return run(C.deleteCircuitSelection)
  if (k === 'r') return run(() => C.rotateSelectedParts(e.shiftKey ? -1 : 1))
}
