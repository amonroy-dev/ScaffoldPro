import { UNIVERSAL_PLANK_SPECS } from './catalogData'

/**
 * Archived legacy Universal-facing catalog metadata.
 *
 * This file is intentionally not wired into the active UI.
 * It exists so the current generic presentation layer can stay clean while
 * preserving the prior Universal-oriented identifiers and source weights.
 */
export const UNIVERSAL_LEGACY_ARCHIVE = {
  profileName: 'Universal',
  profileCode: 'UMC',
  categories: {
    standards: ['US99', 'US66', 'US411', 'US33', 'US17'],
    ledgers: ['UH100', 'UH80', 'UH70', 'UH60', 'UH50', 'UH40', 'UH36', 'UH30', 'UH20'],
    braces: ['UD100', 'UD80', 'UD70', 'UD60', 'UD50', 'UD40', 'UD36', 'UD30', 'UD20'],
    trusses: ['UHT100', 'UHT80', 'UHT70', 'UHT60', 'UHT50'],
    sideBrackets: ['USB36', 'USB30', 'USB20', 'UBB27', 'UBB18', 'UBB010CO', 'UBB010'],
    planks: UNIVERSAL_PLANK_SPECS.map((part) => ({
      partNumber: part.partNumber,
      displayName: part.displayName,
      sourceWeightLb: part.sourceWeightLb ?? part.weightLb,
      weightLb: part.weightLb,
      nominalLengthFt: part.nominalLengthFt,
      plankWidthIn: part.plankWidthIn,
    })),
  },
} as const

export type UniversalLegacyArchive = typeof UNIVERSAL_LEGACY_ARCHIVE
