/** Right panel of the Robotics tab: track tiles, the robot, sensors, run controls and readings. */
import { useMemo } from 'preact/hooks'
import { signal } from '@preact/signals'
import { type DecorKind, type LightParams, type PrimType, SENSOR_TYPES, SPECIES, type Species, type SensorType, type TerrainKind, type TileKind } from '../core/doc/model'
import { LAMP_HEIGHT, lampNode, nerpaNode, robotNode, terrainNode, tileNode } from '../core/robotics/demo'
import { DEFAULT_TERRAIN, LAND_KINDS, type LandKind, RELIEF_KINDS, landParams, snapTerrain } from '../core/robotics/terrain'
import { drawLand } from '../view/landVisuals'
import { DECOR_KINDS } from '../core/robotics/decor'
import { DEFAULT_ROBOT, SONAR_MAX_CM, localText, robotSpec } from '../core/robotics/robot'
import { robotModels } from './mods'
import { followId, landBrush, prettyCap, programActor, programRobot, recording, sensorKind, sensorValues, simSpeed, simState, simTime, simVolume } from '../core/robotics/state'
import { QUALITIES, TIMES, lowerQuality, normView } from '../core/robotics/look'
import { MODULE_COLORS } from '../view/roboVisuals'
import { TILE_KINDS, drawTile } from '../core/robotics/tiles'
import { doc } from '../core/doc/store'
import { type Key, lang, t } from '../i18n'
import * as A from './actions'
import { Icon, ShapeIcon } from './icons'
import { pauseSim, startSim, stopSim } from './sim'

const SPEEDS = [0.5, 1, 2, 4]

function tilePicture(kind: TileKind): string {
  const c = document.createElement('canvas')
  c.width = c.height = 96
  drawTile(c.getContext('2d')!, kind, 96)
  return c.toDataURL()
}

function dragTile(kind: TileKind, e: PointerEvent): void {
  const vp = A.viewport()
  if (e.button !== 0 || !vp || simState.peek() !== 'idle') return
  e.preventDefault()
  const node = tileNode({ kind, x: 0, y: 0, angle: 0 }, '')
  vp.beginShapeDrag(
    node,
    e,
    (r) => {
      if (r.kind === 'click') A.addTile(kind)
      else if (r.kind === 'drop') A.addTile(kind, [r.pos.position[0], r.pos.position[1]])
    },
    (p) => ({ ...p, position: [A.snapCell(p.position[0]), A.snapCell(p.position[1]), 0], rotation: [0, 0, 0] })
  )
}

function landPicture(kind: LandKind): string {
  const c = document.createElement('canvas')
  c.width = c.height = 96
  drawLand(c.getContext('2d')!, 96, kind)
  return c.toDataURL()
}

function dragLand(kind: LandKind, e: PointerEvent): void {
  const vp = A.viewport()
  if (e.button !== 0 || !vp || simState.peek() !== 'idle') return
  e.preventDefault()
  const p = landParams(kind)
  vp.beginShapeDrag(
    terrainNode(p.kind, 0, 0, 0, '', p),
    e,
    (r) => {
      if (r.kind === 'click') A.addLand(kind)
      else if (r.kind === 'drop') A.addLand(kind, [r.pos.position[0], r.pos.position[1]])
    },
    (q) => {
      const [x, y] = snapTerrain(q.position[0], q.position[1], 0, 1)
      return { ...q, position: [x, y, 0], rotation: [0, 0, 0] }
    }
  )
}

/** which kind of field pieces the panel shows: landscape tiles, relief or scenery */
const fieldTab = signal<'land' | 'relief' | 'decor'>('land')

/** the beautiful view's settings are open under its switch */
const prettyOpen = signal(true)

/** «Beautiful view»: the switch and, under it, the time of day, sun, shadows, glow and quality. */
function PrettySection() {
  const v = normView(doc.value.view)
  const cap = prettyCap.value
  const shown = cap ? lowerQuality(v.quality, cap) : v.quality
  return (
    <div class="pretty" data-testid="pretty">
      <div class="pretty-head">
        <label class="pretty-switch" title={t('pretty.hint')}>
          <input type="checkbox" checked={v.on} onChange={(e) => A.setView({ on: (e.currentTarget as HTMLInputElement).checked })} data-testid="pretty-on" />
          <span>{t('pretty.title')}</span>
        </label>
        {v.on && (
          <button class={`pretty-more ${prettyOpen.value ? 'open' : ''}`} onClick={() => (prettyOpen.value = !prettyOpen.value)} title={t('pretty.settings')} data-testid="pretty-more">
            <Icon.chevron size={14} />
          </button>
        )}
      </div>
      {v.on && prettyOpen.value && (
        <div class="pretty-settings">
          <div class="seg small pretty-seg" data-testid="pretty-time">
            {TIMES.map((k) => (
              <button class={v.time === k ? 'on' : ''} onClick={() => A.setView({ time: k })} data-testid={`pretty-time-${k}`}>
                {t(`pretty.t.${k}` as Key)}
              </button>
            ))}
          </div>
          <label class="pretty-row">
            <span>{t('pretty.sun')}</span>
            <input type="range" min={0} max={359} step={5} value={v.sun} onInput={(e) => A.setView({ sun: Number((e.currentTarget as HTMLInputElement).value) })} data-testid="pretty-sun" />
          </label>
          <label class="pretty-row">
            <span>{t('pretty.glow')}</span>
            <input type="range" min={0} max={100} step={5} value={v.glow} onInput={(e) => A.setView({ glow: Number((e.currentTarget as HTMLInputElement).value) })} data-testid="pretty-glow" />
          </label>
          <label class="pretty-row check">
            <input type="checkbox" checked={v.shadows} onChange={(e) => A.setView({ shadows: (e.currentTarget as HTMLInputElement).checked })} data-testid="pretty-shadows" />
            <span>{t('pretty.shadows')}</span>
          </label>
          <div class="pretty-row">
            <span>{t('pretty.quality')}</span>
          </div>
          <div class="seg small pretty-seg" data-testid="pretty-quality">
              {QUALITIES.map((q) => (
                <button class={v.quality === q ? 'on' : ''} onClick={() => A.setView({ quality: q })} data-testid={`pretty-q-${q}`}>
                  {t(`pretty.q.${q}` as Key)}
                </button>
              ))}
          </div>
          {cap && shown !== v.quality && <p class="panel-hint pretty-note">{t('pretty.capped', { q: t(`pretty.q.${shown}` as Key) })}</p>}
        </div>
      )}
    </div>
  )
}

/** the kind the brush paints when it is picked up again */
let brushKind: LandKind = 'grass'

/** Landscape tiles: lay one by dragging (or clicking), or paint many with the brush. */
function LandSection({ idle }: { idle: boolean }) {
  const pics = useMemo(() => Object.fromEntries(LAND_KINDS.map((k) => [k, landPicture(k)])), [])
  const brush = landBrush.value
  const pick = (k: LandKind, e: PointerEvent) => {
    if (!brush) return dragLand(k, e)
    brushKind = k
    landBrush.value = k
  }
  return (
    <>
      <div class="shape-grid three">
        {LAND_KINDS.map((k) => (
          <button
            class={`shape-tile small ${brush === k ? 'chosen' : ''}`}
            title={t(brush ? 'robo.landBrushHint' : 'robo.landHint')}
            data-testid={`land-${k}`}
            disabled={!idle}
            onPointerDown={(e) => pick(k, e as unknown as PointerEvent)}
          >
            <img class="tile-pic land-pic" src={pics[k]} alt="" draggable={false} />
            <span>{t(`robo.land.${k}` as Key)}</span>
          </button>
        ))}
      </div>
      <div class="seg small land-tools">
        <button
          class={brush && brush !== 'erase' ? 'on' : ''}
          disabled={!idle}
          title={t('robo.brushHint')}
          data-testid="land-brush"
          onClick={() => (landBrush.value = brush && brush !== 'erase' ? null : brushKind)}
        >
          <Icon.brush size={15} /> {t('robo.brush')}
        </button>
        <button
          class={brush === 'erase' ? 'on' : ''}
          disabled={!idle}
          title={t('robo.eraserHint')}
          data-testid="land-erase"
          onClick={() => (landBrush.value = brush === 'erase' ? null : 'erase')}
        >
          <Icon.eraser size={15} /> {t('robo.eraser')}
        </button>
      </div>
      {brush && <p class="panel-hint land-note">{t(brush === 'erase' ? 'robo.eraserNote' : 'robo.brushNote')}</p>}
    </>
  )
}

function dragDecor(kind: DecorKind, e: PointerEvent): void {
  const vp = A.viewport()
  if (e.button !== 0 || !vp || simState.peek() !== 'idle') return
  e.preventDefault()
  vp.beginShapeDrag(
    A.decorNode(kind),
    e,
    (r) => {
      if (r.kind === 'click') A.addDecor(kind)
      else if (r.kind === 'drop') A.addDecor(kind, [r.pos.position[0], r.pos.position[1]])
    },
    (p) => ({ ...p, position: [p.position[0], p.position[1], 0], rotation: [0, 0, 0] })
  )
}

/** Little pictures of the scenery. */
function DecorIcon({ kind }: { kind: DecorKind }) {
  const leaf = '#5aa83c'
  const dark = '#2f7a45'
  const bark = '#8a5a34'
  return (
    <svg width="40" height="34" viewBox="0 0 40 34">
      {kind === 'tree' && (
        <>
          <rect x="18" y="20" width="4" height="12" fill={bark} />
          <circle cx="20" cy="13" r="9" fill={leaf} />
          <circle cx="13" cy="17" r="6" fill="#4f9a33" />
          <circle cx="27" cy="16" r="6" fill="#6cb84a" />
        </>
      )}
      {kind === 'pine' && (
        <>
          <rect x="18" y="27" width="4" height="6" fill={bark} />
          <path d="M20 2 L28 13 L12 13 Z M20 8 L31 21 L9 21 Z M20 14 L33 28 L7 28 Z" fill={dark} />
        </>
      )}
      {kind === 'bush' && (
        <>
          <circle cx="14" cy="22" r="8" fill="#4a9136" />
          <circle cx="26" cy="22" r="8" fill={leaf} />
          <circle cx="20" cy="16" r="9" fill="#4f9a33" />
        </>
      )}
      {kind === 'rock' && (
        <>
          <path d="M6 30 L10 16 L20 10 L31 15 L35 30 Z" fill="#9a9c9f" />
          <path d="M20 10 L24 22 L35 30 L31 15 Z" fill="#7f8185" />
        </>
      )}
      {kind === 'flowers' && (
        <>
          <path d="M10 32 V18 M20 32 V12 M30 32 V20" stroke="#3f8a33" stroke-width="2" />
          <circle cx="10" cy="17" r="4" fill="#ff5a5f" />
          <circle cx="20" cy="11" r="4" fill="#ffd23f" />
          <circle cx="30" cy="19" r="4" fill="#b07cff" />
          <circle cx="10" cy="17" r="1.4" fill="#f2b134" />
          <circle cx="30" cy="19" r="1.4" fill="#f2b134" />
        </>
      )}
    </svg>
  )
}

/** The camera during runs: follow a robot or hero, a picture, a short video. */
function CameraRow() {
  const following = followId.value
  const followed = following ? doc.value.nodes.find((n) => n.id === following) : null
  const actor = programActor.value
  const canFollow = !!actor && (actor.kind === 'robot' || actor.kind === 'nerpa')
  const rec = recording.value
  return (
    <>
      <div class="sim-row camera-row">
        <button
          class={`btn small ${following ? 'on' : ''}`}
          disabled={!following && !canFollow}
          onClick={() => A.follow(following ? null : actor!.node.id)}
          title={t('robo.followTip')}
          data-testid="camera-follow"
        >
          <Icon.target size={14} />
          <span class="cam-label">{followed ? `${t('robo.follow')}: ${followed.name}` : t('robo.follow')}</span>
        </button>
      </div>
      <div class="sim-row camera-row">
        <button class="btn small" onClick={() => void A.takePicture()} title={t('robo.shotTip')} data-testid="camera-shot">
          <Icon.camera size={14} />
          <span class="cam-label">{t('robo.shot')}</span>
        </button>
        <button class={`btn small ${rec ? 'on rec' : ''}`} onClick={() => void A.recordVideo()} title={t('robo.videoTip')} data-testid="camera-video">
          <Icon.video size={14} />
          <span class="cam-label">{rec ? t('robo.videoStop') : t('robo.video')}</span>
        </button>
      </div>
    </>
  )
}

function dragTerrain(kind: TerrainKind, e: PointerEvent): void {
  const vp = A.viewport()
  if (e.button !== 0 || !vp || simState.peek() !== 'idle') return
  e.preventDefault()
  const node = terrainNode(kind, 0, 0, 0, '')
  const len = kind === 'ramp' ? (DEFAULT_TERRAIN.ramp.length ?? 2) : 1
  vp.beginShapeDrag(
    node,
    e,
    (r) => {
      if (r.kind === 'click') A.addTerrain(kind)
      else if (r.kind === 'drop') A.addTerrain(kind, [r.pos.position[0], r.pos.position[1]])
    },
    (p) => {
      const [x, y] = snapTerrain(p.position[0], p.position[1], 0, len)
      // the ghost already stands where the piece will be built: on the highest surface there
      return { ...p, position: [x, y, A.surfaceAt(x, y)], rotation: [0, 0, 0] }
    }
  )
}

/** Little pictures of the terrain pieces (seen from the front-right, a ramp rising to the back). */
function TerrainIcon({ kind }: { kind: TerrainKind }) {
  const face = { fill: 'var(--terrain-top, #d9dee5)', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-linejoin': 'round' as const }
  const side = { ...face, fill: 'var(--terrain-side, #9aa5b1)' }
  const line = { fill: 'none', stroke: '#111', 'stroke-width': 2.2 }
  return (
    <svg width="56" height="40" viewBox="0 0 56 40">
      {kind === 'platform' && (
        <>
          <path d="M8 16 L28 8 L48 16 L28 24 Z" {...face} />
          <path d="M8 16 L28 24 L28 36 L8 28 Z" {...side} />
          <path d="M28 24 L48 16 L48 28 L28 36 Z" {...side} />
          <path d="M18 12 L38 20" {...line} />
        </>
      )}
      {kind === 'ramp' && (
        <>
          <path d="M6 30 L26 38 L50 18 L30 10 Z" {...face} />
          <path d="M30 10 L50 18 L50 30 L30 22 Z" {...side} />
          <path d="M26 38 L50 18 L50 30 Z" {...side} />
          <path d="M16 34 L40 14" {...line} />
        </>
      )}
      {kind === 'bridge' && (
        <>
          <path d="M8 14 L28 6 L48 14 L28 22 Z" {...face} />
          <path d="M8 14 L28 22 L28 26 L8 18 Z" {...side} />
          <path d="M28 22 L48 14 L48 18 L28 26 Z" {...side} />
          <path d="M18 10 L38 18" {...line} />
          <path d="M10 36 L46 26" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="3 2" opacity="0.6" />
        </>
      )}
    </svg>
  )
}

function dragRobot(e: PointerEvent, model = DEFAULT_ROBOT): void {
  const vp = A.viewport()
  if (e.button !== 0 || !vp || simState.peek() !== 'idle') return
  e.preventDefault()
  const node = robotNode(0, 0, 0, '')
  node.params = { robot: { model, sensors: [] } }
  vp.beginShapeDrag(
    node,
    e,
    (r) => {
      if (r.kind === 'click') A.addRobot(undefined, 0, model)
      else if (r.kind === 'drop') A.addRobot([r.pos.position[0], r.pos.position[1]], 0, model)
    },
    (p) => ({ ...p, position: [p.position[0], p.position[1], 0], rotation: [0, 0, 0] })
  )
}

function dragObstacle(type: PrimType, e: PointerEvent): void {
  const vp = A.viewport()
  if (e.button !== 0 || !vp || simState.peek() !== 'idle') return
  e.preventDefault()
  vp.beginShapeDrag(A.obstacleNode(type), e, (r) => {
    if (r.kind === 'click') A.addObstacle(type)
    else if (r.kind === 'drop') A.addObstacle(type, [r.pos.position[0], r.pos.position[1]])
  })
}

function dragSensor(type: SensorType, e: PointerEvent): void {
  const vp = A.viewport()
  if (e.button !== 0 || !vp || simState.peek() !== 'idle') return
  e.preventDefault()
  sensorKind.value = type
  vp.beginSensorDrag(
    e,
    (hit) => {
      if (hit === 'click') addSensorToRobot(type)
      else if (hit) A.attachSensor(hit.id, hit.port, type)
    },
    type
  )
}

/** Click on a device card: put it on the first free pad of the shown robot. */
function addSensorToRobot(type: SensorType): void {
  sensorKind.value = type
  const r = programRobot.peek()
  if (!r || !r.params.robot) return A.notify(t('robo.addRobotFirst'), 'error')
  const used = new Set(r.params.robot.sensors.map((s) => s.port))
  const pad = robotSpec(r.params.robot.model).pads.find((p) => !used.has(p.port))
  if (!pad) return A.notify(t('robo.padsFull'), 'error')
  A.attachSensor(r.id, pad.port, type)
}

function dragLamp(kind: LightParams['kind'], e: PointerEvent): void {
  const vp = A.viewport()
  if (e.button !== 0 || !vp || simState.peek() !== 'idle') return
  e.preventDefault()
  vp.beginShapeDrag(
    lampNode(kind, 0, 0, ''),
    e,
    (r) => {
      if (r.kind === 'click') A.addLight(kind)
      else if (r.kind === 'drop') A.addLight(kind, [r.pos.position[0], r.pos.position[1]])
    },
    (p) => ({ ...p, position: [p.position[0], p.position[1], LAMP_HEIGHT[kind]], rotation: [0, 0, 0] })
  )
}

function dragNerpa(e: PointerEvent, species: Species = 'seal'): void {
  const vp = A.viewport()
  if (e.button !== 0 || !vp || simState.peek() !== 'idle') return
  e.preventDefault()
  vp.beginShapeDrag(
    nerpaNode(0, 0, 0, '', undefined, species),
    e,
    (r) => {
      if (r.kind === 'click') A.addNerpa(undefined, species)
      else if (r.kind === 'drop') A.addNerpa([r.pos.position[0], r.pos.position[1]], species)
    },
    (p) => ({ ...p, position: [p.position[0], p.position[1], 0], rotation: [0, 0, 0] })
  )
}

/** How a device's reading reads: a number with its unit, yes/no, on/off. */
export function readingText(type: SensorType, v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—'
  if (type === 'ultrasonic') return `${v} ${t('unit.cm')}`
  if (type === 'touch') return v >= 1 ? t('robo.yes') : t('robo.no')
  if (type === 'flashlight') return v > 0 ? `${t('robo.flashOn')} ${v}%` : t('robo.flashOff')
  return String(v)
}

/** How full a device's reading bar is, 0…100 %. */
export function readingBar(type: SensorType, v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return 0
  if (type === 'ultrasonic') return Math.max(0, Math.min(100, (v / SONAR_MAX_CM) * 100))
  if (type === 'touch') return v >= 1 ? 100 : 0
  return Math.max(0, Math.min(100, v))
}

export function RoboticsPanel() {
  void lang.value
  const pictures = useMemo(() => Object.fromEntries(TILE_KINDS.map((k) => [k, tilePicture(k)])), [])
  const state = simState.value
  const idle = state === 'idle'
  const robot = programRobot.value
  const tab = fieldTab.value
  return (
    <aside class="shapes-panel robo-panel" data-testid="robo-panel">
      <div class="panel-title">{t('robo.track')}</div>
      <div class="shape-grid">
        {TILE_KINDS.map((k) => (
          <button
            class="shape-tile"
            title={t('robo.tileHint')}
            data-testid={`tile-${k}`}
            disabled={!idle}
            onPointerDown={(e) => dragTile(k, e as unknown as PointerEvent)}
          >
            <img class="tile-pic" src={pictures[k]} alt="" draggable={false} />
            <span>{t(`robo.tile.${k}` as Key)}</span>
          </button>
        ))}
      </div>

      <div class="panel-title">{t('robo.fieldSection')}</div>
      <div class="panel-tabs field-tabs" role="tablist">
        {(['land', 'relief', 'decor'] as const).map((id) => (
          <button
            role="tab"
            aria-selected={tab === id}
            class={tab === id ? 'on' : ''}
            onClick={() => {
              fieldTab.value = id
              if (id !== 'land') landBrush.value = null
            }}
            data-testid={`field-tab-${id}`}
          >
            {t(id === 'land' ? 'robo.landscape' : id === 'relief' ? 'robo.reliefTab' : 'robo.decorSection')}
          </button>
        ))}
      </div>
      {tab === 'land' && <LandSection idle={idle} />}
      {tab === 'relief' && (
        <>
          <div class="shape-grid">
            {RELIEF_KINDS.map((k) => (
              <button
                class="shape-tile"
                title={t(`robo.terrainHint.${k}` as Key)}
                data-testid={`terrain-${k}`}
                disabled={!idle}
                onPointerDown={(e) => dragTerrain(k, e as unknown as PointerEvent)}
              >
                <TerrainIcon kind={k} />
                <span>{t(`robo.terrain.${k}` as Key)}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {tab === 'decor' && (
        <>
          <div class="shape-grid three">
            {DECOR_KINDS.map((k) => (
              <button
                class="shape-tile small"
                title={t('robo.decorHint')}
                data-testid={`decor-${k}`}
                disabled={!idle}
                onPointerDown={(e) => dragDecor(k, e as unknown as PointerEvent)}
              >
                <DecorIcon kind={k} />
                <span>{t(`robo.decor.${k}` as Key)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div class="panel-title">{t('robo.devices')}</div>
      <div class="shape-grid">
        {robotModels.value.map((spec) => (
          <button
            class="shape-tile"
            data-testid={spec.id === DEFAULT_ROBOT ? 'add-robot' : `add-robot-${spec.id}`}
            title={t('robo.robotHint')}
            disabled={!idle}
            onPointerDown={(e) => dragRobot(e as unknown as PointerEvent, spec.id)}
          >
            <Icon.robot size={40} />
            <span>{localText(spec.name, lang.value) || spec.id}</span>
          </button>
        ))}
      </div>

      <div class="panel-title">{t('robo.sensorsSection')}</div>
      <div class="shape-grid three">
        {SENSOR_TYPES.map((type) => (
          <button
            class={`shape-tile small ${sensorKind.value === type ? 'chosen' : ''}`}
            data-testid={type === 'line' ? 'add-sensor' : `add-sensor-${type}`}
            title={`${t(`robo.sensor.${type}` as Key)}. ${t('robo.sensorHint')}`}
            disabled={!idle}
            onPointerDown={(e) => dragSensor(type, e as unknown as PointerEvent)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && addSensorToRobot(type)}
          >
            <SensorGlyph type={type} />
            <span>{t(`robo.sensor.${type}` as Key)}</span>
          </button>
        ))}
      </div>
      {robot && robot.params.robot && <PadMap robotId={robot.id} />}

      <div class="panel-title">{t('robo.lightSection')}</div>
      <div class="shape-grid">
        {(['spot', 'point'] as const).map((kind) => (
          <button
            class="shape-tile"
            data-testid={`add-lamp-${kind}`}
            title={t('robo.lampHint')}
            disabled={!idle}
            onPointerDown={(e) => dragLamp(kind, e as unknown as PointerEvent)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && A.addLight(kind)}
          >
            <LampGlyph kind={kind} />
            <span>{t(kind === 'spot' ? 'robo.spotLamp' : 'robo.pointLamp')}</span>
          </button>
        ))}
      </div>

      <div class="panel-title">{t('robo.heroesSection')}</div>
      <div class="shape-grid three">
        {SPECIES.map((sp) => (
          <button
            class="shape-tile small"
            data-testid={sp === 'seal' ? 'add-nerpa' : `add-${sp}`}
            title={t(sp === 'seal' ? 'robo.nerpaHint' : sp === 'cheetah' ? 'robo.cheetahHint' : 'robo.pigeonHint')}
            disabled={!idle}
            onPointerDown={(e) => dragNerpa(e as unknown as PointerEvent, sp)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && A.addNerpa(undefined, sp)}
          >
            {sp === 'seal' ? <NerpaGlyph /> : sp === 'cheetah' ? <CheetahGlyph /> : <PigeonGlyph />}
            <span>{t(sp === 'seal' ? 'shape.nerpa' : sp === 'cheetah' ? 'robo.cheetahName' : 'robo.pigeonName')}</span>
          </button>
        ))}
      </div>

      <div class="panel-title">{t('robo.obstacles')}</div>
      <div class="shape-grid three">
        {A.OBSTACLES.map((type) => (
          <button
            class="shape-tile small"
            title={t('robo.obstaclesHint')}
            data-testid={`obstacle-${type}`}
            disabled={!idle}
            onPointerDown={(e) => dragObstacle(type, e as unknown as PointerEvent)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && A.addObstacle(type)}
          >
            <ShapeIcon type={type} size={34} />
            <span>{A.shapeName(type)}</span>
          </button>
        ))}
      </div>

      <div class="panel-title">{t('robo.run')}</div>
      <div class="sim-controls">
        <button
          class={`btn primary sim-btn ${state === 'running' ? 'on' : ''}`}
          onClick={() => (state === 'running' ? pauseSim() : void startSim())}
          data-testid={state === 'running' ? 'sim-pause' : 'sim-start'}
          title={state === 'running' ? `${t('robo.pause')} (Space)` : `${t('robo.start')} (Space)`}
        >
          {state === 'running' ? <Icon.pause size={16} /> : <Icon.play size={16} />}
          {state === 'running' ? t('robo.pause') : state === 'paused' ? t('robo.resume') : t('robo.start')}
        </button>
        <button class="btn sim-btn" onClick={stopSim} disabled={idle} data-testid="sim-stop" title={`${t('robo.stop')} (Esc)`}>
          <Icon.stop size={14} /> {t('robo.stop')}
        </button>
      </div>
      <PrettySection />
      <CameraRow />
      <div class="sim-row">
        <span class="muted">{t('robo.speed')}</span>
        <div class="seg small">
          {SPEEDS.map((s) => (
            <button class={simSpeed.value === s ? 'on' : ''} onClick={() => (simSpeed.value = s)} data-testid={`speed-${s}`}>
              ×{s}
            </button>
          ))}
        </div>
      </div>
      {doc.value.nodes.some((n) => n.kind === 'prim' && n.prim === 'nerpa') && (
        <div class="sim-row" title={t('robo.volumeTip')}>
          <span class="muted">{t('robo.volume')}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={simVolume.value}
            onInput={(e) => (simVolume.value = Number((e.currentTarget as HTMLInputElement).value))}
            data-testid="sim-volume"
          />
        </div>
      )}
      <div class="sim-row">
        <span class="muted">{t('robo.time')}</span>
        <span class="sim-time" data-testid="sim-time">
          {simTime.value.toFixed(1)} {t('unit.s')}
        </span>
      </div>

      {robot && <Readings robotId={robot.id} />}


      <div class="panel-title">{t('robo.examples')}</div>
      <button class="btn wide" onClick={A.loadDemo} disabled={!idle} data-testid="load-demo">
        <Icon.flag size={16} /> {t('robo.demo')}
      </button>
      <button class="btn wide" onClick={A.loadIsland} disabled={!idle} data-testid="load-island" title={t('robo.islandTip')}>
        <Icon.flag size={16} /> {t('robo.island')}
      </button>
      <p class="panel-hint">{t('robo.hint')}</p>
    </aside>
  )
}

/** Top view of the robot with its five pads: click a pad to put a sensor on it or take it off. */
function PadMap({ robotId }: { robotId: string }) {
  const n = doc.value.nodes.find((x) => x.id === robotId)
  if (!n || n.kind !== 'prim' || !n.params.robot) return null
  const spec = robotSpec(n.params.robot.model)
  const used = new Set(n.params.robot.sensors.map((s) => s.port))
  const typeOf = new Map(n.params.robot.sensors.map((s) => [s.port, s.type]))
  const idle = simState.value === 'idle'
  // robot frame → picture: forward (X) is up, left (Y) is left
  const k = 0.9
  const px = (y: number) => 100 - y * k
  const py = (x: number) => 100 - (x - 10) * k
  return (
    <div class="pad-map" data-testid="pad-map">
      <svg viewBox="0 0 200 200" width="150" height="150">
        <circle cx={px(0)} cy={py(spec.centerX)} r={spec.radius * k} class="pm-body" />
        <rect x={px(spec.track / 2) - 6} y={py(spec.wheelRadius)} width="12" height={spec.wheelRadius * 2 * k} class="pm-wheel" />
        <rect x={px(-spec.track / 2) - 6} y={py(spec.wheelRadius)} width="12" height={spec.wheelRadius * 2 * k} class="pm-wheel" />
        <path d={`M${px(0)} ${py(spec.radius)} l-7 12 h14z`} class="pm-front" />
        {spec.pads.map((p) => {
          const on = used.has(p.port)
          return (
            <g
              class={`pm-pad ${on ? 'on' : ''} ${idle ? '' : 'off'}`}
              data-testid={`pad-${p.port}`}
              onClick={() => {
                if (!idle) return
                if (on) A.detachSensor(robotId, p.port)
                else A.attachSensor(robotId, p.port)
              }}
            >
              <title>{on ? t('robo.removeSensor') : t('robo.putSensor', { name: t(`robo.sensor.${sensorKind.value}` as Key) })}</title>
              <rect
                x={px(p.y) - 11}
                y={py(p.x) - 14}
                width="22"
                height="28"
                rx="3"
                style={on ? { fill: MODULE_COLORS[typeOf.get(p.port)!], stroke: MODULE_COLORS[typeOf.get(p.port)!] } : undefined}
              />
              <text x={px(p.y)} y={py(p.x) + 5}>
                {p.port}
              </text>
            </g>
          )
        })}
      </svg>
      <p class="panel-hint" data-testid="pad-chosen">
        {t('robo.padMapChosen', { name: t(`robo.sensor.${sensorKind.value}` as Key) })}. {t('robo.padMapHint')}
      </p>
    </div>
  )
}

function Readings({ robotId }: { robotId: string }) {
  const n = doc.value.nodes.find((x) => x.id === robotId)
  if (!n || n.kind !== 'prim' || !n.params.robot || n.params.robot.sensors.length === 0) return null
  const values = sensorValues.value[robotId] ?? {}
  return (
    <div class="readings" data-testid="readings">
      <div class="panel-title">{t('robo.readings')}</div>
      {n.params.robot.sensors.map((s) => {
        const v = values[s.port]
        return (
          <div class="reading" data-testid={`reading-${s.port}`} title={t(`robo.sensor.${s.type}` as Key)}>
            <span class="port-badge" style={{ background: MODULE_COLORS[s.type], color: '#fff' }}>
              {s.port}
            </span>
            <div class="reading-bar">
              <div class="reading-fill" style={{ width: `${readingBar(s.type, v)}%` }} />
            </div>
            <span class="reading-val">{readingText(s.type, v)}</span>
          </div>
        )
      })}
    </div>
  )
}

/** A pad module seen from above, in its board colour, with what it does drawn on it. */
function SensorGlyph({ type }: { type: SensorType }) {
  const c = MODULE_COLORS[type]
  return (
    <svg width="34" height="34" viewBox="0 0 40 40" aria-hidden="true">
      <rect x="12" y="6" width="16" height="30" rx="3" fill={c} stroke="currentColor" stroke-width="1.2" />
      {type === 'line' && (
        <>
          <rect x="15" y="26" width="10" height="7" rx="1.5" fill="#bfe6ff" />
          <path d="M20 36v3" stroke="currentColor" stroke-width="1.2" stroke-dasharray="1.5 1.5" />
        </>
      )}
      {type === 'ultrasonic' && (
        <>
          <circle cx="16.5" cy="11" r="3" fill="#dfe3ea" />
          <circle cx="23.5" cy="11" r="3" fill="#dfe3ea" />
          <path d="M14 3.5q6-3 12 0M16 1.5q4-1.8 8 0" fill="none" stroke="currentColor" stroke-width="1.1" />
        </>
      )}
      {type === 'touch' && <rect x="16" y="2" width="8" height="6" rx="1.5" fill="#f4f4f4" stroke="currentColor" stroke-width="1" />}
      {type === 'light' && (
        <>
          <circle cx="20" cy="11" r="3" fill="#fff6d8" />
          <path d="M20 2v3M13.5 5l2 2M26.5 5l-2 2" stroke="currentColor" stroke-width="1.1" />
        </>
      )}
      {type === 'flashlight' && (
        <>
          <circle cx="20" cy="11" r="3" fill="#fff6d8" />
          <path d="M17 4 12 0M23 4l5-4M20 4V0" stroke="#ffd60a" stroke-width="1.6" />
        </>
      )}
    </svg>
  )
}

function LampGlyph({ kind }: { kind: LightParams['kind'] }) {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 38V20" stroke="currentColor" stroke-width="1.5" />
      {kind === 'point' ? (
        <>
          <circle cx="20" cy="13" r="7" fill="#ffd84a" stroke="currentColor" stroke-width="1.2" />
          <path d="M20 1v3M9 5l2 2M31 5l-2 2M6 14h3M31 14h3" stroke="#ffd84a" stroke-width="1.6" />
        </>
      ) : (
        <>
          <path d="M12 12l10-6 3 6-8 5z" fill="#ffd84a" stroke="currentColor" stroke-width="1.2" />
          <path d="M24 12l12 14-16-4z" fill="#ffd84a" opacity="0.35" />
        </>
      )}
    </svg>
  )
}

function CheetahGlyph() {
  return (
    <svg width="44" height="40" viewBox="0 0 44 40" aria-hidden="true">
      <path
        d="M6 18c4-3 12-4 20-3 3-3 6-4 9-3l2-3 1 4c2 1 3 3 2 4l-4 1c-1 2-2 3-3 4l1 12h-3l-2-10c-3 1-7 1-10 0l-3 10H13l1-11c-2-1-4-3-5-5l-6 5-1-2 6-5z"
        fill="#e8a94a"
        stroke="currentColor"
        stroke-width="1.1"
        stroke-linejoin="round"
      />
      <circle cx="17" cy="20" r="1.3" fill="#2a1d12" />
      <circle cx="22" cy="18" r="1.2" fill="#2a1d12" />
      <circle cx="27" cy="21" r="1.2" fill="#2a1d12" />
      <circle cx="13" cy="23" r="1.1" fill="#2a1d12" />
      <circle cx="36" cy="14" r="1.1" fill="#15171f" />
    </svg>
  )
}

function PigeonGlyph() {
  return (
    <svg width="44" height="40" viewBox="0 0 44 40" aria-hidden="true">
      <path
        d="M8 26c3-6 9-9 16-9 2-4 5-7 9-6 3 1 4 3 4 5l4 1-4 2c0 3-2 6-5 8-4 3-10 4-16 3l-7 3 2-4c-2 0-3-1-3-3z"
        fill="#8c97ab"
        stroke="currentColor"
        stroke-width="1.1"
        stroke-linejoin="round"
      />
      <path d="M14 22c5-4 11-4 15-1-4 3-10 4-15 1z" fill="#6f7a8f" />
      <path d="M31 15c1 2 2 3 4 3" stroke="#5aa58e" stroke-width="1.6" fill="none" />
      <circle cx="34" cy="13.5" r="1.2" fill="#d2632a" />
      <path d="M22 33v4M27 32v4" stroke="#d2632a" stroke-width="1.4" />
    </svg>
  )
}

function NerpaGlyph() {
  return (
    <svg width="44" height="40" viewBox="0 0 44 40" aria-hidden="true">
      <path
        d="M4 30c6-1 10-4 16-4 5 0 8-6 10-12 1-3 4-5 7-4s3 5 1 8c-1 2-2 4-2 7 0 5-4 9-11 9H8c-3 0-5-2-4-4z"
        fill="#8f9aa6"
        stroke="currentColor"
        stroke-width="1.2"
      />
      <circle cx="35.5" cy="13" r="1.3" fill="#15171f" />
      <path d="M2 31l-2-4M2 31l-1 5" stroke="currentColor" stroke-width="1.2" />
      <path d="M22 32l-3 5" stroke="currentColor" stroke-width="1.2" />
    </svg>
  )
}

