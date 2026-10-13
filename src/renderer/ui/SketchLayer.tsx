import { focusOnMount } from './common'
import { beginPlace, cancelPlace, endPlace, isPlacing, skSelection } from '../core/sketch/session'
import { type Key, lang, t } from '../i18n'
import { placeDimension, setDimensionValue } from '../view/SketchEditor'
import { type SkBadge, dimText, skEditDim, skFlash, skOverlay, skShowBadges } from '../view/sketchOverlay'
import { ConstraintGlyph } from './icons'

const fmt = (v: number) => String(Math.round(v * 100) / 100)

function arrow([x, y, a]: [number, number, number]): string {
  const l = 9
  const w = 0.38
  const p1 = [x - l * Math.cos(a - w), y - l * Math.sin(a - w)]
  const p2 = [x - l * Math.cos(a + w), y - l * Math.sin(a + w)]
  return `M${x},${y}L${p1[0]},${p1[1]}L${p2[0]},${p2[1]}Z`
}

function select(id: string, shift: boolean) {
  const sel = skSelection.value
  skSelection.value = shift ? (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]) : [id]
}

/** Select several constraints at once (a regular polygon's badge); Shift adds or removes them. */
function selectAll(ids: string[], shift: boolean) {
  if (ids.length === 1) return select(ids[0], shift)
  const sel = skSelection.value
  if (!shift) skSelection.value = ids
  else if (ids.every((id) => sel.includes(id))) skSelection.value = sel.filter((x) => !ids.includes(x))
  else skSelection.value = [...new Set([...sel, ...ids])]
}

function badgeTitle(b: SkBadge): string {
  if (b.type === 'regular') return t('sk.c.regular')
  const name = t(`sk.c.${b.type === 'pointOn' ? 'coincident' : b.type}` as Key)
  return b.n !== undefined ? `${name} · ${t('sk.equalGroup', { n: b.n })}` : name
}

/**
 * Pressing a dimension: a click on its number opens it for typing, a click on its lines or
 * arrows selects it (then Delete removes it); pulling either moves the dimension.
 */
let press: { id: string; x: number; y: number; moved: boolean; label: boolean; shift: boolean } | null = null

function dimDown(e: PointerEvent, id: string, label: boolean) {
  e.stopPropagation()
  if (e.button !== 0) return
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  press = { id, x: e.clientX, y: e.clientY, moved: false, label, shift: e.shiftKey }
}

function dimMove(e: PointerEvent) {
  const p = press
  if (!p) return
  if (!p.moved) {
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4) return
    p.moved = true
    skEditDim.value = null
    select(p.id, false)
    beginPlace()
  }
  if (isPlacing()) placeDimension(p.id, e.clientX, e.clientY)
}

function dimUp(e: PointerEvent) {
  const p = press
  press = null
  const el = e.currentTarget as Element
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  if (!p) return
  if (p.moved) return endPlace()
  if (p.shift) return select(p.id, true)
  select(p.id, false)
  if (p.label) skEditDim.value = p.id
}

function dimCancel() {
  if (press?.moved) cancelPlace()
  press = null
}

const dimHandlers = (id: string, label: boolean) => ({
  onPointerDown: (e: PointerEvent) => dimDown(e, id, label),
  onPointerMove: dimMove,
  onPointerUp: dimUp,
  onPointerCancel: dimCancel,
  onLostPointerCapture: () => {
    if (press?.moved) endPlace()
    press = null
  }
})

/** Dimensions (click the number to type a new one) and constraint badges over the sketch. */
export function SketchLayer() {
  void lang.value
  const ov = skOverlay.value
  const sel = new Set(skSelection.value)
  const flash = skFlash.value
  const editing = skEditDim.value
  const cls = (id: string) => (flash.has(id) ? ' flash' : sel.has(id) ? ' sel' : '')
  const clsAll = (ids: string[]) => (ids.some((id) => flash.has(id)) ? ' flash' : ids.every((id) => sel.has(id)) ? ' sel' : '')
  return (
    <div class="dim-layer sk-layer" data-testid="sketch-layer">
      <svg class="sk-svg">
        {ov.dims.map((d) => (
          <g class={`sk-dim-g${cls(d.id)}`} key={d.id}>
            {d.lines.map((pl) => (
              <polyline points={pl.map((p) => p.join(',')).join(' ')} />
            ))}
            {d.arrows.map((a) => (
              <path d={arrow(a)} />
            ))}
            {/* a wider invisible copy to grab the dimension by its lines and arrows */}
            <g class="sk-dim-hit" data-testid={`skdim-line-${d.id}`} {...dimHandlers(d.id, false)}>
              <title>{t('sk.dimLineTip')}</title>
              {d.lines.slice(d.exts ?? 0).map((pl) => (
                <polyline points={pl.map((p) => p.join(',')).join(' ')} />
              ))}
              {d.arrows.map((a) => (
                <circle cx={a[0]} cy={a[1]} r={7} />
              ))}
            </g>
          </g>
        ))}
      </svg>
      {ov.dims.map((d) =>
        editing === d.id ? (
          <input
            key={`in-${d.id}`}
            class="dim-tag dim-input"
            style={{ left: `${d.x}px`, top: `${d.y}px` }}
            data-testid={`skdim-input-${d.id}`}
            defaultValue={fmt(d.shown)}
            ref={focusOnMount}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              const el = e.currentTarget as HTMLInputElement
              if (e.key === 'Enter') {
                skEditDim.value = null
                setDimensionValue(d.id, parseFloat(el.value.replace(',', '.')))
              }
              if (e.key === 'Escape') skEditDim.value = null
            }}
            onBlur={() => {
              if (skEditDim.peek() === d.id) skEditDim.value = null
            }}
          />
        ) : (
          <button
            key={d.id}
            class={`dim-tag sk-dim${cls(d.id)}`}
            style={{ left: `${d.x}px`, top: `${d.y}px` }}
            title={`${t(d.type === 'distanceX' || d.type === 'distanceY' ? `sk.c.${d.type}` : 'sk.c.dimension')}: ${t('sk.dimEdit')}`}
            data-testid={`skdim-${d.id}`}
            {...dimHandlers(d.id, true)}
            onClick={(e) => {
              // pointer clicks are handled on release; this is the keyboard (Enter / Space)
              if (e.detail !== 0) return
              select(d.id, false)
              skEditDim.value = d.id
            }}
          >
            {dimText(d)}
          </button>
        )
      )}
      {skShowBadges.value && ov.badges.map((b, i) => (
        <button
          key={`${b.id}-${i}`}
          class={`sk-badge${b.ids ? clsAll(b.ids) : cls(b.id)}`}
          style={{ left: `${b.x}px`, top: `${b.y}px` }}
          title={badgeTitle(b)}
          data-testid={`skbadge-${b.id}`}
          data-type={b.type}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => selectAll(b.ids ?? [b.id], e.shiftKey)}
        >
          <ConstraintGlyph type={b.type} size={13} />
          {b.n !== undefined && <span class="sk-badge-n">{b.n}</span>}
        </button>
      ))}
    </div>
  )
}
