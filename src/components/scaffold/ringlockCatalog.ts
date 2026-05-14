import { feetInchesToFeet } from './units'

export type UniversalRinglockStandardId = 'US99' | 'US66' | 'US411' | 'US33' | 'US17'

/**
 * Universal ringlock standard specs in FEET world units.
 *
 * Exact overall lengths from the Universal standard sheet:
 * - US99 = 9'-10 1/8"
 * - US66 = 6'-6 3/4"
 * - US411 = 4'-11 1/16"
 * - US33 = 3'-3 3/8"
 * - US17 = 1'-7 11/16"
 */
export const UNIVERSAL_RINGLOCK_STANDARDS: Record<UniversalRinglockStandardId, {
  heightFt: number
  rosetteCount: number
  weightLbs: number
}> = {
  US99: { heightFt: feetInchesToFeet(9, 10.125), rosetteCount: 6, weightLbs: 30.2 },
  US66: { heightFt: feetInchesToFeet(6, 6.75), rosetteCount: 4, weightLbs: 21.0 },
  US411: { heightFt: feetInchesToFeet(4, 11.0625), rosetteCount: 3, weightLbs: 18.0 },
  US33: { heightFt: feetInchesToFeet(3, 3.375), rosetteCount: 2, weightLbs: 11.9 },
  US17: { heightFt: feetInchesToFeet(1, 7.6875), rosetteCount: 1, weightLbs: 6.0 },
}

export const UNIVERSAL_RINGLOCK_STANDARD_ORDER: UniversalRinglockStandardId[] = [
  'US17',
  'US33',
  'US411',
  'US66',
  'US99',
]
