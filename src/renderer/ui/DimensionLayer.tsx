import { focusOnMount } from './common'
import { useState } from 'preact/hooks'
import { t } from '../i18n'
import { ruler, rulerMode, selection } from '../core/doc/store'
import { type DimLabel, dims } from '../view/dims'
import { viewport } from './actions'

const AX = ['insp.w', 'insp.d', 'insp.h'] as const
const fmt = (v: number) => String(Math.round(v * 100) / 100)

/**
 * Sizes and elevation next to the selected shape; click a number to type a new value. On the
 * robotics field (`pinsOnly`) only the pins over static shapes.
 */
export function DimensionLayer({ pinsOnly = false }: { pinsOnly?: boolean }) {
  const [editing, setEditing] = useState<string | null>(null)
  const list = pinsOnly ? dims.value.filter((d) => d.kind === 'pin') : dims.value
  return (
    <div class="dim-layer">
      {list.map((d) => (
        <DimTag key={d.id} d={d} editing={editing === d.id} setEditing={setEditing} />
      ))}
    </div>
  )
}

function DimTag(props: { d: DimLabel; editing: boolean; setEditing: (id: string | null) => void }) {
  const { d } = props
  const style = { left: `${d.x}px`, top: `${d.y}px` }
  if (d.kind === 'pin') {
    // a static shape of the field: an anchor over it
    return (
      <div
        class="dim-pin"
        style={style}
        title={`${t('robo.static')}. ${t('robo.staticTip')}`}
        data-testid={`dim-${d.id}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => (selection.value = [d.id.slice(4)])}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="5" r="2.5" />
          <path d="M12 7.5V21M7 11h10M4.5 14.5c.8 3.6 3.8 6.5 7.5 6.5s6.7-2.9 7.5-6.5" />
        </svg>
      </div>
    )
  }
  if (d.kind === 'rulerOrigin') {
    // ruler buttons: measure to the near edge or the center; remove the ruler
    const center = rulerMode.value === 'center'
    return (
      <div class="ruler-tools" style={style} onPointerDown={(e) => e.stopPropagation()}>
        <button
          title={center ? t('ruler.toEdge') : t('ruler.toCenter')}
          data-testid="ruler-mode"
          onClick={() => (rulerMode.value = center ? 'edge' : 'center')}
        >
          {center ? '⊕' : '⊢'}
        </button>
        <button title={t('ruler.remove')} data-testid="ruler-remove" onClick={() => (ruler.value = null)}>
          ×
        </button>
      </div>
    )
  }
  const title =
    d.kind === 'elev' ? t('dim.elev') : d.kind === 'ruler' ? t(d.axis === 0 ? 'ruler.dx' : 'ruler.dy') : t(AX[d.axis])
  if (props.editing) {
    const commit = (raw: string) => {
      props.setEditing(null)
      const v = parseFloat(raw.replace(',', '.'))
      if (Number.isFinite(v)) viewport()?.applyDim(d, v)
    }
    return (
      <input
        class="dim-tag dim-input"
        style={style}
        data-testid={`dim-input-${d.id}`}
        defaultValue={fmt(d.value)}
        ref={focusOnMount}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          const el = e.currentTarget as HTMLInputElement
          if (e.key === 'Enter') commit(el.value)
          if (e.key === 'Escape') props.setEditing(null)
        }}
        onBlur={() => props.setEditing(null)}
      />
    )
  }
  return (
    <button
      class={`dim-tag ${d.kind}`}
      data-kind={d.kind}
      style={style}
      title={`${title}: ${t('dim.clickToEdit')}`}
      data-testid={`dim-${d.id}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => props.setEditing(d.id)}
    >
      {d.kind === 'elev' ? '↑ ' : ''}
      {fmt(d.value)}
    </button>
  )
}
