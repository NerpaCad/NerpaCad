import { THEME } from './theme'
import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three'

/** Face order of BoxGeometry groups: +X, -X, +Y, -Y, +Z, -Z */
export const CUBE_NORMALS = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1)
]

/**
 * Small orientation cube drawn in a corner of the main canvas.
 * Built from 6 labelled planes so each label can be oriented explicitly (Z is up).
 * Clicking a face turns the main camera to look at that side.
 */
export class ViewCube {
  readonly size = 96
  readonly margin = 12
  private scene = new Scene()
  private camera = new OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 20)
  private faces: Mesh[] = []
  private mats: MeshLambertMaterial[] = []
  private hoverFace = -1
  private edges!: LineSegments<EdgesGeometry, LineBasicMaterial>

  constructor(labels: string[]) {
    const plane = new PlaneGeometry(2, 2)
    CUBE_NORMALS.forEach((n, i) => {
      // label "up" direction: +Z on the sides, +Y on top, +Y seen from below
      const up = Math.abs(n.z) > 0.5 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1)
      const x = up.clone().cross(n)
      const m = new Mesh(plane)
      m.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, up, n))
      m.position.copy(n)
      m.userData.face = i
      this.faces.push(m)
      this.scene.add(m)
    })
    this.setLabels(labels)
    const edges = (this.edges = new LineSegments(
      new EdgesGeometry(new BoxGeometry(2.01, 2.01, 2.01)),
      new LineBasicMaterial({ color: THEME.cubeEdge })
    ))
    this.scene.add(edges)
    this.scene.add(new AmbientLight('#ffffff', 2.6))
    const d = new DirectionalLight('#ffffff', 1.2)
    d.position.set(2, -3, 5)
    this.scene.add(d)
  }

  /** labels in face order: right, left, back, front, top, bottom */
  setLabels(labels: string[]): void {
    this.edges?.material.color.set(THEME.cubeEdge)
    this.mats.forEach((m) => {
      m.map?.dispose()
      m.dispose()
    })
    this.mats = labels.map((text) => {
      const c = document.createElement('canvas')
      c.width = c.height = 128
      const g = c.getContext('2d')!
      g.fillStyle = THEME.cubeFace
      g.fillRect(0, 0, 128, 128)
      // chamfered inner frame, cyberpunk-style
      g.strokeStyle = THEME.cubeEdge
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(14, 8)
      g.lineTo(120, 8)
      g.lineTo(120, 106)
      g.lineTo(106, 120)
      g.lineTo(8, 120)
      g.lineTo(8, 22)
      g.closePath()
      g.stroke()
      g.fillStyle = THEME.cubeText
      let fs = 30
      do {
        g.font = `600 ${fs}px ${THEME.cubeFont}`
        fs--
      } while (g.measureText(text).width > 112 && fs > 12)
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(text, 64, 64)
      const tex = new CanvasTexture(c)
      tex.colorSpace = SRGBColorSpace
      return new MeshLambertMaterial({ map: tex, color: new Color('#ffffff'), emissive: new Color('#000000') })
    })
    this.faces.forEach((f, i) => (f.material = this.mats[i]))
    this.setHover(this.hoverFace, true)
  }

  /** Rectangle of the cube in CSS pixels, from the top-left of the canvas. */
  rect(): { x: number; y: number; w: number; h: number } {
    return { x: this.margin, y: this.margin, w: this.size, h: this.size }
  }

  /** Face index under the pointer, -1 inside the cube area but on no face, -2 outside. */
  hit(clientX: number, clientY: number, canvasRect: DOMRect, main: PerspectiveCamera): number {
    const r = this.rect()
    const x = clientX - canvasRect.left - r.x
    const y = clientY - canvasRect.top - r.y
    if (x < 0 || y < 0 || x > r.w || y > r.h) return -2
    this.orient(main)
    const ray = new Raycaster()
    ray.setFromCamera(new Vector2((x / r.w) * 2 - 1, -(y / r.h) * 2 + 1), this.camera)
    const hit = ray.intersectObjects(this.faces, false)[0]
    return hit ? (hit.object.userData.face as number) : -1
  }

  setHover(face: number, force = false): boolean {
    if (face === this.hoverFace && !force) return false
    this.hoverFace = face
    this.mats.forEach((m, i) => {
      m.emissive.set(i === face ? THEME.cubeHoverGlow : '#000000')
      m.color.set(i === face ? THEME.cubeHoverTint : '#ffffff')
    })
    return true
  }

  private orient(main: PerspectiveCamera): void {
    const dir = new Vector3().copy(main.position).sub(mainTarget).normalize()
    this.camera.position.copy(dir.multiplyScalar(6))
    this.camera.up.copy(main.up)
    this.camera.lookAt(0, 0, 0)
    this.camera.updateMatrixWorld()
  }

  render(renderer: WebGLRenderer, main: PerspectiveCamera, target: Vector3, canvasHeight: number): void {
    mainTarget.copy(target)
    this.orient(main)
    const r = this.rect()
    const y = canvasHeight - r.y - r.h
    renderer.setScissorTest(true)
    renderer.setScissor(r.x, y, r.w, r.h)
    renderer.setViewport(r.x, y, r.w, r.h)
    renderer.clearDepth()
    renderer.render(this.scene, this.camera)
    renderer.setScissorTest(false)
  }
}

const mainTarget = new Vector3()
