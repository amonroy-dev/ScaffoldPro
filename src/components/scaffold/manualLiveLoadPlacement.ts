import * as THREE from 'three'
import type { ManualLiveLoadPlacement } from '../../types/scaffoldGraph'
import { DEFAULT_MANUAL_LIVE_LOAD_PSF } from '../../types/scaffoldGraph'
import type { RinglockLedgerInstance } from './RinglockLedgers'
import { inchesToFeet } from './units'
import {
	LEDGER_TUBE_OD_IN,
	buildSupportPair,
	computeSupportAxisInterval,
	getSupportFrame,
	projectAxisPointToSupportFrame,
	type SupportFrame,
	type SupportLedgerLike,
	type SupportPair,
} from './manualSupportSpan'

const SAME_LIFT_TOL_FT = inchesToFeet(1)
const SAME_LINE_TOL_FT = inchesToFeet(2)
const TOUCH_TOL_FT = inchesToFeet(2)
export const LIVE_LOAD_SURFACE_Z_OFFSET_FT = inchesToFeet(LEDGER_TUBE_OD_IN / 2) + inchesToFeet(0.25)
export const LIVE_LOAD_MESH_MAX_CELL_SIZE_FT = 1

type LedgerFrame = SupportFrame<RinglockLedgerInstance>

export type RinglockLiveLoadInstance = {
	id: string
	center: THREE.Vector3
	rotationZ: number
	lengthFt: number
	widthFt: number
	magnitudePsf: number
	areaSqFt: number
	supportLedgerId: string
	sideSign: 1 | -1
}

export type ManualLiveLoadPreview = {
	placement: ManualLiveLoadPlacement
	liveLoad: RinglockLiveLoadInstance
}

export type ResolvedManualLiveLoadPlacement<T extends SupportLedgerLike = SupportLedgerLike> = {
	placement: ManualLiveLoadPlacement
	supportPair: SupportPair<T>
	center: THREE.Vector3
	rotationZ: number
	lengthFt: number
	widthFt: number
	areaSqFt: number
}

type ResolvedContribution<T extends SupportLedgerLike> = {
	sourceLedger: T
	targetLedger: T
	sourcePoint: THREE.Vector2
	targetPoint: THREE.Vector2
	sourceLoadLb: number
	targetLoadLb: number
}

function hasExistingPlacement(existingPlacements: ManualLiveLoadPlacement[], supportLedgerId: string, sideSign: 1 | -1) {
	return existingPlacements.some(p => p.supportLedgerId === supportLedgerId && p.sideSign === sideSign)
}

function mapResolvedPlacementToInstance<T extends SupportLedgerLike>(
	resolved: ResolvedManualLiveLoadPlacement<T>,
): RinglockLiveLoadInstance {
	return {
		id: resolved.placement.id,
		center: resolved.center.clone(),
		rotationZ: resolved.rotationZ,
		lengthFt: resolved.lengthFt,
		widthFt: resolved.widthFt,
		magnitudePsf: resolved.placement.magnitudePsf,
		areaSqFt: resolved.areaSqFt,
		supportLedgerId: resolved.placement.supportLedgerId,
		sideSign: resolved.placement.sideSign,
	}
}

export function resolveManualLiveLoadPlacement<T extends SupportLedgerLike>(
	placement: ManualLiveLoadPlacement,
	ledgers: T[],
): ResolvedManualLiveLoadPlacement<T> | null {
	const sourceLedger = ledgers.find(ledger => ledger.id === placement.supportLedgerId)
	if (!sourceLedger) return null
	const supportPair = buildSupportPair(sourceLedger, ledgers, placement.sideSign)
	if (!supportPair) return null

	const widthFt = Math.abs(supportPair.signedOffsetFt)
	const lengthFt = supportPair.overlapLengthFt
	if (!Number.isFinite(widthFt) || widthFt <= 1e-6) return null
	if (!Number.isFinite(lengthFt) || lengthFt <= 1e-6) return null

	const axisCenterFt = (supportPair.overlapMinFt + supportPair.overlapMaxFt) * 0.5
	const center2 = supportPair.source.mid
		.clone()
		.add(supportPair.source.dir.clone().multiplyScalar(axisCenterFt))
		.add(supportPair.source.perp.clone().multiplyScalar(supportPair.signedOffsetFt * 0.5))
	const rotationZ = Math.PI / 2 - Math.atan2(supportPair.source.dir.y, supportPair.source.dir.x)

	return {
		placement,
		supportPair,
		center: new THREE.Vector3(center2.x, center2.y, supportPair.source.z + LIVE_LOAD_SURFACE_Z_OFFSET_FT),
		rotationZ,
		lengthFt,
		widthFt,
		areaSqFt: lengthFt * widthFt,
	}
}

export function forEachResolvedLiveLoadContribution<T extends SupportLedgerLike>(
	resolved: ResolvedManualLiveLoadPlacement<T>,
	callback: (contribution: ResolvedContribution<T>) => void,
	maxCellSizeFt = LIVE_LOAD_MESH_MAX_CELL_SIZE_FT,
) {
	const widthFt = resolved.widthFt
	const lengthFt = resolved.lengthFt
	if (widthFt <= 1e-6 || lengthFt <= 1e-6) return

	const cellsAlong = Math.max(1, Math.ceil(lengthFt / Math.max(maxCellSizeFt, 1e-3)))
	const cellsAcross = Math.max(1, Math.ceil(widthFt / Math.max(maxCellSizeFt, 1e-3)))
	const cellLengthFt = lengthFt / cellsAlong
	const cellWidthFt = widthFt / cellsAcross

	for (let alongIndex = 0; alongIndex < cellsAlong; alongIndex++) {
		const axisPositionFt = resolved.supportPair.overlapMinFt + cellLengthFt * (alongIndex + 0.5)

		for (let acrossIndex = 0; acrossIndex < cellsAcross; acrossIndex++) {
			const spanPositionFt = cellWidthFt * (acrossIndex + 0.5)
			const pointLoadLb = resolved.placement.magnitudePsf * cellLengthFt * cellWidthFt
			if (!Number.isFinite(pointLoadLb) || pointLoadLb <= 0) continue

			const sourceLoadLb = pointLoadLb * ((widthFt - spanPositionFt) / widthFt)
			const targetLoadLb = pointLoadLb - sourceLoadLb

			callback({
				sourceLedger: resolved.supportPair.source.ledger,
				targetLedger: resolved.supportPair.target.ledger,
				sourcePoint: projectAxisPointToSupportFrame(
					resolved.supportPair.source,
					resolved.supportPair.source.mid,
					resolved.supportPair.source.dir,
					axisPositionFt,
				),
				targetPoint: projectAxisPointToSupportFrame(
					resolved.supportPair.target,
					resolved.supportPair.source.mid,
					resolved.supportPair.source.dir,
					axisPositionFt,
				),
				sourceLoadLb,
				targetLoadLb,
			})
		}
	}
}

export function buildManualLiveLoadPreviewForLedger(
	sourceLedger: RinglockLedgerInstance,
	ledgers: RinglockLedgerInstance[],
	sideSign: 1 | -1,
	existingPlacements: ManualLiveLoadPlacement[],
	magnitudePsf = DEFAULT_MANUAL_LIVE_LOAD_PSF,
): ManualLiveLoadPreview | null {
	if (hasExistingPlacement(existingPlacements, sourceLedger.id, sideSign)) return null
	const placement: ManualLiveLoadPlacement = {
		id: `preview:${sourceLedger.id}:${sideSign}`,
		supportLedgerId: sourceLedger.id,
		sideSign,
		magnitudePsf,
	}
	const resolved = resolveManualLiveLoadPlacement(placement, ledgers)
	if (!resolved) return null
	return { placement, liveLoad: mapResolvedPlacementToInstance(resolved) }
}

export function buildManualLiveLoadInstances(
	placements: ManualLiveLoadPlacement[],
	ledgers: RinglockLedgerInstance[],
): RinglockLiveLoadInstance[] {
	return placements
		.map(placement => resolveManualLiveLoadPlacement(placement, ledgers))
		.filter((resolved): resolved is ResolvedManualLiveLoadPlacement<RinglockLedgerInstance> => resolved !== null)
		.map(mapResolvedPlacementToInstance)
}

export function computeManualLiveLoadBatchPreview(
	sourceLedger: RinglockLedgerInstance,
	ledgers: RinglockLedgerInstance[],
	sideSign: 1 | -1,
	existingPlacements: ManualLiveLoadPlacement[],
	magnitudePsf = DEFAULT_MANUAL_LIVE_LOAD_PSF,
): ManualLiveLoadPreview[] {
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
		.map(frame =>
			buildManualLiveLoadPreviewForLedger(
				frame.ledger,
				ledgers,
				sideSign,
				existingPlacements,
				magnitudePsf,
			),
		)
		.filter((preview): preview is ManualLiveLoadPreview => preview !== null)
}
