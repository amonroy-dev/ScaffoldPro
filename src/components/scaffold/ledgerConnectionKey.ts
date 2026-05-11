export function makeLedgerConnectionKey(
	stackKeyA: string,
	liftIndexA: number,
	stackKeyB: string,
	liftIndexB: number,
): string {
	const a = String(stackKeyA)
	const b = String(stackKeyB)
	const liftA = Math.round(Number(liftIndexA))
	const liftB = Math.round(Number(liftIndexB))
	if (a < b) {
		return liftA === liftB ? `${a}|${b}@${liftA}` : `${a}|${b}@${liftA}:${liftB}`
	}
	if (b < a) {
		return liftA === liftB ? `${b}|${a}@${liftA}` : `${b}|${a}@${liftB}:${liftA}`
	}
	const lo = Math.min(liftA, liftB)
	const hi = Math.max(liftA, liftB)
	return lo === hi ? `${a}|${b}@${lo}` : `${a}|${b}@${lo}:${hi}`
}

export function parseLedgerConnectionKey(key: string): {
	stackKeyA: string
	stackKeyB: string
	liftIndexA: number
	liftIndexB: number
} | null {
	const [edge, rawLift] = String(key).split('@')
	if (!edge || !rawLift) return null
	const [stackKeyA, stackKeyB] = edge.split('|')
	if (!stackKeyA || !stackKeyB) return null
	if (rawLift.includes(':')) {
		const [liftA, liftB] = rawLift.split(':').map((value) => Number(value))
		if (!Number.isFinite(liftA) || !Number.isFinite(liftB)) return null
		return {
			stackKeyA,
			stackKeyB,
			liftIndexA: Math.round(liftA),
			liftIndexB: Math.round(liftB),
		}
	}
	const lift = Number(rawLift)
	if (!Number.isFinite(lift)) return null
	return {
		stackKeyA,
		stackKeyB,
		liftIndexA: Math.round(lift),
		liftIndexB: Math.round(lift),
	}
}
