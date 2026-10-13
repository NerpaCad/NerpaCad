/**
 * The block editor under the 3D view. Blockly owns its own DOM inside a div that Preact never
 * re-renders; the program is saved into the robot's document node (one undo step per pause in
 * editing) and reloaded when the document changes from outside (undo, open file).
 */
import { type ReadonlySignal, computed, effect, untracked } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
import { doc } from '../core/doc/store'
import { activeBlocks, programActor, simActive } from '../core/robotics/state'
import { speciesOf } from '../core/robotics/creatures'
import { actorProgram } from '../core/doc/model'
import { type Key, lang, t } from '../i18n'
import { themeId } from '../themes'
import * as A from './actions'
import { Blockly, EMPTY_PROGRAM, blocklyTheme, defineBlocks, toolboxFor } from './blocks'

const SAVE_DELAY = 300

/** Whose program the editor shows and how it is saved: a robot, an Arduino… */
export interface ProgramSource {
  /** `kind` picks the block palette (a robot, a seal, a lamp…) */
  target: ReadonlySignal<{ id: string; name: string; program: unknown; kind?: string } | null>
  save(id: string, program: unknown): void
  /** blocks being run, per target id */
  active: ReadonlySignal<Record<string, string[]>>
  /** a run is on: no editing */
  locked: ReadonlySignal<boolean>
  toolbox(kind?: string): Blockly.utils.toolbox.ToolboxDefinition
  /** shown when there is no target */
  empty: Key
  /** the program as code (adds a "Code" tab) */
  code?: (program: unknown) => string
  /** lines printed by the program (adds a "Serial monitor" tab) */
  serial?: ReadonlySignal<string[]>
}

/** The robotics field: the program of the selected robot, seal or lamp. */
export const robotProgram: ProgramSource = {
  target: computed(() => {
    const a = programActor.value
    return a
      ? { id: a.node.id, name: a.node.name, program: actorProgram(a.node), kind: a.kind === 'nerpa' ? `nerpa:${speciesOf(a.node.params.nerpa?.species)}` : a.kind }
      : null
  }),
  save: (id, p) => A.setProgram(id, p),
  active: activeBlocks,
  locked: simActive,
  toolbox: (kind) => toolboxFor((kind as Parameters<typeof toolboxFor>[0] | undefined) ?? 'robot'),
  empty: 'robo.addActorFirst'
}

// variable names: Blockly asks with window.prompt, which Electron does not have
let promptReady = false
function setUpPrompt(): void {
  if (promptReady) return
  promptReady = true
  Blockly.dialog.setPrompt((message: string, defaultValue: string, callback: (v: string | null) => void) => {
    const back = document.createElement('div')
    back.className = 'modal-back blockly-prompt'
    back.innerHTML = '<div class="modal small"><p></p><input type="text" /><div class="modal-buttons"><button class="btn" data-a="cancel"></button><button class="btn primary" data-a="ok">OK</button></div></div>'
    back.querySelector('p')!.textContent = message
    const input = back.querySelector('input')!
    input.value = defaultValue
    input.setAttribute('data-testid', 'prompt-input')
    back.querySelector<HTMLButtonElement>('[data-a=cancel]')!.textContent = t('about.close')
    const done = (v: string | null) => {
      back.remove()
      callback(v)
    }
    back.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).dataset.a
      if (a === 'ok') done(input.value)
      else if (a === 'cancel' || e.target === back) done(null)
    })
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') done(input.value)
      if (e.key === 'Escape') done(null)
    })
    document.body.appendChild(back)
    input.focus()
    input.select()
  })
}

export function BlocklyPanel({ source = robotProgram }: { source?: ProgramSource }) {
  void lang.value
  void themeId.value
  const robot = source.target.value
  const [view, setView] = useState<'blocks' | 'code' | 'serial'>('blocks')
  const [height, setHeight] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('blockly-height'))
      return Math.max(160, Math.min(700, saved || Math.min(300, Math.round(window.innerHeight * 0.4))))
    } catch {
      return 300
    }
  })
  const startResize = (e: PointerEvent) => {
    e.preventDefault()
    const y0 = e.clientY
    const h0 = shown
    const move = (ev: PointerEvent) => setHeight(Math.max(160, Math.min(window.innerHeight - 200, h0 - (ev.clientY - y0))))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      try {
        localStorage.setItem('blockly-height', String(Math.round(heightRef.current)))
      } catch {
        /* storage may be unavailable */
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const heightRef = useRef(height)
  heightRef.current = height
  // the 3D view always keeps room; the default size is ~40 % of a short window
  const [winH, setWinH] = useState(window.innerHeight)
  useEffect(() => {
    const on = () => setWinH(window.innerHeight)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const shown = Math.max(160, Math.min(height, winH - 300))

  return (
    <section class="blockly-panel" style={{ height: `${shown}px` }} data-testid="blockly-panel">
      <div class="blockly-resize" onPointerDown={(e) => startResize(e as unknown as PointerEvent)} title={t('robo.resize')} />
      <div class="blockly-head">
        <span class="panel-title">{t('robo.program')}</span>
        <span class="blockly-robot">{robot ? robot.name : t('robo.noRobot')}</span>
        {source.code && robot && (
          <div class="seg small blockly-tabs">
            <button class={view === 'blocks' ? 'on' : ''} onClick={() => setView('blocks')} data-testid="view-blocks">
              {t('ckt.blocks')}
            </button>
            <button class={view === 'code' ? 'on' : ''} onClick={() => setView('code')} data-testid="view-code">
              {t('ckt.code')}
            </button>
            {source.serial && (
              <button class={view === 'serial' ? 'on' : ''} onClick={() => setView('serial')} data-testid="view-serial">
                {t('ckt.serial')}
              </button>
            )}
          </div>
        )}
      </div>
      {!robot ? (
        <div class="blockly-empty">{t(source.empty)}</div>
      ) : view === 'code' && source.code ? (
        <CodeView code={source.code(robot.program)} />
      ) : view === 'serial' && source.serial ? (
        <SerialView lines={source.serial.value} />
      ) : (
        // a new editor for every language/theme/palette (block texts and colours are baked in)
        <BlocklyHost key={`${lang.value}-${themeId.value}-${robot.kind ?? ''}`} source={source} />
      )}
    </section>
  )
}

function CodeView({ code }: { code: string }) {
  return (
    <div class="code-view" data-testid="code-view">
      <button
        class="btn small code-copy"
        onClick={() => void navigator.clipboard?.writeText(code).then(() => A.notify(t('ckt.copied')))}
      >
        {t('ckt.copy')}
      </button>
      <pre>{code}</pre>
    </div>
  )
}

/** The serial monitor: what the program printed, newest at the bottom. */
function SerialView({ lines }: { lines: string[] }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])
  return (
    <div class="code-view serial-view" data-testid="serial-view" ref={box}>
      {lines.length ? <pre>{lines.join('\n')}</pre> : <div class="blockly-empty">{t('ckt.serialEmpty')}</div>}
    </div>
  )
}

function BlocklyHost({ source }: { source: ProgramSource }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    defineBlocks()
    setUpPrompt()
    const ws = Blockly.inject(host.current!, {
      toolbox: source.toolbox(source.target.peek()?.kind),
      renderer: 'zelos',
      theme: blocklyTheme(),
      media: './blockly/',
      sounds: false,
      trashcan: true,
      zoom: { controls: true, wheel: true, startScale: 0.75, maxScale: 2, minScale: 0.3, scaleSpeed: 1.15 },
      move: { scrollbars: true, drag: true, wheel: false },
      grid: { spacing: 24, length: 2, colour: 'rgba(128,128,128,0.25)', snap: false }
    })

    let robotId: string | null = null
    /** the program as last loaded or saved, to tell our own saves from outside changes */
    let lastJson = ''
    let loading = false
    let timer = 0

    const save = () => {
      window.clearTimeout(timer)
      timer = 0
      if (!robotId || loading) return
      const program = Blockly.serialization.workspaces.save(ws)
      lastJson = JSON.stringify(program)
      source.save(robotId, program)
    }

    const load = (program: unknown) => {
      loading = true
      Blockly.Events.disable()
      try {
        ws.clear()
        Blockly.serialization.workspaces.load((program ?? EMPTY_PROGRAM) as object, ws)
      } catch (e) {
        console.error('program', e)
        ws.clear()
        A.notify(t('robo.badProgram'), 'error')
      } finally {
        Blockly.Events.enable()
        loading = false
      }
      lastJson = JSON.stringify(program ?? null)
    }

    ws.addChangeListener((e: Blockly.Events.Abstract) => {
      if (loading || e.isUiEvent || !robotId) return
      window.clearTimeout(timer)
      timer = window.setTimeout(save, SAVE_DELAY)
    })

    const stop = [
      // follow the robot whose program is shown, and changes to it from outside
      effect(() => {
        const r = source.target.value
        void doc.value
        untracked(() => {
          if (!r) return
          if (r.id !== robotId) {
            if (timer) save()
            robotId = r.id
            load(r.program)
            return
          }
          const json = JSON.stringify(r.program ?? null)
          if (json !== lastJson && !timer) load(r.program)
        })
      }),
      // light up the blocks being run
      effect(() => {
        const ids = robotId ? (source.active.value[robotId] ?? []) : []
        void source.locked.value
        untracked(() => {
          ws.highlightBlock(null)
          for (const id of ids) if (ws.getBlockById(id)) ws.highlightBlock(id, true)
        })
      })
    ]

    const ro = new ResizeObserver(() => Blockly.svgResize(ws))
    ro.observe(host.current!)

    return () => {
      if (timer) save()
      stop.forEach((s) => s())
      ro.disconnect()
      ws.dispose()
    }
  }, [])

  return (
    <div class="blockly-wrap">
      <div class="blockly-host" ref={host} data-testid="blockly-host" />
      {source.locked.value && (
        <div class="blockly-lock" data-testid="blockly-lock">
          {t('robo.programLocked')}
        </div>
      )}
    </div>
  )
}
