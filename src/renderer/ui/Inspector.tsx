import type { Box, DocNode, PrimNode, Vec3 } from '../core/doc/model'
import { LAND_COLOR, LAND_KINDS, TERRAIN_MAX_HEIGHT, TERRAIN_MIN_HEIGHT, isLand, landKindOf, snapTerrain, surfacesAt } from '../core/robotics/terrain'
import { drawLand } from '../view/landVisuals'
import { speciesOf } from '../core/robotics/creatures'
import { standOnTerrain } from '../core/robotics/field'
import { propSpec } from '../core/robotics/mods'
import { terrainOf } from '../core/robotics/world'
import type { TerrainParams, TileKind } from '../core/doc/model'
import { cleanNum, isRoboNode, MATERIALS } from '../core/doc/model'
import { clampGear, type GearParams, outerDiameter, pitchDiameter } from '../core/doc/gear'
import { PARTS, type PartType, type PartValue, type PartValues, clampPart, isPart, partInfo } from '../core/doc/parts'
import { knownRobot, localText, robotSpec } from '../core/robotics/robot'
import { robotModels } from './mods'
import { DEFAULT_LIGHT } from '../core/robotics/world'
import { readingText } from './RoboticsPanel'
import { MODULE_COLORS } from '../view/roboVisuals'
import { roboticsMode, sensorValues, simState } from '../core/robotics/state'
import { TILE_KINDS, TILE_SIZE } from '../core/robotics/tiles'
import { lenScale, unitName } from '../units'
import { massOf } from './sim'
import { setTransform, sizeToScale, updateNodes } from '../core/doc/ops'
import { PALETTE } from '../core/doc/shapes'
import { commit, doc, selectedNodes, selection } from '../core/doc/store'
import { geom } from '../core/geom/client'
import { type Key, lang, t } from '../i18n'
import { themeId } from '../themes'
import * as A from './actions'
import { NumberField } from './common'
import { Icon } from './icons'

const AX = ['X', 'Y', 'Z']

export function Inspector() {
  void lang.value
  void themeId.value // palette follows the theme
  void geom.revision.value
  const nodes = selectedNodes.value
  if (nodes.length === 0) return null
  const single = nodes.length === 1 ? nodes[0] : null
  const allHole = nodes.every((n) => n.isHole)
  const anySolid = nodes.some((n) => !n.isHole)
  const color = nodes.find((n) => !n.isHole)?.color ?? nodes[0].color
  const robo = nodes.some(isRoboNode)
  const models = nodes.filter((n) => !isRoboNode(n))
  const looks = new Set(nodes.filter((n) => !n.isHole).map((n) => n.material ?? 'normal'))
  const material = looks.size === 1 ? [...looks][0] : null
  const modLook = nodes.every((n) => n.kind === 'prim' && !!propSpec(n.params.prop))

  return (
    <div class="inspector" data-testid="inspector" onPointerDown={(e) => e.stopPropagation()}>
      <div class="insp-head">
        {single ? (
          <input
            key={single.id}
            class="name-input"
            value={single.name}
            aria-label={t('insp.name')}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value.trim()
              if (v && v !== single.name) commit(updateNodes(doc.value, [single.id], (n) => ({ ...n, name: v })))
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
        ) : (
          <div class="insp-title">{t('insp.selected', { n: nodes.length })}</div>
        )}
        <button class="icon-btn" title={t('insp.close')} onClick={() => (selection.value = [])}>
          <Icon.close size={16} />
        </button>
      </div>

      {robo ? (
        <RoboFields nodes={nodes} />
      ) : (
      <>
      {/* a piece of a mod is shown with the mod's own colours: nothing to paint */}
      {!modLook && (
      <>
      <div class="solid-hole">
        <button
          class={`sh-btn ${anySolid && !allHole ? 'on' : ''}`}
          onClick={() => A.setSelectedHole(false)}
          data-testid="insp-solid"
          title={`${t('insp.solid')} (S)`}
        >
          <span class="swatch" style={{ background: color }} />
          {t('insp.solid')}
        </button>
        <button
          class={`sh-btn ${allHole ? 'on' : ''}`}
          onClick={() => A.setSelectedHole(true)}
          data-testid="insp-hole"
          title={`${t('insp.hole')} (H)`}
        >
          <span class="swatch hole" />
          {t('insp.hole')}
        </button>
      </div>

      {!allHole && (
        <div class="palette">
          {PALETTE.map((c) => (
            <button
              class={`pal ${c === color ? 'on' : ''}`}
              style={{ background: c }}
              title={c}
              onClick={() => A.setSelectedColor(c)}
            />
          ))}
          <label class="pal custom" title={t('insp.customColor')}>
            <input
              type="color"
              value={color}
              onChange={(e) => A.setSelectedColor((e.currentTarget as HTMLInputElement).value)}
            />
            +
          </label>
        </div>
      )}

      {!allHole && (
        <div class="mat-row" title={t('mat.tip')}>
          <span class="mat-label">{t('insp.material')}</span>
          <div class="seg small">
            {MATERIALS.map((m) => (
              <button
                class={material === m ? 'on' : ''}
                onClick={() => A.setSelectedMaterial(m)}
                data-testid={`mat-${m}`}
              >
                {t(`mat.${m}` as Key)}
              </button>
            ))}
          </div>
        </div>
      )}

      </>
      )}
      {single && (
        <TransformFields
          key={single.id}
          node={single}
          box={A.viewport()?.sync.objects.get(single.id)?.box ?? null}
        />
      )}
      {single && single.kind === 'prim' && (
        <ParamFields key={single.id} node={single} meshError={!!geom.peek(single)?.error} />
      )}

      {roboticsMode.value && <MassField nodes={models} />}
      </>
      )}

      {nodes.length > 1 && !robo && (
        <button class="wide-btn" onClick={A.group} data-testid="insp-group">
          <Icon.group size={18} /> {t('tb.group')}
        </button>
      )}
      {single?.kind === 'group' && (
        <button class="wide-btn" onClick={A.ungroup} data-testid="insp-ungroup">
          <Icon.ungroup size={18} /> {t('tb.ungroup')}
        </button>
      )}
    </div>
  )
}

/** `box` is the node's unscaled geometry box; passed as a prop so the fields refresh when it arrives. */
function TransformFields({ node, box }: { node: DocNode; box: Box | null }) {
  const tr = node.transform
  const size: Vec3 | null = box
    ? [0, 1, 2].map((k) => Math.abs((box.max[k] - box.min[k]) * tr.scale[k])) as Vec3
    : null

  const setPos = (k: number, v: number) => {
    const p = [...tr.position] as Vec3
    p[k] = cleanNum(v)
    commit(setTransform(doc.value, node.id, { ...tr, position: p }))
  }
  const setRot = (k: number, v: number) => {
    const r = [...tr.rotation] as Vec3
    r[k] = cleanNum(((((v + 180) % 360) + 360) % 360) - 180)
    commit(setTransform(doc.value, node.id, { ...tr, rotation: r }))
  }
  // a part's size comes from its settings: stretching it would spoil its thread and fits
  const fixedSize = node.kind === 'prim' && isPart(node.prim) && tr.scale.every((s) => Math.abs(Math.abs(s) - 1) < 1e-9)
  const setSize = (k: number, v: number) => {
    if (!box || !size) return
    const s = [...size] as Vec3
    s[k] = v
    commit(setTransform(doc.value, node.id, { ...tr, scale: sizeToScale(box, s, tr.scale) }))
  }

  return (
    <div class="fields">
      <div class="field-row-title">{t('insp.sizeU', { u: unitName() })}</div>
      <div class="field-row">
        {[t('insp.w'), t('insp.d'), t('insp.h')].map((l, k) => (
          <NumberField
            label={l}
            value={size ? size[k] : 0}
            min={0.01}
            step={1}
            scale={lenScale()}
            onCommit={(v) => setSize(k, v)}
            testId={`size-${k}`}
            disabled={fixedSize}
            title={fixedSize ? t('insp.sizeByParams') : undefined}
          />
        ))}
      </div>
      <div class="field-row-title">{t('insp.positionU', { u: unitName() })}</div>
      <div class="field-row">
        {AX.map((l, k) => (
          <NumberField label={l} value={tr.position[k]} step={1} scale={lenScale()} onCommit={(v) => setPos(k, v)} testId={`pos-${k}`} />
        ))}
      </div>
      <div class="field-row-title">{t('insp.rotation')}</div>
      <div class="field-row">
        {AX.map((l, k) => (
          <NumberField
            label={l}
            value={tr.rotation[k]}
            step={15}
            digits={1}
            onCommit={(v) => setRot(k, v)}
            testId={`rot-${k}`}
          />
        ))}
      </div>
    </div>
  )
}

function ParamFields({ node, meshError }: { node: PrimNode; meshError: boolean }) {
  const p = node.params
  const set = (patch: Partial<PrimNode['params']>) =>
    commit(
      updateNodes(doc.value, [node.id], (n) =>
        n.kind === 'prim' ? { ...n, params: { ...n.params, ...patch } } : n
      )
    )
  const hasSeg = ['cylinder', 'cone', 'sphere', 'torus', 'hemisphere', 'roundRoof', 'polygon'].includes(node.prim)
  const sides = node.prim === 'polygon'
  if (node.prim === 'sketch')
    return (
      <div class="fields">
        <button class="btn wide" onClick={() => A.editSketch(node.id)} data-testid="edit-sketch">
          <Icon.sketch size={16} /> {t('insp.editSketch')}
        </button>
      </div>
    )
  if (node.prim === 'gear') {
    const g = clampGear(p.gear ?? {})
    const setGear = (k: keyof GearParams, v: number) => set({ gear: clampGear({ ...g, [k]: v }) })
    return (
      <div class="fields" data-testid="gear-fields">
        <div class="field-row-title">{t('gear.params')}</div>
        <div class="field-row two">
          <NumberField label={t('gear.teeth')} value={g.teeth} min={6} max={80} step={1} digits={0} onCommit={(v) => setGear('teeth', v)} testId="gear-teeth" />
          <span title={t('gear.moduleTip')}>
            <NumberField label={t('gear.module')} value={g.module} min={0.3} max={10} step={0.5} onCommit={(v) => setGear('module', v)} testId="gear-module" />
          </span>
        </div>
        <div class="field-row two">
          <NumberField label={t('gear.thickness')} value={g.thickness} min={0.5} max={200} step={1} onCommit={(v) => setGear('thickness', v)} testId="gear-thickness" />
          <NumberField label={t('gear.bore')} value={g.bore} min={0} max={500} step={0.5} onCommit={(v) => setGear('bore', v)} testId="gear-bore" />
        </div>
        <p class="insp-note" data-testid="gear-info">
          {t('gear.info', { d: fmtNum(pitchDiameter(g)), o: fmtNum(outerDiameter(g)) })}
        </p>
      </div>
    )
  }
  if (isPart(node.prim)) return <PartFields node={node} type={node.prim} set={(part) => set({ part })} />
  if (!hasSeg && node.prim !== 'text' && node.prim !== 'mesh') return null
  return (
    <div class="fields">
      {node.prim === 'text' && (
        <>
          <div class="field-row-title">{t('insp.text')}</div>
          <input
            class="text-input"
            value={p.text ?? ''}
            data-testid="param-text"
            onChange={(e) => set({ text: (e.currentTarget as HTMLInputElement).value })}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
        </>
      )}
      {hasSeg && (
        <div class="field-row two">
          <NumberField
            label={t(sides ? 'insp.sides' : 'insp.segments')}
            value={p.segments ?? (node.prim === 'torus' ? 48 : sides ? 6 : 32)}
            min={3}
            max={sides ? 24 : 128}
            step={1}
            digits={0}
            onCommit={(v) => set({ segments: Math.round(v) })}
            testId={sides ? 'param-sides' : 'param-segments'}
          />
          {node.prim === 'torus' && (
            <NumberField
              label={t('insp.tube')}
              value={p.tube ?? 3}
              min={0.5}
              max={9.5}
              step={0.5}
              onCommit={(v) => set({ tube: v })}
            />
          )}
        </div>
      )}
      {node.prim === 'mesh' && meshError && <p class="warn">{t('insp.notManifold')}</p>}
    </div>
  )
}

/** Tiles and robots: where they stand and which way they face; robots also list their sensors. */
function RoboFields({ nodes }: { nodes: DocNode[] }) {
  const single = nodes.length === 1 ? nodes[0] : null
  if (!single) return <p class="insp-note">{t('robo.inspMany')}</p>
  const tr = single.transform
  const setPos = (k: number, v: number) => {
    let p = [...tr.position] as Vec3
    p[k] = cleanNum(v)
    const t = single.kind === 'prim' ? single.params.terrain : undefined
    // a terrain piece stays on the tile grid; things moved across the field stay on its terrain
    if (t && k < 2) p = [...snapTerrain(p[0], p[1], (tr.rotation[2] * Math.PI) / 180, t.kind === 'ramp' ? (t.length ?? 2) : 1), p[2]]
    const before = doc.value
    const next = setTransform(before, single.id, { ...tr, position: p })
    // (a platform keeps its tier: on the surface there nearest to the height it had)
    commit(k < 2 ? standOnTerrain(next, [single.id], before) : next)
  }
  const setAngle = (v: number) =>
    commit(setTransform(doc.value, single.id, { ...tr, rotation: [0, 0, cleanNum(((((v + 180) % 360) + 360) % 360) - 180)] }))
  const robot = single.kind === 'prim' && single.prim === 'robot' ? single : null
  const lamp = single.kind === 'prim' && single.prim === 'light' && single.params.light ? single : null
  const seal = single.kind === 'prim' && single.prim === 'nerpa' ? single : null
  const piece = single.kind === 'prim' && single.prim === 'terrain' && single.params.terrain ? single : null
  // a platform, ramp or bridge can have any colour (landscape tiles are coloured by what they are)
  const relief = piece && !isLand(piece.params.terrain!.kind) ? piece : null
  const tile = single.kind === 'prim' && single.prim === 'tile' ? single : null
  const decor = single.kind === 'prim' && single.prim === 'decor'
  const turns = !!robot || !!seal || decor || lamp?.params.light?.kind === 'spot'
  // a tile over a bridge can lie on the deck or on the floor under it
  const levels = tile ? surfacesAt(terrainOf(doc.value), tr.position[0], tr.position[1]) : []
  const values = robot ? (sensorValues.value[robot.id] ?? {}) : {}
  return (
    <div class="fields">
      <div class="field-row-title">{t('insp.positionU', { u: unitName() })}</div>
      <div class="field-row">
        {['X', 'Y'].map((l, k) => (
          <NumberField
            label={l}
            value={tr.position[k]}
            step={robot || lamp || seal || decor ? 1 : TILE_SIZE / lenScale()}
            scale={lenScale()}
            onCommit={(v) => setPos(k, v)}
            testId={`pos-${k}`}
          />
        ))}
        {(turns || tile || piece) && (
          <NumberField
            label="∠"
            value={tr.rotation[2]}
            step={turns ? 15 : 90}
            digits={1}
            onCommit={(v) => (piece ? A.turnTerrain(piece.id, v) : setAngle(v))}
            testId="rot-2"
          />
        )}
      </div>
      {(lamp || seal || relief) && (
        <div class="palette" data-testid="robo-palette">
          {PALETTE.map((c) => (
            <button class={`pal ${c === single.color ? 'on' : ''}`} style={{ background: c }} title={c} onClick={() => A.setSelectedColor(c)} />
          ))}
          <label class="pal custom" title={t('insp.customColor')}>
            <input type="color" value={single.color} onChange={(e) => A.setSelectedColor((e.currentTarget as HTMLInputElement).value)} />+
          </label>
        </div>
      )}
      {lamp && <LampFields id={lamp.id} z={tr.position[2]} params={{ ...DEFAULT_LIGHT, ...lamp.params.light! }} />}
      {piece && <TerrainFields id={piece.id} params={piece.params.terrain!} />}
      {tile && levels.length > 1 && (
        <>
          <div class="field-row-title">{t('robo.tileLevel')}</div>
          <div class="seg small" data-testid="tile-level">
            {[levels[0], levels[levels.length - 1]].map((l, i) => (
              <button
                class={Math.abs(nearestLevel(levels, tr.position[2]) - l.z) < 1 ? 'on' : ''}
                onClick={() => setPos(2, l.z)}
                data-testid={i === 0 ? 'tile-level-low' : 'tile-level-high'}
              >
                {t(i === 0 ? (l.piece ? 'robo.tileLevelLow' : 'robo.tileLevelFloor') : 'robo.tileLevelTop')}
              </button>
            ))}
          </div>
        </>
      )}
      {seal && (
        <p class="insp-note">
          {t(
            { seal: 'robo.nerpaNote', cheetah: 'robo.cheetahNote', pigeon: 'robo.pigeonNote' }[speciesOf(seal.params.nerpa?.species)] as Key
          )}
        </p>
      )}
      {robot && robot.params.robot && (
        <>
          <RobotModelField id={robot.id} model={robot.params.robot.model} />
          <div class="field-row-title">{t('robo.sensors')}</div>
          {robot.params.robot.sensors.length === 0 && <p class="insp-note">{t('robo.noSensors')}</p>}
          {robot.params.robot.sensors.map((s) => (
            <div class="sensor-row" data-testid={`insp-sensor-${s.port}`}>
              <span class="port-badge" style={{ background: MODULE_COLORS[s.type], color: '#fff' }}>
                {s.port}
              </span>
              <span class="sensor-name">{t(`robo.sensor.${s.type}` as Key)}</span>
              <span class="sensor-val">{readingText(s.type, values[s.port])}</span>
              <button class="icon-btn" title={t('robo.removeSensor')} onClick={() => A.detachSensor(robot.id, s.port)}>
                <Icon.close size={14} />
              </button>
            </div>
          ))}
          <p class="insp-note">{t('robo.padsHint', { n: robotSpec(robot.params.robot.model).pads.length })}</p>
        </>
      )}
    </div>
  )
}

/**
 * Which robot it is (shown when there is a choice: mods with robots are installed, or the
 * project's robot comes from a mod that is not installed here).
 */
function RobotModelField({ id, model }: { id: string; model: string }) {
  const known = knownRobot(model)
  if (robotModels.value.length < 2 && known) return null
  return (
    <>
      <div class="field-row-title">{t('robo.robotModel')}</div>
      <select
        class="robot-model"
        data-testid="robot-model"
        value={model}
        disabled={simState.value !== 'idle'}
        onChange={(e) => A.setRobotModel(id, (e.currentTarget as HTMLSelectElement).value)}
      >
        {!known && <option value={model}>{t('mods.notInstalledOption', { id: model })}</option>}
        {robotModels.value.map((r) => (
          <option value={r.id}>{localText(r.name, lang.value) || r.id}</option>
        ))}
      </select>
      {!known && (
        <p class="insp-note" data-testid="robot-model-missing">
          {t('mods.notInstalled', { id: model })}
        </p>
      )}
    </>
  )
}

/** A lamp: its kind, whether it is on at the start, brightness, beam and height. */
function LampFields({ id, z, params }: { id: string; z: number; params: NonNullable<PrimNode['params']['light']> }) {
  return (
    <div class="fields" data-testid="lamp-fields">
      <div class="mat-row">
        <span class="mat-label">{t('robo.lampKind')}</span>
        <div class="seg small">
          {(['spot', 'point'] as const).map((k) => (
            <button class={params.kind === k ? 'on' : ''} onClick={() => A.setLight(id, { kind: k })} data-testid={`lamp-kind-${k}`}>
              {t(k === 'spot' ? 'robo.spotLamp' : 'robo.pointLamp')}
            </button>
          ))}
        </div>
      </div>
      <label class="check-row">
        <input type="checkbox" checked={params.on} onChange={(e) => A.setLight(id, { on: (e.currentTarget as HTMLInputElement).checked })} data-testid="lamp-on" />
        {t('robo.lampOn')}
      </label>
      <div class="lamp-grid">
        <span>{t('robo.brightness')}</span>
        <NumberField value={params.brightness} step={10} digits={0} min={0} max={100} onCommit={(v) => A.setLight(id, { brightness: v })} testId="lamp-brightness" />
        <span>{t('robo.height', { u: unitName() })}</span>
        <NumberField value={z} step={10} min={0} scale={lenScale()} onCommit={(v) => A.setHeight(id, v)} testId="lamp-height" />
        {params.kind === 'spot' && (
          <>
            <span>{t('robo.coneAngle')}</span>
            <NumberField value={params.angle} step={5} digits={0} min={10} max={170} onCommit={(v) => A.setLight(id, { angle: v })} testId="lamp-angle" />
            <span>{t('robo.tilt')}</span>
            <NumberField value={params.tilt} step={5} digits={0} min={0} max={90} onCommit={(v) => A.setLight(id, { tilt: v })} testId="lamp-tilt" />
          </>
        )}
      </div>
      <p class="insp-note">{t('robo.lampNote')}</p>
    </div>
  )
}

/** Weight for the physics: empty = from the volume (PLA plastic). */
function MassField({ nodes }: { nodes: DocNode[] }) {
  if (nodes.length === 0) return null
  const single = nodes.length === 1 ? nodes[0] : null
  const res = single ? geom.peek(single) : null
  const auto = single && res ? massOf({ ...single, mass: undefined }, res.volume) : null
  const value = single?.mass ?? auto
  // models brought from the 3D tab can be made static: part of the field, not a thing to push
  const meshes = nodes.every((n) => n.kind === 'prim' && n.prim === 'mesh')
  const fixed = meshes && nodes.every((n) => n.fixed)
  const staticRow = meshes && (
    <label class="check-row" title={t('robo.staticTip')}>
      <input
        type="checkbox"
        checked={fixed}
        onChange={(e) => A.setFixed(nodes.map((n) => n.id), (e.currentTarget as HTMLInputElement).checked)}
        data-testid="shape-static"
      />
      {t('robo.static')}
    </label>
  )
  if (fixed) return <div class="fields">{staticRow}</div>
  return (
    <div class="fields">
      {staticRow}
      <div class="field-row-title">{t('robo.mass')}</div>
      <div class="field-row two">
        {single ? (
          <NumberField
            label={t('unit.g')}
            value={value ?? 0}
            min={0.1}
            max={1e6}
            step={5}
            digits={1}
            onCommit={(v) => A.setMass([single.id], v)}
            testId="mass"
          />
        ) : (
          <NumberField label={t('unit.g')} value={nodes[0].mass ?? 0} min={0.1} step={5} digits={1} onCommit={(v) => A.setMass(nodes.map((n) => n.id), v)} testId="mass" />
        )}
        <button
          class={`btn small ${nodes.every((n) => n.mass === undefined) ? 'on' : ''}`}
          title={t('robo.massAutoTip')}
          onClick={() => A.setMass(nodes.map((n) => n.id), undefined)}
          data-testid="mass-auto"
        >
          {t('robo.massAuto')}
        </button>
      </div>
    </div>
  )
}

const fmtNum = (v: number) => String(Math.round(v * 100) / 100)

const nearestLevel = (levels: { z: number }[], z: number) => levels.reduce((b, l) => (Math.abs(l.z - z) < Math.abs(b - z) ? l.z : b), levels[0].z)

/** The fields of a parametric part, from its description in doc/parts.ts. */
function PartFields({ node, type, set }: { node: PrimNode; type: PartType; set: (v: PartValues) => void }) {
  const v = clampPart(type, node.params.part)
  const put = (k: string, x: PartValue) => set(clampPart(type, { ...v, [k]: x }))
  const label = (k: string) => t(`part.${type}.${k}` as Key)
  const fields = Object.entries(PARTS[type].fields)
  const nums = fields.filter(([, f]) => f.kind === 'num')
  const info = partInfo(type, v)
  return (
    <div class="fields" data-testid="part-fields">
      <div class="field-row-title">{t('part.params')}</div>
      {fields.map(([k, f]) =>
        f.kind === 'choice' ? (
          <div class="part-choice" key={k}>
            <span class="part-label">{label(k)}</span>
            <div class="seg small" data-testid={`part-${k}`}>
              {f.options.map((o) => (
                <button class={v[k] === o ? 'on' : ''} onClick={() => put(k, o)} data-testid={`part-${k}-${o}`}>
                  {k === 'size' ? o : t(`part.${type}.${k}.${o}` as Key)}
                </button>
              ))}
            </div>
          </div>
        ) : f.kind === 'bool' ? (
          <label class="part-bool" key={k}>
            <input type="checkbox" checked={v[k] as boolean} onChange={(e) => put(k, (e.currentTarget as HTMLInputElement).checked)} data-testid={`part-${k}`} />
            {label(k)}
          </label>
        ) : f.kind === 'text' ? (
          <div key={k}>
            <div class="field-row-title">{label(k)}</div>
            <input
              class="text-input"
              value={v[k] as string}
              maxLength={f.max}
              data-testid={`part-${k}`}
              onChange={(e) => put(k, (e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            />
          </div>
        ) : null
      )}
      {nums.length > 0 && (
        <div class="field-row two part-nums">
          {nums.map(([k, f]) =>
            f.kind === 'num' ? (
              <NumberField
                key={k}
                label={label(k)}
                value={v[k] as number}
                min={f.min}
                max={f.max}
                step={f.step}
                digits={f.digits ?? 1}
                onCommit={(x) => put(k, x)}
                testId={`part-${k}`}
              />
            ) : null
          )}
        </div>
      )}
      {info && (
        <p class="insp-note" data-testid="part-info">
          {t(info.key as Key, info.vars)}
        </p>
      )}
    </div>
  )
}

const linePics = new Map<string, string>()
/** A road with this line (or none), small, for the line buttons. */
function roadPicture(line: TileKind | null): string {
  const key = line ?? 'none'
  let url = linePics.get(key)
  if (!url) {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    drawLand(c.getContext('2d')!, 64, 'road', { line })
    url = c.toDataURL()
    linePics.set(key, url)
  }
  return url
}

/** A landscape tile: what it is (the four tops or water) and the line on a road. */
function LandFields({ id, params }: { id: string; params: TerrainParams }) {
  const kind = landKindOf(params) ?? 'grass'
  return (
    <>
      <div class="field-row-title">{t('robo.landSurface')}</div>
      <div class="seg small land-kinds" data-testid="land-surface">
        {LAND_KINDS.map((k) => (
          <button class={kind === k ? 'on' : ''} onClick={() => A.setLand(id, k)} data-testid={`land-surface-${k}`} title={t(`robo.land.${k}` as Key)}>
            <span class="land-swatch" style={{ background: LAND_COLOR[k] }} />
            {t(`robo.land.${k}` as Key)}
          </button>
        ))}
      </div>
      {kind === 'road' && (
        <>
          <div class="field-row-title">{t('robo.landLine')}</div>
          <div class="line-pics" data-testid="land-line">
            {[null, ...TILE_KINDS].map((l) => (
              <button
                class={(params.line ?? null) === l ? 'on' : ''}
                onClick={() => A.setTerrain(id, { line: l ?? 'none' })}
                title={l ? t(`robo.tile.${l}` as Key) : t('robo.lineNone')}
                data-testid={`land-line-${l ?? 'none'}`}
              >
                <img src={roadPicture(l)} alt="" draggable={false} />
              </button>
            ))}
          </div>
        </>
      )}
      <p class="insp-note">{t(`robo.terrainNote.${params.kind}` as Key)}</p>
    </>
  )
}

/** A platform, ramp or bridge: its height and (a ramp) its length in tiles. */
function TerrainFields({ id, params }: { id: string; params: TerrainParams }) {
  if (isLand(params.kind)) return <LandFields id={id} params={params} />
  return (
    <>
      <div class="field-row two">
        <NumberField
          label={t('robo.terrainHeight')}
          value={params.height}
          min={TERRAIN_MIN_HEIGHT}
          max={TERRAIN_MAX_HEIGHT}
          step={10}
          digits={1}
          scale={lenScale()}
          onCommit={(v) => A.setTerrain(id, { height: v })}
          testId="terrain-height"
        />
      </div>
      {params.kind === 'ramp' && (
        <>
          <div class="field-row-title">{t('robo.rampLength')}</div>
          <div class="seg small" data-testid="ramp-length">
            {[1, 2].map((l) => (
              <button class={(params.length ?? 2) === l ? 'on' : ''} onClick={() => A.setTerrain(id, { length: l })} data-testid={`ramp-length-${l}`}>
                {t(l === 1 ? 'robo.rampOne' : 'robo.rampTwo')}
              </button>
            ))}
          </div>
        </>
      )}
      <p class="insp-note">{t(`robo.terrainNote.${params.kind}` as Key)}</p>
    </>
  )
}
