import { signal } from '@preact/signals'
import type { PrimType } from '../core/doc/model'
import { addNodes } from '../core/doc/ops'
import { PARAM_SHAPES, SHAPES, companions, createShape } from '../core/doc/shapes'
import { commit, doc } from '../core/doc/store'
import { lang, t } from '../i18n'
import { themeId } from '../themes'
import { addShape, newShapeName, pieceName, shapeName, viewport } from './actions'
import { ShapeIcon } from './icons'
import { isPart, partArea } from '../core/doc/parts'

/**
 * Press on a tile and drag it into the 3D view: a preview of the shape follows the cursor
 * and lands where the button is released. A plain click adds the shape at a free spot.
 */
function startDrag(type: PrimType, e: PointerEvent): void {
  const vp = viewport()
  if (e.button !== 0 || !vp) return
  e.preventDefault()
  const node = createShape(type, newShapeName(type), [0, 0, 0], { text: t('shape.textDefault') })
  vp.beginShapeDrag(node, e, (r) => {
    if (r.kind === 'click') addShape(type, vp.freeSpot(isPart(type) ? partArea(type) : undefined))
    else if (r.kind === 'drop') {
      const placed = {
        ...node,
        transform: { ...node.transform, position: r.pos.position, rotation: r.pos.rotation }
      }
      const all = [placed, ...companions(placed, (piece) => pieceName(type, piece))]
      commit(addNodes(doc.value, all), all.map((x) => x.id))
    }
  })
}

/** Which tab of the shapes panel is open: the basic shapes or the ones set up with numbers. */
export const shapesTab = signal<'basic' | 'param'>('basic')

export function ShapesPanel() {
  void lang.value
  void themeId.value // icons use the theme's shape colors
  const tab = shapesTab.value
  return (
    <aside class="shapes-panel">
      <div class="panel-tabs" role="tablist">
        {(['basic', 'param'] as const).map((id) => (
          <button
            role="tab"
            aria-selected={tab === id}
            class={tab === id ? 'on' : ''}
            onClick={() => (shapesTab.value = id)}
            data-testid={`shapes-tab-${id}`}
          >
            {t(id === 'basic' ? 'shapes.tabBasic' : 'shapes.tabParam')}
          </button>
        ))}
      </div>
      <div class="shape-grid">
        {(tab === 'param' ? PARAM_SHAPES : SHAPES).map((type: PrimType) => (
          <button
            class="shape-tile"
            title={t(tab === 'param' ? 'shapes.paramHint' : 'shapes.hint')}
            data-testid={`shape-${type}`}
            onPointerDown={(e) => startDrag(type, e as unknown as PointerEvent)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                addShape(type, viewport()?.freeSpot(isPart(type) ? partArea(type) : undefined))
              }
            }}
          >
            <ShapeIcon type={type} />
            <span>{shapeName(type)}</span>
          </button>
        ))}
      </div>
      <p class="panel-hint">{t(tab === 'param' ? 'shapes.paramHint' : 'shapes.hint')}</p>
    </aside>
  )
}
