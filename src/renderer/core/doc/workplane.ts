/**
 * The workplane: the plane new shapes land on and moves/lifts/snapping happen in.
 * By default it is the ground (world XY, Z up); the user can move it onto any face.
 * A frame is an orthonormal coordinate system: local Z = plane normal.
 */
import { Matrix4, Quaternion, Vector3 } from 'three'
import { type Vec3, cleanVec, quatFromRotation, rotationFromQuat } from './model'

export interface Frame {
  position: Vec3
  rotation: Vec3
}

export const GROUND: Frame = { position: [0, 0, 0], rotation: [0, 0, 0] }

export function frameMatrix(f: Frame | null): Matrix4 {
  const fr = f ?? GROUND
  return new Matrix4().compose(new Vector3(...fr.position), quatFromRotation(fr.rotation), new Vector3(1, 1, 1))
}

export function frameQuat(f: Frame | null): Quaternion {
  return quatFromRotation((f ?? GROUND).rotation)
}

/** World directions of the frame's local X, Y, Z axes. */
export function frameAxes(f: Frame | null): [Vector3, Vector3, Vector3] {
  const q = frameQuat(f)
  return [new Vector3(1, 0, 0).applyQuaternion(q), new Vector3(0, 1, 0).applyQuaternion(q), new Vector3(0, 0, 1).applyQuaternion(q)]
}

/**
 * Frame on a face: origin at the hit point, Z along the face normal. X stays horizontal when
 * possible (so the grid on a side face runs level), otherwise it follows world X.
 */
export function frameFromHit(point: Vector3, normal: Vector3): Frame {
  const z = normal.clone().normalize()
  let x: Vector3
  if (Math.abs(z.z) > 0.999) x = new Vector3(1, 0, 0)
  else x = new Vector3(0, 0, 1).cross(z).normalize()
  // flip X for downward faces so the frame stays right-handed with X ≈ world X where it can
  if (Math.abs(z.z) > 0.999 && z.z < 0) x.set(1, 0, 0)
  const y = z.clone().cross(x).normalize()
  const m = new Matrix4().makeBasis(x, y, z)
  const q = new Quaternion().setFromRotationMatrix(m)
  return { position: cleanVec([point.x, point.y, point.z], 4), rotation: rotationFromQuat(q) }
}

export const isGround = (f: Frame | null) => !f
