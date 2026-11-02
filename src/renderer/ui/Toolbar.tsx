import type { Axis } from '../core/doc/ops'
import { aligning, canRedo, canUndo, placingRuler, placingWorkplane, selection, selectedNodes } from '../core/doc/store'
import { inSketch, skCanRedo, skCanUndo, sketchPicking } from '../core/sketch/session'
import { roboticsMode } from '../core/robotics/state'
import { circuitsMode } from '../core/circuit/state'
import { editLocked } from '../core/doc/store'
import { circuitsTab } from './circuitActions'
import { LANG_NAMES, LANG_SHORT, LANGS, lang, t } from '../i18n'
import { THEMES, themeId } from '../themes'
import * as A from './actions'
import { geom } from '../core/geom/client'
import { Dropdown, ToolButton } from './common'
import { Icon } from './icons'
import { useLayoutEffect, useRef } from 'preact/hooks'

/**
 * How far the toolbar has to squeeze to fit the window. Each step adds a class:
 * 1 no logo · 2 no captions, tighter tabs · 3 rarer tools into «More» · 4 more of them ·
 * 5 mode tabs as icons only.
 */
const FIT_STEPS = 5

function fitToolbar(el: HTMLElement): void {
  for (let i = 1; i <= FIT_STEPS; i++) el.classList.remove(`fit${i}`)
  for (let i = 1; i <= FIT_STEPS && el.scrollWidth > el.clientWidth + 1; i++) el.classList.add(`fit${i}`)
}

const AXES: Axis[] = [0, 1, 2]
const AXIS_NAME = ['X', 'Y', 'Z']

export function Toolbar(props: { onHelp: () => void; onAbout: () => void }) {
  void lang.value
  const n = selection.value.length
  const hasGroup = selectedNodes.value.some((x) => x.kind === 'group')
  const sk = inSketch.value
  const sketchOn = sk || sketchPicking.value
  const robo = roboticsMode.value
  const circ = circuitsMode.value
  const locked = editLocked.value
  const ref = useRef<HTMLElement>(null)
  // measure after every render (mode, language and theme change the widths) and on resize
  useLayoutEffect(() => {
    if (ref.current) fitToolbar(ref.current)
  })
  useLayoutEffect(() => {
    const el = ref.current!
    const ro = new ResizeObserver(() => fitToolbar(el))
    ro.observe(el)
    void document.fonts?.ready.then(() => fitToolbar(el))
    return () => ro.disconnect()
  }, [])
  return (
    <header class="toolbar" ref={ref} data-testid="toolbar">
      <button class="brand" onClick={props.onAbout} title={t('about.title')} data-testid="brand">
        <span class="brand-logo">
          <img src="./logo-small.png" alt="" draggable={false} />
        </span>
        <span class="brand-name">
          Nerpa<span class="brand-mark">Cad</span>
        </span>
      </button>
      <div class="mode-switch" role="group">
        <button class={robo || circ ? '' : 'on'} title={t('mode.3dTip')} onClick={A.shapesMode} data-testid="mode-3d">
          <Icon.shapes size={18} /> <span class="ms-label">{t('mode.3d')}</span>
        </button>
        <button class={robo ? 'on' : ''} title={t('mode.roboticsTip')} onClick={A.roboticsTab} data-testid="mode-robotics">
          <Icon.robot size={18} /> <span class="ms-label">{t('mode.robotics')}</span>
        </button>
        <button class={circ ? 'on' : ''} title={t('mode.circuitsTip')} onClick={circuitsTab} data-testid="mode-circuits">
          <Icon.circuit size={18} /> <span class="ms-label">{t('mode.circuits')}</span>
        </button>
      </div>
      <div class="tool-group">
        <ToolButton title={`${t('tb.new')} (Ctrl+N)`} onClick={A.newProject} testId="tb-new">
          <Icon.new />
        </ToolButton>
        <ToolButton title={`${t('tb.open')} (Ctrl+O)`} onClick={() => void A.openProject()} testId="tb-open">
          <Icon.open />
        </ToolButton>
        <Dropdown title={`${t('tb.save')} (Ctrl+S)`} icon={<Icon.save />} testId="tb-save">
          {(close) => (
            <>
              <button class="menu-item" onClick={() => (close(), void A.saveProject(false))}>
                {t('tb.save')} <kbd>Ctrl+S</kbd>
              </button>
              <button class="menu-item" onClick={() => (close(), void A.saveProject(true))}>
                {t('tb.saveAs')} <kbd>Ctrl+Shift+S</kbd>
              </button>
            </>
          )}
        </Dropdown>
        <ToolButton title={t('tb.importStl')} onClick={() => void A.importStlFile()} testId="tb-import" cls="tb-ter">
          <Icon.import />
        </ToolButton>
        <Dropdown title={t('tb.export')} icon={<Icon.export />} testId="tb-export" cls="tb-ter">
          {(close) => (
            <>
              <div class="menu-title">{t('export.all')}</div>
              <button class="menu-item" onClick={() => (close(), void A.exportModel('stl', false))}>
                STL
              </button>
              <button class="menu-item" onClick={() => (close(), void A.exportModel('obj', false))}>
                OBJ
              </button>
              <div class="menu-title">{t('export.selected')}</div>
              <button class="menu-item" disabled={n === 0} onClick={() => (close(), void A.exportModel('stl', true))}>
                STL
              </button>
              <button class="menu-item" disabled={n === 0} onClick={() => (close(), void A.exportModel('obj', true))}>
                OBJ
              </button>
            </>
          )}
        </Dropdown>
      </div>

      <div class="tool-group">
        <ToolButton
          title={`${t('tb.undo')} (Ctrl+Z)`}
          onClick={A.undo}
          disabled={locked || (sk ? !skCanUndo.value : !canUndo.value)}
          testId="tb-undo"
        >
          <Icon.undo />
        </ToolButton>
        <ToolButton
          title={`${t('tb.redo')} (Ctrl+Y)`}
          onClick={A.redo}
          disabled={locked || (sk ? !skCanRedo.value : !canRedo.value)}
          testId="tb-redo"
        >
          <Icon.redo />
        </ToolButton>
      </div>
      {!robo && !circ && (
        <div class="tool-group">
          <ToolButton
            title={sk ? t('sk.finishTip') : t('mode.sketchTip')}
            label={sk ? t('sk.done') : t('mode.sketch')}
            onClick={sk ? () => void A.finishSketch() : A.toggleSketchPicking}
            active={sketchOn}
            testId="tb-sketch"
            cls="sketch-btn"
          >
            <Icon.sketch />
          </ToolButton>
        </div>
      )}
      {!sk && !circ && <ShapeTools n={locked ? 0 : n} hasGroup={hasGroup && !locked} robo={robo} />}
      {!sk && !circ && !robo && !sketchPicking.value && (
        <div class="tool-group">
          <ToolButton
            title={t('toSim.tip')}
            label={t('toSim.button')}
            onClick={() => void A.sendToSimulator()}
            disabled={geom.busy.value > 0}
            testId="tb-to-sim"
            cls="to-sim"
          >
            <Icon.toSim />
          </ToolButton>
        </div>
      )}
      <MoreMenu n={locked ? 0 : n} hasGroup={hasGroup && !locked} robo={robo} shapes={!sk && !circ} />

      <div class="spacer" />

      <Dropdown title={t('tb.theme')} icon={<Icon.palette />} testId="tb-theme" align="right">
        {(close) => (
          <div class="theme-menu">
            <div class="menu-title">{t('tb.theme')}</div>
            {THEMES.map((th) => (
              <button
                class={`theme-item ${themeId.value === th.id ? 'on' : ''}`}
                data-testid={`theme-${th.id}`}
                onClick={() => {
                  themeId.value = th.id
                  close()
                }}
              >
                <span class="theme-swatches">
                  {[th.ui.bg, th.ui.panel, th.ui.primary, th.ui.accent, th.shapes.box, th.shapes.cylinder].map(
                    (c) => (
                      <span style={{ background: c }} />
                    )
                  )}
                </span>
                <span class="theme-name">{th.name[lang.value]}</span>
                {themeId.value === th.id && <span class="theme-check">✓</span>}
              </button>
            ))}
          </div>
        )}
      </Dropdown>
      <Dropdown
        title={t('tb.language')}
        label={LANG_SHORT[lang.value]}
        icon={<Icon.globe />}
        testId="tb-lang"
        align="right"
        cls="lang-menu"
      >
        {(close) => (
          <div class="menu-list" role="menu">
            {LANGS.map((l) => (
              <button
                class={`menu-item${lang.value === l ? ' on' : ''}`}
                role="menuitemradio"
                aria-checked={lang.value === l}
                lang={l === 'zh' ? 'zh-Hans' : l}
                onClick={() => {
                  lang.value = l
                  close()
                }}
                data-testid={`lang-${l}`}
              >
                <span>{LANG_NAMES[l]}</span>
                {lang.value === l && <span class="theme-check">✓</span>}
              </button>
            ))}
          </div>
        )}
      </Dropdown>
      <ToolButton title={t('tb.help')} onClick={props.onHelp} testId="tb-help">
        <Icon.help />
      </ToolButton>
    </header>
  )
}

/** Buttons that edit shapes (hidden in sketch mode). */
function ShapeTools({ n, hasGroup, robo }: { n: number; hasGroup: boolean; robo: boolean }) {
  return (
    <>
        <div class="tool-group">
          <ToolButton title={`${t('tb.copy')} (Ctrl+C)`} onClick={A.copy} disabled={n === 0} cls="tb-sec">
            <Icon.copy />
          </ToolButton>
          <ToolButton title={`${t('tb.paste')} (Ctrl+V)`} onClick={A.paste} cls="tb-sec">
            <Icon.paste />
          </ToolButton>
          <ToolButton title={`${t('tb.duplicate')} (Ctrl+D)`} onClick={A.duplicate} disabled={n === 0} testId="tb-duplicate">
            <Icon.duplicate />
          </ToolButton>
          <ToolButton title={`${t('tb.delete')} (Del)`} onClick={A.deleteSelected} disabled={n === 0} testId="tb-delete">
            <Icon.trash />
          </ToolButton>
        </div>

        <div class="tool-group">
          <ToolButton
            title={`${t('tb.group')} (Ctrl+G)`}
            label={t('tb.groupShort')}
            onClick={A.group}
            disabled={n < 2}
            testId="tb-group"
          >
            <Icon.group />
          </ToolButton>
          <ToolButton
            title={`${t('tb.ungroup')} (Ctrl+Shift+G)`}
            onClick={A.ungroup}
            disabled={!hasGroup}
            testId="tb-ungroup"
            cls="tb-ter"
          >
            <Icon.ungroup />
          </ToolButton>
          <ToolButton
            title={`${t('tb.align')} (L): ${t('tb.alignTip')}`}
            onClick={A.toggleAlign}
            active={!!aligning.value}
            disabled={n < 2}
            testId="tb-align"
            cls="tb-sec"
          >
            <Icon.align />
          </ToolButton>
          <Dropdown title={t('tb.mirror')} icon={<Icon.mirror />} disabled={n === 0} testId="tb-mirror" cls="tb-sec">
            {(close) => (
              <>
                {AXES.map((ax) => (
                  <button
                    class="menu-item"
                    data-testid={`mirror-${ax}`}
                    onClick={() => (close(), A.mirror(ax))}
                  >
                    {t('mirror.axis', { axis: AXIS_NAME[ax] })}
                  </button>
                ))}
              </>
            )}
          </Dropdown>
          <ToolButton title={`${t('tb.drop')} (D)`} onClick={A.dropSelected} disabled={n === 0} cls="tb-sec">
            <Icon.drop />
          </ToolButton>
          {!robo && (
          <>
          <ToolButton
            title={`${t('tb.workplane')} (W)`}
            onClick={A.toggleWorkplanePicking}
            active={placingWorkplane.value}
            testId="tb-workplane"
            cls="tb-ter"
          >
            <Icon.workplane />
          </ToolButton>
          <ToolButton
            title={`${t('tb.ruler')} (R)`}
            onClick={A.toggleRulerPlacing}
            active={placingRuler.value}
            testId="tb-ruler"
            cls="tb-ter"
          >
            <Icon.ruler />
          </ToolButton>
          </>
          )}
        </div>
    </>
  )
}

/**
 * «More»: the tools that no longer fit in the toolbar (shown by the fit classes).
 * Rarer tools (m-sec) move first, then the next ones (m-ter).
 */
function MoreMenu({ n, hasGroup, robo, shapes }: { n: number; hasGroup: boolean; robo: boolean; shapes: boolean }) {
  return (
    <Dropdown title={t('tb.more')} icon={<Icon.more />} testId="tb-more" cls="tb-more" align="right">
      {(close) => (
        <div class="more-menu">
          <div class="m-sec">
            <button class="menu-item" onClick={() => (close(), void A.showStartScreen(true))} data-testid="menu-recent">
              {t('start.menu')}
            </button>
          </div>
          {shapes && (
            <div class="m-sec">
              <button class="menu-item" disabled={n === 0} onClick={() => (close(), A.copy())}>
                {t('tb.copy')} <kbd>Ctrl+C</kbd>
              </button>
              <button class="menu-item" onClick={() => (close(), A.paste())}>
                {t('tb.paste')} <kbd>Ctrl+V</kbd>
              </button>
              <button class="menu-item" disabled={n === 0} onClick={() => (close(), A.dropSelected())}>
                {t('tb.drop')} <kbd>D</kbd>
              </button>
              <div class="menu-title">{t('tb.mirror')}</div>
              {AXES.map((ax) => (
                <button class="menu-item" disabled={n === 0} onClick={() => (close(), A.mirror(ax))}>
                  {t('mirror.axis', { axis: AXIS_NAME[ax] })}
                </button>
              ))}
              <button class="menu-item" disabled={n < 2} onClick={() => (close(), A.toggleAlign())}>
                {t('tb.align')} <kbd>L</kbd>
              </button>
            </div>
          )}
          <div class="m-ter">
            {shapes && (
              <button class="menu-item" disabled={!hasGroup} onClick={() => (close(), A.ungroup())}>
                {t('tb.ungroup')} <kbd>Ctrl+Shift+G</kbd>
              </button>
            )}
            {shapes && !robo && (
              <>
                <button class="menu-item" onClick={() => (close(), A.toggleWorkplanePicking())}>
                  {t('tb.workplane')} <kbd>W</kbd>
                </button>
                <button class="menu-item" onClick={() => (close(), A.toggleRulerPlacing())}>
                  {t('tb.ruler')} <kbd>R</kbd>
                </button>
              </>
            )}
            <button class="menu-item" onClick={() => (close(), void A.importStlFile())}>
              {t('tb.importStl')}
            </button>
            <div class="menu-title">{t('export.all')}</div>
            <button class="menu-item" onClick={() => (close(), void A.exportModel('stl', false))}>
              STL
            </button>
            <button class="menu-item" onClick={() => (close(), void A.exportModel('obj', false))}>
              OBJ
            </button>
          </div>
        </div>
      )}
    </Dropdown>
  )
}

