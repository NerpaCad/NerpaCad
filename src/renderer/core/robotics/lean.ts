/** Orientation of a body on the field as a quaternion: heading around Z, then nose up, then left side up. */
export interface Quat {
  x: number
  y: number
  z: number
  w: number
}

const mul = (a: Quat, b: Quat): Quat => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
})

/** Heading `theta` around Z, then `pitch` nose up (around the body's Y), then `roll` left side up (around its X). */
export function bodyQuat(theta: number, pitch = 0, roll = 0): Quat {
  const qz: Quat = { x: 0, y: 0, z: Math.sin(theta / 2), w: Math.cos(theta / 2) }
  if (!pitch && !roll) return qz
  const qy: Quat = { x: 0, y: Math.sin(-pitch / 2), z: 0, w: Math.cos(-pitch / 2) }
  const qx: Quat = { x: Math.sin(roll / 2), y: 0, z: 0, w: Math.cos(roll / 2) }
  return mul(mul(qz, qy), qx)
}
