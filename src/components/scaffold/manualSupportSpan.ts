import * as THREE from 'three'

export const LEDGER_TUBE_OD_IN = 1.9

const MIN_LEDGER_LENGTH_FT = 1
const MIN_SUPPORT_OFFSET_FT = 0.5
const PARALLEL_DOT_THRESHOLD = 0.985
const SAME_LIFT_TOL_FT = 1 / 12
const MIN_OVERLAP_FT = 0.5

export type SupportLedgerLike = {
	id: string
	start: THREE.Vector3
	end: THREE.Vector3
}

export type SupportFrame<T extends SupportLedgerLike = SupportLedgerLike> = {
	ledger: T
	start: THREE.Vector2
	end: THREE.Vector2
	mid: THREE.Vector2
	dir: THREE.Vector2
	perp: THREE.Vector2
	lengthFt: number
	z: number
}

export type SupportPair<T extends SupportLedgerLike = SupportLedgerLike> = {
	source: SupportFrame<T>
	target: SupportFrame<T>
	signedOffsetFt: number
	overlapMinFt: number
	overlapMaxFt: number
	overlapLengthFt: number
}

export function getSupportFrame<T extends SupportLedgerLike>(ledger: T): SupportFrame<T> | null {
	const start = new THREE.Vector2(ledger.start.x, ledger.start.y)
	const end = new THREE.Vector2(ledger.end.x, ledger.end.y)
	const dir = end.clone().sub(start)
	const lengthFt = dir.length()
	if (lengthFt < MIN_LEDGER_LENGTH_FT) return null
	dir.multiplyScalar(1 / lengthFt)
	const mid = start.clone().add(end).multiplyScalar(0.5)
	return {
		ledger,
		start,
		end,
		mid,
		dir,
		perp: new THREE.Vector2(-dir.y, dir.x),
		lengthFt,
		z: (ledger.start.z + ledger.end.z) * 0.5,
	}
}

export function computeSupportAxisInterval<T extends SupportLedgerLike>(frame: SupportFrame<T>, origin: THREE.Vector2) {
	const center = frame.mid.clone().sub(origin).dot(frame.dir)
	return { min: center - frame.lengthFt / 2, max: center + frame.lengthFt / 2 }
}

export function findOppositeSupportFrame<T extends SupportLedgerLike>(
	source: SupportFrame<T>,
	ledgers: T[],
	sideSign: 1 | -1,
): SupportFrame<T> | null {
	let best: SupportFrame<T> | null = null
	let bestOffset = Infinity
	const sourceInterval = { min: -source.lengthFt / 2, max: source.lengthFt / 2 }

	for (const candidate of ledgers) {
		if (candidate.id === source.ledger.id) continue
		const frame = getSupportFrame(candidate)
		if (!frame) continue
		if (Math.abs(frame.z - source.z) > SAME_LIFT_TOL_FT) continue
		if (Math.abs(Math.abs(source.dir.dot(frame.dir)) - 1) > 1 - PARALLEL_DOT_THRESHOLD) continue

		const delta = frame.mid.clone().sub(source.mid)
		const signedOffset = delta.dot(source.perp)
		if (signedOffset * sideSign <= MIN_SUPPORT_OFFSET_FT) continue

		const interval = computeSupportAxisInterval(frame, source.mid)
		const overlap = Math.min(sourceInterval.max, interval.max) - Math.max(sourceInterval.min, interval.min)
		if (overlap < MIN_OVERLAP_FT) continue

		const absOffset = Math.abs(signedOffset)
		if (absOffset < bestOffset) {
			bestOffset = absOffset
			best = frame
		}
	}

	return best
}

export function buildSupportPair<T extends SupportLedgerLike>(
	sourceLedger: T,
	ledgers: T[],
	sideSign: 1 | -1,
): SupportPair<T> | null {
	const source = getSupportFrame(sourceLedger)
	if (!source) return null
	const target = findOppositeSupportFrame(source, ledgers, sideSign)
	if (!target) return null

	const sourceInterval = { min: -source.lengthFt / 2, max: source.lengthFt / 2 }
	const targetInterval = computeSupportAxisInterval(target, source.mid)
	const overlapMinFt = Math.max(sourceInterval.min, targetInterval.min)
	const overlapMaxFt = Math.min(sourceInterval.max, targetInterval.max)
	const overlapLengthFt = overlapMaxFt - overlapMinFt
	if (overlapLengthFt < MIN_OVERLAP_FT) return null

	const signedOffsetFt = target.mid.clone().sub(source.mid).dot(source.perp)
	if (Math.abs(signedOffsetFt) <= MIN_SUPPORT_OFFSET_FT) return null

	return {
		source,
		target,
		signedOffsetFt,
		overlapMinFt,
		overlapMaxFt,
		overlapLengthFt,
	}
}

export function projectAxisPointToSupportFrame<T extends SupportLedgerLike>(
	frame: SupportFrame<T>,
	axisOrigin: THREE.Vector2,
	axisDir: THREE.Vector2,
	axisPositionFt: number,
) {
	const axisPoint = axisOrigin.clone().add(axisDir.clone().multiplyScalar(axisPositionFt))
	const frameOffsetFt = THREE.MathUtils.clamp(
		axisPoint.clone().sub(frame.start).dot(frame.dir),
		0,
		frame.lengthFt,
	)
	return frame.start.clone().add(frame.dir.clone().multiplyScalar(frameOffsetFt))
}

export function getLedgerSideSign<T extends SupportLedgerLike>(ledger: T, point: THREE.Vector3): 1 | -1 {
	const start = new THREE.Vector2(ledger.start.x, ledger.start.y)
	const end = new THREE.Vector2(ledger.end.x, ledger.end.y)
	const dir = end.sub(start)
	if (dir.lengthSq() < 1e-10) return 1
	dir.normalize()
	const perp = new THREE.Vector2(-dir.y, dir.x)
	const delta = new THREE.Vector2(point.x, point.y).sub(start.clone().add(end).multiplyScalar(0.5))
	return delta.dot(perp) >= 0 ? 1 : -1
}
