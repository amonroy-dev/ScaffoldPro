import type { Catalog, CatalogCategoryKey, CatalogPart } from './catalogSchema'
import { makePartId, validateCatalog } from './catalogSchema'
import { getGenericPartDisplayName, roundDisplayWeightLb } from './scaffoldDisplay'
import { UNIVERSAL_RINGLOCK_STANDARDS } from '../components/scaffold/ringlockCatalog'
import {
  UNIVERSAL_RINGLOCK_BOARD_BRACKETS,
  UNIVERSAL_RINGLOCK_DIAGONALS,
  UNIVERSAL_RINGLOCK_HORIZONTALS,
  UNIVERSAL_RINGLOCK_SIDE_BRACKETS,
  UNIVERSAL_RINGLOCK_TRUSSES,
} from '../types/scaffoldGraph'

/**
 * Current placeholder tube spec for the listed parts.
 * (User will later provide per-part descriptions + weights.)
 */
export const DEFAULT_TUBE_OD_IN = 1.9
export const DEFAULT_TUBE_WALL_IN = 0.12
export const DEFAULT_PLANK_WIDTH_IN = 9
const NARROW_PLANK_WIDTH_IN = 6
const DEFAULT_PLANK_MOUTHPIECE_IN = 3

type UniversalPlankSpec = {
  partNumber: string
  displayName?: string
  nominalLengthFt: number
  lengthLabel: string
  plankWidthIn: number
  mouthpieceInsetIn: number
  finish: string
  description: string
  sourceWeightLb?: number
  weightLb: number
}

function roundToTenth(value: number) {
  return Math.round(value * 10) / 10
}

const UNIVERSAL_LOW_PROFILE_9IN_PLANKS = [
  { partNumber: 'USP20ADG', nominalLengthFt: 2, lengthLabel: `2'`, weightLb: 10.9 },
  { partNumber: 'USP30ADG', nominalLengthFt: 3, lengthLabel: `3'`, weightLb: 15.0 },
  { partNumber: 'USP36ADG', nominalLengthFt: 3.5, lengthLabel: `3' 6"`, weightLb: 17.0 },
  { partNumber: 'USP40ADG', nominalLengthFt: 4, lengthLabel: `4'`, weightLb: 19.3 },
  { partNumber: 'USP50ADG', nominalLengthFt: 5, lengthLabel: `5'`, weightLb: 23.0 },
  { partNumber: 'USP60ADG', nominalLengthFt: 6, lengthLabel: `6'`, weightLb: 27.0 },
  { partNumber: 'USP70ADG', nominalLengthFt: 7, lengthLabel: `7'`, weightLb: 32.0 },
  { partNumber: 'USP80ADG', nominalLengthFt: 8, lengthLabel: `8'`, weightLb: 35.0 },
  { partNumber: 'USP100ADG', nominalLengthFt: 10, lengthLabel: `10'`, weightLb: 44.0 },
] as const

export const UNIVERSAL_PLANK_SPECS: UniversalPlankSpec[] = [
  ...UNIVERSAL_LOW_PROFILE_9IN_PLANKS.map((plank) => ({
    partNumber: plank.partNumber,
    displayName: getGenericPartDisplayName(plank.partNumber, 'planks', { plankWidthIn: DEFAULT_PLANK_WIDTH_IN } as CatalogPart),
    nominalLengthFt: plank.nominalLengthFt,
    lengthLabel: plank.lengthLabel,
    plankWidthIn: DEFAULT_PLANK_WIDTH_IN,
    mouthpieceInsetIn: DEFAULT_PLANK_MOUTHPIECE_IN,
    finish: 'Galvanized steel',
    description: `${plank.lengthLabel} steel deck for a generic ringlock profile`,
    sourceWeightLb: plank.weightLb,
    weightLb: roundDisplayWeightLb(plank.weightLb) ?? plank.weightLb,
  })),
  ...UNIVERSAL_LOW_PROFILE_9IN_PLANKS.map((plank) => ({
    partNumber: `${plank.partNumber}-6`,
    displayName: getGenericPartDisplayName(`${plank.partNumber}-6`, 'planks', { plankWidthIn: NARROW_PLANK_WIDTH_IN } as CatalogPart),
    nominalLengthFt: plank.nominalLengthFt,
    lengthLabel: plank.lengthLabel,
    plankWidthIn: NARROW_PLANK_WIDTH_IN,
    mouthpieceInsetIn: DEFAULT_PLANK_MOUTHPIECE_IN,
    finish: 'Galvanized steel',
    description: `${plank.lengthLabel} narrow steel deck for a generic ringlock profile`,
    sourceWeightLb: roundToTenth((plank.weightLb * NARROW_PLANK_WIDTH_IN) / DEFAULT_PLANK_WIDTH_IN),
    weightLb: roundDisplayWeightLb(roundToTenth((plank.weightLb * NARROW_PLANK_WIDTH_IN) / DEFAULT_PLANK_WIDTH_IN)) ?? roundToTenth((plank.weightLb * NARROW_PLANK_WIDTH_IN) / DEFAULT_PLANK_WIDTH_IN),
  })),
]

function getSourceWeightLb(partNumber: string) {
  if (partNumber in UNIVERSAL_RINGLOCK_STANDARDS) {
    return UNIVERSAL_RINGLOCK_STANDARDS[partNumber as keyof typeof UNIVERSAL_RINGLOCK_STANDARDS].weightLbs
  }
  if (partNumber in UNIVERSAL_RINGLOCK_TRUSSES) {
    return UNIVERSAL_RINGLOCK_TRUSSES[partNumber as keyof typeof UNIVERSAL_RINGLOCK_TRUSSES].weightLbs
  }
  if (partNumber in UNIVERSAL_RINGLOCK_HORIZONTALS) {
    return UNIVERSAL_RINGLOCK_HORIZONTALS[partNumber as keyof typeof UNIVERSAL_RINGLOCK_HORIZONTALS].weightLbs
  }
  if (partNumber in UNIVERSAL_RINGLOCK_DIAGONALS) {
    return UNIVERSAL_RINGLOCK_DIAGONALS[partNumber as keyof typeof UNIVERSAL_RINGLOCK_DIAGONALS].weightLbs
  }
  if (partNumber in UNIVERSAL_RINGLOCK_SIDE_BRACKETS) {
    return UNIVERSAL_RINGLOCK_SIDE_BRACKETS[partNumber as keyof typeof UNIVERSAL_RINGLOCK_SIDE_BRACKETS].weightLbs
  }
  if (partNumber in UNIVERSAL_RINGLOCK_BOARD_BRACKETS) {
    return UNIVERSAL_RINGLOCK_BOARD_BRACKETS[partNumber as keyof typeof UNIVERSAL_RINGLOCK_BOARD_BRACKETS].weightLbs
  }
  return undefined
}

function getGenericDescription(partNumber: string, categoryKey: CatalogCategoryKey) {
  const displayName = getGenericPartDisplayName(partNumber, categoryKey)
  switch (categoryKey) {
    case 'standards':
      return `${displayName} for a generic ringlock profile`
    case 'ledgers':
      return `${displayName} for generic ringlock bay connections`
    case 'braces':
      return `${displayName} for generic ringlock bay bracing`
    case 'trusses':
      return `${displayName} for longer-span ringlock runs`
    case 'sideBrackets':
      return `${displayName} for platform extension support`
    default:
      return displayName
  }
}

function makeTubeParts(manufacturerCode: string, categoryKey: CatalogCategoryKey, partNumbers: string[]) {
  return partNumbers.map((partNumber) => ({
    id: makePartId({ manufacturerCode, categoryKey, partNumber }),
    partNumber,
    displayName: getGenericPartDisplayName(partNumber, categoryKey),
    sourceWeightLb: getSourceWeightLb(partNumber),
    weightLb: roundDisplayWeightLb(getSourceWeightLb(partNumber)) ?? undefined,
    tubeODIn: DEFAULT_TUBE_OD_IN,
    tubeWallIn: DEFAULT_TUBE_WALL_IN,
    description: getGenericDescription(partNumber, categoryKey),
  }))
}

function makePlankParts(manufacturerCode: string, parts: Array<Omit<CatalogPart, 'id'>>) {
  return parts.map((part) => ({
    ...part,
    id: makePartId({ manufacturerCode, categoryKey: 'planks', partNumber: part.partNumber }),
  }))
}

const UNIVERSAL_PARTS = {
  standards: ['US99', 'US66', 'US411', 'US33', 'US17'],
  ledgers: ['UH100', 'UH80', 'UH70', 'UH60', 'UH50', 'UH40', 'UH36', 'UH30', 'UH20'],
  braces: ['UD100', 'UD80', 'UD70', 'UD60', 'UD50', 'UD40', 'UD36', 'UD30', 'UD20'],
  trusses: ['UHT100', 'UHT80', 'UHT70', 'UHT60', 'UHT50'],
  sideBrackets: ['USB36', 'USB30', 'USB20', 'UBB27', 'UBB18', 'UBB010CO', 'UBB010'],
  planks: UNIVERSAL_PLANK_SPECS.map(({ partNumber, displayName, plankWidthIn, mouthpieceInsetIn, finish, description, sourceWeightLb, weightLb }) => ({
    partNumber,
    displayName,
    plankWidthIn,
    mouthpieceInsetIn,
    finish,
    description,
    sourceWeightLb,
    weightLb,
  })),
  liveLoads: [],
} as const

const MANUFACTURERS = [
  { id: 'universal', name: 'Generic Ringlock', code: 'UMC' },
  { id: 'layher', name: 'Ringlock Profile A', code: 'LAY' },
  { id: 'brandsafway', name: 'Ringlock Profile B', code: 'BSW' },
  { id: 'direct', name: 'Ringlock Profile C', code: 'DIR' },
] as const

export const CATALOG: Catalog = validateCatalog({
  manufacturers: MANUFACTURERS.map((m) => ({
    id: m.id,
    name: m.name,
    code: m.code,
    categories: {
      standards: {
        key: 'standards',
        name: 'Standards',
        parts: makeTubeParts(m.code, 'standards', [...UNIVERSAL_PARTS.standards]),
      },
      ledgers: {
        key: 'ledgers',
        name: 'Ledgers',
        parts: makeTubeParts(m.code, 'ledgers', [...UNIVERSAL_PARTS.ledgers]),
      },
      braces: {
        key: 'braces',
        name: 'Braces',
        parts: makeTubeParts(m.code, 'braces', [...UNIVERSAL_PARTS.braces]),
      },
      trusses: {
        key: 'trusses',
        name: 'Trusses',
        parts: makeTubeParts(m.code, 'trusses', [...UNIVERSAL_PARTS.trusses]),
      },
      sideBrackets: {
        key: 'sideBrackets',
        name: 'Side Brackets',
        parts: makeTubeParts(m.code, 'sideBrackets', [...UNIVERSAL_PARTS.sideBrackets]),
      },
      planks: {
        key: 'planks',
        name: 'Planks',
        parts: m.id === 'universal' ? makePlankParts(m.code, [...UNIVERSAL_PARTS.planks]) : [],
      },
      liveLoads: {
        key: 'liveLoads',
        name: 'Live Loads',
        parts: [...UNIVERSAL_PARTS.liveLoads],
      },
    },
  })),
})
