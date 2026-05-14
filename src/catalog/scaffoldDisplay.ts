import type { CatalogCategoryKey, CatalogManufacturerId, CatalogPart } from './catalogSchema'
import { UNIVERSAL_RINGLOCK_STANDARDS } from '../components/scaffold/ringlockCatalog'
import {
  UNIVERSAL_RINGLOCK_BOARD_BRACKETS,
  UNIVERSAL_RINGLOCK_DIAGONALS,
  UNIVERSAL_RINGLOCK_HORIZONTALS,
  UNIVERSAL_RINGLOCK_SIDE_BRACKETS,
  UNIVERSAL_RINGLOCK_TRUSSES,
} from '../types/scaffoldGraph'

const PROFILE_NAMES: Record<CatalogManufacturerId, string> = {
  universal: 'Universal Manufacturing',
}

const PLANK_LENGTH_LABELS: Record<string, string> = {
  USP20ADG: `2'`,
  USP30ADG: `3'`,
  USP36ADG: `3'6"`,
  USP40ADG: `4'`,
  USP50ADG: `5'`,
  USP60ADG: `6'`,
  USP70ADG: `7'`,
  USP80ADG: `8'`,
  USP100ADG: `10'`,
}

export function roundDisplayWeightLb(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return null
  return Math.max(0, Math.round(Number(value)))
}

export function formatFeetAndInches(lengthFt: number) {
  if (!Number.isFinite(lengthFt) || lengthFt <= 0) return `0'`
  const totalIn = Math.max(0, Math.round(lengthFt * 12))
  const feet = Math.floor(totalIn / 12)
  const inches = totalIn % 12
  if (inches === 0) return `${feet}'`
  return `${feet}'${inches}"`
}

export function formatLengthFromInches(lengthIn: number) {
  return formatFeetAndInches(lengthIn / 12)
}

export function getCatalogProfileName(manufacturerId: CatalogManufacturerId) {
  return PROFILE_NAMES[manufacturerId] ?? 'Universal Manufacturing'
}

function getPlankLengthLabel(partNumber: string) {
  const baseCode = partNumber.replace(/-6$/i, '')
  return PLANK_LENGTH_LABELS[baseCode] ?? null
}

export function getGenericPartDisplayName(
  partNumber: string,
  categoryKey?: CatalogCategoryKey,
  part?: Pick<CatalogPart, 'plankWidthIn'>,
) {
  if (!partNumber) {
    switch (categoryKey) {
      case 'standards':
        return 'STANDARD'
      case 'ledgers':
        return 'LEDGER'
      case 'braces':
        return 'DIAGONAL BRACE'
      case 'trusses':
        return 'TRUSS'
      case 'sideBrackets':
        return 'BRACKET'
      case 'planks':
        return 'STEEL DECK'
      default:
        return 'RINGLOCK COMPONENT'
    }
  }

  if (partNumber in UNIVERSAL_RINGLOCK_STANDARDS) {
    return `${formatFeetAndInches(UNIVERSAL_RINGLOCK_STANDARDS[partNumber as keyof typeof UNIVERSAL_RINGLOCK_STANDARDS].heightFt)} STANDARD`
  }
  if (partNumber in UNIVERSAL_RINGLOCK_TRUSSES) {
    return `${formatLengthFromInches(UNIVERSAL_RINGLOCK_TRUSSES[partNumber as keyof typeof UNIVERSAL_RINGLOCK_TRUSSES].lengthIn)} TRUSS`
  }
  if (partNumber in UNIVERSAL_RINGLOCK_HORIZONTALS) {
    return `${formatLengthFromInches(UNIVERSAL_RINGLOCK_HORIZONTALS[partNumber as keyof typeof UNIVERSAL_RINGLOCK_HORIZONTALS].lengthIn)} LEDGER`
  }
  if (partNumber in UNIVERSAL_RINGLOCK_DIAGONALS) {
    return `${formatLengthFromInches(UNIVERSAL_RINGLOCK_DIAGONALS[partNumber as keyof typeof UNIVERSAL_RINGLOCK_DIAGONALS].baySizeIn)} DIAGONAL BRACE`
  }
  if (partNumber in UNIVERSAL_RINGLOCK_SIDE_BRACKETS) {
    return `${formatLengthFromInches(UNIVERSAL_RINGLOCK_SIDE_BRACKETS[partNumber as keyof typeof UNIVERSAL_RINGLOCK_SIDE_BRACKETS].lengthIn)} SIDE BRACKET`
  }
  if (partNumber in UNIVERSAL_RINGLOCK_BOARD_BRACKETS) {
    return `${formatLengthFromInches(UNIVERSAL_RINGLOCK_BOARD_BRACKETS[partNumber as keyof typeof UNIVERSAL_RINGLOCK_BOARD_BRACKETS].lengthIn)} BOARD BRACKET`
  }
  if (partNumber.startsWith('USP')) {
    const lengthLabel = getPlankLengthLabel(partNumber) ?? 'DECK'
    const widthLabel = typeof part?.plankWidthIn === 'number' ? ` - ${part.plankWidthIn}"` : ''
    return `${lengthLabel} STEEL DECK${widthLabel}`
  }

  return partNumber
}

export function getCatalogPartDisplayName(categoryKey: CatalogCategoryKey, part: CatalogPart) {
  return part.displayName ?? getGenericPartDisplayName(part.partNumber, categoryKey, part)
}

export function getCatalogPartSpecLabel(categoryKey: CatalogCategoryKey, part: CatalogPart) {
  const bits: string[] = []

  if (part.description) bits.push(part.description)

  if (categoryKey === 'planks') {
    if (typeof part.plankWidthIn === 'number') bits.push(`${part.plankWidthIn.toFixed(0)}" wide`)
  } else if (typeof part.tubeODIn === 'number' && typeof part.tubeWallIn === 'number') {
    bits.push(`${part.tubeODIn.toFixed(2)}" OD`)
    bits.push(`${part.tubeWallIn.toFixed(3)}" wall`)
  }

  const weightLb = roundDisplayWeightLb(part.weightLb)
  if (typeof weightLb === 'number') bits.push(`${weightLb} lb`)
  return bits.join(' | ') || 'Generic scaffold component'
}

export function formatDisplayWeight(weightLb: number | null | undefined) {
  const rounded = roundDisplayWeightLb(weightLb)
  if (rounded == null) return '--'
  return `${rounded} lb`
}
