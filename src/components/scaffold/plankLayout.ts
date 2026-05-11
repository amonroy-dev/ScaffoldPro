import type { CatalogPart } from '../../catalog/catalogSchema'
import { UNIVERSAL_PLANK_SPECS } from '../../catalog/catalogData'
import { inchesToFeet } from './units'

export const NARROW_PLANK_WIDTH_IN = 6 as const

type PlankCatalogRef = Pick<CatalogPart, 'partNumber' | 'plankWidthIn'>

export type SupportedPlankWidthIn = typeof NARROW_PLANK_WIDTH_IN | 9

export type PlankLayoutSlot = {
	widthIn: SupportedPlankWidthIn
	centerOffsetFt: number
	partNumber?: string
}

const nominalLengthByPartNumber = new Map(
	UNIVERSAL_PLANK_SPECS.map((spec) => [spec.partNumber, spec.nominalLengthFt] as const),
)

export function resolveClosestCatalogPlankPartNumber(
	parts: PlankCatalogRef[],
	widthIn: number,
	nominalLengthFt: number,
) {
	const widthMatchedParts = parts.filter((part) => part.plankWidthIn === widthIn)

	let bestPartNumber: string | undefined
	let bestLengthDelta = Infinity

	for (const part of widthMatchedParts) {
		const catalogLengthFt = nominalLengthByPartNumber.get(part.partNumber)
		if (typeof catalogLengthFt !== 'number') continue

		const lengthDelta = Math.abs(catalogLengthFt - nominalLengthFt)
		if (lengthDelta < bestLengthDelta) {
			bestLengthDelta = lengthDelta
			bestPartNumber = part.partNumber
		}
	}

	if (bestPartNumber) return bestPartNumber
	if (widthMatchedParts.length === 1) return widthMatchedParts[0]?.partNumber
	return undefined
}

export function buildBestFitPlankLayout(
	usableSpanIn: number,
	nominalLengthFt: number,
	parts: PlankCatalogRef[] = [],
): PlankLayoutSlot[] {
	if (!Number.isFinite(usableSpanIn) || usableSpanIn < NARROW_PLANK_WIDTH_IN) return []

	let bestCoveredIn = 0
	let bestNineCount = 0
	let bestSixCount = 0
	const maxNineCount = Math.floor(usableSpanIn / 9)

	for (let nineCount = maxNineCount; nineCount >= 0; nineCount--) {
		const remainingIn = Math.max(0, usableSpanIn - nineCount * 9)
		const sixCount = Math.floor(remainingIn / NARROW_PLANK_WIDTH_IN)
		const coveredIn = nineCount * 9 + sixCount * NARROW_PLANK_WIDTH_IN

		const isBetter =
			coveredIn > bestCoveredIn ||
			(coveredIn === bestCoveredIn && nineCount > bestNineCount) ||
			(coveredIn === bestCoveredIn && nineCount === bestNineCount && sixCount < bestSixCount)

		if (isBetter) {
			bestCoveredIn = coveredIn
			bestNineCount = nineCount
			bestSixCount = sixCount
		}
	}

	if (bestCoveredIn < NARROW_PLANK_WIDTH_IN) return []

	const leftNineCount = Math.floor(bestNineCount / 2)
	const rightNineCount = bestNineCount - leftNineCount
	const orderedWidths = [
		...Array.from({ length: leftNineCount }, () => 9 as const),
		...Array.from({ length: bestSixCount }, () => NARROW_PLANK_WIDTH_IN),
		...Array.from({ length: rightNineCount }, () => 9 as const),
	]

	let cursorIn = -bestCoveredIn / 2
	return orderedWidths.map((widthIn) => {
		const centerOffsetFt = inchesToFeet(cursorIn + widthIn / 2)
		cursorIn += widthIn
		return {
			widthIn,
			centerOffsetFt,
			partNumber: resolveClosestCatalogPlankPartNumber(parts, widthIn, nominalLengthFt),
		}
	})
}