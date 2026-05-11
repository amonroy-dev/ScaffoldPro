import * as THREE from 'three'
import type { DerivedScaffoldGeometry } from '../components/scaffold/bomDerivation'
import { getStandardBaseOffsetFt } from '../components/scaffold/scaffoldGeometry'
import type { SceneObject } from '../contexts/ToolContext'
import type { DrawingDisplayPreset, DrawingProjection, DrawingSavedView, DrawingSectionDefinition, DrawingVector3 } from './drawingDocument'

type RenderTone = 'primary' | 'secondary' | 'cut' | 'poche'

type RawProjectedPoint = {
	x: number
	y: number
}

export type ViewportRenderPath = {
	id: string
	points: RawProjectedPoint[]
	closed: boolean
	tone: RenderTone
	fill?: boolean
}

export type ViewportRenderData = {
	paths: ViewportRenderPath[]
	emptyMessage: string | null
}

type ProjectionBasis = {
	projection: DrawingProjection
	position: THREE.Vector3
	target: THREE.Vector3
	forward: THREE.Vector3
	right: THREE.Vector3
	up: THREE.Vector3
	zoom: number
}

type SectionSlab = {
	origin: THREE.Vector3
	normal: THREE.Vector3
	frontClipEnabled: boolean
	minDistance: number | null
	maxDistance: number | null
}

const BOX_EDGES: Array<[number, number]> = [
	[0, 1], [1, 2], [2, 3], [3, 0],
	[4, 5], [5, 6], [6, 7], [7, 4],
	[0, 4], [1, 5], [2, 6], [3, 7],
]

const EPSILON = 1e-5
const CAMERA_NEAR = 0.05
const FIT_PADDING = 7
/** Match the Three.js PerspectiveCamera FOV used in the 3D Canvas (Scene.tsx). */
const DEFAULT_PERSPECTIVE_FOV_DEG = 50
const STANDARD_PLAN_MARKER_SIZE_FT = 0.22
const BASE_SILL_SIZE_FT = 9 / 12
const BASE_COLLAR_SIZE_FT = 5 / 12
const TONE_SORT_WEIGHT: Record<RenderTone, number> = {
	poche: 0,
	secondary: 1,
	primary: 2,
	cut: 3,
}

function toVector3(value: DrawingVector3): THREE.Vector3 {
	return new THREE.Vector3(value.x, value.y, value.z)
}

function buildProjectionBasis(view: DrawingSavedView): ProjectionBasis {
	const position = toVector3(view.camera.position)
	const target = toVector3(view.camera.target)
	const forward = target.clone().sub(position)
	if (forward.lengthSq() <= EPSILON) {
		forward.set(0, 1, 0)
	} else {
		forward.normalize()
	}

	const cameraDirection = position.clone().sub(target)
	if (cameraDirection.lengthSq() <= EPSILON) {
		cameraDirection.set(0, -1, 0)
	} else {
		cameraDirection.normalize()
	}

	const up = Math.abs(cameraDirection.z) > 0.999
		? new THREE.Vector3(0, cameraDirection.z > 0 ? 1 : -1, 0)
		: new THREE.Vector3(0, 0, 1)

	const right = forward.clone().cross(up)
	if (right.lengthSq() <= EPSILON) {
		right.set(1, 0, 0)
	} else {
		right.normalize()
	}

	const trueUp = right.clone().cross(forward)
	if (trueUp.lengthSq() <= EPSILON) {
		trueUp.set(0, 0, 1)
	} else {
		trueUp.normalize()
	}

	return {
		projection: view.projection,
		position,
		target,
		forward,
		right,
		up: trueUp,
		zoom: Math.max(0.1, view.camera.zoom),
	}
}

function buildSectionSlab(section: DrawingSectionDefinition | null | undefined): SectionSlab | null {
	if (!section) return null
	const origin = toVector3(section.origin)
	const normal = toVector3(section.normal)
	if (normal.lengthSq() <= EPSILON) {
		normal.set(0, 1, 0)
	} else {
		normal.normalize()
	}
	const depthFt = Number.isFinite(section.depthFt) ? Math.max(section.depthFt, 0) : 0
	if (section.clipMode === 'elevation' && depthFt <= EPSILON) return null
	return {
		origin,
		normal,
		frontClipEnabled: section.clipMode === 'section',
		minDistance: section.clipMode === 'section' ? 0 : null,
		maxDistance: depthFt > EPSILON ? depthFt : null,
	}
}

function signedSectionDistance(point: THREE.Vector3, slab: SectionSlab) {
	return point.clone().sub(slab.origin).dot(slab.normal)
}

function clipRangeByLowerBound(t0: number, t1: number, a: number, b: number, minValue: number) {
	if (a >= minValue && b >= minValue) return [t0, t1] as const
	if (a < minValue && b < minValue) return null
	const denominator = b - a
	if (Math.abs(denominator) <= EPSILON) return null
	const t = (minValue - a) / denominator
	return a < minValue ? [Math.max(t0, t), t1] as const : [t0, Math.min(t1, t)] as const
}

function clipRangeByUpperBound(t0: number, t1: number, a: number, b: number, maxValue: number) {
	if (a <= maxValue && b <= maxValue) return [t0, t1] as const
	if (a > maxValue && b > maxValue) return null
	const denominator = b - a
	if (Math.abs(denominator) <= EPSILON) return null
	const t = (maxValue - a) / denominator
	return a > maxValue ? [Math.max(t0, t), t1] as const : [t0, Math.min(t1, t)] as const
}

function clipSegmentToSection(start: THREE.Vector3, end: THREE.Vector3, slab: SectionSlab | null) {
	if (!slab) return [start.clone(), end.clone()] as const
	let t0 = 0
	let t1 = 1
	const startDistance = signedSectionDistance(start, slab)
	const endDistance = signedSectionDistance(end, slab)

	if (slab.minDistance != null) {
		const next = clipRangeByLowerBound(t0, t1, startDistance, endDistance, slab.minDistance)
		if (!next) return null
		;[t0, t1] = next
	}

	if (slab.maxDistance != null) {
		const next = clipRangeByUpperBound(t0, t1, startDistance, endDistance, slab.maxDistance)
		if (!next) return null
		;[t0, t1] = next
	}

	if (t1 < t0) return null
	return [start.clone().lerp(end, t0), start.clone().lerp(end, t1)] as const
}

function clipSegmentToCamera(start: THREE.Vector3, end: THREE.Vector3, basis: ProjectionBasis) {
	if (basis.projection !== 'perspective') return [start.clone(), end.clone()] as const
	let t0 = 0
	let t1 = 1
	const startDepth = start.clone().sub(basis.position).dot(basis.forward)
	const endDepth = end.clone().sub(basis.position).dot(basis.forward)
	const next = clipRangeByLowerBound(t0, t1, startDepth, endDepth, CAMERA_NEAR)
	if (!next) return null
	;[t0, t1] = next
	if (t1 < t0) return null
	return [start.clone().lerp(end, t0), start.clone().lerp(end, t1)] as const
}

function projectPoint(point: THREE.Vector3, basis: ProjectionBasis): RawProjectedPoint | null {
	const reference = basis.projection === 'orthographic' ? basis.target : basis.position
	const relative = point.clone().sub(reference)
	const x = relative.dot(basis.right)
	const y = relative.dot(basis.up)
	if (basis.projection === 'orthographic') {
		return { x, y }
	}
	const depth = point.clone().sub(basis.position).dot(basis.forward)
	if (depth <= CAMERA_NEAR) return null
	return { x: (x / depth) * basis.zoom, y: (y / depth) * basis.zoom }
}

function pushProjectedSegment(
	shapes: Array<{ id: string; points: RawProjectedPoint[]; closed: boolean; tone: RenderTone; fill?: boolean }>,
	id: string,
	start: THREE.Vector3,
	end: THREE.Vector3,
	basis: ProjectionBasis,
	slab: SectionSlab | null,
	tone: RenderTone,
) {
	const clippedBySection = clipSegmentToSection(start, end, slab)
	if (!clippedBySection) return
	const clippedByCamera = clipSegmentToCamera(clippedBySection[0], clippedBySection[1], basis)
	if (!clippedByCamera) return
	const a = projectPoint(clippedByCamera[0], basis)
	const b = projectPoint(clippedByCamera[1], basis)
	if (!a || !b) return
	if (Math.hypot(a.x - b.x, a.y - b.y) <= EPSILON) return
	shapes.push({ id, points: [a, b], closed: false, tone })
}

function pushProjectedPolygon(
	shapes: Array<{ id: string; points: RawProjectedPoint[]; closed: boolean; tone: RenderTone; fill?: boolean }>,
	id: string,
	points: THREE.Vector3[],
	basis: ProjectionBasis,
	tone: RenderTone,
	fill = false,
) {
	const projected = points
		.map(point => projectPoint(point, basis))
		.filter((point): point is RawProjectedPoint => point !== null)
	if (projected.length < 3) return
	shapes.push({ id, points: projected, closed: true, tone, fill })
}

function buildObjectBoxCorners(object: SceneObject) {
	const half = object.dimensions.clone().multiplyScalar(0.5)
	const rotation = new THREE.Quaternion().setFromEuler(object.rotation)
	const localCorners = [
		new THREE.Vector3(-half.x, -half.y, -half.z),
		new THREE.Vector3(half.x, -half.y, -half.z),
		new THREE.Vector3(half.x, half.y, -half.z),
		new THREE.Vector3(-half.x, half.y, -half.z),
		new THREE.Vector3(-half.x, -half.y, half.z),
		new THREE.Vector3(half.x, -half.y, half.z),
		new THREE.Vector3(half.x, half.y, half.z),
		new THREE.Vector3(-half.x, half.y, half.z),
	]
	return localCorners.map(corner => corner.applyQuaternion(rotation).add(object.position.clone()))
}

function dedupeWorldPoints(points: THREE.Vector3[]) {
	const out: THREE.Vector3[] = []
	for (const point of points) {
		if (out.some(existing => existing.distanceToSquared(point) <= 1e-8)) continue
		out.push(point)
	}
	return out
}

function pushObjectCutPolygon(
	shapes: Array<{ id: string; points: RawProjectedPoint[]; closed: boolean; tone: RenderTone; fill?: boolean }>,
	object: SceneObject,
	corners: THREE.Vector3[],
	basis: ProjectionBasis,
	slab: SectionSlab | null,
) {
	if (!slab?.frontClipEnabled) return
	const intersections: THREE.Vector3[] = []
	for (const [startIndex, endIndex] of BOX_EDGES) {
		const start = corners[startIndex]
		const end = corners[endIndex]
		const startDistance = signedSectionDistance(start, slab)
		const endDistance = signedSectionDistance(end, slab)
		if (Math.abs(startDistance) <= EPSILON && signedSectionDistance(end, slab) >= -EPSILON) {
			intersections.push(start.clone())
		}
		if (startDistance * endDistance > EPSILON) continue
		if (Math.abs(endDistance - startDistance) <= EPSILON) continue
		const t = -startDistance / (endDistance - startDistance)
		if (t < -EPSILON || t > 1 + EPSILON) continue
		intersections.push(start.clone().lerp(end, THREE.MathUtils.clamp(t, 0, 1)))
	}

	const unique = dedupeWorldPoints(intersections)
	if (unique.length < 3) return
	const projected = unique
		.map(point => projectPoint(point, basis))
		.filter((point): point is RawProjectedPoint => point !== null)
	if (projected.length < 3) return
	const centroid = projected.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 })
	centroid.x /= projected.length
	centroid.y /= projected.length
	projected.sort((a, b) => Math.atan2(a.y - centroid.y, a.x - centroid.x) - Math.atan2(b.y - centroid.y, b.x - centroid.x))
	shapes.push({ id: `${object.id}:cut:poche`, points: projected, closed: true, tone: 'poche', fill: true })
	shapes.push({ id: `${object.id}:cut:outline`, points: projected, closed: true, tone: 'cut' })
}

function buildMarkerSquare(center: THREE.Vector3, basis: ProjectionBasis, sizeFt: number) {
	const dx = basis.right.clone().multiplyScalar(sizeFt * 0.5)
	const dy = basis.up.clone().multiplyScalar(sizeFt * 0.5)
	return [
		center.clone().sub(dx).sub(dy),
		center.clone().add(dx).sub(dy),
		center.clone().add(dx).add(dy),
		center.clone().sub(dx).add(dy),
	]
}

function addBuildingGeometry(
	shapes: Array<{ id: string; points: RawProjectedPoint[]; closed: boolean; tone: RenderTone; fill?: boolean }>,
	objects: SceneObject[],
	basis: ProjectionBasis,
	slab: SectionSlab | null,
	style: DrawingDisplayPreset['visualStyle'],
) {
	const edgeTone: RenderTone = style === 'presentation' ? 'secondary' : 'primary'
	for (const object of objects) {
		const corners = buildObjectBoxCorners(object)
		pushObjectCutPolygon(shapes, object, corners, basis, slab)
		for (let edgeIndex = 0; edgeIndex < BOX_EDGES.length; edgeIndex++) {
			const [startIndex, endIndex] = BOX_EDGES[edgeIndex]
			pushProjectedSegment(
				shapes,
				`${object.id}:edge:${edgeIndex}`,
				corners[startIndex],
				corners[endIndex],
				basis,
				slab,
				edgeTone,
			)
		}
	}
}

function addScaffoldGeometry(
	shapes: Array<{ id: string; points: RawProjectedPoint[]; closed: boolean; tone: RenderTone; fill?: boolean }>,
	geometry: DerivedScaffoldGeometry,
	basis: ProjectionBasis,
	slab: SectionSlab | null,
) {
	for (const standard of geometry.standardInstances) {
		const start = standard.basePosition.clone()
		const end = standard.basePosition.clone().add(new THREE.Vector3(0, 0, standard.heightFt))
		const beforeCount = shapes.length
		pushProjectedSegment(shapes, `standard:${standard.id}`, start, end, basis, slab, 'primary')
		if (shapes.length === beforeCount) {
			pushProjectedPolygon(shapes, `standard:${standard.id}:marker`, buildMarkerSquare(start, basis, STANDARD_PLAN_MARKER_SIZE_FT), basis, 'primary')
		}
	}

	for (const base of geometry.baseInstances) {
		const topZ = base.groundPosition.z + getStandardBaseOffsetFt(base.jackExtensionIn, base.showWoodSill, base.showBaseCollar)
		pushProjectedSegment(
			shapes,
			`base:${base.id}:stem`,
			base.groundPosition.clone(),
			new THREE.Vector3(base.groundPosition.x, base.groundPosition.y, topZ),
			basis,
			slab,
			'primary',
		)
		if (base.showWoodSill) {
			const half = BASE_SILL_SIZE_FT * 0.5
			pushProjectedPolygon(
				shapes,
				`base:${base.id}:sill`,
				[
					new THREE.Vector3(base.groundPosition.x - half, base.groundPosition.y - half, base.groundPosition.z),
					new THREE.Vector3(base.groundPosition.x + half, base.groundPosition.y - half, base.groundPosition.z),
					new THREE.Vector3(base.groundPosition.x + half, base.groundPosition.y + half, base.groundPosition.z),
					new THREE.Vector3(base.groundPosition.x - half, base.groundPosition.y + half, base.groundPosition.z),
				],
				basis,
				'secondary',
			)
		}
		if (base.showBaseCollar) {
			pushProjectedPolygon(shapes, `base:${base.id}:collar`, buildMarkerSquare(new THREE.Vector3(base.groundPosition.x, base.groundPosition.y, topZ), basis, BASE_COLLAR_SIZE_FT), basis, 'secondary')
		}
	}

	for (const ledger of geometry.ledgerInstances) {
		pushProjectedSegment(shapes, `ledger:${ledger.id}`, ledger.start, ledger.end, basis, slab, 'primary')
	}

	for (const diagonal of geometry.diagonalInstances) {
		pushProjectedSegment(shapes, `diagonal:${diagonal.id}`, diagonal.start, diagonal.end, basis, slab, 'secondary')
	}

	for (const plank of geometry.plankInstances) {
		const halfLength = plank.lengthFt * 0.5
		const halfWidth = plank.widthIn / 24
		const direction = new THREE.Vector3(Math.sin(plank.rotationZ), Math.cos(plank.rotationZ), 0).multiplyScalar(halfLength)
		const cross = new THREE.Vector3(-direction.y, direction.x, 0).normalize().multiplyScalar(halfWidth)
		const corners = [
			plank.center.clone().sub(direction).sub(cross),
			plank.center.clone().add(direction).sub(cross),
			plank.center.clone().add(direction).add(cross),
			plank.center.clone().sub(direction).add(cross),
		]
		pushProjectedPolygon(shapes, `plank:${plank.id}`, corners, basis, 'secondary')
	}
}

/**
 * Normalize projected paths into the 0–100 SVG coordinate space.
 *
 * When a `ProjectionBasis` is provided the viewport extent is derived from the
 * camera parameters (FOV for perspective, zoom for orthographic) so the Drawing
 * viewport frames the same region as the 3D Canvas.  This prevents large
 * building geometry at extreme off-axis angles from bloating the bounding box
 * and compressing the scaffold into tiny disconnected marks.
 *
 * Without a basis (fallback) the old auto-fit behaviour is used.
 */
function normalizePaths(paths: ViewportRenderPath[], basis?: ProjectionBasis): ViewportRenderPath[] {
	const allPoints = paths.flatMap(path => path.points)
	if (allPoints.length === 0) return []

	let centerX = 0
	let centerY = 0
	let halfExtent: number

	if (basis) {
		// Camera target always projects to (0, 0) in both modes — centre there.
		if (basis.projection === 'perspective') {
			// In projected space the frustum edge = tan(fov/2) * zoom.
			const fovRad = (DEFAULT_PERSPECTIVE_FOV_DEG * Math.PI) / 180
			halfExtent = Math.tan(fovRad * 0.5) * basis.zoom
		} else {
			// Orthographic: zoom represents the visible half-width in world units.
			halfExtent = basis.zoom
		}
	} else {
		// Fallback: auto-fit all geometry (legacy behaviour).
		let minX = Infinity
		let maxX = -Infinity
		let minY = Infinity
		let maxY = -Infinity
		for (const point of allPoints) {
			minX = Math.min(minX, point.x)
			maxX = Math.max(maxX, point.x)
			minY = Math.min(minY, point.y)
			maxY = Math.max(maxY, point.y)
		}
		centerX = (minX + maxX) * 0.5
		centerY = (minY + maxY) * 0.5
		halfExtent = Math.max(maxX - minX, maxY - minY, 1) * 0.5
	}

	// Prevent degenerate scaling
	if (halfExtent < EPSILON) halfExtent = 1

	const usable = 100 - FIT_PADDING * 2
	const scale = usable / (halfExtent * 2)

	return [...paths]
		.sort((a, b) => TONE_SORT_WEIGHT[a.tone] - TONE_SORT_WEIGHT[b.tone])
		.map(path => ({
			...path,
			points: path.points.map(point => ({
				x: 50 + (point.x - centerX) * scale,
				y: 50 - (point.y - centerY) * scale,
			})),
		}))
}

export function buildViewportRenderData(params: {
	objects: SceneObject[]
	scaffoldGeometry: DerivedScaffoldGeometry
	view: DrawingSavedView | null
	section: DrawingSectionDefinition | null
	displayPreset: DrawingDisplayPreset | null
}): ViewportRenderData {
	const { objects, scaffoldGeometry, view, section, displayPreset } = params
	if (!view || !displayPreset) {
		return {
			paths: [],
			emptyMessage: 'View definition missing from the drawing package.',
		}
	}

	const basis = buildProjectionBasis(view)
	const slab = buildSectionSlab(section)
	const rawPaths: ViewportRenderPath[] = []

	if (displayPreset.showBuilding) {
		addBuildingGeometry(rawPaths, objects, basis, slab, displayPreset.visualStyle)
	}

	if (displayPreset.showScaffold) {
		addScaffoldGeometry(rawPaths, scaffoldGeometry, basis, slab)
	}

	const normalizedPaths = normalizePaths(rawPaths, basis)
	return {
		paths: normalizedPaths,
		emptyMessage: normalizedPaths.length === 0 ? 'No visible model geometry for this saved view yet.' : null,
	}
}