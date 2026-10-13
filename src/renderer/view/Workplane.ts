import { Color, DoubleSide, Matrix4, Mesh, PlaneGeometry, ShaderMaterial } from 'three'
import { THEME } from './theme'

/**
 * The blue workplane with an anti-aliased grid drawn in the fragment shader:
 * thin lines every `minor` mm, stronger lines every 10 mm, a border at the edge.
 */
export class Workplane {
  readonly mesh: Mesh
  private mat: ShaderMaterial

  constructor(private readonly baseSize = 200) {
    const size = baseSize
    this.mat = new ShaderMaterial({
      uniforms: {
        uSize: { value: size },
        uMinor: { value: 1 },
        uMajor: { value: 10 },
        uBase: { value: new Color(THEME.workBase) },
        uMinorColor: { value: new Color(THEME.workMinor) },
        uMajorColor: { value: new Color(THEME.workMajor) },
        uBorder: { value: new Color(THEME.workBorder) },
        uAlphaTop: { value: THEME.workAlphaTop },
        uAlphaBottom: { value: THEME.workAlphaBottom }
      },
      vertexShader: /* glsl */ `
        varying vec2 vPos;
        void main() {
          vPos = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uSize, uMinor, uMajor;
        uniform vec3 uBase, uMinorColor, uMajorColor, uBorder;
        uniform float uAlphaTop, uAlphaBottom;
        varying vec2 vPos;
        float gridLine(vec2 p, float step, float width) {
          vec2 g = abs(fract(p / step - 0.5) - 0.5) / fwidth(p / step);
          return 1.0 - min(min(g.x, g.y) / width, 1.0);
        }
        void main() {
          vec3 c = uBase;
          vec2 d = fwidth(vPos);
          // fade the minor grid out when its cells get smaller than ~4 px
          float minorFade = clamp(uMinor / max(d.x, d.y) / 4.0 - 0.5, 0.0, 1.0);
          float lMinor = gridLine(vPos, uMinor, 1.0) * minorFade;
          float lMajor = gridLine(vPos, uMajor, 1.2);
          c = mix(c, uMinorColor, lMinor);
          c = mix(c, uMajorColor, lMajor);
          float halfSize = uSize * 0.5;
          vec2 e = (halfSize - abs(vPos)) / fwidth(vPos);
          float border = 1.0 - min(min(e.x, e.y) / 2.5, 1.0);
          c = mix(c, uBorder, border);
          // translucent so shapes below the plane stay visible; grid lines stay more solid
          float a = gl_FrontFacing ? uAlphaTop : uAlphaBottom;
          a = max(a, max(lMajor * 0.9, border));
          gl_FragColor = vec4(c, a);
          #include <colorspace_fragment>
        }`,
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2
    })
    this.mesh = new Mesh(new PlaneGeometry(size, size), this.mat)
    this.mesh.name = 'workplane'
    this.mesh.renderOrder = -1
  }

  private custom = false

  /** Place the grid on a frame (null = ground). A moved workplane gets a highlighted border. */
  setFrame(m: Matrix4 | null): void {
    this.custom = !!m
    this.mesh.matrixAutoUpdate = false
    this.mesh.matrix.copy(m ?? new Matrix4())
    this.mesh.matrixWorldNeedsUpdate = true
    this.mat.uniforms.uBorder.value.set(this.custom ? THEME.lift : THEME.workBorder)
    this.applyAlpha()
  }

  /** A workplane moved onto a face is lighter, so it doesn't hide the shape it stands on. */
  private applyAlpha(): void {
    const k = this.custom ? 0.5 : 1
    // the floor is solid ground: nothing to see below it
    this.mat.uniforms.uAlphaTop.value = this.floor ? 1 : THEME.workAlphaTop * k
    this.mat.uniforms.uAlphaBottom.value = this.floor ? 1 : THEME.workAlphaBottom * k
  }

  applyTheme(): void {
    const u = this.mat.uniforms
    u.uBase.value.set(THEME.workBase)
    u.uMinorColor.value.set(THEME.workMinor)
    u.uMajorColor.value.set(THEME.workMajor)
    u.uBorder.value.set(this.custom ? THEME.lift : THEME.workBorder)
    this.applyAlpha()
  }

  private floor = false
  private minor = 1

  /**
   * Robotics floor: a big opaque field with a line every 300 mm (the tile grid) instead of the
   * small translucent workplane.
   */
  setFloor(on: boolean, size = 6000): void {
    if (on === this.floor) return
    this.floor = on
    const s = on ? size : this.baseSize
    this.mesh.geometry.dispose()
    this.mesh.geometry = new PlaneGeometry(s, s)
    const u = this.mat.uniforms
    u.uSize.value = s
    u.uMajor.value = on ? 300 : 10
    u.uMinor.value = on ? 50 : Math.max(1, this.minor)
    this.applyAlpha()
  }

  setMinor(step: number): void {
    this.minor = step
    // keep the minor grid readable: at least 1 mm between lines
    if (!this.floor) this.mat.uniforms.uMinor.value = Math.max(1, step)
  }

  get size(): number {
    return this.mat.uniforms.uSize.value
  }
}
