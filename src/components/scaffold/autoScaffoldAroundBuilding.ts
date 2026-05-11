import * as THREE from 'three'

import type { BuildingPoint2 } from '../../types/buildingEntities'
import type { ScaffoldBlockInstance } from '../../types/scaffoldGraph'
import { chooseBayLayout } from './blockPlanning'

export type AutoScaffoldTargetBuilding = {
	id: string
	shape: 'rect' | 'circle' | 'ring' | 'polygon'
	position: { x: number; y: number; z?: number }
	dimensions: { x: number; y: number; z?: number }
	rotation?: { z?: number } | null
	radiusFt?: number
	innerRadiusFt?: number
	points?: BuildingPoint2[]
}

export type AutoScaffoldRecipe = {
	depthFt: number
	preferredBayWidthFt: number
}

export type RoundAutoScaffoldBayFamily = '6x8' | '6x6' | '8x8'

export type AutoScaffoldPlacementRecipe = {
	widthFt: number
	depthFt: number
}

export type AutoScaffoldPlacementSide = string

export type AutoScaffoldPlacement = {
	centerX: number
	centerY: number
	rotationSteps: number
	side: AutoScaffoldPlacementSide
	recipe: AutoScaffoldPlacementRecipe
}

export type RoundAutoScaffoldBayPlan = {
	index: number
	isClosure: boolean
	centerX: number
	centerY: number
	rotationSteps: number
	widthFt: number
	depthFt: number
	innerStandardKeyA: string
	innerStandardKeyB: string
	outerStandardKeyA: string
	outerStandardKeyB: string
}

export type RoundAutoScaffoldPlan = {
	bayCount: number
	innerLedgerFt: number
	outerLedgerFt: number
	actualInnerChordFt: number
	actualOuterChordFt: number
	radialDepthFt: number
	closureBayIndex: number
	innerStacks: Array<{ key: string; x: number; y: number }>
	outerStacks: Array<{ key: string; x: number; y: number }>
	bays: RoundAutoScaffoldBayPlan[]
}

type AutoScaffoldSideDescriptor = {
	side: 'front' | 'back' | 'left' | 'right'
	centerX: number
	centerY: number
	rotationSteps: number
	runLengthFt: number
	tangent: { x: number; y: number }
}

type AutoScaffoldCornerDescriptor = {
	side: 'front-left' | 'front-right' | 'back-left' | 'back-right'
	centerX: number
	centerY: number
	rotationSteps: number
}

function clampPositive(value: unknown, fallback: number) {
	const numeric = Number(value)
	return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function normalizeQuarterTurns(rawRadians: number): number {
	const quarterTurns = Math.round(rawRadians / (Math.PI / 2))
	return ((quarterTurns % 4) + 4) % 4
}

function rotationStepsFromAngle(angleRad: number): number {
	return angleRad / (Math.PI / 2)
}

function normalizeVector2(vector: { x: number; y: number }) {
	const length = Math.hypot(vector.x, vector.y)
	if (length <= 1e-9) return { x: 1, y: 0 }
	return { x: vector.x / length, y: vector.y / length }
}

export function getRoundBayFamilyTargets(family: RoundAutoScaffoldBayFamily) {
	switch (family) {
		case '6x6':
			return { innerLedgerFt: 6, outerLedgerFt: 6 }
		case '8x8':
			return { innerLedgerFt: 8, outerLedgerFt: 8 }
		case '6x8':
		default:
			return { innerLedgerFt: 6, outerLedgerFt: 8 }
	}
}

function chooseRoundBayCount(params: {
	innerRadiusFt: number
	outerRadiusFt: number
	innerLedgerFt: number
	outerLedgerFt: number
}): { bayCount: number; actualInnerChordFt: number; actualOuterChordFt: number } {
	const { innerRadiusFt, outerRadiusFt, innerLedgerFt, outerLedgerFt } = params
	const circumferenceFt = Math.max(0.1, 2 * Math.PI * (innerRadiusFt + outerRadiusFt) / 2)
	const minBays = Math.max(6, Math.round(circumferenceFt / 12))
	const maxBays = Math.max(minBays, Math.round(circumferenceFt / 4))
	let best = {
		bayCount: minBays,
		actualInnerChordFt: Math.max(0.1, 2 * innerRadiusFt * Math.sin(Math.PI / minBays)),
		actualOuterChordFt: Math.max(0.1, 2 * outerRadiusFt * Math.sin(Math.PI / minBays)),
		score: Number.POSITIVE_INFINITY,
	}
	for (let bayCount = minBays; bayCount <= maxBays; bayCount++) {
		const halfAngle = Math.PI / bayCount
		const actualInnerChordFt = Math.max(0.1, 2 * innerRadiusFt * Math.sin(halfAngle))
		const actualOuterChordFt = Math.max(0.1, 2 * outerRadiusFt * Math.sin(halfAngle))
		const score = Math.abs(actualInnerChordFt - innerLedgerFt) * 2 + Math.abs(actualOuterChordFt - outerLedgerFt)
		if (score < best.score - 1e-6) {
			best = { bayCount, actualInnerChordFt, actualOuterChordFt, score }
		}
	}
	return best
}

function signedPolygonArea(points: BuildingPoint2[]) {
	let area = 0
	for (let index = 0; index < points.length; index++) {
		const current = points[index]!
		const next = points[(index + 1) % points.length]!
		area += current.x * next.y - next.x * current.y
	}
	return area / 2
}

function transformLocalPoint(params: {
	centerX: number
	centerY: number
	rotationZRad: number
	point: BuildingPoint2
}): BuildingPoint2 {
	const { centerX, centerY, rotationZRad, point } = params
	const cos = Math.cos(rotationZRad)
	const sin = Math.sin(rotationZRad)
	return {
		x: centerX + point.x * cos - point.y * sin,
		y: centerY + point.x * sin + point.y * cos,
	}
}

function getRectWorldOutline(building: AutoScaffoldTargetBuilding): BuildingPoint2[] {
	const halfWidthFt = clampPositive(building.dimensions.x, 0.1) / 2
	const halfDepthFt = clampPositive(building.dimensions.y, 0.1) / 2
	const centerX = Number(building.position.x) || 0
	const centerY = Number(building.position.y) || 0
	const rotationZRad = Number(building.rotation?.z) || 0
	return [
		{ x: -halfWidthFt, y: -halfDepthFt },
		{ x: halfWidthFt, y: -halfDepthFt },
		{ x: halfWidthFt, y: halfDepthFt },
		{ x: -halfWidthFt, y: halfDepthFt },
	].map((point) => transformLocalPoint({ centerX, centerY, rotationZRad, point }))
}

function getPolygonWorldOutline(building: AutoScaffoldTargetBuilding): BuildingPoint2[] {
	const points = Array.isArray(building.points) ? building.points : []
	if (points.length < 3) return []
	const centerX = Number(building.position.x) || 0
	const centerY = Number(building.position.y) || 0
	const rotationZRad = Number(building.rotation?.z) || 0
	return points.map((point) => transformLocalPoint({ centerX, centerY, rotationZRad, point }))
}

function getAutoScaffoldSideDescriptors(params: {
	building: AutoScaffoldTargetBuilding
	recipe: AutoScaffoldRecipe
	buildingOffsetFt: number
}): AutoScaffoldSideDescriptor[] {
	const { building, recipe, buildingOffsetFt } = params
	const blockDepthFt = clampPositive(recipe.depthFt, 0.1)
	const preferredBayWidthFt = clampPositive(recipe.preferredBayWidthFt, 7)
	const halfBuildingWidthFt = clampPositive(building.dimensions.x, 0.1) / 2
	const halfBuildingDepthFt = clampPositive(building.dimensions.y, 0.1) / 2
	const center = new THREE.Vector2(Number(building.position.x) || 0, Number(building.position.y) || 0)
	const buildingRotationSteps = normalizeQuarterTurns(Number(building.rotation?.z) || 0)
	const buildingAngle = buildingRotationSteps * (Math.PI / 2)
	const axisX = new THREE.Vector2(Math.cos(buildingAngle), Math.sin(buildingAngle))
	const axisY = new THREE.Vector2(-Math.sin(buildingAngle), Math.cos(buildingAngle))
	const faceOffset = Math.max(0, buildingOffsetFt) + blockDepthFt / 2
	const frontBackRunFt = Math.max(preferredBayWidthFt, halfBuildingWidthFt * 2 + Math.max(0, buildingOffsetFt) * 2)
	const leftRightRunFt = Math.max(preferredBayWidthFt, halfBuildingDepthFt * 2 + Math.max(0, buildingOffsetFt) * 2)

	const toWorld = (localX: number, localY: number) => ({
		x: center.x + axisX.x * localX + axisY.x * localY,
		y: center.y + axisX.y * localX + axisY.y * localY,
	})

	const front = toWorld(0, -(halfBuildingDepthFt + faceOffset))
	const back = toWorld(0, halfBuildingDepthFt + faceOffset)
	const left = toWorld(-(halfBuildingWidthFt + faceOffset), 0)
	const right = toWorld(halfBuildingWidthFt + faceOffset, 0)

	return [
		{
			side: 'front',
			centerX: front.x,
			centerY: front.y,
			rotationSteps: buildingRotationSteps,
			runLengthFt: frontBackRunFt,
			tangent: { x: axisX.x, y: axisX.y },
		},
		{
			side: 'back',
			centerX: back.x,
			centerY: back.y,
			rotationSteps: buildingRotationSteps,
			runLengthFt: frontBackRunFt,
			tangent: { x: axisX.x, y: axisX.y },
		},
		{
			side: 'left',
			centerX: left.x,
			centerY: left.y,
			rotationSteps: buildingRotationSteps + 1,
			runLengthFt: leftRightRunFt,
			tangent: { x: axisY.x, y: axisY.y },
		},
		{
			side: 'right',
			centerX: right.x,
			centerY: right.y,
			rotationSteps: buildingRotationSteps + 1,
			runLengthFt: leftRightRunFt,
			tangent: { x: axisY.x, y: axisY.y },
		},
	]
}

function getAutoScaffoldCornerDescriptors(params: {
	building: AutoScaffoldTargetBuilding
	recipe: AutoScaffoldRecipe
	buildingOffsetFt: number
}): AutoScaffoldCornerDescriptor[] {
	const { building, recipe, buildingOffsetFt } = params
	const blockDepthFt = clampPositive(recipe.depthFt, 0.1)
	const halfBuildingWidthFt = clampPositive(building.dimensions.x, 0.1) / 2
	const halfBuildingDepthFt = clampPositive(building.dimensions.y, 0.1) / 2
	const center = new THREE.Vector2(Number(building.position.x) || 0, Number(building.position.y) || 0)
	const buildingRotationSteps = normalizeQuarterTurns(Number(building.rotation?.z) || 0)
	const buildingAngle = buildingRotationSteps * (Math.PI / 2)
	const axisX = new THREE.Vector2(Math.cos(buildingAngle), Math.sin(buildingAngle))
	const axisY = new THREE.Vector2(-Math.sin(buildingAngle), Math.cos(buildingAngle))
	const faceOffset = Math.max(0, buildingOffsetFt) + blockDepthFt / 2

	const toWorld = (localX: number, localY: number) => ({
		x: center.x + axisX.x * localX + axisY.x * localY,
		y: center.y + axisX.y * localX + axisY.y * localY,
	})

	const frontLeft = toWorld(-(halfBuildingWidthFt + faceOffset), -(halfBuildingDepthFt + faceOffset))
	const frontRight = toWorld(halfBuildingWidthFt + faceOffset, -(halfBuildingDepthFt + faceOffset))
	const backLeft = toWorld(-(halfBuildingWidthFt + faceOffset), halfBuildingDepthFt + faceOffset)
	const backRight = toWorld(halfBuildingWidthFt + faceOffset, halfBuildingDepthFt + faceOffset)

	return [
		{ side: 'front-left', centerX: frontLeft.x, centerY: frontLeft.y, rotationSteps: buildingRotationSteps },
		{ side: 'front-right', centerX: frontRight.x, centerY: frontRight.y, rotationSteps: buildingRotationSteps },
		{ side: 'back-left', centerX: backLeft.x, centerY: backLeft.y, rotationSteps: buildingRotationSteps },
		{ side: 'back-right', centerX: backRight.x, centerY: backRight.y, rotationSteps: buildingRotationSteps },
	]
}

function generateRectPlacements(params: {
	building: AutoScaffoldTargetBuilding
	recipe: AutoScaffoldRecipe
	buildingOffsetFt: number
}): AutoScaffoldPlacement[] {
	const { recipe } = params
	const blockDepthFt = clampPositive(recipe.depthFt, 0.1)
	const sideDescriptors = getAutoScaffoldSideDescriptors(params)
	const cornerDescriptors = getAutoScaffoldCornerDescriptors(params)
	const frontBackRunFt = sideDescriptors.find((side) => side.side === 'front')?.runLengthFt ?? blockDepthFt
	const leftRightRunFt = sideDescriptors.find((side) => side.side === 'left')?.runLengthFt ?? blockDepthFt
	const frontBackLayout = chooseBayLayout(frontBackRunFt)
	const leftRightLayout = chooseBayLayout(leftRightRunFt)

	const placements: AutoScaffoldPlacement[] = []
	const pushSidePlacements = (side: AutoScaffoldPlacement['side'], bays: number, baySpacingFt: number) => {
		const descriptor = sideDescriptors.find((entry) => entry.side === side)
		if (!descriptor) return
		const tangentStart = -((Math.max(1, bays) - 1) * baySpacingFt) / 2
		for (let index = 0; index < Math.max(1, bays); index++) {
			const tangentOffset = tangentStart + index * baySpacingFt
			placements.push({
				centerX: descriptor.centerX + descriptor.tangent.x * tangentOffset,
				centerY: descriptor.centerY + descriptor.tangent.y * tangentOffset,
				rotationSteps: ((descriptor.rotationSteps % 4) + 4) % 4,
				side,
				recipe: {
					widthFt: baySpacingFt,
					depthFt: blockDepthFt,
				},
			})
		}
	}

	pushSidePlacements('front', frontBackLayout.bays, frontBackLayout.spacingFt)
	pushSidePlacements('back', frontBackLayout.bays, frontBackLayout.spacingFt)
	pushSidePlacements('left', leftRightLayout.bays, leftRightLayout.spacingFt)
	pushSidePlacements('right', leftRightLayout.bays, leftRightLayout.spacingFt)

	for (const corner of cornerDescriptors) {
		placements.push({
			centerX: corner.centerX,
			centerY: corner.centerY,
			rotationSteps: ((corner.rotationSteps % 4) + 4) % 4,
			side: corner.side,
			recipe: {
				widthFt: blockDepthFt,
				depthFt: blockDepthFt,
			},
		})
	}

	return placements
}

function generateCircularPlacements(params: {
	building: AutoScaffoldTargetBuilding
	recipe: AutoScaffoldRecipe
	buildingOffsetFt: number
}): AutoScaffoldPlacement[] {
	const { building, recipe, buildingOffsetFt } = params
	const blockDepthFt = clampPositive(recipe.depthFt, 0.1)
	const outerRadiusFt = clampPositive(building.radiusFt ?? building.dimensions.x / 2, 0.1)
	const centerRadiusFt = outerRadiusFt + Math.max(0, buildingOffsetFt) + blockDepthFt / 2
	const circumferenceFt = Math.max(0.1, 2 * Math.PI * centerRadiusFt)
	const layout = chooseBayLayout(circumferenceFt)
	const bayCount = Math.max(8, layout.bays)
	const bayAngleRad = (Math.PI * 2) / bayCount
	const chordWidthFt = Math.max(0.1, 2 * centerRadiusFt * Math.sin(Math.abs(bayAngleRad) / 2))
	const baseAngleRad = Number(building.rotation?.z) || 0
	const centerX = Number(building.position.x) || 0
	const centerY = Number(building.position.y) || 0

	return Array.from({ length: bayCount }, (_, index) => {
		const angleRad = baseAngleRad + index * bayAngleRad
		const tangentAngleRad = angleRad + Math.PI / 2
		return {
			centerX: centerX + Math.cos(angleRad) * centerRadiusFt,
			centerY: centerY + Math.sin(angleRad) * centerRadiusFt,
			rotationSteps: rotationStepsFromAngle(tangentAngleRad),
			side: `${building.shape}-bay-${index}`,
			recipe: {
				widthFt: chordWidthFt,
				depthFt: blockDepthFt,
			},
		}
	})
}

function generatePolygonPlacements(params: {
	building: AutoScaffoldTargetBuilding
	recipe: AutoScaffoldRecipe
	buildingOffsetFt: number
	points: BuildingPoint2[]
	prefix: string
	includeCornerClosures: boolean
}): AutoScaffoldPlacement[] {
	const { building, recipe, buildingOffsetFt, points, prefix, includeCornerClosures } = params
	const blockDepthFt = clampPositive(recipe.depthFt, 0.1)
	const faceOffset = Math.max(0, buildingOffsetFt) + blockDepthFt / 2
	const placements: AutoScaffoldPlacement[] = []
	if (points.length < 3) return placements

	const isCounterClockwise = signedPolygonArea(points) > 0
	const getOutwardNormal = (tangent: { x: number; y: number }) => (
		isCounterClockwise
			? { x: tangent.y, y: -tangent.x }
			: { x: -tangent.y, y: tangent.x }
	)

	for (let edgeIndex = 0; edgeIndex < points.length; edgeIndex++) {
		const start = points[edgeIndex]!
		const end = points[(edgeIndex + 1) % points.length]!
		const edge = { x: end.x - start.x, y: end.y - start.y }
		const lengthFt = Math.hypot(edge.x, edge.y)
		if (lengthFt <= 0.1) continue
		const tangent = normalizeVector2(edge)
		const outwardNormal = getOutwardNormal(tangent)
		const layout = chooseBayLayout(lengthFt)
		for (let bayIndex = 0; bayIndex < layout.bays; bayIndex++) {
			const distanceFt = (bayIndex + 0.5) * layout.spacingFt
			placements.push({
				centerX: start.x + tangent.x * distanceFt + outwardNormal.x * faceOffset,
				centerY: start.y + tangent.y * distanceFt + outwardNormal.y * faceOffset,
				rotationSteps: rotationStepsFromAngle(Math.atan2(tangent.y, tangent.x)),
				side: `${prefix}-edge-${edgeIndex}-bay-${bayIndex}`,
				recipe: {
					widthFt: layout.spacingFt,
					depthFt: blockDepthFt,
				},
			})
		}
	}

	if (!includeCornerClosures) return placements

	for (let cornerIndex = 0; cornerIndex < points.length; cornerIndex++) {
		const previous = points[(cornerIndex - 1 + points.length) % points.length]!
		const current = points[cornerIndex]!
		const next = points[(cornerIndex + 1) % points.length]!
		const previousTangent = normalizeVector2({ x: current.x - previous.x, y: current.y - previous.y })
		const nextTangent = normalizeVector2({ x: next.x - current.x, y: next.y - current.y })
		const previousNormal = getOutwardNormal(previousTangent)
		const nextNormal = getOutwardNormal(nextTangent)
		const bisector = normalizeVector2({
			x: previousNormal.x + nextNormal.x,
			y: previousNormal.y + nextNormal.y,
		})
		placements.push({
			centerX: current.x + bisector.x * faceOffset,
			centerY: current.y + bisector.y * faceOffset,
			rotationSteps: rotationStepsFromAngle(Math.atan2(nextTangent.y, nextTangent.x)),
			side: `${prefix}-corner-${cornerIndex}`,
			recipe: {
				widthFt: blockDepthFt,
				depthFt: blockDepthFt,
			},
		})
	}

	return placements
}

function isNearlyQuarterTurn(angleRad: number) {
	const quarterTurns = angleRad / (Math.PI / 2)
	return Math.abs(quarterTurns - Math.round(quarterTurns)) <= 1e-4
}

export function generateAutoScaffoldPlacements(params: {
	building: AutoScaffoldTargetBuilding
	recipe: AutoScaffoldRecipe
	buildingOffsetFt: number
}): AutoScaffoldPlacement[] {
	const { building } = params

	if (building.shape === 'circle' || building.shape === 'ring') {
		return generateCircularPlacements(params)
	}

	if (building.shape === 'polygon') {
		return generatePolygonPlacements({
			...params,
			points: getPolygonWorldOutline(building),
			prefix: 'polygon',
			includeCornerClosures: true,
		})
	}

	const rotationZRad = Number(building.rotation?.z) || 0
	if (building.shape === 'rect' && isNearlyQuarterTurn(rotationZRad)) {
		return generateRectPlacements(params)
	}

	return generatePolygonPlacements({
		...params,
		points: getRectWorldOutline(building),
		prefix: 'rect',
		includeCornerClosures: true,
	})
}

export function buildRoundAutoScaffoldPlan(params: {
	building: AutoScaffoldTargetBuilding
	recipe: AutoScaffoldRecipe
	buildingOffsetFt: number
	family: RoundAutoScaffoldBayFamily
}): RoundAutoScaffoldPlan | null {
	const { building, recipe, buildingOffsetFt, family } = params
	if (building.shape !== 'circle' && building.shape !== 'ring') return null
	const outerBuildingRadiusFt = clampPositive(building.radiusFt ?? building.dimensions.x / 2, 0.1)
	const blockDepthFt = clampPositive(recipe.depthFt, 0.1)
	const innerRadiusFt = outerBuildingRadiusFt + Math.max(0, buildingOffsetFt)
	const outerRadiusFt = innerRadiusFt + blockDepthFt
	const familyTargets = getRoundBayFamilyTargets(family)
	const solved = chooseRoundBayCount({
		innerRadiusFt,
		outerRadiusFt,
		innerLedgerFt: familyTargets.innerLedgerFt,
		outerLedgerFt: familyTargets.outerLedgerFt,
	})
	const baseAngleRad = Number(building.rotation?.z) || 0
	const centerX = Number(building.position.x) || 0
	const centerY = Number(building.position.y) || 0
	const bayAngleRad = (Math.PI * 2) / solved.bayCount
	const closureBayIndex = solved.bayCount - 1

	const innerStacks = Array.from({ length: solved.bayCount }, (_, index) => {
		const angleRad = baseAngleRad + index * bayAngleRad
		return {
			key: `round-inner-${index}`,
			x: centerX + Math.cos(angleRad) * innerRadiusFt,
			y: centerY + Math.sin(angleRad) * innerRadiusFt,
		}
	})
	const outerStacks = Array.from({ length: solved.bayCount }, (_, index) => {
		const angleRad = baseAngleRad + index * bayAngleRad
		return {
			key: `round-outer-${index}`,
			x: centerX + Math.cos(angleRad) * outerRadiusFt,
			y: centerY + Math.sin(angleRad) * outerRadiusFt,
		}
	})

	const bays = Array.from({ length: solved.bayCount }, (_, index) => {
		const nextIndex = (index + 1) % solved.bayCount
		const angleRad = baseAngleRad + (index + 0.5) * bayAngleRad
		const innerMidX = (innerStacks[index]!.x + innerStacks[nextIndex]!.x) / 2
		const innerMidY = (innerStacks[index]!.y + innerStacks[nextIndex]!.y) / 2
		const outerMidX = (outerStacks[index]!.x + outerStacks[nextIndex]!.x) / 2
		const outerMidY = (outerStacks[index]!.y + outerStacks[nextIndex]!.y) / 2
		return {
			index,
			isClosure: index === closureBayIndex,
			centerX: (innerMidX + outerMidX) / 2,
			centerY: (innerMidY + outerMidY) / 2,
			rotationSteps: rotationStepsFromAngle(angleRad + Math.PI / 2),
			widthFt: (familyTargets.innerLedgerFt + familyTargets.outerLedgerFt) / 2,
			depthFt: blockDepthFt,
			innerStandardKeyA: innerStacks[index]!.key,
			innerStandardKeyB: innerStacks[nextIndex]!.key,
			outerStandardKeyA: outerStacks[index]!.key,
			outerStandardKeyB: outerStacks[nextIndex]!.key,
		}
	})

	return {
		bayCount: solved.bayCount,
		innerLedgerFt: familyTargets.innerLedgerFt,
		outerLedgerFt: familyTargets.outerLedgerFt,
		actualInnerChordFt: solved.actualInnerChordFt,
		actualOuterChordFt: solved.actualOuterChordFt,
		radialDepthFt: blockDepthFt,
		closureBayIndex,
		innerStacks,
		outerStacks,
		bays,
	}
}

export function findLegacyAutoScaffoldBlockIds(params: {
	building: AutoScaffoldTargetBuilding
	recipe: AutoScaffoldRecipe
	buildingOffsetFt: number
	blocks: Array<Pick<ScaffoldBlockInstance, 'id' | 'center' | 'rotationSteps' | 'widthFt' | 'depthFt'>>
}): string[] {
	const { blocks, recipe, building } = params
	if (building.shape !== 'rect') return []
	const sideDescriptors = getAutoScaffoldSideDescriptors(params)
	const depthToleranceFt = 0.2
	const centerToleranceFt = 0.35
	const runToleranceFt = 0.75
	const blockDepthFt = clampPositive(recipe.depthFt, 0.1)
	const halfBuildingWidthFt = clampPositive(building.dimensions.x, 0.1) / 2
	const halfBuildingDepthFt = clampPositive(building.dimensions.y, 0.1) / 2
	const legacyCornerWrapFt = Math.max(0, params.buildingOffsetFt) + blockDepthFt
	const preferredBayWidthFt = clampPositive(recipe.preferredBayWidthFt, 7)
	const legacyFrontBackRunFt = Math.max(preferredBayWidthFt, halfBuildingWidthFt * 2 + legacyCornerWrapFt * 2)
	const legacyLeftRightRunFt = Math.max(preferredBayWidthFt, halfBuildingDepthFt * 2 + legacyCornerWrapFt * 2)
	const legacyDescriptors = sideDescriptors.map((side) => ({
		...side,
		runLengthFt: side.side === 'front' || side.side === 'back' ? legacyFrontBackRunFt : legacyLeftRightRunFt,
	}))

	return blocks
		.filter((block) => {
			if (Math.abs(block.depthFt - recipe.depthFt) > depthToleranceFt) return false
			return [...sideDescriptors, ...legacyDescriptors].some((side) => {
				const normalizedRotation = ((block.rotationSteps % 4) + 4) % 4
				const sideRotation = ((side.rotationSteps % 4) + 4) % 4
				if (Math.abs(normalizedRotation - sideRotation) > 1e-6) return false
				if (Math.abs(block.widthFt - side.runLengthFt) > runToleranceFt) return false
				if (Math.abs(block.center.x - side.centerX) > centerToleranceFt) return false
				if (Math.abs(block.center.y - side.centerY) > centerToleranceFt) return false
				return true
			})
		})
		.map((block) => block.id)
}
