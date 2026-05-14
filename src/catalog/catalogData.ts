import type { Catalog, CatalogCategoryKey, CatalogPart } from './catalogSchema'
import { makePartId, validateCatalog } from './catalogSchema'
import { roundDisplayWeightLb } from './scaffoldDisplay'
import {
  UNIVERSAL_SYSTEM_SCAFFOLD_LIBRARY,
  getUniversalSystemLibraryEntry,
} from './universalSystemLibrary'

export const DEFAULT_TUBE_OD_IN = 1.9
export const DEFAULT_TUBE_WALL_IN = 0.12
export const DEFAULT_PLANK_WIDTH_IN = 9
const NARROW_PLANK_WIDTH_IN = 6
const DEFAULT_PLANK_MOUTHPIECE_IN = 3

type UniversalPlankSpec = {
  partNumber: string
  displayName: string
  nominalLengthFt: number
  lengthLabel: string
  plankWidthIn: number
  mouthpieceInsetIn: number
  finish: string
  description: string
  sourceWeightLb?: number
  weightLb: number
}

const UNIVERSAL_MANUFACTURER = {
  id: 'universal',
  name: UNIVERSAL_SYSTEM_SCAFFOLD_LIBRARY.manufacturerName,
  code: 'UMC',
} as const

const UNIVERSAL_SUPPORTED_PARTS = {
  standards: ['US99', 'US66', 'US411', 'US33', 'US17'],
  ledgers: ['UH100', 'UH80', 'UH70', 'UH60', 'UH50', 'UH40', 'UH36', 'UH30', 'UH20'],
  braces: ['UD100', 'UD80', 'UD70', 'UD60', 'UD50', 'UD40', 'UD36', 'UD30', 'UD20'],
  trusses: ['UHT100', 'UHT80', 'UHT70', 'UHT60', 'UHT50'],
  sideBrackets: ['USB36', 'USB30', 'USB20', 'UBB18', 'UBB010CO', 'UBB010'],
} as const

function buildUniversalPartDescription(description: string) {
  return description
}

function makeCatalogWeight(value: number | undefined) {
  if (!Number.isFinite(Number(value))) return undefined
  return roundDisplayWeightLb(value) ?? undefined
}

const UNIVERSAL_A_STYLE_PLANKS = [
  { partNumber: 'USP20ADG', nominalLengthFt: 2, lengthLabel: `2'`, plankWidthIn: DEFAULT_PLANK_WIDTH_IN },
  { partNumber: 'USP30ADG', nominalLengthFt: 3, lengthLabel: `3'`, plankWidthIn: DEFAULT_PLANK_WIDTH_IN },
  { partNumber: 'USP36ADG', nominalLengthFt: 3.5, lengthLabel: `3' 6"`, plankWidthIn: DEFAULT_PLANK_WIDTH_IN },
  { partNumber: 'USP40ADG', nominalLengthFt: 4, lengthLabel: `4'`, plankWidthIn: DEFAULT_PLANK_WIDTH_IN },
  { partNumber: 'USP50ADG', nominalLengthFt: 5, lengthLabel: `5'`, plankWidthIn: DEFAULT_PLANK_WIDTH_IN },
  { partNumber: 'USP60ADG', nominalLengthFt: 6, lengthLabel: `6'`, plankWidthIn: DEFAULT_PLANK_WIDTH_IN },
  { partNumber: 'USP70ADG', nominalLengthFt: 7, lengthLabel: `7'`, plankWidthIn: DEFAULT_PLANK_WIDTH_IN },
  { partNumber: 'USP80ADG', nominalLengthFt: 8, lengthLabel: `8'`, plankWidthIn: DEFAULT_PLANK_WIDTH_IN },
  { partNumber: 'USP100ADG', nominalLengthFt: 10, lengthLabel: `10'`, plankWidthIn: DEFAULT_PLANK_WIDTH_IN },
  { partNumber: 'USP20-6ADG', nominalLengthFt: 2, lengthLabel: `2'`, plankWidthIn: NARROW_PLANK_WIDTH_IN },
  { partNumber: 'USP30-6ADG', nominalLengthFt: 3, lengthLabel: `3'`, plankWidthIn: NARROW_PLANK_WIDTH_IN },
  { partNumber: 'USP36-6ADG', nominalLengthFt: 3.5, lengthLabel: `3' 6"`, plankWidthIn: NARROW_PLANK_WIDTH_IN },
  { partNumber: 'USP40-6ADG', nominalLengthFt: 4, lengthLabel: `4'`, plankWidthIn: NARROW_PLANK_WIDTH_IN },
  { partNumber: 'USP50-6ADG', nominalLengthFt: 5, lengthLabel: `5'`, plankWidthIn: NARROW_PLANK_WIDTH_IN },
  { partNumber: 'USP60-6ADG', nominalLengthFt: 6, lengthLabel: `6'`, plankWidthIn: NARROW_PLANK_WIDTH_IN },
  { partNumber: 'USP70-6ADG', nominalLengthFt: 7, lengthLabel: `7'`, plankWidthIn: NARROW_PLANK_WIDTH_IN },
  { partNumber: 'USP80-6ADG', nominalLengthFt: 8, lengthLabel: `8'`, plankWidthIn: NARROW_PLANK_WIDTH_IN },
  { partNumber: 'USP100-6ADG', nominalLengthFt: 10, lengthLabel: `10'`, plankWidthIn: NARROW_PLANK_WIDTH_IN },
] as const

const autoLayoutPlankSpecByPartNumber = new Map<string, (typeof UNIVERSAL_A_STYLE_PLANKS)[number]>(
  UNIVERSAL_A_STYLE_PLANKS.map((spec) => [spec.partNumber, spec] as const),
)

export const UNIVERSAL_PLANK_SPECS: UniversalPlankSpec[] = UNIVERSAL_A_STYLE_PLANKS.map((spec) => {
  const libraryEntry = getUniversalSystemLibraryEntry('planks', spec.partNumber)
  const sourceWeightLb = libraryEntry?.weightLb
  return {
    partNumber: spec.partNumber,
    displayName: spec.partNumber,
    nominalLengthFt: spec.nominalLengthFt,
    lengthLabel: spec.lengthLabel,
    plankWidthIn: spec.plankWidthIn,
    mouthpieceInsetIn: DEFAULT_PLANK_MOUTHPIECE_IN,
    finish: 'Galvanized steel',
    description: buildUniversalPartDescription(
      libraryEntry?.description ?? spec.partNumber,
    ),
    sourceWeightLb,
    weightLb: makeCatalogWeight(sourceWeightLb) ?? sourceWeightLb ?? 0,
  }
})

function makeTubeParts(
  manufacturerCode: string,
  categoryKey: Exclude<CatalogCategoryKey, 'planks' | 'liveLoads' | 'sideBrackets'>,
  sourceCategory: 'columns' | 'horizontals' | 'diagonals',
  partNumbers: string[],
) {
  return partNumbers.flatMap((partNumber) => {
    const libraryEntry = getUniversalSystemLibraryEntry(sourceCategory, partNumber)
    if (!libraryEntry) return []
    return [{
      id: makePartId({ manufacturerCode, categoryKey, partNumber }),
      partNumber,
      displayName: partNumber,
      sourceWeightLb: libraryEntry.weightLb,
      weightLb: makeCatalogWeight(libraryEntry.weightLb),
      tubeODIn: DEFAULT_TUBE_OD_IN,
      tubeWallIn: DEFAULT_TUBE_WALL_IN,
      description: buildUniversalPartDescription(libraryEntry.description),
    }]
  })
}

function makeSideBracketParts(manufacturerCode: string, partNumbers: string[]) {
  return partNumbers.flatMap((partNumber) => {
    const libraryEntry = getUniversalSystemLibraryEntry('sidearms', partNumber)
    if (!libraryEntry) return []
    return [{
      id: makePartId({ manufacturerCode, categoryKey: 'sideBrackets', partNumber }),
      partNumber,
      displayName: partNumber,
      sourceWeightLb: libraryEntry.weightLb,
      weightLb: makeCatalogWeight(libraryEntry.weightLb),
      description: buildUniversalPartDescription(libraryEntry.description),
    }]
  })
}

function makePlankPart(manufacturerCode: string, partNumber: string): CatalogPart | null {
  const libraryEntry = getUniversalSystemLibraryEntry('planks', partNumber)
  if (!libraryEntry) return null
  const autoLayoutSpec = autoLayoutPlankSpecByPartNumber.get(partNumber)
  const finish = libraryEntry.description.includes('Aluminum')
    ? (libraryEntry.description.includes('Ply') ? 'Aluminum / plywood' : 'Aluminum')
    : 'Galvanized steel'

  return {
    id: makePartId({ manufacturerCode, categoryKey: 'planks', partNumber }),
    partNumber,
    displayName: partNumber,
    sourceWeightLb: libraryEntry.weightLb,
    weightLb: makeCatalogWeight(libraryEntry.weightLb),
    plankWidthIn: autoLayoutSpec?.plankWidthIn,
    mouthpieceInsetIn: autoLayoutSpec ? DEFAULT_PLANK_MOUTHPIECE_IN : undefined,
    finish,
    description: buildUniversalPartDescription(libraryEntry.description),
  }
}

function makePlankParts(manufacturerCode: string) {
  return Object.keys(UNIVERSAL_SYSTEM_SCAFFOLD_LIBRARY.categories.planks)
    .map((partNumber) => makePlankPart(manufacturerCode, partNumber))
    .filter((part): part is CatalogPart => part !== null)
}

export const CATALOG: Catalog = validateCatalog({
  manufacturers: [{
    id: UNIVERSAL_MANUFACTURER.id,
    name: UNIVERSAL_MANUFACTURER.name,
    code: UNIVERSAL_MANUFACTURER.code,
    categories: {
      standards: {
        key: 'standards',
        name: 'Standards',
        // We keep only stackable standard segments in the active catalog category.
        parts: makeTubeParts(UNIVERSAL_MANUFACTURER.code, 'standards', 'columns', [...UNIVERSAL_SUPPORTED_PARTS.standards]),
      },
      ledgers: {
        key: 'ledgers',
        name: 'Ledgers',
        parts: makeTubeParts(UNIVERSAL_MANUFACTURER.code, 'ledgers', 'horizontals', [...UNIVERSAL_SUPPORTED_PARTS.ledgers]),
      },
      braces: {
        key: 'braces',
        name: 'Braces',
        parts: makeTubeParts(UNIVERSAL_MANUFACTURER.code, 'braces', 'diagonals', [...UNIVERSAL_SUPPORTED_PARTS.braces]),
      },
      trusses: {
        key: 'trusses',
        name: 'Trusses',
        parts: makeTubeParts(UNIVERSAL_MANUFACTURER.code, 'trusses', 'horizontals', [...UNIVERSAL_SUPPORTED_PARTS.trusses]),
      },
      sideBrackets: {
        key: 'sideBrackets',
        name: 'Side Brackets',
        parts: makeSideBracketParts(UNIVERSAL_MANUFACTURER.code, [...UNIVERSAL_SUPPORTED_PARTS.sideBrackets]),
      },
      planks: {
        key: 'planks',
        name: 'Planks',
        parts: makePlankParts(UNIVERSAL_MANUFACTURER.code),
      },
      liveLoads: {
        key: 'liveLoads',
        name: 'Live Loads',
        parts: [],
      },
    },
  }],
})
