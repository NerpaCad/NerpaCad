/**
 * Length units on screen. Everything is stored in millimetres; the robotics field is shown in
 * centimetres (a 30 cm tile, a 12 cm robot), the 3D model in millimetres.
 */
import { computed } from '@preact/signals'
import { roboticsMode } from './core/robotics/state'
import { t } from './i18n'

export type LenUnit = 'mm' | 'cm'

export const lenUnit = computed<LenUnit>(() => (roboticsMode.value ? 'cm' : 'mm'))

/** Millimetres in one unit on screen. */
export const lenScale = (): number => (lenUnit.value === 'cm' ? 10 : 1)

/** The unit's short name in the current language ("мм", "см"). */
export const unitName = (): string => t(lenUnit.value === 'cm' ? 'unit.cm' : 'unit.mm')

/** A length in mm as it is shown: at most two decimals, in the unit on screen. */
export function fmtLen(mm: number, withUnit = false): string {
  const v = Math.round((mm / lenScale()) * 100) / 100
  const s = Object.is(v, -0) ? '0' : String(v)
  return withUnit ? `${s} ${unitName()}` : s
}

/** Grid steps offered for each scene (mm). */
export const GRID_STEPS: Record<LenUnit, number[]> = {
  mm: [0, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  cm: [0, 5, 10, 50, 100]
}
