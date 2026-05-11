import * as THREE from 'three'
import type { CatalogPart } from '../../catalog/catalogSchema'
import type { ManualPlankPlacement } from '../../types/scaffoldGraph'
import { RINGLOCK_PLANK_PROFILE_DEPTH_IN, RINGLOCK_PLANK_WIDTH_IN, type RinglockPlankInstance } from './RinglockPlanks'
import type { RinglockLedgerInstance } from './RinglockLedgers'
import { buildBestFitPlankLayout } from './plankLayout'
import { inchesToFeet } from './units'
import {
	LEDGER_TUBE_OD_IN,
	buildSupportPair,
	computeSupportAxisInterval,
	getSupportFrame,
	type SupportFrame,
} from './manualSupportSpan'

const PLANK_MOUTHPIECE_TOTAL_IN = 6
const SAME_LIFT_TOL_FT = inchesToFeet(1)
const SAME_LINE_TOL_FT = inchesToFeet(2)
const TOUCH_TOL_FT = inchesToFeet(2)
type LedgerFrame = SupportFrame<RinglockLedgerInstance>

export type ManualPlankPreview = {
	placement: ManualPlankPlacement
	planks: RinglockPlankInstance[]
}

function buildPlankInstancesFromFrames(
	placementId: string,
	source: LedgerFrame,
	target: LedgerFrame,
	plankCatalogParts: Array<Pick<CatalogPart, 'partNumber' | 'plankWidthIn'>> = [],
): RinglockPlankInstance[] {
	const plankDepthFt = inchesToFeet(RINGLOCK_PLANK_PROFILE_DEPTH_IN)
	const plankSeatOffsetFt = inchesToFeet(LEDGER_TUBE_OD_IN / 2) - plankDepthFt / 2
	const signedOffset = target.mid.clone().sub(source.mid).dot(source.perp)
	const runLengthFt = Math.abs(signedOffset)
	const supportLengthIn = source.lengthFt * 12
	const usableSpanIn = Math.max(0, supportLengthIn - PLANK_MOUTHPIECE_TOTAL_IN)
	const plankLayout = buildBestFitPlankLayout(usableSpanIn, runLengthFt, plankCatalogParts)
	if (plankLayout.length === 0) return []

	const visibleLengthFt = Math.max(inchesToFeet(RINGLOCK_PLANK_WIDTH_IN), runLengthFt - inchesToFeet(0.25))
	const runDir = source.perp.clone().multiplyScalar(Math.sign(signedOffset) || 1)
	const rotationZ = Math.PI / 2 - Math.atan2(runDir.y, runDir.x)
	const betweenMid = source.mid.clone().add(source.perp.clone().multiplyScalar(signedOffset / 2))
	const deckCenterZ = source.z + plankSeatOffsetFt

	return plankLayout.map((slot, index) => {
		return {
			id: `${placementId}:${index}`,
			center: new THREE.Vector3(
				betweenMid.x + source.dir.x * slot.centerOffsetFt,
				betweenMid.y + source.dir.y * slot.centerOffsetFt,
				deckCenterZ,
			),
			rotationZ,
			lengthFt: visibleLengthFt,
			widthIn: slot.widthIn,
			partNumber: slot.partNumber,
		}
	})
}

function hasExistingPlacement(existingPlacements: ManualPlankPlacement[], supportLedgerId: string, sideSign: 1 | -1) {
	return existingPlacements.some(p => p.supportLedgerId === supportLedgerId && p.sideSign === sideSign)
}

export function buildManualPlankPreviewForLedger(
	sourceLedger: RinglockLedgerInstance,
	ledgers: RinglockLedgerInstance[],
	sideSign: 1 | -1,
	existingPlacements: ManualPlankPlacement[],
	plankCatalogParts: Array<Pick<CatalogPart, 'partNumber' | 'plankWidthIn'>> = [],
): ManualPlankPreview | null {
	if (hasExistingPlacement(existingPlacements, sourceLedger.id, sideSign)) return null
	const supportPair = buildSupportPair(sourceLedger, ledgers, sideSign)
	if (!supportPair) return null
	return {
		placement: { id: `preview:${sourceLedger.id}:${sideSign}`, supportLedgerId: sourceLedger.id, sideSign },
		planks: buildPlankInstancesFromFrames(
			`preview:${sourceLedger.id}:${sideSign}`,
			supportPair.source,
			supportPair.target,
			plankCatalogParts,
		),
	}
}

export function buildManualPlankInstances(
	placements: ManualPlankPlacement[],
	ledgers: RinglockLedgerInstance[],
	plankCatalogParts: Array<Pick<CatalogPart, 'partNumber' | 'plankWidthIn'>> = [],
): RinglockPlankInstance[] {
	const out: RinglockPlankInstance[] = []
	for (const placement of placements) {
		const sourceLedger = ledgers.find(ledger => ledger.id === placement.supportLedgerId)
		if (!sourceLedger) continue
		const supportPair = buildSupportPair(sourceLedger, ledgers, placement.sideSign)
		if (!supportPair) continue
		out.push(...buildPlankInstancesFromFrames(placement.id, supportPair.source, supportPair.target, plankCatalogParts))
	}
	return out
}

export function computeManualPlankBatchPreview(
	sourceLedger: RinglockLedgerInstance,
	ledgers: RinglockLedgerInstance[],
	sideSign: 1 | -1,
	existingPlacements: ManualPlankPlacement[],
	plankCatalogParts: Array<Pick<CatalogPart, 'partNumber' | 'plankWidthIn'>> = [],
): ManualPlankPreview[] {
	const source = getSupportFrame(sourceLedger)
	if (!source) return []

	const sameLine = ledgers
		.map(getSupportFrame)
		.filter((frame): frame is LedgerFrame => frame !== null)
		.filter(frame =>
			Math.abs(frame.z - source.z) <= SAME_LIFT_TOL_FT &&
			Math.abs(Math.abs(source.dir.dot(frame.dir)) - 1) <= 1 - 0.985 &&
			Math.abs(frame.mid.clone().sub(source.mid).dot(source.perp)) <= SAME_LINE_TOL_FT,
		)

	const byId = new Map(sameLine.map(frame => [frame.ledger.id, frame]))
	const component = new Set<string>([source.ledger.id])
	const queue = [source.ledger.id]

	while (queue.length > 0) {
		const current = byId.get(queue.shift() ?? '')
		if (!current) continue
		const a = computeSupportAxisInterval(current, source.mid)
		for (const candidate of sameLine) {
			if (component.has(candidate.ledger.id)) continue
			const b = computeSupportAxisInterval(candidate, source.mid)
			const touches = a.min <= b.max + TOUCH_TOL_FT && b.min <= a.max + TOUCH_TOL_FT
			if (!touches) continue
			component.add(candidate.ledger.id)
			queue.push(candidate.ledger.id)
		}
	}

	return sameLine
		.filter(frame => component.has(frame.ledger.id))
		.sort((a, b) => computeSupportAxisInterval(a, source.mid).min - computeSupportAxisInterval(b, source.mid).min)
		.map(frame => buildManualPlankPreviewForLedger(frame.ledger, ledgers, sideSign, existingPlacements, plankCatalogParts))
		.filter((preview): preview is ManualPlankPreview => preview !== null)
}

export { getLedgerSideSign } from './manualSupportSpan'
