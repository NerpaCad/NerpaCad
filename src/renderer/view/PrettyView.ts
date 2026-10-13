/**
 * The beautiful view of the robotics field (settings: core/robotics/look.ts). While it is on the
 * scene is drawn through a chain of passes instead of straight to the screen:
 *
 *   scene (with the sun's soft shadows, sky and surroundings for reflections, real glass)
 *   → soft shading in corners (GTAO, high quality only) → glow (bloom) → tone mapping and colour.
 *
 * The editor's own lights, grid and dark background are put away meanwhile and come back when
 * it is switched off. Everything is three.js r186 itself, nothing else.
 */
import {
  ACESFilmicToneMapping,
  BackSide,
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Fog,
  HalfFloatType,
  HemisphereLight,
  Light,
  type Line,
  type Material,
  type Points,
  ShaderMaterial,
  Sprite,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  type Scene,
  SphereGeometry,
  SpotLight,
  SRGBColorSpace,
  type Texture,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer
} from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { PRESETS, type Preset, QUALITY, type Quality, type ViewSettings, sunDirection } from '../core/robotics/look'

/** what does not glow looks like while the glow is drawn */
const BLACK = new MeshBasicMaterial({ color: '#000000' })

/** the floor of the field reaches this far (mm), into the haze */
const FLOOR = 60000

export class PrettyView {
  private composer: EffectComposer | null = null
  private render$: RenderPass | null = null
  private ao: GTAOPass | null = null
  private bloom: UnrealBloomPass | null = null
  private glowComposer: EffectComposer | null = null
  private mix: ShaderPass | null = null
  private glowOn = false
  private readonly fog = new Fog('#ffffff', 4000, 20000)
  private output: OutputPass | null = null
  private samples = -1
  readonly sun = new DirectionalLight('#ffffff', 2)
  readonly hemi = new HemisphereLight('#ffffff', '#888888', 1)
  private floor: Mesh
  private sky: Mesh
  private skyTex: Texture | null = null
  private skyKey = ''
  private env: Texture | null = null
  private on = false
  private quality: Quality = 'mid'
  private settings: ViewSettings | null = null
  private size = new Vector2(1, 1)
  /** what the editor had, to put back */
  private saved: { pixelRatio: number } | null = null

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera
  ) {
    this.sun.castShadow = true
    this.sun.shadow.bias = -0.0004
    this.sun.name = 'pretty-sun'
    this.hemi.name = 'pretty-hemi'
    this.floor = new Mesh(new PlaneGeometry(FLOOR * 2, FLOOR * 2), new MeshStandardMaterial({ color: '#cccccc', roughness: 1, metalness: 0 }))
    this.floor.name = 'pretty-floor'
    this.floor.position.z = -0.3
    this.floor.receiveShadow = true
    this.floor.raycast = () => undefined
    this.floor.renderOrder = -2
    // the sky: a big sphere round the camera, the gradient (and stars) painted inside
    this.sky = new Mesh(new SphereGeometry(1, 32, 16), new MeshBasicMaterial({ side: BackSide, depthWrite: false, fog: false }))
    this.sky.name = 'pretty-sky'
    this.sky.raycast = () => undefined
    this.sky.renderOrder = -3
    this.sky.frustumCulled = false
    this.sky.onBeforeRender = () => {
      this.sky.position.copy(this.camera.position)
      this.sky.scale.setScalar(this.camera.far * 0.9)
      this.sky.updateMatrixWorld()
    }
  }

  get active(): boolean {
    return this.on
  }

  /** Switch on (with these settings at this quality) or off. */
  set(s: ViewSettings | null, quality: Quality, bounds: Box3 | null): void {
    if (!s) return this.off()
    const first = !this.on
    this.on = true
    this.settings = s
    this.quality = quality
    const q = QUALITY[quality]
    const p = PRESETS[s.time]
    const r = this.renderer
    if (first) {
      this.saved = { pixelRatio: r.getPixelRatio() }
      this.scene.add(this.sun, this.sun.target, this.hemi, this.floor, this.sky)
      if (!this.env) {
        const pm = new PMREMGenerator(r)
        this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture
        pm.dispose()
      }
    }
    r.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio))
    r.shadowMap.enabled = s.shadows
    r.shadowMap.type = PCFSoftShadowMap
    r.toneMapping = ACESFilmicToneMapping
    r.toneMappingExposure = p.exposure
    this.scene.environment = this.env
    this.scene.environmentIntensity = p.envIntensity
    this.scene.environmentRotation.set(Math.PI / 2, 0, 0)
    // the haze only hides the far floor toward the horizon: it is laid out from where the camera
    // is at every frame (see `render`), so the field never fades however far one zooms out
    this.fog.color.set(p.skyHorizon)
    this.scene.fog = this.fog
    this.paintSky(p)

    this.hemi.color.set(p.skyLight)
    this.hemi.groundColor.set(p.groundLight)
    this.hemi.intensity = p.hemiIntensity
    this.hemi.position.set(0, 0, 1)
    ;(this.floor.material as MeshStandardMaterial).color.set(p.floor)

    this.sun.color.set(p.sunColor)
    this.sun.intensity = p.sunIntensity
    this.sunBox = null
    this.fitSun(bounds)
    if (this.sun.shadow.mapSize.x !== q.shadowMap) {
      this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap)
      this.sun.shadow.map?.dispose()
      this.sun.shadow.map = null
    }
    this.sun.castShadow = s.shadows
    this.buildPasses(s, quality)
  }

  /** the field the sun's shadow box was last laid round */
  private sunBox: Box3 | null = null

  /**
   * The sun over the middle of the field, its shadow box round everything on it. Called again when
   * the field grows or shrinks (painted further out, a project's meshes arrived after it opened).
   */
  fitSun(bounds: Box3 | null): void {
    if (!this.on || !this.settings) return
    const b = bounds && !bounds.isEmpty() ? bounds.clone() : new Box3(new Vector3(-900, -900, 0), new Vector3(900, 900, 300))
    // nothing to do for small changes (a robot driving about)
    const old = this.sunBox
    if (old && old.min.distanceTo(b.min) < 100 && old.max.distanceTo(b.max) < 100) return
    this.sunBox = b.clone()
    b.expandByScalar(300)
    const q = QUALITY[this.quality]
    const c = b.getCenter(new Vector3())
    const R = Math.max(800, b.getSize(new Vector3()).length() / 2)
    const d = new Vector3(...sunDirection(this.settings))
    this.sun.target.position.copy(c)
    this.sun.position.copy(c).addScaledVector(d, R * 2)
    this.sun.target.updateMatrixWorld()
    const cam = this.sun.shadow.camera
    cam.left = -R
    cam.right = R
    cam.top = R
    cam.bottom = -R
    cam.near = R * 0.2
    cam.far = R * 4
    cam.updateProjectionMatrix()
    this.sun.shadow.normalBias = (R / q.shadowMap) * 1.5
  }

  /** Lamps and everything else on the field: who casts and catches shadows. */
  prepare(root: Object3D): void {
    if (!this.on || !this.settings) return
    const q = QUALITY[this.quality]
    let spots = 0
    root.traverse((o) => {
      if (o instanceof Mesh) {
        o.castShadow = true
        o.receiveShadow = true
      } else if (o instanceof SpotLight) {
        o.castShadow = !!this.settings?.shadows && spots++ < q.lampShadows
        o.shadow.mapSize.set(q.shadowMap / 4, q.shadowMap / 4)
        o.shadow.bias = -0.0006
      } else if (o instanceof PointLight) {
        o.castShadow = false
      }
    })
  }

  private paintSky(p: Preset): void {
    const key = `${p.skyTop}${p.skyHorizon}${p.stars}`
    if (key === this.skyKey) return
    this.skyKey = key
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 512
    const g = c.getContext('2d')!
    // equirectangular: the top row is straight up, the middle the horizon
    const grad = g.createLinearGradient(0, 0, 0, c.height)
    grad.addColorStop(0, p.skyTop)
    grad.addColorStop(0.47, p.skyHorizon)
    grad.addColorStop(0.53, p.skyHorizon)
    grad.addColorStop(1, p.skyHorizon)
    g.fillStyle = grad
    g.fillRect(0, 0, c.width, c.height)
    if (p.stars) {
      let a = 7
      const rnd = () => ((a = (a * 16807) % 2147483647) / 2147483647)
      for (let i = 0; i < 700; i++) {
        const y = rnd() * c.height * 0.45
        g.fillStyle = `rgba(255,255,255,${0.35 + rnd() * 0.65})`
        g.fillRect(rnd() * c.width, y, rnd() < 0.1 ? 2 : 1, rnd() < 0.1 ? 2 : 1)
      }
    }
    this.skyTex?.dispose()
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    t.mapping = EquirectangularReflectionMapping
    this.skyTex = t
    const m = this.sky.material as MeshBasicMaterial
    m.map = t
    m.needsUpdate = true
    // the sphere's poles are on its Y axis: turn them to Z (the field's up)
    this.sky.rotation.set(Math.PI / 2, 0, 0)
  }

  private buildPasses(s: ViewSettings, quality: Quality): void {
    const q = QUALITY[quality]
    const r = this.renderer
    const w = Math.max(1, this.size.x)
    const h = Math.max(1, this.size.y)
    if (!this.composer || this.samples !== q.samples) {
      this.dropComposers()
      const target = new WebGLRenderTarget(w * r.getPixelRatio(), h * r.getPixelRatio(), { type: HalfFloatType, samples: q.samples })
      this.composer = new EffectComposer(r, target)
      this.samples = q.samples
      this.render$ = new RenderPass(this.scene, this.camera)
      this.composer.addPass(this.render$)
      this.ao = null
      // the glow: only glowing things (everything else drawn black) are blurred into a halo,
      // then laid over the picture
      this.glowComposer = new EffectComposer(r, new WebGLRenderTarget(w, h, { type: HalfFloatType }))
      this.glowComposer.renderToScreen = false
      this.glowComposer.addPass(new RenderPass(this.scene, this.camera))
      this.bloom = new UnrealBloomPass(new Vector2(w, h), 0.6, 0.5, 0)
      this.glowComposer.addPass(this.bloom)
      this.mix = new ShaderPass(
        new ShaderMaterial({
          uniforms: { baseTexture: { value: null }, glowTexture: { value: this.glowComposer.renderTarget2.texture } },
          vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader:
            'uniform sampler2D baseTexture; uniform sampler2D glowTexture; varying vec2 vUv; void main() { gl_FragColor = texture2D(baseTexture, vUv) + vec4(texture2D(glowTexture, vUv).rgb, 0.0); }'
        }),
        'baseTexture'
      )
      this.mix.needsSwap = true
      this.output = new OutputPass()
      this.composer.addPass(this.mix)
      this.composer.addPass(this.output)
    }
    const composer = this.composer
    // soft shading in corners only on the high quality
    if (q.ao && !this.ao) {
      this.ao = new GTAOPass(this.scene, this.camera, w, h)
      this.ao.updateGtaoMaterial({ radius: 45, distanceExponent: 1.5, thickness: 12, scale: 1, samples: 12 })
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 })
      this.ao.blendIntensity = 0.85
      composer.insertPass(this.ao, 1)
    } else if (!q.ao && this.ao) {
      composer.removePass(this.ao)
      this.ao.dispose()
      this.ao = null
    }
    const p = PRESETS[s.time]
    this.bloom!.strength = (s.glow / 100) * 1.3 * Math.min(1.4, p.glowBoost)
    this.bloom!.radius = 0.35
    this.bloom!.threshold = 0
    this.glowOn = s.glow > 0
    this.mix!.enabled = this.glowOn
    composer.setPixelRatio(r.getPixelRatio())
    composer.setSize(w, h)
    // the halo is blurry anyway: half the pixels on the low quality
    const gk = quality === 'low' ? 0.5 : 1
    this.glowComposer!.setPixelRatio(r.getPixelRatio() * gk)
    this.glowComposer!.setSize(w, h)
  }

  setSize(w: number, h: number): void {
    this.size.set(w, h)
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio())
      this.composer.setSize(w, h)
    }
    if (this.glowComposer) {
      this.glowComposer.setPixelRatio(this.renderer.getPixelRatio() * (this.quality === 'low' ? 0.5 : 1))
      this.glowComposer.setSize(w, h)
    }
  }

  /** `dist`: how far the camera is from what it looks at, mm. */
  render(dist = this.camera.position.length()): void {
    const d = dist
    this.fog.near = Math.max(4000, d * 2.5)
    this.fog.far = Math.max(this.fog.near * 3, this.camera.far * 0.85)
    if (this.glowOn && this.glowComposer) this.renderGlow()
    this.composer?.render()
  }

  /** Does this material glow (lamps, glowing shapes, lit LEDs)? */
  private static glows(m: Material): boolean {
    const e = (m as MeshStandardMaterial).emissive
    if (!e) return false
    const k = (m as MeshStandardMaterial).emissiveIntensity ?? 1
    return (0.2126 * e.r + 0.7152 * e.g + 0.0722 * e.b) * k > 0.25
  }

  /** Draw only what glows (the rest black, the sky and haze away) into the glow composer. */
  private renderGlow(): void {
    const swapped: [Mesh, Material | Material[]][] = []
    const hidden: Object3D[] = []
    this.scene.traverseVisible((o) => {
      // outlines and helpers would get a halo too
      if ((o as Line).isLine || (o as Points).isPoints || o instanceof Sprite) {
        hidden.push(o)
        return
      }
      if (!(o instanceof Mesh)) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      // invisible stand-ins (what is picked by the mouse) block nothing
      if (mats.every((m) => !m.visible)) return
      if (mats.some((m) => PrettyView.glows(m))) return
      swapped.push([o, o.material])
      o.material = BLACK
    })
    const sky = this.sky.visible
    const fog = this.scene.fog
    const bg = this.scene.background
    const env = this.scene.environment
    this.sky.visible = false
    this.scene.fog = null
    this.scene.background = null
    this.scene.environment = null
    // the background must be black too, or the whole picture gets a halo of the editor's colour
    const clear = this.renderer.getClearColor(new Color())
    const alpha = this.renderer.getClearAlpha()
    this.renderer.setClearColor(0x000000, 1)
    PrettyView.hide(hidden, false)
    this.glowComposer!.render()
    PrettyView.hide(hidden, true)
    this.renderer.setClearColor(clear, alpha)
    this.sky.visible = sky
    this.scene.fog = fog
    this.scene.background = bg
    this.scene.environment = env
    for (const [o, m] of swapped) o.material = m
  }

  private static hide(list: Object3D[], on: boolean): void {
    for (const o of list) o.visible = on
  }

  private off(): void {
    if (!this.on) return
    this.on = false
    const r = this.renderer
    this.scene.remove(this.sun, this.sun.target, this.hemi, this.floor, this.sky)
    this.scene.environment = null
    this.scene.fog = null
    r.toneMapping = NoToneMapping
    r.toneMappingExposure = 1
    r.shadowMap.enabled = false
    if (this.saved) r.setPixelRatio(this.saved.pixelRatio)
    this.saved = null
    this.dropComposers()
    this.sunBox = null
  }

  /**
   * Free the passes' render targets and materials (a composer's own dispose frees only its two
   * targets): switching the view off and on, or the quality, leaks nothing on the graphics card.
   */
  private dropComposers(): void {
    for (const c of [this.composer, this.glowComposer]) {
      if (!c) continue
      for (const p of c.passes) p.dispose()
      c.renderTarget1.dispose()
      c.renderTarget2.dispose()
      c.dispose()
    }
    this.composer = null
    this.glowComposer = null
    this.render$ = null
    this.bloom = null
    this.mix = null
    this.output = null
    this.ao = null
    this.samples = -1
  }

  /** Lights of the editor that must be dark while the view is on (they are put back by the caller). */
  static isOwn(l: Light): boolean {
    return l.name === 'pretty-sun' || l.name === 'pretty-hemi'
  }
}
