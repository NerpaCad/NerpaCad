import type { JSX } from 'preact'
import { signal } from '@preact/signals'
import {
  type SketchTool,
  filletRadius,
  polygonSides,
  skConstruction,
  skSelection,
  skTool,
  solveInfo
} from '../core/sketch/session'
import { type Key, lang, t } from '../i18n'
import { deleteSelected, runConstraint } from '../view/SketchEditor'
import { type ConstraintCmd, applyCommand } from '../core/sketch/rules'
import { sketch } from '../core/sketch/session'
import * as A from './actions'
import { skShowBadges } from '../view/sketchOverlay'
import { ConstraintGlyph, Icon } from './icons'

const CONSTRAINTS: { id: ConstraintCmd; key?: string }[] = [
  { id: 'coincident', key: 'C' },
  { id: 'horizontal', key: 'H' },
  { id: 'vertical', key: 'V' },
  { id: 'parallel', key: 'P' },
  { id: 'perpendicular', key: 'K' },
  { id: 'equal', key: 'E' },
  { id: 'tangent', key: 'T' },
  { id: 'midpoint', key: 'M' },
  { id: 'symmetric' },
  { id: 'lock' }
]
const DIMS: { id: ConstraintCmd; key?: string }[] = [
  { id: 'dimension', key: 'D' },
  { id: 'distanceX' },
  { id: 'distanceY' }
]

/** Constraint buttons: bright when the selection fits, with a hint about what to select. */
function CmdButtons({ list }: { list: { id: ConstraintCmd; key?: string }[] }) {
  const s = sketch.value
  const sel = skSelection.value
  return (
    <div class="sk-cmds">
      {list.map((c) => {
        const ok = sel.length > 0 && applyCommand(s, sel, c.id) !== null
        const name = t(`sk.c.${c.id}` as Key)
        return (
          <button
            class={`sk-cmd ${ok ? 'ok' : ''}`}
            title={`${name}${c.key ? ` (${c.key})` : ''} — ${t(`sk.need.${c.id}` as Key)}`}
            aria-label={name}
            data-testid={`sk-c-${c.id}`}
            onClick={() => runConstraint(c.id)}
          >
            <ConstraintGlyph type={c.id} size={20} />
          </button>
        )
      })}
    </div>
  )
}

type ToolSpec = { id: SketchTool; icon: (p: { size?: number }) => JSX.Element; key?: string }
const T = (id: SketchTool, icon: ToolSpec['icon'], key?: string): ToolSpec => ({ id, icon, key })

/** A plain tool, or a group of variants behind one button (the little corner triangle opens the list). */
const TOOLS: (ToolSpec | { group: string; variants: ToolSpec[] })[] = [
  T('select', Icon.skSelect, 'Q'),
  T('line', Icon.skLine, 'L'),
  T('spline', Icon.skSpline, 'S'),
  { group: 'rect', variants: [T('rect', Icon.skRect, 'R'), T('rectCenter', Icon.skRectCenter)] },
  T('circle', Icon.skCircle, 'O'),
  { group: 'arc', variants: [T('arc', Icon.skArc, 'A'), T('arc3', Icon.skArc3)] },
  T('polygon', Icon.skPolygon, 'N'),
  T('point', Icon.skPoint),
  T('trim', Icon.skTrim),
  T('fillet', Icon.skFillet)
]

/** the variant each group shows (the last one picked) */
const groupPick = signal<Record<string, SketchTool>>({})
/** the group whose variant list is open */
const openGroup = signal<string | null>(null)

function ToolButton({ x, more }: { x: ToolSpec; more?: { group: string; open: boolean } }) {
  const name = t(`sk.tool.${x.id}` as Key)
  return (
    <div class={`sk-tool-wrap ${more ? 'grouped' : ''}`}>
      <button
        class={`sk-tool ${skTool.value === x.id ? 'on' : ''}`}
        title={x.key ? `${name} (${x.key})` : name}
        aria-label={name}
        data-testid={`sk-tool-${x.id}`}
        onClick={() => {
          openGroup.value = null
          skTool.value = x.id
        }}
      >
        <x.icon size={20} />
        <span>{name}</span>
      </button>
      {more && (
        <button
          class={`sk-tool-more ${more.open ? 'open' : ''}`}
          title={t('sk.toolVariants')}
          aria-label={t('sk.toolVariants')}
          aria-expanded={more.open}
          data-testid={`sk-more-${more.group}`}
          onClick={(e) => {
            e.stopPropagation()
            openGroup.value = more.open ? null : more.group
          }}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
            <path d="M8 0V8H0Z" />
          </svg>
        </button>
      )}
    </div>
  )
}

function ToolGroup({ group, variants }: { group: string; variants: ToolSpec[] }) {
  const tool = skTool.value
  // the button shows the variant in use, else the last one picked, else the first
  const shown = variants.find((v) => v.id === tool) ?? variants.find((v) => v.id === groupPick.value[group]) ?? variants[0]
  const open = openGroup.value === group
  return (
    <div class="sk-group">
      <ToolButton x={shown} more={{ group, open }} />
      {open && (
        <div class="sk-variants" role="menu" data-testid={`sk-variants-${group}`}>
          {variants.map((v) => {
            const name = t(`sk.tool.${v.id}` as Key)
            return (
              <button
                role="menuitem"
                class={`sk-variant ${v.id === shown.id ? 'on' : ''}`}
                data-testid={`sk-variant-${v.id}`}
                onClick={() => {
                  groupPick.value = { ...groupPick.value, [group]: v.id }
                  openGroup.value = null
                  skTool.value = v.id
                }}
              >
                <v.icon size={18} />
                <span>{name}</span>
                {v.key && <kbd>{v.key}</kbd>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// a click anywhere else closes an open variant list
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    if (openGroup.peek() && !(e.target as Element | null)?.closest?.('.sk-group')) openGroup.value = null
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openGroup.peek()) openGroup.value = null
  })
}

/** Right-hand panel in sketch mode: drawing tools, status and finishing the sketch. */
export function SketchPanel() {
  void lang.value
  const tool = skTool.value
  return (
    <aside class="shapes-panel sketch-panel" data-testid="sketch-panel">
      <div class="panel-title">{t('sk.title')}</div>
      <div class="sk-section">{t('sk.tools')}</div>
      <div class="sk-tools">
        {TOOLS.map((x) => ('group' in x ? <ToolGroup key={x.group} group={x.group} variants={x.variants} /> : <ToolButton key={x.id} x={x} />))}
      </div>
      {tool === 'fillet' && (
        <label class="sk-row">
          {t('sk.filletR')}
          <input
            type="number"
            min={0.1}
            step={0.5}
            value={filletRadius.value}
            data-testid="sk-fillet-r"
            onChange={(e) => {
              const v = parseFloat((e.currentTarget as HTMLInputElement).value)
              if (Number.isFinite(v) && v > 0) filletRadius.value = v
            }}
          />
        </label>
      )}
      {tool === 'polygon' && (
        <label class="sk-row">
          {t('sk.sides')}
          <input
            type="number"
            min={3}
            max={64}
            value={polygonSides.value}
            data-testid="sk-sides"
            onChange={(e) => {
              const v = parseInt((e.currentTarget as HTMLInputElement).value, 10)
              if (Number.isFinite(v)) polygonSides.value = Math.max(3, Math.min(64, v))
            }}
          />
        </label>
      )}
      <div class="sk-row">
        <button
          class={`sk-toggle ${skConstruction.value ? 'on' : ''}`}
          title={t('sk.constructionTip')}
          data-testid="sk-construction"
          onClick={() => (skConstruction.value = !skConstruction.value)}
        >
          <Icon.construction size={18} /> {t('sk.construction')} <kbd>G</kbd>
        </button>
        <button
          class="icon-btn"
          title={`${t('sk.delete')} (Del)`}
          disabled={skSelection.value.length === 0}
          onClick={deleteSelected}
          data-testid="sk-delete"
        >
          <Icon.trash size={18} />
        </button>
      </div>
      <div class="sk-section sk-section-row">
        {t('sk.constraints')}
        <label class="sk-badges-toggle" title={t('sk.showBadges')}>
          <input
            type="checkbox"
            checked={skShowBadges.value}
            data-testid="sk-badges"
            onChange={(e) => (skShowBadges.value = (e.currentTarget as HTMLInputElement).checked)}
          />
          {t('sk.badges')}
        </label>
      </div>
      <CmdButtons list={CONSTRAINTS} />
      <div class="sk-section">{t('sk.dimensions')}</div>
      <CmdButtons list={DIMS} />
      <p class="panel-hint">
        {t(`sk.hint.${tool}` as Key)} {tool !== 'select' && tool !== 'trim' && tool !== 'fillet' && t('sk.hint.alt')}
      </p>
      <div class="sk-row sk-export">
        <span>{t('sk.export')}</span>
        <button class="btn small" title={t('sk.exportDxf')} onClick={() => void A.exportSketch('dxf')} data-testid="sk-dxf">
          DXF
        </button>
        <button class="btn small" title={t('sk.exportSvg')} onClick={() => void A.exportSketch('svg')} data-testid="sk-svg">
          SVG
        </button>
      </div>
      <div class="spacer" />
      <SketchStatus />
      <div class="sk-actions">
        <button class="btn primary" onClick={() => void A.finishSketch()} data-testid="sk-done">
          <Icon.check size={18} /> {t('sk.done')}
        </button>
        <button class="btn" onClick={A.cancelSketch} data-testid="sk-cancel">
          {t('sk.cancel')}
        </button>
      </div>
    </aside>
  )
}

function SketchStatus() {
  const info = solveInfo.value
  if (!info) return <div class="sk-status">{t('sk.solving')}</div>
  const full = info.dof === 0
  return (
    <div class={`sk-status ${full ? 'full' : ''}`} data-testid="sk-status" data-dof={info.dof}>
      <span class="sk-dot" />
      {full ? t('sk.full') : t('sk.dof', { n: info.dof })}
      {!full && <div class="sk-free-hint">{t('sk.freeHint')}</div>}
      {info.redundant.length > 0 && <div class="sk-warn">{t('sk.redundant', { n: info.redundant.length })}</div>}
    </div>
  )
}
