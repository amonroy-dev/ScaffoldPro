import { Html } from '@react-three/drei'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import type { CatalogPart } from '../../catalog/catalogSchema'
import { RinglockStandards, type RinglockStandardInstance } from './RinglockStandards'
import { RinglockLedgers, type RinglockLedgerInstance } from './RinglockLedgers'
import { RinglockBases, type RinglockBaseInstance } from './RinglockBases'
import { RinglockDiagonals, type RinglockDiagonalInstance } from './RinglockDiagonals'
import { RinglockPlanks, RINGLOCK_PLANK_PROFILE_DEPTH_IN, RINGLOCK_PLANK_WIDTH_IN, type RinglockPlankInstance } from './RinglockPlanks'
import { RinglockLiveLoads } from './RinglockLiveLoads'
import { useScaffoldBaseSettings } from '../../contexts/ScaffoldBaseSettings'
import { useSettings } from '../../contexts/SettingsContext'
import { useTool, type LiveLoadDeckTarget, type StackCadHud } from '../../contexts/ToolContext'
import { useCatalogSelection } from '../../contexts/CatalogContext'
import { UNIVERSAL_RINGLOCK_STANDARDS, type UniversalRinglockStandardId } from './ringlockCatalog'
import { buildBestFitPlankLayout, resolveClosestCatalogPlankPartNumber } from './plankLayout'
import { inchesToFeet } from './units'
import { computeRosettePositions, getStandardBaseOffsetFt } from './scaffoldGeometry'
import { buildStandardPlan, chooseBayLayout, makeBlockLiveLoadBayKey, makeStackPositionKey, posKey2, resolveBlockDeckPlan, resolveRoundAutoBayFrame, rotateOffset90 } from './blockPlanning'
import { computeRectUnionBoundarySegments } from './guardrailPlanning'
import {
	UNIVERSAL_LEDGER_LENGTHS,
	UNIVERSAL_RINGLOCK_DIAGONALS,
	UNIVERSAL_RINGLOCK_HORIZONTALS,
	UNIVERSAL_RINGLOCK_TRUSSES,
	findClosestDiagonal,
} from '../../types/scaffoldGraph'
import { DxfPreviewOverlay } from './DxfPreviewOverlay'
import { buildManualPlankInstances } from './manualPlankPlacement'
import { buildManualLiveLoadInstances, forEachResolvedLiveLoadContribution, resolveManualLiveLoadPlacement, LIVE_LOAD_SURFACE_Z_OFFSET_FT, type RinglockLiveLoadInstance } from './manualLiveLoadPlacement'
import { resolveSupportAwareBlockLayout } from './supportAwareBlockSolver'
import type { ScaffoldBlockInstance } from '../../types/scaffoldGraph'
import { resolveScaffoldBuildingGeometry, type ResolvedBuildingBoxObstacle } from '../../utils/building/scaffoldBuildingGeometry'

const LEDGER_TUBE_OD_IN = 1.9
const PLANK_MOUTHPIECE_TOTAL_IN = 6

/** Applies direction + distance constraints for the move/copy 'place' step. */
function applyPlaceConstraints(
	rawDx: number, rawDy: number,
	orthoLocked: boolean,
	lockedAngleDeg: number | null,
	distanceInput: string,
	snapStep: number,
): { dx: number; dy: number; distance: number; angleDeg: number } {
	let dx = rawDx
	let dy = rawDy
	const typedDist = distanceInput !== '' ? parseFloat(distanceInput) : NaN

	// Direction constraint
	if (lockedAngleDeg !== null) {
		const rawDist = Math.sqrt(dx * dx + dy * dy)
		const rad = lockedAngleDeg * (Math.PI / 180)
		dx = rawDist * Math.cos(rad)
		dy = rawDist * Math.sin(rad)
	} else if (orthoLocked) {
		if (Math.abs(dx) >= Math.abs(dy)) { dy = 0 } else { dx = 0 }
	}

	// Distance constraint — typed value overrides grid snap
	if (!isNaN(typedDist) && typedDist >= 0) {
		const dir = Math.sqrt(dx * dx + dy * dy)
		if (dir > 1e-6) {
			dx = dx * (typedDist / dir)
			dy = dy * (typedDist / dir)
		} else if (lockedAngleDeg !== null) {
			const rad = lockedAngleDeg * (Math.PI / 180)
			dx = typedDist * Math.cos(rad)
			dy = typedDist * Math.sin(rad)
		}
	} else if (snapStep > 0) {
		dx = Math.round(dx / snapStep) * snapStep
		dy = Math.round(dy / snapStep) * snapStep
	}

	const distance = Math.sqrt(dx * dx + dy * dy)
	const angleDeg = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360
	return { dx, dy, distance, angleDeg }
}

/** Thin line from start to end for CAD distance preview. */
function DistanceLine({ start, end }: { start: { x: number; y: number }; end: { x: number; y: number } }) {
	const lineObj = useMemo(() => {
		const geo = new THREE.BufferGeometry()
		const mat = new THREE.LineBasicMaterial({ color: '#a855f7' })
		return new THREE.Line(geo, mat)
	}, [])
	useLayoutEffect(() => {
		const pos = new Float32Array([start.x, start.y, 0.25, end.x, end.y, 0.25])
		lineObj.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
		lineObj.geometry.computeBoundingSphere()
		lineObj.geometry.attributes.position.needsUpdate = true
	}, [lineObj, start.x, start.y, end.x, end.y])
	useEffect(() => () => {
		lineObj.geometry.dispose();
		(lineObj.material as THREE.Material).dispose()
	}, [lineObj])
	return <primitive object={lineObj} raycast={() => null} />
}

const DIM_Z = 0.12             // just above base plates
const DIM_INITIAL_OFFSET = 0.45 // default perpendicular offset for new dims (ft)
const DIM_TICK_HALF = 0.18     // half-length of the slash tick (ft)

/** Permanent engineering-drawing style dimension annotation with drag-to-reposition. */
function PermanentDimension({ start, end, distance, offset, onRemove, onOffsetChange }: {
	start: { x: number; y: number }
	end: { x: number; y: number }
	distance: number
	offset: number              // signed perpendicular offset; drag changes this
	onRemove: () => void
	onOffsetChange: (newOffset: number) => void
}) {
	const { gl, camera } = useThree()
	const { settings } = useSettings()
	const [hovered, setHovered] = useState(false)
	const [dragging, setDragging] = useState(false)
	const dragRef = useRef<{ initialOffset: number; cursorOffsetAtStart: number } | null>(null)

	const snapStep = settings.snapToGrid ? settings.gridSize : 0

	// Stable direction vectors (start/end never change after creation)
	const dx = end.x - start.x, dy = end.y - start.y
	const len = Math.sqrt(dx * dx + dy * dy)
	const ux = len > 0.001 ? dx / len : 1
	const uy = len > 0.001 ? dy / len : 0
	const px = -uy, py = ux   // unit perpendicular (left of direction)

	// Rebuild geometry whenever offset changes (or on mount)
	const linesObj = useMemo(() => {
		if (len < 0.01) return null
		const Ax = start.x + px * offset, Ay = start.y + py * offset
		const Bx = end.x   + px * offset, By = end.y   + py * offset

		const rtx = ux + px, rty = uy + py
		const tLen = Math.sqrt(rtx * rtx + rty * rty) || 1
		const tx = (rtx / tLen) * DIM_TICK_HALF
		const ty = (rty / tLen) * DIM_TICK_HALF

		const over = 0.07
		const verts = new Float32Array([
			Ax, Ay, DIM_Z,  Bx, By, DIM_Z,
			start.x, start.y, DIM_Z,  Ax + px * over, Ay + py * over, DIM_Z,
			end.x,   end.y,   DIM_Z,  Bx + px * over, By + py * over, DIM_Z,
			Ax - tx, Ay - ty, DIM_Z,  Ax + tx, Ay + ty, DIM_Z,
			Bx - tx, By - ty, DIM_Z,  Bx + tx, By + ty, DIM_Z,
		])
		const geo = new THREE.BufferGeometry()
		geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
		const mat = new THREE.LineBasicMaterial({ color: '#3b82f6' })
		return new THREE.LineSegments(geo, mat)
	}, [start.x, start.y, end.x, end.y, offset, px, py, ux, uy, len])

	// Hover / drag colour feedback
	useEffect(() => {
		if (!linesObj) return
		;(linesObj.material as THREE.LineBasicMaterial).color.set(
			dragging ? '#93c5fd' : hovered ? '#60a5fa' : '#3b82f6'
		)
	}, [hovered, dragging, linesObj])

	useEffect(() => () => {
		linesObj?.geometry.dispose()
		;(linesObj?.material as THREE.Material | undefined)?.dispose()
	}, [linesObj])

	// Project screen → ground plane (same logic as projectClientToGround in ScaffoldWorkspace)
	const projectToGround = useCallback((clientX: number, clientY: number) => {
		const rect = gl.domElement.getBoundingClientRect()
		const ptr = new THREE.Vector2(
			((clientX - rect.left) / rect.width)  * 2 - 1,
			-((clientY - rect.top)  / rect.height) * 2 + 1,
		)
		const ray = new THREE.Raycaster()
		ray.setFromCamera(ptr, camera)
		const pt = new THREE.Vector3()
		return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), pt)
			? { x: pt.x, y: pt.y } : null
	}, [gl.domElement, camera])

	// Begin drag on hit-mesh pointerdown
	const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation()
		e.nativeEvent.stopPropagation()
		e.nativeEvent.preventDefault()
		const pt = projectToGround(e.nativeEvent.clientX, e.nativeEvent.clientY)
		if (!pt) return
		// Record signed perp offset of cursor relative to baseline at drag start
		const cursorOff = (pt.x - start.x) * px + (pt.y - start.y) * py
		dragRef.current = { initialOffset: offset, cursorOffsetAtStart: cursorOff }
		setDragging(true)
	}, [projectToGround, start.x, start.y, px, py, offset])

	// Global pointermove/up while dragging
	useEffect(() => {
		if (!dragging) return
		gl.domElement.style.cursor = 'grabbing'
		const onMove = (e: PointerEvent) => {
			if (!dragRef.current) return
			const pt = projectToGround(e.clientX, e.clientY)
			if (!pt) return
			const cursorOff = (pt.x - start.x) * px + (pt.y - start.y) * py
			const raw = dragRef.current.initialOffset + (cursorOff - dragRef.current.cursorOffsetAtStart)
			const snapped = snapStep > 0 ? Math.round(raw / snapStep) * snapStep : raw
			onOffsetChange(snapped)
		}
		const onUp = () => {
			setDragging(false)
			dragRef.current = null
		}
		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', onUp)
		return () => {
			gl.domElement.style.cursor = ''
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', onUp)
		}
	}, [dragging, projectToGround, start.x, start.y, px, py, snapStep, onOffsetChange, gl.domElement])

	if (!linesObj) return null

	const Ax = start.x + px * offset, Ay = start.y + py * offset
	const Bx = end.x   + px * offset, By = end.y   + py * offset
	const midX = (Ax + Bx) / 2, midY = (Ay + By) / 2
	const dimAngle = Math.atan2(uy, ux)

	return (
		<>
			<primitive object={linesObj} raycast={() => null} />

			{/* Transparent hit plane covering the dim line — drag handle */}
			<mesh
				position={[midX, midY, DIM_Z + 0.01]}
				rotation={[0, 0, dimAngle]}
				onPointerDown={handlePointerDown}
				onPointerEnter={() => { setHovered(true); gl.domElement.style.cursor = 'grab' }}
				onPointerLeave={() => { setHovered(false); if (!dragging) gl.domElement.style.cursor = '' }}
			>
				<planeGeometry args={[distance + 0.2, 0.4]} />
				<meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
			</mesh>

			<Html
				position={[midX, midY, DIM_Z + 0.05]}
				center
				zIndexRange={[200, 201]}
				style={{ pointerEvents: 'none', userSelect: 'none' }}
			>
				<div className={`perm-dim-label${hovered || dragging ? ' perm-dim-label--active' : ''}`}>
					<span className="perm-dim-value">{distance.toFixed(2)}</span>
					<span className="perm-dim-unit"> ft</span>
					<button
						className="perm-dim-close"
						style={{ pointerEvents: 'auto' }}
						onClick={onRemove}
					>×</button>
				</div>
			</Html>
		</>
	)
}

function isTextInputFocused() {
	const el = document.activeElement
	if (!el) return false
	const tag = (el as HTMLElement).tagName
	return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
}
const LEG_LOAD_LABEL_HEIGHT_FT = inchesToFeet(14)
const LEG_LOAD_LABEL_OUTWARD_OFFSET_FT = inchesToFeet(10)
const STACK_MATCH_XY_TOL_FT = inchesToFeet(3)
const STACK_MATCH_Z_TOL_FT = inchesToFeet(6)
const SUPPORT_LEDGER_Z_TOL_FT = inchesToFeet(2)
const SUPPORT_LEDGER_ALIGN_DOT_THRESHOLD = 0.985
const SUPPORT_LEDGER_SPAN_TOL_FT = inchesToFeet(4)

type LegLoadByStackId = Record<string, number>

type StackLegFrame = {
	stackId: string
	position: THREE.Vector3
	bottomZ: number
	topZ: number
	labelPosition: THREE.Vector3
}

type LedgerLoadFrame = {
	id: string
	start: THREE.Vector3
	end: THREE.Vector3
	startStackId: string
	endStackId: string
	start2: THREE.Vector2
	end2: THREE.Vector2
	mid: THREE.Vector2
	dir: THREE.Vector2
	lengthFt: number
	z: number
}

type BlockLiveLoadBay = RinglockLiveLoadInstance & {
	blockId: string
	deckLiftIndex: number
	bayX: number
	bayY: number
	bayKey: string
	isExcluded: boolean
	cornerStackIds: [string, string, string, string]
	totalLoadLb: number
}

type MarqueeRect = {
	xMin: number
	xMax: number
	yMin: number
	yMax: number
}

type LiveLoadMarqueeState = {
	startWorld: { x: number; y: number }
	currentWorld: { x: number; y: number }
	startClientX: number
	currentClientX: number
	startClientY: number
	currentClientY: number
	additive: boolean
	startTargets: LiveLoadDeckTarget[]
}

type BuildingOccluder = {
	inverseMatrix: THREE.Matrix4
	halfSize: THREE.Vector3
}

function buildSupportAwareRecipeFromBlock(block: ScaffoldBlockInstance) {
	return {
		rotationSteps: block.rotationSteps ?? 0,
		widthFt: block.widthFt,
		depthFt: block.depthFt,
		heightFt: block.heightFt,
		plankedLevelsCount: Math.max(1, Math.round(Number(block.plankedLevelsCount ?? 1))),
		includeBaseDeck: Boolean(block.includeBaseDeck ?? false),
		braceFrontBack: block.braceFrontBack ?? 'off',
		braceLeftRight: block.braceLeftRight ?? 'off',
		ledgerEveryNRosettes: Math.max(1, Math.round(Number(block.ledgerEveryNRosettes ?? 4))),
		baseSettings: {
			jackExtensionIn: Number(block.baseSettings?.jackExtensionIn ?? 0),
			showWoodSill: Boolean(block.baseSettings?.showWoodSill),
			showBaseCollar: Boolean(block.baseSettings?.showBaseCollar),
		},
	}
}

function buildBuildingOccluders(obstacles: ResolvedBuildingBoxObstacle[]): BuildingOccluder[] {
	return obstacles.map((obstacle) => {
			const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, obstacle.rotationZRad))
			const matrix = new THREE.Matrix4().compose(
				new THREE.Vector3(obstacle.center.x, obstacle.center.y, obstacle.center.z),
				quaternion,
				new THREE.Vector3(1, 1, 1),
			)
			return {
				inverseMatrix: matrix.clone().invert(),
				halfSize: new THREE.Vector3(obstacle.dimensions.x, obstacle.dimensions.y, obstacle.dimensions.z).multiplyScalar(0.5),
			}
		})
}

function isSegmentOccludedByBuilding(
	cameraPosition: THREE.Vector3,
	labelPosition: THREE.Vector3,
	occluders: BuildingOccluder[],
) {
	if (occluders.length === 0) return false
	const worldDistance = cameraPosition.distanceTo(labelPosition)
	if (worldDistance <= 1e-6) return false

	for (const occluder of occluders) {
		const localOrigin = cameraPosition.clone().applyMatrix4(occluder.inverseMatrix)
		const localTarget = labelPosition.clone().applyMatrix4(occluder.inverseMatrix)
		const localDirection = localTarget.clone().sub(localOrigin)
		const localDistance = localDirection.length()
		if (localDistance <= 1e-6) continue

		const ray = new THREE.Ray(localOrigin, localDirection.multiplyScalar(1 / localDistance))
		const hit = ray.intersectBox(
			new THREE.Box3(
				occluder.halfSize.clone().multiplyScalar(-1),
				occluder.halfSize.clone(),
			),
			new THREE.Vector3(),
		)
		if (!hit) continue

		const hitDistance = hit.distanceTo(localOrigin)
		if (hitDistance < localDistance - 0.05) return true
	}

	return false
}

function LegLoadValueLabel(props: {
	position: THREE.Vector3
	valueText: string
	buildingOccluders: BuildingOccluder[]
}) {
	const { camera } = useThree()
	const wrapperRef = useRef<HTMLDivElement | null>(null)
	const visibleRef = useRef(true)
	const labelPosition = props.position

	useFrame(() => {
		const shouldBeVisible = !isSegmentOccludedByBuilding(camera.position, labelPosition, props.buildingOccluders)
		if (visibleRef.current === shouldBeVisible) return
		visibleRef.current = shouldBeVisible
		if (!wrapperRef.current) return
		wrapperRef.current.style.opacity = shouldBeVisible ? '1' : '0'
	})

	return (
		<Html
			center
			position={labelPosition}
			sprite
			style={{ pointerEvents: 'none', transform: 'translate(-50%, 0)' }}
			zIndexRange={[120, 0]}
		>
			<div
				ref={wrapperRef}
				style={{
					display: 'inline-flex',
					alignItems: 'baseline',
					gap: 4,
					color: '#0b1324',
					fontFamily: '"Plus Jakarta Sans", Inter, system-ui, sans-serif',
					fontSize: 12.5,
					fontWeight: 800,
					lineHeight: 1,
					textAlign: 'center',
					whiteSpace: 'nowrap',
					letterSpacing: '0.008em',
					fontVariantNumeric: 'tabular-nums',
					textShadow: '0 0 1px rgba(255, 255, 255, 0.98), 0 1px 3px rgba(255, 255, 255, 0.96), 0 8px 22px rgba(255, 255, 255, 0.8)',
					transition: 'opacity 120ms ease',
					opacity: 1,
				}}
			>
				<span>{props.valueText}</span>
				<span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: 'rgba(11, 19, 36, 0.64)', textTransform: 'uppercase' }}>
					lb
				</span>
			</div>
		</Html>
	)
}

function getLiveLoadDeckTargetKey(target: Pick<LiveLoadDeckTarget, 'blockId' | 'liftIndex'> & { bayKey?: string }) {
	return `${target.blockId}@${target.liftIndex}@${target.bayKey ?? '*'}`
}

function isRoundAutoGeneratedBay(
	block: Pick<
		ScaffoldBlockInstance,
		'autoGeneratedMode'
		| 'autoGeneratedTargetShape'
		| 'autoGeneratedRoundInnerLedgerFt'
		| 'autoGeneratedRoundOuterLedgerFt'
	>,
): block is Pick<
		ScaffoldBlockInstance,
		'autoGeneratedMode'
		| 'autoGeneratedTargetShape'
		| 'autoGeneratedRoundInnerLedgerFt'
		| 'autoGeneratedRoundOuterLedgerFt'
	> & {
		autoGeneratedTargetShape: 'circle' | 'ring'
		autoGeneratedRoundInnerLedgerFt: number
		autoGeneratedRoundOuterLedgerFt: number
	} {
	return Boolean(
		block.autoGeneratedMode === 'around-building'
		&& (block.autoGeneratedTargetShape === 'circle' || block.autoGeneratedTargetShape === 'ring')
		&& Number.isFinite(Number(block.autoGeneratedRoundInnerLedgerFt))
		&& Number.isFinite(Number(block.autoGeneratedRoundOuterLedgerFt)),
	)
}

function dedupeLiveLoadDeckTargets(targets: LiveLoadDeckTarget[]) {
	const seen = new Set<string>()
	return targets.filter((target) => {
		const key = getLiveLoadDeckTargetKey(target)
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

function isCameraNavigationModifierGesture(event: PointerEvent | MouseEvent): boolean {
	return !!(event.shiftKey || event.altKey)
}

function normalizeMarqueeRect(a: { x: number; y: number }, b: { x: number; y: number }): MarqueeRect {
	return {
		xMin: Math.min(a.x, b.x),
		xMax: Math.max(a.x, b.x),
		yMin: Math.min(a.y, b.y),
		yMax: Math.max(a.y, b.y),
	}
}

function doesWindowContainRect(selection: MarqueeRect, rect: MarqueeRect): boolean {
	return (
		rect.xMin >= selection.xMin &&
		rect.xMax <= selection.xMax &&
		rect.yMin >= selection.yMin &&
		rect.yMax <= selection.yMax
	)
}

function doesCrossingIntersectRect(selection: MarqueeRect, rect: MarqueeRect): boolean {
	return !(
		rect.xMax < selection.xMin ||
		rect.xMin > selection.xMax ||
		rect.yMax < selection.yMin ||
		rect.yMin > selection.yMax
	)
}

function LiveLoadMarquee(props: {
	start: { x: number; y: number }
	current: { x: number; y: number }
	crossing: boolean
	z?: number
}) {
	const { start, current, crossing, z = 0.04 } = props
	const selectionRect = useMemo(() => normalizeMarqueeRect(start, current), [current, start])
	const widthFt = selectionRect.xMax - selectionRect.xMin
	const depthFt = selectionRect.yMax - selectionRect.yMin

	const [fillGeometry, edgeGeometry] = useMemo(() => {
		const geometry = new THREE.PlaneGeometry(Math.max(widthFt, 1e-6), Math.max(depthFt, 1e-6))
		return [geometry, new THREE.EdgesGeometry(geometry)] as const
	}, [depthFt, widthFt])

	useEffect(() => {
		return () => {
			fillGeometry.dispose()
			edgeGeometry.dispose()
		}
	}, [edgeGeometry, fillGeometry])

	if (widthFt <= 1e-6 || depthFt <= 1e-6) return null

	const centerX = (selectionRect.xMin + selectionRect.xMax) * 0.5
	const centerY = (selectionRect.yMin + selectionRect.yMax) * 0.5
	const edgeColor = crossing ? '#34d399' : '#60a5fa'
	const fillColor = crossing ? '#6ee7b7' : '#93c5fd'

	return (
		<group position={[centerX, centerY, z]} raycast={() => null}>
			<mesh>
				<primitive object={fillGeometry} attach="geometry" />
				<meshBasicMaterial
					color={fillColor}
					transparent
					opacity={crossing ? 0.12 : 0.08}
					depthWrite={false}
					side={THREE.DoubleSide}
				/>
			</mesh>

			<lineSegments>
				<primitive object={edgeGeometry} attach="geometry" />
				<lineBasicMaterial color={edgeColor} transparent opacity={0.95} />
			</lineSegments>
		</group>
	)
}

function buildCatalogWeightMap(parts: Array<{ partNumber: string; weightLb?: number }>) {
	return new Map(
		parts
			.filter((part): part is { partNumber: string; weightLb: number } => typeof part.weightLb === 'number')
			.map((part) => [part.partNumber, part.weightLb] as const),
	)
}

function resolveClosestCatalogPlankWeightLb(
	plank: RinglockPlankInstance,
	parts: Array<Pick<CatalogPart, 'partNumber' | 'plankWidthIn'>>,
	weightByPartNumber: Map<string, number>,
) {
	if (plank.partNumber) {
		return weightByPartNumber.get(plank.partNumber) ?? null
	}

	const resolvedPartNumber = resolveClosestCatalogPlankPartNumber(parts, plank.widthIn, plank.lengthFt)
	if (!resolvedPartNumber) return null
	return weightByPartNumber.get(resolvedPartNumber) ?? null
}

function addLegLoad(loads: LegLoadByStackId, stackId: string | null | undefined, weightLb: number) {
	if (!stackId || !Number.isFinite(weightLb) || weightLb <= 0) return
	loads[stackId] = (loads[stackId] ?? 0) + weightLb
}

function formatLoadLb(weightLb: number) {
	if (!Number.isFinite(weightLb)) return '0.0'
	return weightLb >= 100 ? weightLb.toFixed(0) : weightLb.toFixed(1)
}

function compareStackLegFramesForLabelOrder(a: StackLegFrame, b: StackLegFrame) {
	const byY = b.position.y - a.position.y
	if (Math.abs(byY) > 1e-6) return byY

	const byX = a.position.x - b.position.x
	if (Math.abs(byX) > 1e-6) return byX

	const byZ = a.position.z - b.position.z
	if (Math.abs(byZ) > 1e-6) return byZ

	return a.stackId.localeCompare(b.stackId)
}

function resolveClosestStackIdForPoint(point: THREE.Vector3, stackFrames: StackLegFrame[]) {
	let bestStackId: string | null = null
	let bestScore = Infinity

	for (const frame of stackFrames) {
		const dx = point.x - frame.position.x
		const dy = point.y - frame.position.y
		const xyDistance = Math.hypot(dx, dy)
		if (xyDistance > STACK_MATCH_XY_TOL_FT) continue

		const clampedZ = Math.min(Math.max(point.z, frame.bottomZ), frame.topZ)
		const zDistance = Math.abs(point.z - clampedZ)
		if (zDistance > STACK_MATCH_Z_TOL_FT) continue

		const score = xyDistance * 10 + zDistance
		if (score < bestScore) {
			bestScore = score
			bestStackId = frame.stackId
		}
	}

	return bestStackId
}

function getPlankLongDirection(rotationZ: number) {
	return new THREE.Vector2(-Math.sin(rotationZ), Math.cos(rotationZ)).normalize()
}

function applyLedgerPointLoad(
	loads: LegLoadByStackId,
	ledger: LedgerLoadFrame,
	pointOnLedger: THREE.Vector2,
	pointLoadLb: number,
) {
	if (!Number.isFinite(pointLoadLb) || pointLoadLb <= 0) return
	if (ledger.lengthFt <= 1e-6) {
		addLegLoad(loads, ledger.startStackId, pointLoadLb * 0.5)
		addLegLoad(loads, ledger.endStackId, pointLoadLb * 0.5)
		return
	}

	const projectedLengthFt = THREE.MathUtils.clamp(
		pointOnLedger.clone().sub(ledger.start2).dot(ledger.dir),
		0,
		ledger.lengthFt,
	)
	const endReactionLb = pointLoadLb * (projectedLengthFt / ledger.lengthFt)
	const startReactionLb = pointLoadLb - endReactionLb

	addLegLoad(loads, ledger.startStackId, startReactionLb)
	addLegLoad(loads, ledger.endStackId, endReactionLb)
}

function distributePlankLoadToLegs(
	loads: LegLoadByStackId,
	plank: RinglockPlankInstance,
	plankWeightLb: number,
	ledgerFrames: LedgerLoadFrame[],
) {
	if (!Number.isFinite(plankWeightLb) || plankWeightLb <= 0) return

	const plankCenter = new THREE.Vector2(plank.center.x, plank.center.y)
	const longDir = getPlankLongDirection(plank.rotationZ)
	const supportDir = new THREE.Vector2(longDir.y, -longDir.x).normalize()
	const expectedLedgerZ = plank.center.z - (inchesToFeet(LEDGER_TUBE_OD_IN / 2) - inchesToFeet(RINGLOCK_PLANK_PROFILE_DEPTH_IN) / 2)
	const targetOffsetFt = plank.lengthFt / 2

	let negativeSupport: { ledger: LedgerLoadFrame; offsetFt: number; score: number } | null = null
	let positiveSupport: { ledger: LedgerLoadFrame; offsetFt: number; score: number } | null = null

	for (const ledger of ledgerFrames) {
		if (Math.abs(ledger.z - expectedLedgerZ) > SUPPORT_LEDGER_Z_TOL_FT) continue
		if (Math.abs(Math.abs(ledger.dir.dot(supportDir)) - 1) > 1 - SUPPORT_LEDGER_ALIGN_DOT_THRESHOLD) continue

		const delta = plankCenter.clone().sub(ledger.mid)
		const signedOffsetFt = delta.dot(longDir)
		const projectedFt = delta.dot(ledger.dir)
		if (Math.abs(projectedFt) > ledger.lengthFt / 2 + SUPPORT_LEDGER_SPAN_TOL_FT) continue

		const score = Math.abs(Math.abs(signedOffsetFt) - targetOffsetFt)
		if (signedOffsetFt < 0) {
			if (!negativeSupport || score < negativeSupport.score) {
				negativeSupport = { ledger, offsetFt: signedOffsetFt, score }
			}
		} else if (signedOffsetFt > 0) {
			if (!positiveSupport || score < positiveSupport.score) {
				positiveSupport = { ledger, offsetFt: signedOffsetFt, score }
			}
		}
	}

	if (!negativeSupport || !positiveSupport) return

	const pointLoadPerSupportLb = plankWeightLb * 0.5
	const negativePoint = plankCenter.clone().sub(longDir.clone().multiplyScalar(Math.abs(negativeSupport.offsetFt)))
	const positivePoint = plankCenter.clone().add(longDir.clone().multiplyScalar(Math.abs(positiveSupport.offsetFt)))

	applyLedgerPointLoad(loads, negativeSupport.ledger, negativePoint, pointLoadPerSupportLb)
	applyLedgerPointLoad(loads, positiveSupport.ledger, positivePoint, pointLoadPerSupportLb)
}

/**
 * ScaffoldWorkspace - Interactive scaffold assembly component.
 * 
 * Renders placed scaffold stacks and connections.
 * Handles click-to-place based on catalog selection.
 */
export type ScaffoldWorkspaceProps = {
	clippingPlanes?: THREE.Plane[]
}

export function ScaffoldWorkspace({ clippingPlanes }: ScaffoldWorkspaceProps) {
  const { baseSettings } = useScaffoldBaseSettings()
	const { settings } = useSettings()
  const { camera, gl } = useThree()
  const {
    selectedObjectId,
    setSelectedObjectId,
	    setSelectedStackIds,
    objects,
    buildingEntities,
    scaffoldStacks,
    scaffoldBlocks,
    blockDragPreviewIds,
    blockDragHiddenStackIds,
    ledgerConnections,
    manualPlankPlacements,
    manualLiveLoadPlacements,
    activeTool,
				blockToolSettings,
					dxfPreviewEnabled,
			appendStandardSegmentToStack,
			cameraNavigationActive,
			viewMode,
			activeLiveLoadLevelNumber,
			hoveredLiveLoadDeckTargets,
			selectedLiveLoadDeckTargets,
			setSelectedLiveLoadDeckTargets,
    selectedStackIds,
    getSelectedStacks,
    updateScaffoldStack,
    addScaffoldStack,
    setStandardSegmentsForStack,
    addLedgerConnection,
    stackEditActionMode,
    setStackEditActionMode,
    stackMoveStep,
    setStackMoveStep,
    stackOrthoLocked,
    setStackOrthoLocked,
    stackCadHud,
    setStackCadHud,
  } = useTool()
		  const { categoryKey, manufacturerId, selectedManufacturer, selectedPart } = useCatalogSelection()

					const isPlacingStandard = categoryKey === 'standards' && selectedPart !== null
					const isPlacingLedger = categoryKey === 'ledgers' || categoryKey === 'trusses'
					const isPlacingPlank = categoryKey === 'planks'
					const isPlacingLiveLoad = categoryKey === 'liveLoads'
					const isBlockInspectMode = activeTool === 'block' && blockToolSettings.mode === 'inspect'
				// In Block "Scaffold" (inspect) mode, selection should always work even if a catalog part
				// is currently selected (otherwise the user can't click members on first entry).
					const selectionEnabled = isBlockInspectMode || (activeTool === 'select' && !isPlacingStandard && !isPlacingLedger && !isPlacingPlank && !isPlacingLiveLoad)
	const movingBlockIdSet = useMemo(() => new Set(blockDragPreviewIds), [blockDragPreviewIds])
	const resolvedBuildingGeometry = useMemo(
		() => resolveScaffoldBuildingGeometry({ buildingEntities, objects }),
		[buildingEntities, objects],
	)
	const buildingSupportSurfaces = resolvedBuildingGeometry.supportSurfaces
	const buildingCutVolumes = resolvedBuildingGeometry.cutVolumes
	const movingStackIdSet = useMemo(() => {
		const ids = new Set<string>((blockDragHiddenStackIds ?? []).map((id) => String(id)))
		if (movingBlockIdSet.size === 0) return ids
		const movingManagedStackKeys = new Set<string>()
		for (const block of scaffoldBlocks) {
			if (!movingBlockIdSet.has(block.id)) continue
			for (const key of block.managedStackKeys ?? []) {
				movingManagedStackKeys.add(key)
			}
		}
		if (movingManagedStackKeys.size === 0) return ids
		for (const stack of scaffoldStacks) {
			if (movingManagedStackKeys.has(makeStackPositionKey(stack.gridPosition.x, stack.gridPosition.y, stack.gridPosition.z))) {
				ids.add(stack.id)
			}
		}
		return ids
	}, [blockDragHiddenStackIds, movingBlockIdSet, scaffoldBlocks, scaffoldStacks])

	// ─── Permanent copy dimensions ──────────────────────────────────────────
	type PermanentDimRecord = {
		id: string
		start: { x: number; y: number }
		end: { x: number; y: number }
		distance: number
		offset: number   // perpendicular offset in ft (draggable)
	}
	const [permanentDims, setPermanentDims] = useState<PermanentDimRecord[]>([])

	// ─── Stack move/copy state ───────────────────────────────────────────────
	type StackMarqueeState = {
		start: { x: number; y: number }
		current: { x: number; y: number }
		startClientX: number
		currentClientX: number
		startClientY: number
		currentClientY: number
	}
	const [stackMarquee, setStackMarquee] = useState<StackMarqueeState | null>(null)
	const stackMarqueeRef = useRef<StackMarqueeState | null>(null)
	// Clear marquee immediately when the camera view changes (e.g. ViewCube click)
	// useLayoutEffect runs synchronously before the browser can fire the next pointermove,
	// so the stale start point from the old projection is never used.
	useLayoutEffect(() => {
		stackMarqueeRef.current = null
		setStackMarquee(null)
	}, [viewMode])
	const [stackMoveIds, setStackMoveIds] = useState<string[]>([])
	const stackMoveIdsRef = useRef<string[]>([])
	const [stackMoveAnchor, setStackMoveAnchor] = useState<{ x: number; y: number } | null>(null)
	const stackMoveAnchorRef = useRef<{ x: number; y: number } | null>(null)
	const [stackPreviewOffset, setStackPreviewOffset] = useState<{ dx: number; dy: number } | null>(null)

	const stackOrthoLockedRef = useRef(false)
	const stackPreviewOffsetRef = useRef<{ dx: number; dy: number } | null>(null)
	const stackCadHudRef = useRef<StackCadHud | null>(null)
	const lastCursorPtRef = useRef<{ x: number; y: number } | null>(null)
	const executeStackPlacementRef = useRef<(() => void) | null>(null)
	// Settings-based snap step (mirrors PlaceStandardTool behaviour)
	const snapStepRef = useRef(settings.snapToGrid ? settings.gridSize : 0)
	useEffect(() => { stackMoveAnchorRef.current = stackMoveAnchor }, [stackMoveAnchor])
	useEffect(() => { stackMoveIdsRef.current = stackMoveIds }, [stackMoveIds])
	useEffect(() => { stackOrthoLockedRef.current = stackOrthoLocked }, [stackOrthoLocked])
	useEffect(() => { stackPreviewOffsetRef.current = stackPreviewOffset }, [stackPreviewOffset])
	useEffect(() => { stackCadHudRef.current = stackCadHud }, [stackCadHud])
	useEffect(() => { snapStepRef.current = settings.snapToGrid ? settings.gridSize : 0 }, [settings.snapToGrid, settings.gridSize])

	const cancelStackMove = useCallback(() => {
		stackMarqueeRef.current = null
		stackMoveAnchorRef.current = null
		stackMoveIdsRef.current = []
		stackOrthoLockedRef.current = false
		stackPreviewOffsetRef.current = null
		stackCadHudRef.current = null
		lastCursorPtRef.current = null
		setStackMarquee(null)
		setStackMoveAnchor(null)
		setStackMoveIds([])
		setStackPreviewOffset(null)
		setStackOrthoLocked(false)
		setStackCadHud(null)
		setStackEditActionMode('neutral')
		setStackMoveStep(null)
	}, [setStackCadHud, setStackEditActionMode, setStackMoveStep, setStackOrthoLocked])

	// Escape key cancels
	useEffect(() => {
		if (stackEditActionMode === 'neutral') return
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelStackMove() }
		window.addEventListener('keydown', onKey, true)
		return () => window.removeEventListener('keydown', onKey, true)
	}, [cancelStackMove, stackEditActionMode])

	// When mode activates, start in 'select' step
	useEffect(() => {
		if (stackEditActionMode === 'neutral') {
			setStackMoveStep(null)
		} else {
			setStackMoveStep('select')
		}
	}, [stackEditActionMode, setStackMoveStep])

	// Cursor style
	useEffect(() => {
		const canvas = gl.domElement
		if (stackEditActionMode === 'neutral') {
			canvas.style.removeProperty('cursor')
			return
		}
		canvas.style.cursor = stackMoveStep === 'select' ? 'crosshair' : 'cell'
		return () => { canvas.style.removeProperty('cursor') }
	}, [gl.domElement, stackEditActionMode, stackMoveStep])
	// Initialise / clear CAD HUD when entering or leaving 'place' step
	useEffect(() => {
		if (stackMoveStep === 'place') {
			setStackCadHud({ distance: 0, angle: 0, field: 'distance', distanceInput: '', angleInput: '', lockedAngleDeg: null })
		} else {
			setStackCadHud(null)
		}
	}, [stackMoveStep, setStackCadHud])

	// Recompute preview when typed distance or locked angle changes (cursor may not be moving)
	useEffect(() => {
		if (stackMoveStep !== 'place') return
		const anchor = stackMoveAnchorRef.current
		const pt = lastCursorPtRef.current
		if (!anchor || !pt) return
		const hud = stackCadHudRef.current
		const result = applyPlaceConstraints(
			pt.x - anchor.x, pt.y - anchor.y,
			stackOrthoLockedRef.current,
			hud?.lockedAngleDeg ?? null,
			hud?.distanceInput ?? '',
			snapStepRef.current,
		)
		setStackPreviewOffset({ dx: result.dx, dy: result.dy })
		const curHud = stackCadHudRef.current; if (curHud) setStackCadHud({ ...curHud, distance: result.distance, angle: result.angleDeg })
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [stackCadHud?.distanceInput, stackCadHud?.lockedAngleDeg, stackMoveStep])

	// F8 toggles ortho lock; digits/Tab/Backspace/Enter drive CAD direct-distance-entry
	useEffect(() => {
		if (stackMoveStep !== 'place') return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'F8') {
				e.preventDefault()
				setStackOrthoLocked(!stackOrthoLockedRef.current)
				return
			}
			if (e.key === 'Escape') return  // handled by the cancel effect
			if (e.ctrlKey || e.metaKey || e.altKey) return
			if (isTextInputFocused()) return

			if (e.key === 'Enter') {
				e.preventDefault()
				e.stopPropagation()
				executeStackPlacementRef.current?.()
				return
			}
			if (e.key === 'Tab') {
				e.preventDefault()
				const cur = stackCadHudRef.current
				if (!cur) return
				setStackCadHud({ ...cur, field: cur.field === 'distance' ? 'angle' : 'distance' })
				return
			}
			if (e.key === 'Backspace') {
				e.preventDefault()
				const cur = stackCadHudRef.current
				if (!cur) return
				if (cur.field === 'distance') {
					setStackCadHud({ ...cur, distanceInput: cur.distanceInput.slice(0, -1) })
				} else {
					const newAngle = cur.angleInput.slice(0, -1)
					setStackCadHud({ ...cur, angleInput: newAngle, lockedAngleDeg: newAngle === '' ? null : cur.lockedAngleDeg })
				}
				return
			}
			if (/^[\d.]$/.test(e.key)) {
				e.preventDefault()
				const cur = stackCadHudRef.current
				if (!cur) return
				if (cur.field === 'distance') {
					setStackCadHud({ ...cur, distanceInput: cur.distanceInput + e.key })
				} else {
					const newAngle = cur.angleInput + e.key
					const parsed = parseFloat(newAngle)
					setStackCadHud({ ...cur, angleInput: newAngle, lockedAngleDeg: isNaN(parsed) ? null : parsed })
				}
			}
		}
		window.addEventListener('keydown', onKey, true)
		return () => window.removeEventListener('keydown', onKey, true)
	}, [stackMoveStep, setStackCadHud, setStackOrthoLocked])
	// ─── (pointer effects using projectClientToGround are placed after it is declared) ───

	// Selection cycling state (CAD-style select-through)
	const selectionCycleRef = useRef<{
		key: string
		timeMs: number
		candidateIds: string[]
		index: number
	} | null>(null)

	const applySelectionByObjectId = useCallback(
		(objectId: string) => {
			if (objectId.startsWith('diagonal-')) {
				setSelectedStackIds([])
				setSelectedObjectId(objectId)
				return
			}
			if (objectId.startsWith('ledger-')) {
				setSelectedStackIds([])
				setSelectedObjectId(objectId)
				return
			}
			if (objectId.startsWith('live-load-')) {
				setSelectedStackIds([])
				setSelectedObjectId(objectId)
				return
			}
				if (objectId.startsWith('plank-')) {
					setSelectedStackIds([])
					setSelectedObjectId(objectId)
					return
				}
			if (objectId.startsWith('standard-')) {
					const payload = objectId.slice('standard-'.length)
					const at = payload.indexOf('@')
					const stackId = at >= 0 ? payload.slice(0, at) : payload
				setSelectedStackIds([stackId])
				setSelectedObjectId(objectId)
				return
			}
			if (objectId.startsWith('wood-sill-')) {
				const stackId = objectId.slice('wood-sill-'.length)
				setSelectedStackIds([stackId])
				setSelectedObjectId(objectId)
				return
			}
			if (objectId.startsWith('screw-jack-')) {
				const stackId = objectId.slice('screw-jack-'.length)
				setSelectedStackIds([stackId])
				setSelectedObjectId(objectId)
				return
			}
			if (objectId.startsWith('base-collar-')) {
				const stackId = objectId.slice('base-collar-'.length)
				setSelectedStackIds([stackId])
				setSelectedObjectId(objectId)
				return
			}
		},
		[setSelectedObjectId, setSelectedStackIds]
	)

	const maybeCycleSelection = useCallback(
		(e: ThreeEvent<PointerEvent>) => {
			if (cameraNavigationActive) return false
			const intersections = (e.intersections ?? []) as Array<any>
			if (intersections.length < 2) return false

			const candidates: string[] = []
			const seen = new Set<string>()

			for (const hit of intersections) {
				const obj = hit?.object as THREE.Object3D | undefined
				const ud: any = obj?.userData
				const kind = ud?.scaffPickKind as string | undefined
				const items = ud?.scaffItems as any[] | undefined
				if (!kind || !Array.isArray(items)) continue

				const instanceId = hit?.instanceId
				if (instanceId === undefined || instanceId === null) continue
				if (instanceId < 0 || instanceId >= items.length) continue

				if (kind === 'standard') {
					const s = items[instanceId] as { id: string } | undefined
					if (!s?.id) continue
					const objectId = `standard-${s.id}`
					if (!seen.has(objectId)) {
						seen.add(objectId)
						candidates.push(objectId)
					}
					continue
				}

				if (kind === 'ledger') {
					const l = items[instanceId] as { id: string } | undefined
					if (!l?.id) continue
					const objectId = `ledger-${l.id}`
					if (!seen.has(objectId)) {
						seen.add(objectId)
						candidates.push(objectId)
					}
					continue
				}

				if (kind === 'live-load') {
					const liveLoad = items[instanceId] as { id: string } | undefined
					if (!liveLoad?.id) continue
					const objectId = `live-load-${liveLoad.id}`
					if (!seen.has(objectId)) {
						seen.add(objectId)
						candidates.push(objectId)
					}
					continue
				}

					if (kind === 'plank') {
						const plank = items[instanceId] as { id: string } | undefined
						if (!plank?.id) continue
						const objectId = `plank-${plank.id}`
						if (!seen.has(objectId)) {
							seen.add(objectId)
							candidates.push(objectId)
						}
						continue
					}

				if (kind === 'base') {
					const base = items[instanceId] as { id: string } | undefined
					const componentType = ud?.scaffBaseComponentType as
						| 'wood-sill'
						| 'screw-jack'
						| 'base-collar'
						| undefined
					if (!base?.id || !componentType) continue
					const objectId = `${componentType}-${base.id}`
					if (!seen.has(objectId)) {
						seen.add(objectId)
						candidates.push(objectId)
					}
					continue
				}

					if (kind === 'diagonal') {
						const diagonal = items[instanceId] as { id: string } | undefined
						if (!diagonal?.id) continue
						const objectId = `diagonal-${diagonal.id}`
						if (!seen.has(objectId)) {
							seen.add(objectId)
							candidates.push(objectId)
						}
						continue
					}
			}

			if (candidates.length < 2) return false

			const now = Date.now()
			const ne = e.nativeEvent as any
			const binPx = 8
			const cx = typeof ne?.clientX === 'number' ? ne.clientX : 0
			const cy = typeof ne?.clientY === 'number' ? ne.clientY : 0
			const clickKey = `${Math.round(cx / binPx)}:${Math.round(cy / binPx)}`
			const prev = selectionCycleRef.current
			const withinWindow = prev ? now - prev.timeMs < 650 : false
			const sameSeries = !!prev && withinWindow && prev.key === clickKey
			const forceCycle = !!ne?.ctrlKey || !!ne?.metaKey

			const selectedIdx = selectedObjectId ? candidates.indexOf(selectedObjectId) : -1
			let nextIdx = -1

			if (forceCycle) {
				// Ctrl/⌘ forces select-through: if nothing selected yet, jump to the 2nd hit.
				nextIdx = selectedIdx >= 0 ? (selectedIdx + 1) % candidates.length : Math.min(1, candidates.length - 1)
			} else if (sameSeries && selectedIdx >= 0) {
				// Repeated click in the same screen region cycles through overlaps.
				nextIdx = (selectedIdx + 1) % candidates.length
			} else {
				// Start/refresh the series but don't override the default behavior on the first click.
				selectionCycleRef.current = {
					key: clickKey,
					timeMs: now,
					candidateIds: candidates,
					index: Math.max(0, selectedIdx),
				}
				return false
			}

			const nextId = candidates[nextIdx]
			selectionCycleRef.current = {
				key: clickKey,
				timeMs: now,
				candidateIds: candidates,
				index: nextIdx,
			}
			applySelectionByObjectId(nextId)
			return true
		},
		[applySelectionByObjectId, cameraNavigationActive, selectedObjectId]
	)

  // Convert stacks to render instances
  const standardInstances = useMemo<RinglockStandardInstance[]>(() => {
			const out: RinglockStandardInstance[] = []
			for (const stack of scaffoldStacks) {
				if (movingStackIdSet.has(stack.id)) continue
				const segments = stack.standardSegments
				if (!Array.isArray(segments) || segments.length === 0) continue
			const effectiveShowWoodSill = (stack.baseSupport === 'stacked')
				? false
				: (stack.showWoodSill ?? baseSettings.showWoodSill)
			const effectiveShowBaseCollar = (stack.baseSupport === 'stacked')
				? false
				: (stack.showBaseCollar ?? baseSettings.showBaseCollar)

				const baseOffsetFt = getStandardBaseOffsetFt(stack.jackExtensionIn, effectiveShowWoodSill, effectiveShowBaseCollar)
				const baseWorldZ = stack.gridPosition.z + baseOffsetFt
				let cumulativeHeightFt = 0
					let segmentIndex = 0
					for (const seg of segments) {
					const pn = String(seg?.partNumber ?? '')
					const spec = UNIVERSAL_RINGLOCK_STANDARDS[pn as UniversalRinglockStandardId]
						if (!spec) {
							segmentIndex++
							continue
						}
					out.push({
							// NOTE: id is per-segment so selection/picking can target individual stacked pieces.
							id: `${stack.id}@${segmentIndex}`,
							stackId: stack.id,
							segmentIndex,
							partNumber: pn,
						basePosition: new THREE.Vector3(stack.gridPosition.x, stack.gridPosition.y, baseWorldZ + cumulativeHeightFt),
						heightFt: spec.heightFt,
						rosetteCount: spec.rosetteCount,
					})
					cumulativeHeightFt += spec.heightFt
						segmentIndex++
				}
			}
			return out
	}, [scaffoldStacks, movingStackIdSet, baseSettings.showWoodSill, baseSettings.showBaseCollar])

  const baseInstances = useMemo<RinglockBaseInstance[]>(() => {
	    return scaffoldStacks
			.filter((stack) => !movingStackIdSet.has(stack.id))
			.map(stack => {
				const effectiveShowWoodSill = (stack.baseSupport === 'stacked')
					? false
					: (stack.showWoodSill ?? baseSettings.showWoodSill)
				const effectiveShowBaseCollar = (stack.baseSupport === 'stacked')
					? false
					: (stack.showBaseCollar ?? baseSettings.showBaseCollar)

				return {
      id: stack.id,
      groundPosition: stack.gridPosition.clone(),
      jackExtensionIn: stack.jackExtensionIn,
				showWoodSill: effectiveShowWoodSill,
				showBaseCollar: effectiveShowBaseCollar,
			}
			})
	}, [scaffoldStacks, movingStackIdSet, baseSettings.showWoodSill, baseSettings.showBaseCollar])

	const rosettePositionByLiftByStackId = useMemo(() => {
		const map = new Map<string, Map<number, THREE.Vector3>>()
		for (const stack of scaffoldStacks) {
			if (movingStackIdSet.has(stack.id)) continue
			const effectiveShowWoodSill = (stack.baseSupport === 'stacked')
				? false
				: (stack.showWoodSill ?? baseSettings.showWoodSill)
			const effectiveShowBaseCollar = (stack.baseSupport === 'stacked')
				? false
				: (stack.showBaseCollar ?? baseSettings.showBaseCollar)
			const rosettes = computeRosettePositions(
				stack.gridPosition,
				stack.standardSegments,
				stack.jackExtensionIn,
				effectiveShowWoodSill,
				effectiveShowBaseCollar,
			)
			map.set(
				stack.id,
				new Map(rosettes.map((rosette) => [rosette.liftIndex, rosette.position.clone()] as const)),
			)
		}
		return map
	}, [scaffoldStacks, movingStackIdSet, baseSettings.showWoodSill, baseSettings.showBaseCollar])

  // Convert ledger connections to render instances
	  const ledgerInstances = useMemo<RinglockLedgerInstance[]>(() => {
	    return ledgerConnections
				.filter((conn) => !(movingStackIdSet.has(conn.startNode.stackId) || movingStackIdSet.has(conn.endNode.stackId)))
				.map((conn): RinglockLedgerInstance | null => {
      const startNodes = rosettePositionByLiftByStackId.get(conn.startNode.stackId)
      const endNodes = rosettePositionByLiftByStackId.get(conn.endNode.stackId)
      if (!startNodes || !endNodes) return null

      const startNode = startNodes.get(conn.startNode.liftIndex)
      const endNode = endNodes.get(conn.endNode.liftIndex)
      if (!startNode || !endNode) return null

	      return {
	        id: conn.id,
	        partNumber: conn.ledgerPartNumber,
	        start: startNode.clone(),
	        end: endNode.clone(),
	      }
	    })
				.filter((l): l is RinglockLedgerInstance => l !== null)
	}, [ledgerConnections, movingStackIdSet, rosettePositionByLiftByStackId])

	const stackIdBySupportKey = useMemo(() => {
		const map = new Map<string, string>()
		for (const stack of scaffoldStacks) {
			if (movingStackIdSet.has(stack.id)) continue
			map.set(makeStackPositionKey(stack.gridPosition.x, stack.gridPosition.y, stack.gridPosition.z), stack.id)
		}
		return map
	}, [movingStackIdSet, scaffoldStacks])

	const supportAwareLayoutsByBlockId = useMemo(() => {
		const layouts = new Map<string, ReturnType<typeof resolveSupportAwareBlockLayout>>()
		for (const block of scaffoldBlocks) {
			if (movingBlockIdSet.has(block.id)) continue
			layouts.set(block.id, resolveSupportAwareBlockLayout({
				centerX: block.center.x,
				centerY: block.center.y,
				recipe: buildSupportAwareRecipeFromBlock(block),
				objects,
				supportSurfaces: buildingSupportSurfaces,
				cutVolumes: buildingCutVolumes,
			}))
		}
		return layouts
	}, [buildingCutVolumes, buildingSupportSurfaces, movingBlockIdSet, objects, scaffoldBlocks])

	const diagonalInstances = useMemo<RinglockDiagonalInstance[]>(() => {
		const out: RinglockDiagonalInstance[] = []
		const boundaryTol = 0.01

		const rectForBlock = (block: (typeof scaffoldBlocks)[number]) => {
			const halfWidth = block.widthFt / 2
			const halfDepth = block.depthFt / 2
			const corners = [
				rotateOffset90({ x: -halfWidth, y: -halfDepth }, block.rotationSteps ?? 0),
				rotateOffset90({ x: halfWidth, y: -halfDepth }, block.rotationSteps ?? 0),
				rotateOffset90({ x: halfWidth, y: halfDepth }, block.rotationSteps ?? 0),
				rotateOffset90({ x: -halfWidth, y: halfDepth }, block.rotationSteps ?? 0),
			]
			const xs = corners.map((corner) => block.center.x + corner.x)
			const ys = corners.map((corner) => block.center.y + corner.y)
			return {
				xMin: Math.min(...xs),
				xMax: Math.max(...xs),
				yMin: Math.min(...ys),
				yMax: Math.max(...ys),
			}
		}

		const boundarySegments = computeRectUnionBoundarySegments(scaffoldBlocks.map(rectForBlock))
		const isPerimeterSpan = (start: THREE.Vector3, end: THREE.Vector3) => {
			if (boundarySegments.length === 0) return false
			if (Math.abs(start.y - end.y) <= boundaryTol) {
				const y = (start.y + end.y) * 0.5
				const minX = Math.min(start.x, end.x)
				const maxX = Math.max(start.x, end.x)
				return boundarySegments.some((seg) => (
					seg.kind === 'H' &&
					Math.abs(seg.y - y) <= boundaryTol &&
					Math.min(seg.x0, seg.x1) <= minX + boundaryTol &&
					Math.max(seg.x0, seg.x1) >= maxX - boundaryTol
				))
			}
			if (Math.abs(start.x - end.x) <= boundaryTol) {
				const x = (start.x + end.x) * 0.5
				const minY = Math.min(start.y, end.y)
				const maxY = Math.max(start.y, end.y)
				return boundarySegments.some((seg) => (
					seg.kind === 'V' &&
					Math.abs(seg.x - x) <= boundaryTol &&
					Math.min(seg.y0, seg.y1) <= minY + boundaryTol &&
					Math.max(seg.y0, seg.y1) >= maxY - boundaryTol
				))
			}
			return false
		}

		for (const block of scaffoldBlocks) {
			if (movingBlockIdSet.has(block.id)) continue
			const braceFrontBack = block.braceFrontBack ?? 'off'
			const braceLeftRight = block.braceLeftRight ?? 'off'
			if (braceFrontBack === 'off' && braceLeftRight === 'off') continue
			const suppressedDiagonalKeys = new Set(block.suppressedDiagonalKeys ?? [])
			const supportAwareLayout = supportAwareLayoutsByBlockId.get(block.id)
			const base = block.baseSettings
			const standardPlan = supportAwareLayout?.nominalPlan ?? buildStandardPlan({
				heightFt: block.heightFt,
				ledgerEveryN: block.ledgerEveryNRosettes,
				plankedLevelsCount: block.plankedLevelsCount,
				includeBaseDeck: block.includeBaseDeck,
				jackExtensionIn: base.jackExtensionIn,
				showWoodSill: base.showWoodSill,
				showBaseCollar: base.showBaseCollar,
			})
			const layoutX = supportAwareLayout?.layoutX ?? chooseBayLayout(block.widthFt)
			const layoutY = supportAwareLayout?.layoutY ?? chooseBayLayout(block.depthFt)

			const rosettes = computeRosettePositions(
				new THREE.Vector3(0, 0, 0),
				standardPlan.segments.map((partNumber) => ({ partNumber })),
				base.jackExtensionIn,
				base.showWoodSill,
				base.showBaseCollar,
			)
			if (rosettes.length < 2) continue

			const rosetteZByLift = new Map(rosettes.map((r) => [r.liftIndex, r.position.z]))
			const maxLiftIndex = rosettes.reduce((maxLift, r) => Math.max(maxLift, r.liftIndex), 0)
			const braceStartLiftIndex = base.showBaseCollar ? 0 : 1
			const braceLiftPairs: Array<{ startLiftIndex: number; endLiftIndex: number; startZ: number; endZ: number }> = []
			const supportsDesignLiftPair = (stackKeys: string[], startLiftIndex: number, endLiftIndex: number) => {
				if (!supportAwareLayout) return true
				return stackKeys.every((key) => {
					const spec = supportAwareLayout.stackSpecsByKey.get(key)
					return !!spec
						&& spec.designLiftToLocalLift.has(startLiftIndex)
						&& spec.designLiftToLocalLift.has(endLiftIndex)
				})
			}

			for (let startLiftIndex = braceStartLiftIndex; startLiftIndex + 4 <= maxLiftIndex; startLiftIndex += 4) {
				const endLiftIndex = startLiftIndex + 4
				const startZ = rosetteZByLift.get(startLiftIndex)
				const endZ = rosetteZByLift.get(endLiftIndex)
				if (typeof startZ !== 'number' || typeof endZ !== 'number') continue
				if (!(endZ > startZ + 1e-6)) continue
				braceLiftPairs.push({ startLiftIndex, endLiftIndex, startZ, endZ })
			}

			if (braceLiftPairs.length === 0) continue

			const halfWidth = block.widthFt / 2
			const halfDepth = block.depthFt / 2
			const roundBay = isRoundAutoGeneratedBay(block)
				? {
					innerSpanFt: block.autoGeneratedRoundInnerLedgerFt,
					outerSpanFt: block.autoGeneratedRoundOuterLedgerFt,
				}
				: null
			const toWorld = (localX: number, localY: number, localZ: number) => {
				const rotated = rotateOffset90({ x: localX, y: localY }, block.rotationSteps)
				return new THREE.Vector3(block.center.x + rotated.x, block.center.y + rotated.y, localZ)
			}

			if (braceFrontBack !== 'off') {
				if (roundBay) {
					const [innerKeyA, innerKeyB, outerKeyA, outerKeyB] = block.managedStackKeys ?? []
					const roundFaces = [
						{
							faceSign: 1 as const,
							stackKeyA: innerKeyA,
							stackKeyB: innerKeyB,
							spanFt: roundBay.innerSpanFt,
							ascending: braceFrontBack === 'slash',
						},
						{
							faceSign: -1 as const,
							stackKeyA: outerKeyA,
							stackKeyB: outerKeyB,
							spanFt: roundBay.outerSpanFt,
							ascending: braceFrontBack === 'backslash',
						},
					]
					for (const face of roundFaces) {
						if (!face.stackKeyA || !face.stackKeyB) continue
						const stackIdA = stackIdBySupportKey.get(face.stackKeyA)
						const stackIdB = stackIdBySupportKey.get(face.stackKeyB)
						if (!stackIdA || !stackIdB) continue
						const nodesA = rosettePositionByLiftByStackId.get(stackIdA)
						const nodesB = rosettePositionByLiftByStackId.get(stackIdB)
						if (!nodesA || !nodesB) continue
						const partNumber = findClosestDiagonal(face.spanFt * 12) ?? undefined
						const startNodes = face.ascending ? nodesA : nodesB
						const endNodes = face.ascending ? nodesB : nodesA
						for (const pair of braceLiftPairs) {
							const id = `${block.id}@brace-fb:${face.faceSign}:0:${pair.startLiftIndex}-${pair.endLiftIndex}`
							if (suppressedDiagonalKeys.has(id)) continue
							const start = startNodes.get(pair.startLiftIndex)
							const end = endNodes.get(pair.endLiftIndex)
							if (!start || !end) continue
							out.push({
								id,
								partNumber,
								start: start.clone(),
								end: end.clone(),
							})
						}
					}
				} else {
					for (const faceSign of [1, -1] as const) {
						const partNumber = findClosestDiagonal(layoutX.spacingFt * 12) ?? undefined
						const ascending = faceSign === 1 ? braceFrontBack === 'slash' : braceFrontBack === 'backslash'
						const faceY = faceSign * halfDepth
						for (let bayIndex = 0; bayIndex < layoutX.bays; bayIndex++) {
							const x0 = bayIndex * layoutX.spacingFt - halfWidth
							const x1 = x0 + layoutX.spacingFt
							const edgeStart = toWorld(x0, faceY, 0)
							const edgeEnd = toWorld(x1, faceY, 0)
							if (!isPerimeterSpan(edgeStart, edgeEnd)) continue
							const rowIndex = faceSign === -1 ? 0 : layoutY.bays
							const spanKeys = supportAwareLayout
								? [
									supportAwareLayout.stackKeys[rowIndex]?.[bayIndex],
									supportAwareLayout.stackKeys[rowIndex]?.[bayIndex + 1],
								].filter((key): key is string => !!key)
								: []
							const startX = ascending ? x0 : x1
							const endX = ascending ? x1 : x0
							for (const pair of braceLiftPairs) {
								const id = `${block.id}@brace-fb:${faceSign}:${bayIndex}:${pair.startLiftIndex}-${pair.endLiftIndex}`
								if (suppressedDiagonalKeys.has(id)) continue
								if (!supportsDesignLiftPair(spanKeys, pair.startLiftIndex, pair.endLiftIndex)) continue
								out.push({
									id,
									partNumber,
									start: toWorld(startX, faceY, pair.startZ),
									end: toWorld(endX, faceY, pair.endZ),
								})
							}
						}
					}
				}
			}

			if (braceLeftRight !== 'off' && !roundBay) {
				for (const faceSign of [1, -1] as const) {
					const sideSpanFt = layoutY.spacingFt
					const partNumber = findClosestDiagonal(sideSpanFt * 12) ?? undefined
					const ascending = faceSign === 1 ? braceLeftRight === 'slash' : braceLeftRight === 'backslash'
					for (let bayIndex = 0; bayIndex < layoutY.bays; bayIndex++) {
						const y0 = bayIndex * layoutY.spacingFt - halfDepth
						const y1 = y0 + layoutY.spacingFt
						const faceX = faceSign * halfWidth
						const edgeStart = toWorld(faceX, y0, 0)
						const edgeEnd = toWorld(faceX, y1, 0)
						if (!isPerimeterSpan(edgeStart, edgeEnd)) continue
						const colIndex = faceSign === -1 ? 0 : layoutX.bays
						const spanKeys = supportAwareLayout
							? [
								supportAwareLayout.stackKeys[bayIndex]?.[colIndex],
								supportAwareLayout.stackKeys[bayIndex + 1]?.[colIndex],
							].filter((key): key is string => !!key)
							: []
						const startY = ascending ? y0 : y1
						const endY = ascending ? y1 : y0
						for (const pair of braceLiftPairs) {
							const id = `${block.id}@brace-lr:${faceSign}:${bayIndex}:${pair.startLiftIndex}-${pair.endLiftIndex}`
							if (suppressedDiagonalKeys.has(id)) continue
							if (!supportsDesignLiftPair(spanKeys, pair.startLiftIndex, pair.endLiftIndex)) continue
							out.push({
								id,
								partNumber,
								start: toWorld(faceX, startY, pair.startZ),
								end: toWorld(faceX, endY, pair.endZ),
							})
						}
					}
				}
			}
		}

		return out
	}, [movingBlockIdSet, rosettePositionByLiftByStackId, scaffoldBlocks, stackIdBySupportKey, supportAwareLayoutsByBlockId])

  const autoPlankInstances = useMemo<RinglockPlankInstance[]>(() => {
    const out: RinglockPlankInstance[] = []
    const plankDepthFt = inchesToFeet(RINGLOCK_PLANK_PROFILE_DEPTH_IN)
    const plankSeatOffsetFt = inchesToFeet(LEDGER_TUBE_OD_IN / 2) - plankDepthFt / 2
		const plankCatalogParts = selectedManufacturer.categories.planks.parts

    for (const block of scaffoldBlocks) {
      if (movingBlockIdSet.has(block.id)) continue
      const supportAwareLayout = supportAwareLayoutsByBlockId.get(block.id)
      const layoutX = supportAwareLayout?.layoutX ?? chooseBayLayout(block.widthFt)
      const layoutY = supportAwareLayout?.layoutY ?? chooseBayLayout(block.depthFt)
      const base = block.baseSettings
      const standardPlan = supportAwareLayout?.nominalPlan ?? buildStandardPlan({
        heightFt: block.heightFt,
        ledgerEveryN: block.ledgerEveryNRosettes,
        plankedLevelsCount: block.plankedLevelsCount,
        includeBaseDeck: block.includeBaseDeck,
        jackExtensionIn: base.jackExtensionIn,
        showWoodSill: base.showWoodSill,
        showBaseCollar: base.showBaseCollar,
      })
      if (standardPlan.workingDeckLiftIndices.length === 0) continue

      const rosettes = computeRosettePositions(
        new THREE.Vector3(0, 0, 0),
        standardPlan.segments.map((partNumber) => ({ partNumber })),
        base.jackExtensionIn,
        base.showWoodSill,
        base.showBaseCollar,
      )
      const rosetteZByLift = new Map(rosettes.map((r) => [r.liftIndex, r.position.z]))

      const deckPlan = resolveBlockDeckPlan(block, layoutX, layoutY)
      const roundBayFrame = resolveRoundAutoBayFrame(block)
      const runAlongX = deckPlan.runAlongX
      const runLengthFt = deckPlan.runLengthFt
      const crossLedgerPart = deckPlan.crossLedgerPartNumber
      const crossLedgerLengthIn = UNIVERSAL_LEDGER_LENGTHS[crossLedgerPart] ?? Math.round(deckPlan.crossSpanFt * 12)
      const usableSpanIn = Math.max(0, crossLedgerLengthIn - PLANK_MOUTHPIECE_TOTAL_IN)
			const plankLayout = buildBestFitPlankLayout(usableSpanIn, runLengthFt, plankCatalogParts)
			if (plankLayout.length === 0) continue

      const halfWidth = block.widthFt / 2
      const halfDepth = block.depthFt / 2
      const visibleLengthFt = Math.max(inchesToFeet(RINGLOCK_PLANK_WIDTH_IN), runLengthFt - inchesToFeet(0.25))
      const runCenterOffsetFt = deckPlan.runAnchor === 'positive'
        ? Math.max(0, runLengthFt - visibleLengthFt) / 2
        : 0
      const rotationZ = block.rotationSteps * (Math.PI / 2) + (runAlongX ? Math.PI / 2 : 0)
      const baySupportsDeckLift = (bayX: number, bayY: number, designLift: number) => {
        if (!supportAwareLayout) return true
        const cornerKeys = [
          supportAwareLayout.stackKeys[bayY]?.[bayX],
          supportAwareLayout.stackKeys[bayY]?.[bayX + 1],
          supportAwareLayout.stackKeys[bayY + 1]?.[bayX],
          supportAwareLayout.stackKeys[bayY + 1]?.[bayX + 1],
        ].filter((key): key is string => !!key)
        return cornerKeys.length === 4 && cornerKeys.every((key) => {
          const spec = supportAwareLayout.stackSpecsByKey.get(key)
          return !!spec && spec.designLiftToLocalLift.has(designLift)
        })
      }

      for (const liftIndex of standardPlan.workingDeckLiftIndices) {
        const rosetteZ = supportAwareLayout?.workingDeckTargetZByLift.get(liftIndex) ?? rosetteZByLift.get(liftIndex)
        if (typeof rosetteZ !== 'number') continue
        const deckCenterZ = rosetteZ + plankSeatOffsetFt

        for (let bayY = 0; bayY < layoutY.bays; bayY++) {
          for (let bayX = 0; bayX < layoutX.bays; bayX++) {
            if (!baySupportsDeckLift(bayX, bayY, liftIndex)) continue
            const bayCenterX = (bayX + 0.5) * layoutX.spacingFt - halfWidth
            const bayCenterY = (bayY + 0.5) * layoutY.spacingFt - halfDepth

						for (let plankIndex = 0; plankIndex < plankLayout.length; plankIndex++) {
							const plankSlot = plankLayout[plankIndex]
							const crossOffsetFt = plankSlot.centerOffsetFt
              const localCenter = runAlongX
                ? { x: bayCenterX + runCenterOffsetFt, y: bayCenterY + crossOffsetFt }
                : { x: bayCenterX + crossOffsetFt, y: bayCenterY + runCenterOffsetFt }
              const worldCenter = roundBayFrame
                ? {
                    x: roundBayFrame.origin.x + roundBayFrame.tangent.x * localCenter.x + roundBayFrame.inward.x * localCenter.y,
                    y: roundBayFrame.origin.y + roundBayFrame.tangent.y * localCenter.x + roundBayFrame.inward.y * localCenter.y,
                  }
                : (() => {
                    const rotated = rotateOffset90(localCenter, block.rotationSteps)
                    return {
                      x: block.center.x + rotated.x,
                      y: block.center.y + rotated.y,
                    }
                  })()

              out.push({
                id: `${block.id}@${liftIndex}:${bayX}:${bayY}:${plankIndex}`,
                center: new THREE.Vector3(worldCenter.x, worldCenter.y, deckCenterZ),
                rotationZ,
                lengthFt: visibleLengthFt,
								widthIn: plankSlot.widthIn,
								partNumber: plankSlot.partNumber,
              })
            }
          }
        }
      }
    }

    return out
	}, [movingBlockIdSet, scaffoldBlocks, selectedManufacturer, supportAwareLayoutsByBlockId])

  const manualPlankInstances = useMemo<RinglockPlankInstance[]>(() => {
		return buildManualPlankInstances(manualPlankPlacements, ledgerInstances, selectedManufacturer.categories.planks.parts)
	}, [manualPlankPlacements, ledgerInstances, selectedManufacturer])

	const manualLiveLoadInstances = useMemo(() => {
		return buildManualLiveLoadInstances(manualLiveLoadPlacements, ledgerInstances)
	}, [manualLiveLoadPlacements, ledgerInstances])

	const blockLiveLoadDeckBays = useMemo<BlockLiveLoadBay[]>(() => {
		const out: BlockLiveLoadBay[] = []

		for (const block of scaffoldBlocks) {
			if (movingBlockIdSet.has(block.id)) continue
			const liveLoadPsf = Number(block.liveLoadPsf ?? 0)
			if (!Number.isFinite(liveLoadPsf) || liveLoadPsf <= 0) continue
			const requestedLiftIndices = Array.isArray(block.liveLoadDeckLiftIndices) ? block.liveLoadDeckLiftIndices : []
			if (requestedLiftIndices.length === 0) continue

			const base = block.baseSettings
			const supportAwareLayout = supportAwareLayoutsByBlockId.get(block.id)
			const layoutX = supportAwareLayout?.layoutX ?? chooseBayLayout(block.widthFt)
			const layoutY = supportAwareLayout?.layoutY ?? chooseBayLayout(block.depthFt)
			const plan = supportAwareLayout?.nominalPlan ?? buildStandardPlan({
				heightFt: block.heightFt,
				ledgerEveryN: block.ledgerEveryNRosettes,
				plankedLevelsCount: block.plankedLevelsCount ?? 1,
				includeBaseDeck: block.includeBaseDeck ?? false,
				jackExtensionIn: base.jackExtensionIn,
				showWoodSill: base.showWoodSill,
				showBaseCollar: base.showBaseCollar,
			})
			const validLiftSet = new Set(plan.workingDeckLiftIndices)
			const liveLoadLiftIndices = Array.from(new Set(
				requestedLiftIndices
					.map(value => Math.round(Number(value)))
					.filter(value => Number.isFinite(value) && validLiftSet.has(value))
			)).sort((a, b) => a - b)
			if (liveLoadLiftIndices.length === 0) continue
			const excludedBayKeySet = new Set(
				(Array.isArray(block.liveLoadExcludedBayKeys) ? block.liveLoadExcludedBayKeys : [])
					.map(value => String(value))
			)

			const rosettes = computeRosettePositions(
				new THREE.Vector3(0, 0, 0),
				plan.segments.map(partNumber => ({ partNumber })),
				base.jackExtensionIn,
				base.showWoodSill,
				base.showBaseCollar,
			)
			const rosetteZByLift = new Map(rosettes.map(rosette => [rosette.liftIndex, rosette.position.z]))
			const runAlongX = layoutX.spacingFt >= layoutY.spacingFt
			const rotationZ = block.rotationSteps * (Math.PI / 2) + (runAlongX ? 0 : Math.PI / 2)
			const halfWidth = block.widthFt / 2
			const halfDepth = block.depthFt / 2
			const stackKeys = supportAwareLayout?.stackKeys ?? (() => {
				const rows: string[][] = []
				for (let bayY = 0; bayY <= layoutY.bays; bayY++) {
					const row: string[] = []
					for (let bayX = 0; bayX <= layoutX.bays; bayX++) {
						const local = {
							x: bayX * layoutX.spacingFt - halfWidth,
							y: bayY * layoutY.spacingFt - halfDepth,
						}
						const rotated = rotateOffset90(local, block.rotationSteps)
						row.push(makeStackPositionKey(block.center.x + rotated.x, block.center.y + rotated.y, 0))
					}
					rows.push(row)
				}
				return rows
			})()
			const baySupportsDeckLift = (bayX: number, bayY: number, designLift: number) => {
				if (!supportAwareLayout) return true
				const cornerKeys = [
					stackKeys[bayY]?.[bayX],
					stackKeys[bayY]?.[bayX + 1],
					stackKeys[bayY + 1]?.[bayX],
					stackKeys[bayY + 1]?.[bayX + 1],
				].filter((key): key is string => !!key)
				return cornerKeys.length === 4 && cornerKeys.every((key) => {
					const spec = supportAwareLayout.stackSpecsByKey.get(key)
					return !!spec && spec.designLiftToLocalLift.has(designLift)
				})
			}

			for (const liftIndex of liveLoadLiftIndices) {
				const rosetteZ = supportAwareLayout?.workingDeckTargetZByLift.get(liftIndex) ?? rosetteZByLift.get(liftIndex)
				if (typeof rosetteZ !== 'number') continue
				const centerZ = rosetteZ + LIVE_LOAD_SURFACE_Z_OFFSET_FT

				for (let bayY = 0; bayY < layoutY.bays; bayY++) {
					for (let bayX = 0; bayX < layoutX.bays; bayX++) {
						if (!baySupportsDeckLift(bayX, bayY, liftIndex)) continue
						const cornerStackIds = [
							stackIdBySupportKey.get(stackKeys[bayY]?.[bayX] ?? ''),
							stackIdBySupportKey.get(stackKeys[bayY]?.[bayX + 1] ?? ''),
							stackIdBySupportKey.get(stackKeys[bayY + 1]?.[bayX] ?? ''),
							stackIdBySupportKey.get(stackKeys[bayY + 1]?.[bayX + 1] ?? ''),
						]
						if (cornerStackIds.some(stackId => !stackId)) continue

						const localCenter = {
							x: (bayX + 0.5) * layoutX.spacingFt - halfWidth,
							y: (bayY + 0.5) * layoutY.spacingFt - halfDepth,
						}
						const rotatedCenter = rotateOffset90(localCenter, block.rotationSteps)
						const areaSqFt = layoutX.spacingFt * layoutY.spacingFt
						const bayKey = makeBlockLiveLoadBayKey(liftIndex, bayX, bayY)

						out.push({
							id: `${block.id}@block-live-load:${liftIndex}:${bayX}:${bayY}`,
							blockId: block.id,
							deckLiftIndex: liftIndex,
							bayX,
							bayY,
							bayKey,
							isExcluded: excludedBayKeySet.has(bayKey),
							center: new THREE.Vector3(block.center.x + rotatedCenter.x, block.center.y + rotatedCenter.y, centerZ),
							rotationZ,
							lengthFt: runAlongX ? layoutY.spacingFt : layoutX.spacingFt,
							widthFt: runAlongX ? layoutX.spacingFt : layoutY.spacingFt,
							magnitudePsf: liveLoadPsf,
							areaSqFt,
							supportLedgerId: `block:${block.id}`,
							sideSign: 1,
							cornerStackIds: cornerStackIds as [string, string, string, string],
							totalLoadLb: liveLoadPsf * areaSqFt,
						})
					}
				}
			}
		}

		return out
	}, [movingBlockIdSet, scaffoldBlocks, stackIdBySupportKey, supportAwareLayoutsByBlockId])

	const blockLiveLoadBays = useMemo(
		() => blockLiveLoadDeckBays.filter(bay => !bay.isExcluded),
		[blockLiveLoadDeckBays],
	)
	const excludedBlockLiveLoadBays = useMemo(
		() => blockLiveLoadDeckBays.filter(bay => bay.isExcluded),
		[blockLiveLoadDeckBays],
	)
	const hoveredLiveLoadTargetKeySet = useMemo(
		() => new Set(hoveredLiveLoadDeckTargets.map((target) => getLiveLoadDeckTargetKey(target))),
		[hoveredLiveLoadDeckTargets],
	)
	const hoveredBlockLiveLoadBays = useMemo(
		() => hoveredLiveLoadTargetKeySet.size === 0
			? []
			: blockLiveLoadDeckBays.filter((bay) => (
				hoveredLiveLoadTargetKeySet.has(getLiveLoadDeckTargetKey({
					blockId: bay.blockId,
					liftIndex: bay.deckLiftIndex,
					bayKey: bay.bayKey,
				}))
				|| hoveredLiveLoadTargetKeySet.has(getLiveLoadDeckTargetKey({
					blockId: bay.blockId,
					liftIndex: bay.deckLiftIndex,
				}))
			)),
		[blockLiveLoadDeckBays, hoveredLiveLoadTargetKeySet],
	)
	const selectedLiveLoadTargetKeySet = useMemo(
		() => new Set(selectedLiveLoadDeckTargets.map((target) => getLiveLoadDeckTargetKey(target))),
		[selectedLiveLoadDeckTargets],
	)
	const selectedBlockLiveLoadBays = useMemo(
		() => selectedLiveLoadTargetKeySet.size === 0
			? []
			: blockLiveLoadDeckBays.filter((bay) => (
				selectedLiveLoadTargetKeySet.has(getLiveLoadDeckTargetKey({
					blockId: bay.blockId,
					liftIndex: bay.deckLiftIndex,
					bayKey: bay.bayKey,
				}))
				|| selectedLiveLoadTargetKeySet.has(getLiveLoadDeckTargetKey({
					blockId: bay.blockId,
					liftIndex: bay.deckLiftIndex,
				}))
			)),
		[blockLiveLoadDeckBays, selectedLiveLoadTargetKeySet],
	)
	const selectedIncludedBlockLiveLoadBays = useMemo(
		() => selectedBlockLiveLoadBays.filter(bay => !bay.isExcluded),
		[selectedBlockLiveLoadBays],
	)
	const selectedExcludedBlockLiveLoadBays = useMemo(
		() => selectedBlockLiveLoadBays.filter(bay => bay.isExcluded),
		[selectedBlockLiveLoadBays],
	)
	const commitLiveLoadDeckTargetSelection = useCallback((targets: LiveLoadDeckTarget[], additive: boolean) => {
		const nextTargets = dedupeLiveLoadDeckTargets(targets)
		if (additive) {
			const merged = new Map(selectedLiveLoadDeckTargets.map((target) => [getLiveLoadDeckTargetKey(target), target] as const))
			for (const target of nextTargets) {
				const key = getLiveLoadDeckTargetKey(target)
				if (merged.has(key)) merged.delete(key)
				else merged.set(key, target)
			}
			setSelectedLiveLoadDeckTargets(Array.from(merged.values()))
			return
		}
		if (nextTargets.length === 0) {
			setSelectedLiveLoadDeckTargets([])
			return
		}
		const nextKeySet = new Set(nextTargets.map((target) => getLiveLoadDeckTargetKey(target)))
		const isSameSelection = nextKeySet.size === selectedLiveLoadTargetKeySet.size
			&& Array.from(nextKeySet).every((key) => selectedLiveLoadTargetKeySet.has(key))
		setSelectedLiveLoadDeckTargets(isSameSelection ? [] : nextTargets)
	}, [selectedLiveLoadDeckTargets, selectedLiveLoadTargetKeySet, setSelectedLiveLoadDeckTargets])
	const getLiveLoadBayRect = useCallback((bay: Pick<BlockLiveLoadBay, 'center' | 'rotationZ' | 'widthFt' | 'lengthFt'>): MarqueeRect => {
		const halfWidth = bay.widthFt / 2
		const halfLength = bay.lengthFt / 2
		const cos = Math.cos(bay.rotationZ)
		const sin = Math.sin(bay.rotationZ)
		const corners = [
			{ x: -halfWidth, y: -halfLength },
			{ x: halfWidth, y: -halfLength },
			{ x: halfWidth, y: halfLength },
			{ x: -halfWidth, y: halfLength },
		].map((corner) => ({
			x: bay.center.x + corner.x * cos - corner.y * sin,
			y: bay.center.y + corner.x * sin + corner.y * cos,
		}))
		const xs = corners.map((corner) => corner.x)
		const ys = corners.map((corner) => corner.y)
		return {
			xMin: Math.min(...xs),
			xMax: Math.max(...xs),
			yMin: Math.min(...ys),
			yMax: Math.max(...ys),
		}
	}, [])
	const isLiveLoadTopView = isPlacingLiveLoad && viewMode === 'ortho-top'
	const liveLoadLevelTargetKeySetsByLevel = useMemo(() => {
		const byLevel = new Map<number, Set<string>>()
		for (const block of scaffoldBlocks) {
			const base = block.baseSettings
			const plan = buildStandardPlan({
				heightFt: block.heightFt,
				ledgerEveryN: block.ledgerEveryNRosettes,
				plankedLevelsCount: block.plankedLevelsCount ?? 1,
				includeBaseDeck: block.includeBaseDeck ?? false,
				jackExtensionIn: base.jackExtensionIn,
				showWoodSill: base.showWoodSill,
				showBaseCollar: base.showBaseCollar,
			})
			const sortedLiftIndices = [...plan.workingDeckLiftIndices].sort((a, b) => b - a)
			sortedLiftIndices.forEach((liftIndex, index) => {
				const levelNumber = index + 1
				const levelSet = byLevel.get(levelNumber) ?? new Set<string>()
				levelSet.add(`${block.id}@${liftIndex}`)
				byLevel.set(levelNumber, levelSet)
			})
		}
		return byLevel
	}, [scaffoldBlocks])
	const activeLiveLoadLevelTargetKeySet = useMemo(() => {
		if (activeLiveLoadLevelNumber === null) return null
		return liveLoadLevelTargetKeySetsByLevel.get(activeLiveLoadLevelNumber) ?? new Set<string>()
	}, [activeLiveLoadLevelNumber, liveLoadLevelTargetKeySetsByLevel])
	const projectClientToGround = useCallback((clientX: number, clientY: number) => {
		const rect = gl.domElement.getBoundingClientRect()
		if (rect.width <= 0 || rect.height <= 0) return null
		if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null
		const pointer = new THREE.Vector2(
			((clientX - rect.left) / rect.width) * 2 - 1,
			-((clientY - rect.top) / rect.height) * 2 + 1,
		)
		const raycaster = new THREE.Raycaster()
		raycaster.setFromCamera(pointer, camera)
		const point = new THREE.Vector3()
		return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), point)
			? { x: point.x, y: point.y }
			: null
	}, [camera, gl.domElement])

	// ─── Stack move/copy pointer effects (require projectClientToGround) ─────

	// Marquee pointer-down — active whenever selection is enabled and no mid-operation step is in progress
	useEffect(() => {
		const marqueeAllowed = selectionEnabled && stackMoveStep !== 'anchor' && stackMoveStep !== 'place'
		if (!marqueeAllowed) return
		const canvas = gl.domElement
		const onDown = (e: PointerEvent) => {
			if (e.button !== 0 || cameraNavigationActive || isCameraNavigationModifierGesture(e)) return
			const pt = projectClientToGround(e.clientX, e.clientY)
			if (!pt) return
			// Only record the start position — defer the visual until drag threshold is crossed in pointermove
			stackMarqueeRef.current = { start: pt, current: pt, startClientX: e.clientX, currentClientX: e.clientX, startClientY: e.clientY, currentClientY: e.clientY }
		}
		canvas.addEventListener('pointerdown', onDown, false)
		return () => canvas.removeEventListener('pointerdown', onDown, false)
	}, [cameraNavigationActive, gl.domElement, projectClientToGround, selectionEnabled, stackMoveStep])

	// Marquee pointer-move + pointer-up → finalise selection
	useEffect(() => {
		const marqueeAllowed = selectionEnabled && stackMoveStep !== 'anchor' && stackMoveStep !== 'place'
		if (!marqueeAllowed) return
		const onMove = (e: PointerEvent) => {
			const cur = stackMarqueeRef.current
			if (!cur) return
			// If the button was released without triggering our pointerup (e.g. outside window), clean up
			if (!(e.buttons & 1)) {
				stackMarqueeRef.current = null
				setStackMarquee(null)
				return
			}
			const pt = projectClientToGround(e.clientX, e.clientY)
			if (!pt) return
			const next: StackMarqueeState = { ...cur, current: pt, currentClientX: e.clientX, currentClientY: e.clientY }
			stackMarqueeRef.current = next
			// Only show the visual marquee once the drag threshold is crossed
			const dx = Math.abs(e.clientX - cur.startClientX)
			const dy = Math.abs(e.clientY - cur.startClientY)
			if (dx >= 4 || dy >= 4) {
				setStackMarquee(next)
			}
		}
		const onUp = (e: PointerEvent) => {
			const cur = stackMarqueeRef.current
			if (!cur) return
			// Ignore sub-pixel drags (plain click — handled by mesh onSelect callbacks)
			if (Math.abs(cur.currentClientX - cur.startClientX) < 4 && Math.abs(cur.currentClientY - cur.startClientY) < 4) {
				stackMarqueeRef.current = null
				setStackMarquee(null)
				return
			}
			const isCrossing = cur.currentClientX < cur.startClientX
			const rect = normalizeMarqueeRect(cur.start, cur.current)
			const ids = scaffoldStacks
				.filter(s => {
					const p = { x: s.gridPosition.x, y: s.gridPosition.y }
					return isCrossing
						? doesCrossingIntersectRect(rect, { xMin: p.x - 0.1, xMax: p.x + 0.1, yMin: p.y - 0.1, yMax: p.y + 0.1 })
						: doesWindowContainRect(rect, { xMin: p.x - 0.1, xMax: p.x + 0.1, yMin: p.y - 0.1, yMax: p.y + 0.1 })
				})
				.map(s => s.id)
			const prevIds = stackEditActionMode !== 'neutral' ? stackMoveIdsRef.current : selectedStackIds
			const nextIds = e.shiftKey ? Array.from(new Set([...prevIds, ...ids])) : ids
			stackMarqueeRef.current = null
			setStackMarquee(null)
			if (nextIds.length === 0) return
			setSelectedStackIds(nextIds)
			// In move/copy mode, advance to the anchor step
			if (stackEditActionMode !== 'neutral') {
				stackMoveIdsRef.current = nextIds
				setStackMoveIds(nextIds)
				setStackMoveStep('anchor')
			}
		}
		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', onUp)
		return () => {
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', onUp)
		}
	}, [cameraNavigationActive, gl.domElement, projectClientToGround, scaffoldStacks, selectedStackIds, selectionEnabled, setSelectedStackIds, setStackMoveStep, stackEditActionMode, stackMoveStep])

	// Anchor click
	useEffect(() => {
		if (stackEditActionMode === 'neutral' || stackMoveStep !== 'anchor') return
		const canvas = gl.domElement
		const onDown = (e: PointerEvent) => {
			if (e.button !== 0 || cameraNavigationActive || isCameraNavigationModifierGesture(e)) return
			const pt = projectClientToGround(e.clientX, e.clientY)
			if (!pt) return
			e.stopPropagation()
			e.preventDefault()
			stackMoveAnchorRef.current = { x: pt.x, y: pt.y }
			setStackMoveAnchor({ x: pt.x, y: pt.y })
			setStackPreviewOffset({ dx: 0, dy: 0 })
			setStackMoveStep('place')
		}
		canvas.addEventListener('pointerdown', onDown, true)
		return () => canvas.removeEventListener('pointerdown', onDown, true)
	}, [cameraNavigationActive, gl.domElement, projectClientToGround, setStackMoveStep, stackEditActionMode, stackMoveStep])

	// Ghost preview tracking (pointer-move during 'place')
	useEffect(() => {
		if (stackEditActionMode === 'neutral' || stackMoveStep !== 'place') return
		const onMove = (e: PointerEvent) => {
			const anchor = stackMoveAnchorRef.current
			if (!anchor) return
			const pt = projectClientToGround(e.clientX, e.clientY)
			if (!pt) return
			lastCursorPtRef.current = pt
			const hud = stackCadHudRef.current
			const result = applyPlaceConstraints(
				pt.x - anchor.x, pt.y - anchor.y,
				stackOrthoLockedRef.current,
				hud?.lockedAngleDeg ?? null,
				hud?.distanceInput ?? '',
				snapStepRef.current,
			)
			setStackPreviewOffset({ dx: result.dx, dy: result.dy })
			const curHud = stackCadHudRef.current; if (curHud) setStackCadHud({ ...curHud, distance: result.distance, angle: result.angleDeg })
		}
		window.addEventListener('pointermove', onMove)
		return () => window.removeEventListener('pointermove', onMove)
	}, [projectClientToGround, setStackCadHud, stackEditActionMode, stackMoveStep])

	// Destination click → execute move or copy
	// Also wires executeStackPlacementRef so the Enter key can trigger the same logic.
	useEffect(() => {
		if (stackEditActionMode === 'neutral' || stackMoveStep !== 'place') return

		const doPlacement = () => {
			const offset = stackPreviewOffsetRef.current
			if (!offset) return
			const { dx, dy } = offset
			const ids = stackMoveIdsRef.current
			const stacks = scaffoldStacks.filter(s => ids.includes(s.id))
			if (stackEditActionMode === 'move') {
				for (const s of stacks) {
					updateScaffoldStack(s.id, {
						gridPosition: new THREE.Vector3(s.gridPosition.x + dx, s.gridPosition.y + dy, s.gridPosition.z),
					})
				}
			} else {
				const idMap = new Map<string, string>()
				const idSet = new Set(ids)
				for (const s of stacks) {
					const newStack = addScaffoldStack(
						new THREE.Vector3(s.gridPosition.x + dx, s.gridPosition.y + dy, s.gridPosition.z),
						s.standardSegments[0]?.partNumber ?? 'US66',
						s.jackExtensionIn,
						{ showWoodSill: s.showWoodSill, showBaseCollar: s.showBaseCollar, baseSupport: s.baseSupport },
					)
					if (s.standardSegments.length > 1) {
						setStandardSegmentsForStack(newStack.id, s.standardSegments.map(seg => seg.partNumber))
					}
					idMap.set(s.id, newStack.id)
				}
				for (const lc of ledgerConnections) {
					if (idSet.has(lc.startNode.stackId) && idSet.has(lc.endNode.stackId)) {
						addLedgerConnection(
							{ stackId: idMap.get(lc.startNode.stackId)!, liftIndex: lc.startNode.liftIndex },
							{ stackId: idMap.get(lc.endNode.stackId)!, liftIndex: lc.endNode.liftIndex },
							lc.ledgerPartNumber,
						)
					}
				}
			}
			// Add permanent dimension annotation after placement
			const anchor = stackMoveAnchorRef.current
			const hud = stackCadHudRef.current
			if (anchor && hud && hud.distance > 0.05) {
				const dimEnd = { x: anchor.x + dx, y: anchor.y + dy }
				setPermanentDims(prev => [...prev, {
					id: `dim-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
					start: anchor,
					end: dimEnd,
					distance: hud.distance,
					offset: DIM_INITIAL_OFFSET,
				}])
			}
			cancelStackMove()
		}

		executeStackPlacementRef.current = doPlacement

		const canvas = gl.domElement
		const onDown = (e: PointerEvent) => {
			if (e.button !== 0 || cameraNavigationActive || isCameraNavigationModifierGesture(e)) return
			e.stopPropagation()
			e.preventDefault()
			doPlacement()
		}
		canvas.addEventListener('pointerdown', onDown, true)
		return () => {
			canvas.removeEventListener('pointerdown', onDown, true)
			executeStackPlacementRef.current = null
		}
	}, [addLedgerConnection, addScaffoldStack, cancelStackMove, cameraNavigationActive, gl.domElement, ledgerConnections, scaffoldStacks, setStandardSegmentsForStack, stackEditActionMode, stackMoveStep, updateScaffoldStack])

	const selectableLiveLoadDeckBays = useMemo(
		() => {
			if (!isLiveLoadTopView) return blockLiveLoadDeckBays
			if (!activeLiveLoadLevelTargetKeySet || activeLiveLoadLevelTargetKeySet.size === 0) return []
			return blockLiveLoadDeckBays.filter((bay) => activeLiveLoadLevelTargetKeySet.has(`${bay.blockId}@${bay.deckLiftIndex}`))
		},
		[activeLiveLoadLevelTargetKeySet, blockLiveLoadDeckBays, isLiveLoadTopView],
	)
	const resolveLiveLoadTargetsAtPoint = useCallback((point: { x: number; y: number }) => {
		const hits = selectableLiveLoadDeckBays.filter((bay) => {
			const rect = getLiveLoadBayRect(bay)
			return point.x >= rect.xMin && point.x <= rect.xMax && point.y >= rect.yMin && point.y <= rect.yMax
		})
		hits.sort((a, b) => b.center.z - a.center.z)
		return hits.map((bay) => ({ blockId: bay.blockId, liftIndex: bay.deckLiftIndex, bayKey: bay.bayKey }))
	}, [getLiveLoadBayRect, selectableLiveLoadDeckBays])
	const computeMarqueeLiveLoadTargets = useCallback((state: LiveLoadMarqueeState) => {
		const selectionRect = normalizeMarqueeRect(state.startWorld, state.currentWorld)
		const crossing = state.currentClientX < state.startClientX
		return selectableLiveLoadDeckBays
			.filter((bay) => {
				const rect = getLiveLoadBayRect(bay)
				return crossing ? doesCrossingIntersectRect(selectionRect, rect) : doesWindowContainRect(selectionRect, rect)
			})
			.map((bay) => ({ blockId: bay.blockId, liftIndex: bay.deckLiftIndex, bayKey: bay.bayKey }))
	}, [getLiveLoadBayRect, selectableLiveLoadDeckBays])
	const [liveLoadMarqueeState, setLiveLoadMarqueeState] = useState<LiveLoadMarqueeState | null>(null)
	const liveLoadMarqueeStateRef = useRef<LiveLoadMarqueeState | null>(null)
	const [liveLoadMarqueePreviewKeys, setLiveLoadMarqueePreviewKeys] = useState<string[]>([])
	const liveLoadMarqueePreviewKeySet = useMemo(
		() => new Set(liveLoadMarqueePreviewKeys),
		[liveLoadMarqueePreviewKeys],
	)
	const marqueePreviewBlockLiveLoadBays = useMemo(
		() => liveLoadMarqueePreviewKeySet.size === 0
			? []
			: blockLiveLoadDeckBays.filter((bay) => liveLoadMarqueePreviewKeySet.has(
				getLiveLoadDeckTargetKey({ blockId: bay.blockId, liftIndex: bay.deckLiftIndex, bayKey: bay.bayKey }),
			)),
		[blockLiveLoadDeckBays, liveLoadMarqueePreviewKeySet],
	)
	const liveLoadInteractionPlane = useMemo(() => {
		if (!isLiveLoadTopView || blockLiveLoadDeckBays.length === 0) return null
		let xMin = Number.POSITIVE_INFINITY
		let xMax = Number.NEGATIVE_INFINITY
		let yMin = Number.POSITIVE_INFINITY
		let yMax = Number.NEGATIVE_INFINITY
		let zMax = 0
		for (const bay of blockLiveLoadDeckBays) {
			const rect = getLiveLoadBayRect(bay)
			xMin = Math.min(xMin, rect.xMin)
			xMax = Math.max(xMax, rect.xMax)
			yMin = Math.min(yMin, rect.yMin)
			yMax = Math.max(yMax, rect.yMax)
			zMax = Math.max(zMax, bay.center.z)
		}
		const paddingFt = 24
		return {
			centerX: (xMin + xMax) * 0.5,
			centerY: (yMin + yMax) * 0.5,
			widthFt: Math.max(12, xMax - xMin + paddingFt * 2),
			depthFt: Math.max(12, yMax - yMin + paddingFt * 2),
			z: zMax + inchesToFeet(12),
		}
	}, [blockLiveLoadDeckBays, getLiveLoadBayRect, isLiveLoadTopView])

	useEffect(() => {
		if (!isLiveLoadTopView) return
		const onPointerDown = (event: PointerEvent) => {
			if (event.button !== 0 || cameraNavigationActive) return
			if (isCameraNavigationModifierGesture(event)) return
			const startWorld = projectClientToGround(event.clientX, event.clientY)
			if (!startWorld) return
			event.preventDefault()
			event.stopPropagation()
			const startTargets = resolveLiveLoadTargetsAtPoint(startWorld)
			const nextState: LiveLoadMarqueeState = {
				startWorld,
				currentWorld: startWorld,
				startClientX: event.clientX,
				currentClientX: event.clientX,
				startClientY: event.clientY,
				currentClientY: event.clientY,
				additive: !!(event.ctrlKey || event.metaKey),
				startTargets,
			}
			liveLoadMarqueeStateRef.current = nextState
			setLiveLoadMarqueeState(nextState)
			setLiveLoadMarqueePreviewKeys(startTargets.map((target) => getLiveLoadDeckTargetKey(target)))
		}

		const element = gl.domElement
		element.addEventListener('pointerdown', onPointerDown, true)
		return () => element.removeEventListener('pointerdown', onPointerDown, true)
	}, [cameraNavigationActive, gl.domElement, isLiveLoadTopView, projectClientToGround, resolveLiveLoadTargetsAtPoint])

	useEffect(() => {
		if (!isLiveLoadTopView) return

		const clearLiveLoadMarquee = () => {
			liveLoadMarqueeStateRef.current = null
			setLiveLoadMarqueeState(null)
			setLiveLoadMarqueePreviewKeys([])
		}

		const updateLiveLoadMarquee = (clientX: number, clientY: number) => {
			const current = liveLoadMarqueeStateRef.current
			if (!current) return
			const point = projectClientToGround(clientX, clientY)
			if (!point) return
			const nextState: LiveLoadMarqueeState = {
				...current,
				currentWorld: point,
				currentClientX: clientX,
				currentClientY: clientY,
			}
			liveLoadMarqueeStateRef.current = nextState
			setLiveLoadMarqueeState(nextState)
			const isClick = Math.abs(nextState.currentClientX - nextState.startClientX) < 5
				&& Math.abs(nextState.currentClientY - nextState.startClientY) < 5
			const previewTargets = isClick ? nextState.startTargets : computeMarqueeLiveLoadTargets(nextState)
			setLiveLoadMarqueePreviewKeys(previewTargets.map((target) => getLiveLoadDeckTargetKey(target)))
		}
		const onPointerMove = (event: PointerEvent) => updateLiveLoadMarquee(event.clientX, event.clientY)
		const onMouseMove = (event: MouseEvent) => updateLiveLoadMarquee(event.clientX, event.clientY)

		const commitLiveLoadMarquee = () => {
			const current = liveLoadMarqueeStateRef.current
			if (!current) return
			const isClick = Math.abs(current.currentClientX - current.startClientX) < 5
				&& Math.abs(current.currentClientY - current.startClientY) < 5
			const nextTargets = isClick ? current.startTargets : computeMarqueeLiveLoadTargets(current)
			commitLiveLoadDeckTargetSelection(nextTargets, current.additive)
			clearLiveLoadMarquee()
		}

		window.addEventListener('pointermove', onPointerMove)
		window.addEventListener('mousemove', onMouseMove)
		window.addEventListener('pointerup', commitLiveLoadMarquee)
		window.addEventListener('mouseup', commitLiveLoadMarquee)
		window.addEventListener('pointercancel', clearLiveLoadMarquee)
		return () => {
			window.removeEventListener('pointermove', onPointerMove)
			window.removeEventListener('mousemove', onMouseMove)
			window.removeEventListener('pointerup', commitLiveLoadMarquee)
			window.removeEventListener('mouseup', commitLiveLoadMarquee)
			window.removeEventListener('pointercancel', clearLiveLoadMarquee)
		}
	}, [commitLiveLoadDeckTargetSelection, computeMarqueeLiveLoadTargets, isLiveLoadTopView, projectClientToGround])

	useEffect(() => {
		if (isLiveLoadTopView) return
		liveLoadMarqueeStateRef.current = null
		setLiveLoadMarqueeState(null)
		setLiveLoadMarqueePreviewKeys([])
	}, [isLiveLoadTopView])

  const plankInstances = useMemo<RinglockPlankInstance[]>(() => {
    if (manualPlankInstances.length === 0) return autoPlankInstances
    if (autoPlankInstances.length === 0) return manualPlankInstances
    return [...autoPlankInstances, ...manualPlankInstances]
  }, [autoPlankInstances, manualPlankInstances])

		const stackLegFrames = useMemo<StackLegFrame[]>(() => {
			const byStackId = new Map<string, StackLegFrame>()

			for (const standard of standardInstances) {
				const topZ = standard.basePosition.z + standard.heightFt
				const existing = byStackId.get(standard.stackId)
				if (!existing) {
					byStackId.set(standard.stackId, {
						stackId: standard.stackId,
						position: new THREE.Vector3(standard.basePosition.x, standard.basePosition.y, standard.basePosition.z),
						bottomZ: standard.basePosition.z,
						topZ,
						labelPosition: new THREE.Vector3(
							standard.basePosition.x,
							standard.basePosition.y,
							Math.max(LEG_LOAD_LABEL_HEIGHT_FT, standard.basePosition.z + LEG_LOAD_LABEL_HEIGHT_FT),
						),
					})
					continue
				}

				existing.bottomZ = Math.min(existing.bottomZ, standard.basePosition.z)
				existing.topZ = Math.max(existing.topZ, topZ)
				existing.labelPosition.set(
					existing.position.x,
					existing.position.y,
					Math.max(LEG_LOAD_LABEL_HEIGHT_FT, existing.bottomZ + LEG_LOAD_LABEL_HEIGHT_FT),
				)
			}

			const frames = Array.from(byStackId.values())
			if (frames.length === 0) return frames

			const centroid = frames.reduce(
				(acc, frame) => {
					acc.x += frame.position.x
					acc.y += frame.position.y
					return acc
				},
				{ x: 0, y: 0 },
			)
			centroid.x /= frames.length
			centroid.y /= frames.length

			for (const frame of frames) {
				const outward = new THREE.Vector2(frame.position.x - centroid.x, frame.position.y - centroid.y)
				if (outward.lengthSq() <= 1e-8) outward.set(0, -1)
				outward.normalize().multiplyScalar(LEG_LOAD_LABEL_OUTWARD_OFFSET_FT)
				frame.labelPosition.set(
					frame.position.x + outward.x,
					frame.position.y + outward.y,
					Math.max(LEG_LOAD_LABEL_HEIGHT_FT, frame.bottomZ + LEG_LOAD_LABEL_HEIGHT_FT),
				)
			}

			return frames
		}, [standardInstances])

		const ledgerLoadFrames = useMemo<LedgerLoadFrame[]>(() => {
			const ledgerConnectionById = new Map(ledgerConnections.map((connection) => [connection.id, connection]))
			return ledgerInstances
				.map((ledger) => {
					const connection = ledgerConnectionById.get(ledger.id)
					if (!connection) return null

					const start2 = new THREE.Vector2(ledger.start.x, ledger.start.y)
					const end2 = new THREE.Vector2(ledger.end.x, ledger.end.y)
					const dir = end2.clone().sub(start2)
					const lengthFt = dir.length()
					if (lengthFt <= 1e-6) return null
					dir.multiplyScalar(1 / lengthFt)

					return {
						id: ledger.id,
						start: ledger.start,
						end: ledger.end,
						startStackId: connection.startNode.stackId,
						endStackId: connection.endNode.stackId,
						start2,
						end2,
						mid: start2.clone().add(end2).multiplyScalar(0.5),
						dir,
						lengthFt,
						z: (ledger.start.z + ledger.end.z) * 0.5,
					}
				})
				.filter((ledger): ledger is LedgerLoadFrame => ledger !== null)
		}, [ledgerConnections, ledgerInstances])

		const categoryWeightMaps = useMemo(() => ({
			standards: buildCatalogWeightMap(selectedManufacturer.categories.standards.parts),
			ledgers: buildCatalogWeightMap(selectedManufacturer.categories.ledgers.parts),
			braces: buildCatalogWeightMap(selectedManufacturer.categories.braces.parts),
			trusses: buildCatalogWeightMap(selectedManufacturer.categories.trusses.parts),
			planks: buildCatalogWeightMap(selectedManufacturer.categories.planks.parts),
		}), [selectedManufacturer])

		const legDeadLoadsByStackId = useMemo<LegLoadByStackId>(() => {
			const loads: LegLoadByStackId = Object.fromEntries(stackLegFrames.map((frame) => [frame.stackId, 0]))

			const getStandardWeightLb = (partNumber: string) => {
				const catalogWeight = categoryWeightMaps.standards.get(partNumber)
				if (typeof catalogWeight === 'number') return catalogWeight
				if (manufacturerId !== 'universal') return null
				return UNIVERSAL_RINGLOCK_STANDARDS[partNumber as UniversalRinglockStandardId]?.weightLbs ?? null
			}

			const getLedgerWeightLb = (partNumber: string) => {
				if (partNumber.startsWith('UHT')) {
					const catalogWeight = categoryWeightMaps.trusses.get(partNumber)
					if (typeof catalogWeight === 'number') return catalogWeight
					if (manufacturerId !== 'universal') return null
					return UNIVERSAL_RINGLOCK_TRUSSES[partNumber as keyof typeof UNIVERSAL_RINGLOCK_TRUSSES]?.weightLbs ?? null
				}

				const catalogWeight = categoryWeightMaps.ledgers.get(partNumber)
				if (typeof catalogWeight === 'number') return catalogWeight
				if (manufacturerId !== 'universal') return null
				return UNIVERSAL_RINGLOCK_HORIZONTALS[partNumber as keyof typeof UNIVERSAL_RINGLOCK_HORIZONTALS]?.weightLbs ?? null
			}

			const getDiagonalWeightLb = (partNumber?: string) => {
				if (!partNumber) return null
				const catalogWeight = categoryWeightMaps.braces.get(partNumber)
				if (typeof catalogWeight === 'number') return catalogWeight
				if (manufacturerId !== 'universal') return null
				return UNIVERSAL_RINGLOCK_DIAGONALS[partNumber as keyof typeof UNIVERSAL_RINGLOCK_DIAGONALS]?.weightLbs ?? null
			}

			for (const standard of standardInstances) {
				const weightLb = getStandardWeightLb(standard.partNumber)
				if (typeof weightLb === 'number') {
					addLegLoad(loads, standard.stackId, weightLb)
				}
			}

			for (const connection of ledgerConnections) {
				const weightLb = getLedgerWeightLb(connection.ledgerPartNumber)
				if (typeof weightLb !== 'number') continue
				addLegLoad(loads, connection.startNode.stackId, weightLb * 0.5)
				addLegLoad(loads, connection.endNode.stackId, weightLb * 0.5)
			}

			for (const diagonal of diagonalInstances) {
				const weightLb = getDiagonalWeightLb(diagonal.partNumber)
				if (typeof weightLb !== 'number') continue

				const startStackId = resolveClosestStackIdForPoint(diagonal.start, stackLegFrames)
				const endStackId = resolveClosestStackIdForPoint(diagonal.end, stackLegFrames)
				addLegLoad(loads, startStackId, weightLb * 0.5)
				addLegLoad(loads, endStackId, weightLb * 0.5)
			}

			for (const plank of plankInstances) {
				const plankWeightLb = resolveClosestCatalogPlankWeightLb(
					plank,
					selectedManufacturer.categories.planks.parts,
					categoryWeightMaps.planks,
				)
				if (typeof plankWeightLb !== 'number') continue
				distributePlankLoadToLegs(loads, plank, plankWeightLb, ledgerLoadFrames)
			}

			return loads
		}, [
			categoryWeightMaps,
			diagonalInstances,
			ledgerConnections,
			ledgerLoadFrames,
			manufacturerId,
			plankInstances,
			selectedManufacturer,
			stackLegFrames,
			standardInstances,
		])

		const legLiveLoadsByStackId = useMemo<LegLoadByStackId>(() => {
			const loads: LegLoadByStackId = Object.fromEntries(stackLegFrames.map((frame) => [frame.stackId, 0]))

			for (const placement of manualLiveLoadPlacements) {
				const resolved = resolveManualLiveLoadPlacement(placement, ledgerLoadFrames)
				if (!resolved) continue

				forEachResolvedLiveLoadContribution(resolved, ({ sourceLedger, targetLedger, sourcePoint, targetPoint, sourceLoadLb, targetLoadLb }) => {
					applyLedgerPointLoad(loads, sourceLedger, sourcePoint, sourceLoadLb)
					applyLedgerPointLoad(loads, targetLedger, targetPoint, targetLoadLb)
				})
			}

			for (const bay of blockLiveLoadBays) {
				// Inference from the RISA one-way distribution method: for these regular block bays,
				// the meshed one-way panel resolves to equal corner reactions because each bay is a
				// symmetric rectangle simply supported on two opposite ledgers, and each ledger is
				// then simply supported by the two corner legs.
				const cornerReactionLb = bay.totalLoadLb * 0.25
				for (const stackId of bay.cornerStackIds) {
					addLegLoad(loads, stackId, cornerReactionLb)
				}
			}

			return loads
		}, [blockLiveLoadBays, manualLiveLoadPlacements, ledgerLoadFrames, stackLegFrames])

		const legNumberByStackId = useMemo(() => {
			const orderedFrames = [...stackLegFrames].sort(compareStackLegFramesForLabelOrder)
			return new Map(orderedFrames.map((frame, index) => [frame.stackId, index + 1] as const))
		}, [stackLegFrames])

		const legLoadLabels = useMemo(() => {
			return stackLegFrames.map((frame) => {
				const deadLoadLb = legDeadLoadsByStackId[frame.stackId] ?? 0
				const liveLoadLb = legLiveLoadsByStackId[frame.stackId] ?? 0

				return {
					...frame,
					legNumber: legNumberByStackId.get(frame.stackId) ?? 0,
					deadLoadLb,
					liveLoadLb,
					totalLoadLb: deadLoadLb + liveLoadLb,
					showLiveLoad: liveLoadLb > 1e-6,
				}
			})
		}, [legDeadLoadsByStackId, legLiveLoadsByStackId, legNumberByStackId, stackLegFrames])
		const buildingOccluders = useMemo(
			() => buildBuildingOccluders(resolvedBuildingGeometry.boxObstacles),
			[resolvedBuildingGeometry.boxObstacles],
		)

  // Selection handlers
				  const handleStandardSelect = useCallback((standard: RinglockStandardInstance, e?: ThreeEvent<PointerEvent>) => {
	    if (!selectionEnabled || cameraNavigationActive) return
				if (e && maybeCycleSelection(e)) return
					const stackId = standard.stackId

			// If the standard is sleeved into a base collar, clicks in the overlap region should prefer
			// selecting the base collar (otherwise the standard's large pick proxy makes collars hard to click).
			// Pro override: hold Alt to force selecting the standard.
					const stack = scaffoldStacks.find(s => s.id === stackId)
			if (stack && e && !e.nativeEvent.altKey) {
					const effectiveShowWoodSill = (stack.baseSupport === 'stacked')
						? false
						: (stack.showWoodSill ?? baseSettings.showWoodSill)
				const effectiveShowBaseCollar = (stack.baseSupport === 'stacked')
					? false
					: (stack.showBaseCollar ?? baseSettings.showBaseCollar)

				if (effectiveShowBaseCollar) {
					const insertionDepthFt = inchesToFeet(6)
						// IMPORTANT: With multi-segment stacks, the clicked segment may be above the base.
						// Base collar overlap exists only at the very bottom of the stack.
						const baseOffsetFt = getStandardBaseOffsetFt(stack.jackExtensionIn, effectiveShowWoodSill, effectiveShowBaseCollar)
						const insertionTopZ = stack.gridPosition.z + baseOffsetFt + insertionDepthFt
					if (e.point.z <= insertionTopZ + 1e-6) {
							setSelectedStackIds([stackId])
							setSelectedObjectId(`base-collar-${stackId}`)
						return
					}
				}
			}

		  // Keep single-stack selection state in sync so PropertiesPanel edits apply reliably.
		  setSelectedStackIds([stackId])
		    setSelectedObjectId(`standard-${standard.id}`)
				  }, [baseSettings.showBaseCollar, baseSettings.showWoodSill, cameraNavigationActive, maybeCycleSelection, scaffoldStacks, selectionEnabled, setSelectedObjectId, setSelectedStackIds])

			// While the Standard tool is active, clicking an existing standard should stack another
			// segment on top (repeat-until-ESC CAD behavior).
			const handleStandardStackSelect = useCallback((standard: RinglockStandardInstance, e?: ThreeEvent<PointerEvent>) => {
				if (!isPlacingStandard || cameraNavigationActive) return
				if (e) e.stopPropagation()
				const pn = selectedPart?.partNumber
				if (!pn) return
					appendStandardSegmentToStack(standard.stackId, pn)
			}, [appendStandardSegmentToStack, cameraNavigationActive, isPlacingStandard, selectedPart])

		  const handleLedgerSelect = useCallback((ledger: RinglockLedgerInstance, e?: ThreeEvent<PointerEvent>) => {
	    if (!selectionEnabled || cameraNavigationActive) return
			if (e && maybeCycleSelection(e)) return
	    // Selecting a ledger should clear any stack multi-selection.
	    setSelectedStackIds([])
    setSelectedObjectId(`ledger-${ledger.id}`)
	  }, [cameraNavigationActive, maybeCycleSelection, selectionEnabled, setSelectedObjectId, setSelectedStackIds])

		const handleDiagonalSelect = useCallback((diagonal: RinglockDiagonalInstance, e?: ThreeEvent<PointerEvent>) => {
			if (!selectionEnabled || cameraNavigationActive) return
			if (e && maybeCycleSelection(e)) return
			setSelectedStackIds([])
			setSelectedObjectId(`diagonal-${diagonal.id}`)
		}, [cameraNavigationActive, maybeCycleSelection, selectionEnabled, setSelectedObjectId, setSelectedStackIds])

		const handlePlankSelect = useCallback((plank: RinglockPlankInstance, e?: ThreeEvent<PointerEvent>) => {
			if (!selectionEnabled || cameraNavigationActive) return
			if (e && maybeCycleSelection(e)) return
			setSelectedStackIds([])
			setSelectedObjectId(`plank-${plank.id}`)
		}, [cameraNavigationActive, maybeCycleSelection, selectionEnabled, setSelectedObjectId, setSelectedStackIds])

		const handleBlockLiveLoadBaySelect = useCallback((bay: RinglockLiveLoadInstance, e?: ThreeEvent<PointerEvent>) => {
			if (cameraNavigationActive || categoryKey !== 'liveLoads') return
			if (e) {
				e.stopPropagation()
				e.nativeEvent.stopImmediatePropagation?.()
			}
			const deckBay = bay as BlockLiveLoadBay
			commitLiveLoadDeckTargetSelection(
				[{ blockId: deckBay.blockId, liftIndex: deckBay.deckLiftIndex, bayKey: deckBay.bayKey }],
				!!(e?.nativeEvent.ctrlKey || e?.nativeEvent.metaKey),
			)
		}, [cameraNavigationActive, categoryKey, commitLiveLoadDeckTargetSelection])

		const handleLiveLoadSelect = useCallback((liveLoad: { id: string }, e?: ThreeEvent<PointerEvent>) => {
			if (!selectionEnabled || cameraNavigationActive) return
			if (e && maybeCycleSelection(e)) return
			setSelectedStackIds([])
			setSelectedObjectId(`live-load-${liveLoad.id}`)
		}, [cameraNavigationActive, maybeCycleSelection, selectionEnabled, setSelectedObjectId, setSelectedStackIds])

		  const handleBaseSelect = useCallback((base: RinglockBaseInstance, componentType: 'wood-sill' | 'screw-jack' | 'base-collar', e?: ThreeEvent<PointerEvent>) => {
	    if (!selectionEnabled || cameraNavigationActive) return
			if (e && maybeCycleSelection(e)) return
	    // Keep single-stack selection state in sync so PropertiesPanel edits apply reliably.
	    setSelectedStackIds([base.id])
    setSelectedObjectId(`${componentType}-${base.id}`)
	  }, [cameraNavigationActive, maybeCycleSelection, selectionEnabled, setSelectedObjectId, setSelectedStackIds])

  return (
    <group>
				{dxfPreviewEnabled ? (
					<DxfPreviewOverlay diagonals={diagonalInstances} />
				) : (
					<>
						<>
							{/* Render real scaffold members even in block assemble mode so committed blocks
							    keep the same volumetric language as the placement preview. */}
							<RinglockBases
								bases={baseInstances}
								selectedId={selectedObjectId}
								clippingPlanes={clippingPlanes}
								onSelect={selectionEnabled ? handleBaseSelect : undefined}
							/>

							<RinglockStandards
								standards={standardInstances}
								selectedId={selectedObjectId?.startsWith('standard-') ? selectedObjectId.slice('standard-'.length) : null}
								selectedIds={stackMoveIds.length > 0 ? stackMoveIds : undefined}
								clippingPlanes={clippingPlanes}
								onSelect={selectionEnabled ? handleStandardSelect : (isPlacingStandard ? handleStandardStackSelect : undefined)}
							/>

							<RinglockLedgers
								ledgers={ledgerInstances}
								selectedId={selectedObjectId?.replace('ledger-', '')}
								clippingPlanes={clippingPlanes}
								onSelect={selectionEnabled ? handleLedgerSelect : undefined}
							/>

							<RinglockDiagonals
								diagonals={diagonalInstances}
								selectedId={selectedObjectId?.startsWith('diagonal-') ? selectedObjectId.slice('diagonal-'.length) : null}
								clippingPlanes={clippingPlanes}
								onSelect={selectionEnabled ? handleDiagonalSelect : undefined}
							/>

							<RinglockPlanks
								planks={plankInstances}
								selectedId={selectedObjectId?.startsWith('plank-') ? selectedObjectId.slice('plank-'.length) : null}
								clippingPlanes={clippingPlanes}
								onSelect={selectionEnabled ? handlePlankSelect : undefined}
							/>

							<RinglockLiveLoads
								liveLoads={blockLiveLoadDeckBays}
								selectedId={null}
								clippingPlanes={clippingPlanes}
								onSelect={isPlacingLiveLoad && !isLiveLoadTopView ? handleBlockLiveLoadBaySelect : undefined}
								fillColor="#2dd4bf"
								emissiveColor="#2dd4bf"
								stripeColor="rgba(236, 253, 245, 0.76)"
								backgroundFill="rgba(45, 212, 191, 0.16)"
								opacity={0}
								outlineOpacity={0}
							/>

							<RinglockLiveLoads
								liveLoads={blockLiveLoadBays}
								selectedId={null}
								clippingPlanes={clippingPlanes}
								onSelect={undefined}
								fillColor="#22d3ee"
								emissiveColor="#67e8f9"
								stripeColor="rgba(236, 254, 255, 0.94)"
								backgroundFill="rgba(34, 211, 238, 0.28)"
								opacity={0.42}
								outlineColor="#0f766e"
								outlineOpacity={0.28}
							/>

							{isPlacingLiveLoad ? (
								<>
									{hoveredBlockLiveLoadBays.length > 0 ? (
										<RinglockLiveLoads
											liveLoads={hoveredBlockLiveLoadBays}
											selectedId={null}
											clippingPlanes={clippingPlanes}
											onSelect={undefined}
											fillColor="#2563eb"
											emissiveColor="#60a5fa"
											stripeColor="rgba(239, 246, 255, 0.96)"
											backgroundFill="rgba(37, 99, 235, 0.34)"
											opacity={0.56}
											outlineColor="#bfdbfe"
											outlineOpacity={0.62}
										/>
									) : null}
									<RinglockLiveLoads
										liveLoads={excludedBlockLiveLoadBays}
										selectedId={null}
										clippingPlanes={clippingPlanes}
										onSelect={undefined}
										fillColor="#94a3b8"
										emissiveColor="#cbd5f5"
										stripeColor="rgba(226, 232, 240, 0.55)"
										backgroundFill="rgba(148, 163, 184, 0.08)"
										opacity={0.12}
										outlineColor="#94a3b8"
										outlineOpacity={0.4}
									/>
									{selectedIncludedBlockLiveLoadBays.length > 0 ? (
										<RinglockLiveLoads
											liveLoads={selectedIncludedBlockLiveLoadBays}
											selectedId={null}
											clippingPlanes={clippingPlanes}
											onSelect={undefined}
											fillColor="#1d4ed8"
											emissiveColor="#93c5fd"
											stripeColor="rgba(255, 255, 255, 0.98)"
											backgroundFill="rgba(29, 78, 216, 0.42)"
											opacity={0.68}
											outlineColor="#dbeafe"
											outlineOpacity={0.78}
										/>
									) : null}
									{selectedExcludedBlockLiveLoadBays.length > 0 ? (
										<RinglockLiveLoads
											liveLoads={selectedExcludedBlockLiveLoadBays}
											selectedId={null}
											clippingPlanes={clippingPlanes}
											onSelect={undefined}
											fillColor="#64748b"
											emissiveColor="#94a3b8"
											stripeColor="rgba(255, 255, 255, 0.82)"
											backgroundFill="rgba(100, 116, 139, 0.22)"
											opacity={0.28}
											outlineColor="#cbd5e1"
											outlineOpacity={0.56}
										/>
									) : null}
									{marqueePreviewBlockLiveLoadBays.length > 0 ? (
										<RinglockLiveLoads
											liveLoads={marqueePreviewBlockLiveLoadBays}
											selectedId={null}
											clippingPlanes={clippingPlanes}
											onSelect={undefined}
											fillColor="#1d4ed8"
											emissiveColor="#93c5fd"
											stripeColor="rgba(255, 255, 255, 0.98)"
											backgroundFill="rgba(29, 78, 216, 0.34)"
											opacity={0.52}
											outlineColor="#dbeafe"
											outlineOpacity={0.62}
										/>
									) : null}
								</>
							) : null}

							{isLiveLoadTopView && liveLoadInteractionPlane && liveLoadMarqueeState ? (
								<LiveLoadMarquee
									start={liveLoadMarqueeState.startWorld}
									current={liveLoadMarqueeState.currentWorld}
									crossing={liveLoadMarqueeState.currentClientX < liveLoadMarqueeState.startClientX}
									z={liveLoadInteractionPlane.z - inchesToFeet(1)}
								/>
							) : null}

							<RinglockLiveLoads
								liveLoads={manualLiveLoadInstances}
								selectedId={selectedObjectId?.startsWith('live-load-') ? selectedObjectId.slice('live-load-'.length) : null}
								clippingPlanes={clippingPlanes}
								onSelect={selectionEnabled ? handleLiveLoadSelect : undefined}
							/>

							{/* Keep DL/LL in the data model for drawings/export, but present only the total load in the live 3D scene. */}
							{settings.showLegLoads && legLoadLabels.map((frame) => (
								<LegLoadValueLabel
									key={`leg-load-${frame.stackId}`}
									position={frame.labelPosition}
									valueText={formatLoadLb(frame.totalLoadLb)}
									buildingOccluders={buildingOccluders}
								/>
							))}
						</>
					</>
				)}

				{/* ── Stack move/copy visuals ─────────────────────────────────── */}
				{stackMarquee && (
					<LiveLoadMarquee
						start={stackMarquee.start}
						current={stackMarquee.current}
						crossing={stackMarquee.currentClientX < stackMarquee.startClientX}
						z={0.05}
					/>
				)}

				{/* Anchor marker */}
				{stackMoveAnchor && (
					<mesh position={[stackMoveAnchor.x, stackMoveAnchor.y, 0.15]} raycast={() => null}>
						<sphereGeometry args={[0.18, 16, 16]} />
						<meshStandardMaterial
							color="#a855f7"
							emissive="#a855f7"
							emissiveIntensity={0.6}
						/>
					</mesh>
				)}

				{/* Permanent dimension annotations (created after each copy/move placement) */}
				{permanentDims.map(dim => (
					<PermanentDimension
						key={dim.id}
						start={dim.start}
						end={dim.end}
						distance={dim.distance}
						offset={dim.offset}
						onRemove={() => setPermanentDims(prev => prev.filter(d => d.id !== dim.id))}
						onOffsetChange={newOffset => setPermanentDims(prev =>
							prev.map(d => d.id === dim.id ? { ...d, offset: newOffset } : d)
						)}
					/>
				))}

				{/* Distance line + midpoint label during 'place' step */}
				{stackMoveStep === 'place' && stackMoveAnchor && stackPreviewOffset && stackCadHud && (
					<>
						<DistanceLine
							start={stackMoveAnchor}
							end={{ x: stackMoveAnchor.x + stackPreviewOffset.dx, y: stackMoveAnchor.y + stackPreviewOffset.dy }}
						/>
						<Html
							position={[
								stackMoveAnchor.x + stackPreviewOffset.dx * 0.5,
								stackMoveAnchor.y + stackPreviewOffset.dy * 0.5,
								0.4,
							]}
							center
							style={{ pointerEvents: 'none', userSelect: 'none' }}
						>
							<div className="cad-dimension-label">
								{stackCadHud.distance.toFixed(2)} ft &nbsp; {stackCadHud.angle.toFixed(0)}°
							</div>
						</Html>
					</>
				)}

				{/* Ghost standard preview at destination — real geometry, tinted */}
				{stackMoveStep === 'place' && stackPreviewOffset && stackMoveIds.length > 0 && (() => {
					const ghostColor = stackEditActionMode === 'copy' ? '#22c55e' : '#f97316'
					const stackMoveIdSet = new Set(stackMoveIds)
					const ghostInstances = standardInstances
						.filter(si => stackMoveIdSet.has(si.stackId))
						.map(si => ({
							...si,
							id: `ghost-${si.id}`,
							basePosition: new THREE.Vector3(
								si.basePosition.x + stackPreviewOffset.dx,
								si.basePosition.y + stackPreviewOffset.dy,
								si.basePosition.z,
							),
						}))
					return (
						<RinglockStandards
							standards={ghostInstances}
							ghostColor={ghostColor}
						/>
					)
				})()}
	    </group>
  )
}
