import { feetInchesToFeet } from './units'

export type UniversalRinglockStandardId = 'US99' | 'US66' | 'US411' | 'US33' | 'US17'

/**
 * Universal ringlock standard specs in FEET world units.
 *
 * Assumption (matches typical naming):
 * - US99 = 9'9"
 * - US66 = 6'6"
 * - US411 = 4'11"
 * - US33 = 3'3"
 * - US17 = 1'7"
 */
export const UNIVERSAL_RINGLOCK_STANDARDS: Record<UniversalRinglockStandardId, {
  heightFt: number
  rosetteCount: number
  weightLbs: number
}> = {
  US99: { heightFt: feetInchesToFeet(9, 9), rosetteCount: 6, weightLbs: 30.2 },
  US66: { heightFt: feetInchesToFeet(6, 6), rosetteCount: 4, weightLbs: 21.0 },
  US411: { heightFt: feetInchesToFeet(4, 11), rosetteCount: 3, weightLbs: 18.0 },
  US33: { heightFt: feetInchesToFeet(3, 3), rosetteCount: 2, weightLbs: 11.9 },
  US17: { heightFt: feetInchesToFeet(1, 7), rosetteCount: 1, weightLbs: 6.0 },
}

export const UNIVERSAL_RINGLOCK_STANDARD_ORDER: UniversalRinglockStandardId[] = [
  'US17',
  'US33',
  'US411',
  'US66',
  'US99',
]
