export type AxisAlignedRectFt = {
	xMin: number
	xMax: number
	yMin: number
	yMax: number
}

export type RectUnionBoundarySegmentFt =
	| { kind: 'H'; y: number; x0: number; x1: number }
	| { kind: 'V'; x: number; y0: number; y1: number }

function roundTo(v: number, precision = 1000): number {
	// precision=1000 => millifeet (~0.012") stability, matches blockPlanning.posKey2 default.
	return Math.round(v * precision) / precision
}

function uniqSorted(values: number[], tol = 1e-9): number[] {
	const v = values
		.filter(n => Number.isFinite(n))
		.slice()
		.sort((a, b) => a - b)
	if (v.length === 0) return []
	const out: number[] = [v[0]]
	for (let i = 1; i < v.length; i++) {
		const last = out[out.length - 1]!
		const cur = v[i]!
		if (Math.abs(cur - last) <= tol) continue
		out.push(cur)
	}
	return out
}

function mergeCollinearSegments(
	segments: RectUnionBoundarySegmentFt[],
	mergeTol = 1e-6,
): RectUnionBoundarySegmentFt[] {
	const buckets = new Map<string, RectUnionBoundarySegmentFt[]>()
	for (const s of segments) {
		if (s.kind === 'H') {
			const y = roundTo(s.y)
			const x0 = Math.min(s.x0, s.x1)
			const x1 = Math.max(s.x0, s.x1)
			const key = `H:${y}`
			const list = buckets.get(key) ?? []
			list.push({ kind: 'H', y, x0, x1 })
			buckets.set(key, list)
		} else {
			const x = roundTo(s.x)
			const y0 = Math.min(s.y0, s.y1)
			const y1 = Math.max(s.y0, s.y1)
			const key = `V:${x}`
			const list = buckets.get(key) ?? []
			list.push({ kind: 'V', x, y0, y1 })
			buckets.set(key, list)
		}
	}

	const out: RectUnionBoundarySegmentFt[] = []
	for (const [key, list] of buckets) {
		if (list.length === 0) continue
		if (key.startsWith('H:')) {
			const segs = (list as Extract<RectUnionBoundarySegmentFt, { kind: 'H' }>[])
				.slice()
				.sort((a, b) => a.x0 - b.x0)
			let cur = { ...segs[0] }
			for (let i = 1; i < segs.length; i++) {
				const s = segs[i]!
				if (s.x0 <= cur.x1 + mergeTol) {
					cur.x1 = Math.max(cur.x1, s.x1)
				} else {
					out.push(cur)
					cur = { ...s }
				}
			}
			out.push(cur)
		} else {
			const segs = (list as Extract<RectUnionBoundarySegmentFt, { kind: 'V' }>[])
				.slice()
				.sort((a, b) => a.y0 - b.y0)
			let cur = { ...segs[0] }
			for (let i = 1; i < segs.length; i++) {
				const s = segs[i]!
				if (s.y0 <= cur.y1 + mergeTol) {
					cur.y1 = Math.max(cur.y1, s.y1)
				} else {
					out.push(cur)
					cur = { ...s }
				}
			}
			out.push(cur)
		}
	}
	return out
}

/**
 * Compute the boundary of the union of axis-aligned rectangles.
 *
 * Output segments are axis-aligned and merged where collinear.
 */
export function computeRectUnionBoundarySegments(
	rects: AxisAlignedRectFt[],
): RectUnionBoundarySegmentFt[] {
	const clean = rects
		.map(r => ({
			xMin: Math.min(r.xMin, r.xMax),
			xMax: Math.max(r.xMin, r.xMax),
			yMin: Math.min(r.yMin, r.yMax),
			yMax: Math.max(r.yMin, r.yMax),
		}))
		.filter(r => Number.isFinite(r.xMin) && Number.isFinite(r.xMax) && Number.isFinite(r.yMin) && Number.isFinite(r.yMax))
		.filter(r => r.xMax - r.xMin > 1e-9 && r.yMax - r.yMin > 1e-9)
	if (clean.length === 0) return []

	const xs = uniqSorted(clean.flatMap(r => [r.xMin, r.xMax]).map(v => roundTo(v)))
	const ys = uniqSorted(clean.flatMap(r => [r.yMin, r.yMax]).map(v => roundTo(v)))
	if (xs.length < 2 || ys.length < 2) return []

	const nx = xs.length - 1
	const ny = ys.length - 1
	const filled: boolean[][] = Array.from({ length: nx }, () => Array.from({ length: ny }, () => false))

	for (let i = 0; i < nx; i++) {
		for (let j = 0; j < ny; j++) {
			const x0 = xs[i]!
			const x1 = xs[i + 1]!
			const y0 = ys[j]!
			const y1 = ys[j + 1]!
			const cx = (x0 + x1) * 0.5
			const cy = (y0 + y1) * 0.5
			filled[i]![j] = clean.some(r => cx > r.xMin + 1e-9 && cx < r.xMax - 1e-9 && cy > r.yMin + 1e-9 && cy < r.yMax - 1e-9)
		}
	}

	const segs: RectUnionBoundarySegmentFt[] = []
	for (let i = 0; i < nx; i++) {
		for (let j = 0; j < ny; j++) {
			if (!filled[i]![j]) continue
			const x0 = xs[i]!
			const x1 = xs[i + 1]!
			const y0 = ys[j]!
			const y1 = ys[j + 1]!

			if (i === 0 || !filled[i - 1]![j]) segs.push({ kind: 'V', x: x0, y0, y1 })
			if (i === nx - 1 || !filled[i + 1]![j]) segs.push({ kind: 'V', x: x1, y0, y1 })
			if (j === 0 || !filled[i]![j - 1]) segs.push({ kind: 'H', y: y0, x0, x1 })
			if (j === ny - 1 || !filled[i]![j + 1]) segs.push({ kind: 'H', y: y1, x0, x1 })
		}
	}

	return mergeCollinearSegments(segs)
}
