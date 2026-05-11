import * as THREE from 'three'

import type { SceneObject } from '../../contexts/ToolContext'
import type { ScaffoldStack } from '../../types/scaffoldGraph'
import type { ResolvedBuildingCutVolume, ResolvedBuildingSupportSurface } from '../../utils/building/scaffoldBuildingGeometry'
import { resolveSupportSurfaceAtPoint } from '../../utils/building/scaffoldBuildingGeometry'
import { buildStandardPlan, chooseBayLayout, makeStackPositionKey, rotateOffset90 } from './blockPlanning'
import { type UniversalRinglockStandardId, UNIVERSAL_RINGLOCK_STANDARDS } from './ringlockCatalog'
import { computeRosettePositions } from './scaffoldGeometry'
import { makeLedgerConnectionKey } from './ledgerConnectionKey'

const WORLD_UP = new THREE.Vector3(0, 0, 1)
const STANDARD_PARTS_DESC: UniversalRinglockStandardId[] = ['US99', 'US66', 'US411', 'US33', 'US17']
const JACK_MIN_IN = 0
const JACK_MAX_IN = 12
const JACK_ROUNDING_IN = 0.125
const ALIGN_TOLERANCE_FT = 1 / 192

export type SupportAwareBlockRecipe = {
	rotationSteps: number
	widthFt: number
	depthFt: number
	heightFt: number
	plankedLevelsCount: number
	includeBaseDeck: boolean
	braceFrontBack: 'off' | 'slash' | 'backslash'
	braceLeftRight: 'off' | 'slash' | 'backslash'
	ledgerEveryNRosettes: number
	baseSettings: {
		jackExtensionIn: number
		showWoodSill: boolean
		showBaseCollar: boolean
	}
}

export type SupportAwareStackSpec = {
	key: string
	x: number
	y: number
	gridPositionZ: number
	baseSupport: ScaffoldStack['baseSupport']
	jackExtensionIn: number
	standardSegments: string[]
	designLiftToLocalLift: Map<number, number>
}

export type SupportAwareLedgerSpec = {
	key: string
	stackKeyA: string
	stackKeyB: string
	liftIndexA: number
	liftIndexB: number
	ledgerPartNumber: string
	designLiftIndex: number
}

export type SupportAwareLayoutIssue = {
	kind: 'support-too-high' | 'unresolved-stack'
	x: number
	y: number
	supportZ: number
	topSupportZ: number
}

export type SupportAwareBlockLayout = {
	layoutX: ReturnType<typeof chooseBayLayout>
	layoutY: ReturnType<typeof chooseBayLayout>
	stackKeys: string[][]
	stackSpecsByKey: Map<string, SupportAwareStackSpec>
	ledgerSpecs: SupportAwareLedgerSpec[]
	workingDeckTargetZByLift: Map<number, number>
	nominalPlan: ReturnType<typeof buildStandardPlan>
	placementIssue: SupportAwareLayoutIssue | null
}

type PrefixCandidate = {
	segments: UniversalRinglockStandardId[]
	heightFt: number
	rosetteCount: number
}

type ResolvedStackSpec = {
	spec: SupportAwareStackSpec
	issue: SupportAwareLayoutIssue | null
}

const rosetteZByLiftCache = new Map<string, Map<number, number>>()
const supportAwareLayoutCache = new WeakMap<readonly unknown[], Map<string, SupportAwareBlockLayout>>()

function roundToJackIncrement(valueIn: number) {
	return Math.round(valueIn / JACK_ROUNDING_IN) * JACK_ROUNDING_IN
}

function almostZero(value: number, tol = 1e-6) {
	return Math.abs(value) <= tol
}

function getBoxTopZAtPoint(object: SceneObject, x: number, y: number): number | null {
	if (object.type !== 'box') return null
	if (!almostZero(object.rotation.x) || !almostZero(object.rotation.y)) return null
	const dz = object.position.z + object.dimensions.z / 2
	const dx = x - object.position.x
	const dy = y - object.position.y
	const angle = -(object.rotation.z ?? 0)
	const cos = Math.cos(angle)
	const sin = Math.sin(angle)
	const localX = dx * cos - dy * sin
	const localY = dx * sin + dy * cos
	if (Math.abs(localX) > object.dimensions.x / 2 + 1e-6) return null
	if (Math.abs(localY) > object.dimensions.y / 2 + 1e-6) return null
	return dz
}

function getCircleTopZAtPoint(object: SceneObject, x: number, y: number): number | null {
	if (object.type !== 'circle') return null
	const radius = Number(object.radius ?? object.dimensions.x / 2)
	if (!Number.isFinite(radius) || radius <= 0) return null
	const dx = x - object.position.x
	const dy = y - object.position.y
	if (dx * dx + dy * dy > radius * radius + 1e-6) return null
	return object.position.z + object.dimensions.z / 2
}

function resolveLegacySupportSurface(objects: SceneObject[], x: number, y: number) {
	let z = 0
	let baseSupport: ScaffoldStack['baseSupport'] = 'grid'
	for (const object of objects) {
		if (object.workspace !== 'building') continue
		let topZ: number | null = null
		if (object.type === 'box') topZ = getBoxTopZAtPoint(object, x, y)
		else if (object.type === 'circle') topZ = getCircleTopZAtPoint(object, x, y)
		if (topZ === null) continue
		if (topZ > z + 1e-6) {
			z = topZ
			baseSupport = 'shape'
		}
	}
	return { z, baseSupport }
}

function sumSegmentHeights(segments: UniversalRinglockStandardId[]) {
	return segments.reduce((total, partNumber) => total + (UNIVERSAL_RINGLOCK_STANDARDS[partNumber]?.heightFt ?? 0), 0)
}

function sumSegmentRosettes(segments: UniversalRinglockStandardId[]) {
	return segments.reduce((total, partNumber) => total + (UNIVERSAL_RINGLOCK_STANDARDS[partNumber]?.rosetteCount ?? 0), 0)
}

function formatFeetLabel(valueFt: number) {
	const totalInches = Math.max(0, Math.round(valueFt * 12))
	const feet = Math.floor(totalInches / 12)
	const inches = totalInches % 12
	return `${feet}'-${String(inches).padStart(2, '0')}"`
}

function makeRosetteCacheKey(
	partNumbers: UniversalRinglockStandardId[],
	jackExtensionIn: number,
	showWoodSill: boolean,
	showBaseCollar: boolean,
) {
	return [
		showWoodSill ? '1' : '0',
		showBaseCollar ? '1' : '0',
		Number(jackExtensionIn).toFixed(3),
		partNumbers.join('|'),
	].join(':')
}

function getRosetteZByLift(
	partNumbers: UniversalRinglockStandardId[],
	jackExtensionIn: number,
	showWoodSill: boolean,
	showBaseCollar: boolean,
) {
	const cacheKey = makeRosetteCacheKey(partNumbers, jackExtensionIn, showWoodSill, showBaseCollar)
	const cached = rosetteZByLiftCache.get(cacheKey)
	if (cached) return cached
	const rosettes = computeRosettePositions(
		new THREE.Vector3(0, 0, 0),
		partNumbers.map((partNumber) => ({ partNumber })),
		jackExtensionIn,
		showWoodSill,
		showBaseCollar,
	)
	const byLift = new Map(rosettes.map((rosette) => [rosette.liftIndex, rosette.position.z]))
	rosetteZByLiftCache.set(cacheKey, byLift)
	return byLift
}

function buildPrefixCandidates(maxHeightFt: number): PrefixCandidate[] {
	const limitFt = Math.max(0, maxHeightFt)
	const maxSegments = Math.max(0, Math.min(6, Math.ceil(limitFt / (UNIVERSAL_RINGLOCK_STANDARDS.US99.heightFt || 1)) + 1))
	const out: PrefixCandidate[] = [{ segments: [], heightFt: 0, rosetteCount: 0 }]

	const walk = (startIndex: number, remaining: number, acc: UniversalRinglockStandardId[]) => {
		if (remaining <= 0) return
		for (let index = startIndex; index < STANDARD_PARTS_DESC.length; index++) {
			const partNumber = STANDARD_PARTS_DESC[index]!
			const next = [...acc, partNumber]
			const heightFt = sumSegmentHeights(next)
			if (heightFt > limitFt + UNIVERSAL_RINGLOCK_STANDARDS.US17.heightFt + 1e-6) continue
			out.push({
				segments: next,
				heightFt,
				rosetteCount: sumSegmentRosettes(next),
			})
			walk(index, remaining - 1, next)
		}
	}

	walk(0, maxSegments, [])

	const seen = new Set<string>()
	return out.filter((candidate) => {
		const key = candidate.segments.join('|')
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

function buildTargetZByDesignLift(recipe: SupportAwareBlockRecipe, nominalPlan: ReturnType<typeof buildStandardPlan>) {
	return getRosetteZByLift(
		nominalPlan.segments as UniversalRinglockStandardId[],
		recipe.baseSettings.jackExtensionIn,
		recipe.baseSettings.showWoodSill,
		recipe.baseSettings.showBaseCollar,
	)
}

function makeSupportAwareLayoutCacheKey(centerX: number, centerY: number, recipe: SupportAwareBlockRecipe) {
	return [
		Number(centerX).toFixed(4),
		Number(centerY).toFixed(4),
		recipe.rotationSteps,
		Number(recipe.widthFt).toFixed(4),
		Number(recipe.depthFt).toFixed(4),
		Number(recipe.heightFt).toFixed(4),
		recipe.plankedLevelsCount,
		recipe.includeBaseDeck ? '1' : '0',
		recipe.braceFrontBack,
		recipe.braceLeftRight,
		recipe.ledgerEveryNRosettes,
		Number(recipe.baseSettings.jackExtensionIn).toFixed(3),
		recipe.baseSettings.showWoodSill ? '1' : '0',
		recipe.baseSettings.showBaseCollar ? '1' : '0',
	].join('|')
}

export function describeSupportAwareLayoutIssue(issue: SupportAwareLayoutIssue) {
	if (issue.kind === 'support-too-high') {
		return `Block cannot land here: support at ${formatFeetLabel(issue.supportZ)} is above the block's top support level at ${formatFeetLabel(issue.topSupportZ)}.`
	}
	return `Block cannot land here: the support surface at ${formatFeetLabel(issue.supportZ)} is too high for the requested block height.`
}

function buildCriticalDesignLiftIndices(nominalPlan: ReturnType<typeof buildStandardPlan>) {
	const critical = new Set<number>()
	if (nominalPlan.topWorkingDeckLiftIndex !== null) {
		critical.add(nominalPlan.topWorkingDeckLiftIndex)
		critical.add(nominalPlan.topWorkingDeckLiftIndex + 1)
		critical.add(nominalPlan.topWorkingDeckLiftIndex + 2)
	} else {
		critical.add(nominalPlan.requiredStandardLiftIndex)
	}
	critical.add(nominalPlan.requiredStandardLiftIndex)
	return Array.from(critical)
		.filter((value) => Number.isFinite(value) && value >= 0)
		.sort((a, b) => a - b)
}

function buildRelevantDesignLiftIndices(nominalPlan: ReturnType<typeof buildStandardPlan>) {
	const relevant = new Set<number>()
	for (const liftIndex of nominalPlan.ledgerLiftIndices) {
		if (Number.isFinite(liftIndex) && liftIndex >= 0) relevant.add(liftIndex)
	}
	for (const deckLiftIndex of nominalPlan.workingDeckLiftIndices) {
		if (!Number.isFinite(deckLiftIndex) || deckLiftIndex < 0) continue
		relevant.add(deckLiftIndex)
		relevant.add(deckLiftIndex + 1)
		relevant.add(deckLiftIndex + 2)
	}
	for (const liftIndex of buildCriticalDesignLiftIndices(nominalPlan)) relevant.add(liftIndex)
	return Array.from(relevant).sort((a, b) => a - b)
}

function getRemovedBoundaryOptions(nominalSegments: UniversalRinglockStandardId[]) {
	const out: Array<{
		removedSegments: UniversalRinglockStandardId[]
		remainingSegments: UniversalRinglockStandardId[]
		removedHeightFt: number
		removedRosetteCount: number
	}> = []
	for (let removeCount = 0; removeCount <= nominalSegments.length; removeCount++) {
		const removedSegments = nominalSegments.slice(0, removeCount)
		const remainingSegments = nominalSegments.slice(removeCount)
		out.push({
			removedSegments,
			remainingSegments,
			removedHeightFt: sumSegmentHeights(removedSegments),
			removedRosetteCount: sumSegmentRosettes(removedSegments),
		})
	}
	return out
}

function resolveStackSpec(params: {
	x: number
	y: number
	objects: SceneObject[]
	supportSurfaces?: ResolvedBuildingSupportSurface[]
	cutVolumes?: ResolvedBuildingCutVolume[]
	recipe: SupportAwareBlockRecipe
	nominalPlan: ReturnType<typeof buildStandardPlan>
	targetZByDesignLift: Map<number, number>
	criticalDesignLifts: number[]
}) : ResolvedStackSpec {
	const { x, y, objects, supportSurfaces, cutVolumes, recipe, nominalPlan, targetZByDesignLift, criticalDesignLifts } = params
	const support = supportSurfaces
		? resolveSupportSurfaceAtPoint(supportSurfaces, x, y, cutVolumes)
		: resolveLegacySupportSurface(objects, x, y)
	const nominalSegments = nominalPlan.segments as UniversalRinglockStandardId[]
	const removedOptions = getRemovedBoundaryOptions(nominalSegments)
	const prefixCandidates = buildPrefixCandidates(Math.max(18, Math.abs(support.z) + recipe.heightFt + 6))
	// Lift 0 is the base-collar rosette relative to the local support, so once a leg lands on a
	// raised shape it no longer has a meaningful global target Z. Keeping it in the alignment set
	// makes every raised-support candidate look invalid and forces the nominal full-height fallback.
	const includeBaseCollarAlignment = recipe.baseSettings.showBaseCollar && support.z <= ALIGN_TOLERANCE_FT
	const relevantDesignLifts = Array.from(new Set([
		...(includeBaseCollarAlignment ? [0] : []),
		...buildRelevantDesignLiftIndices(nominalPlan),
	])).sort((a, b) => a - b)

	const nominalJackFt = Number(recipe.baseSettings.jackExtensionIn) / 12
	let best:
		| {
			segments: UniversalRinglockStandardId[]
			jackExtensionIn: number
			designLiftToLocalLift: Map<number, number>
			score: number
		}
		| null = null

	for (const removed of removedOptions) {
		for (const prefix of prefixCandidates) {
			const segments = [...prefix.segments, ...removed.remainingSegments]
			if (segments.length === 0) continue
			const candidateZByLift = getRosetteZByLift(
				segments,
				0,
				recipe.baseSettings.showWoodSill,
				recipe.baseSettings.showBaseCollar,
			)
			if (candidateZByLift.size === 0) continue
			const shift = prefix.rosetteCount - removed.removedRosetteCount
			const designLiftToLocalLift = new Map<number, number>()
			if (includeBaseCollarAlignment && candidateZByLift.has(0) && targetZByDesignLift.has(0)) {
				designLiftToLocalLift.set(0, 0)
			}
			for (const designLift of relevantDesignLifts) {
				if (designLift === 0) continue
				const localLift = designLift + shift
				if (localLift < 1) continue
				if (!candidateZByLift.has(localLift)) continue
				designLiftToLocalLift.set(designLift, localLift)
			}

			const supportedCritical = criticalDesignLifts.filter((designLift) => designLiftToLocalLift.has(designLift))
			if (supportedCritical.length !== criticalDesignLifts.length) continue
			const anchorDesignLift = supportedCritical[0]
			const anchorLocalLift = designLiftToLocalLift.get(anchorDesignLift)
			if (anchorLocalLift === undefined) continue
			const anchorTargetZ = targetZByDesignLift.get(anchorDesignLift)
			const anchorCandidateZ = candidateZByLift.get(anchorLocalLift)
			if (anchorTargetZ === undefined || anchorCandidateZ === undefined) continue

			const requiredJackFt = anchorTargetZ - support.z - anchorCandidateZ
			const requiredJackIn = roundToJackIncrement(requiredJackFt * 12)
			if (requiredJackIn < JACK_MIN_IN - 1e-6 || requiredJackIn > JACK_MAX_IN + 1e-6) continue

			let valid = true
			for (const designLift of relevantDesignLifts) {
				const localLift = designLiftToLocalLift.get(designLift)
				if (localLift === undefined) continue
				const targetZ = targetZByDesignLift.get(designLift)
				const candidateZ = candidateZByLift.get(localLift)
				if (targetZ === undefined || candidateZ === undefined) continue
				const solvedZ = support.z + candidateZ + requiredJackIn / 12
				if (Math.abs(solvedZ - targetZ) > ALIGN_TOLERANCE_FT) {
					valid = false
					break
				}
			}
			if (!valid) continue

			const lowerSupport = support.z < nominalJackFt - 1e-6
			const firstPrefix = prefix.segments[0]
			const supportedRelevantCount = relevantDesignLifts.filter((designLift) => designLiftToLocalLift.has(designLift)).length
			const score =
				(relevantDesignLifts.length - supportedRelevantCount) * 4000 +
				removed.removedSegments.length * 500 +
				prefix.segments.length * 120 +
				(Math.abs(requiredJackIn - recipe.baseSettings.jackExtensionIn) * 4) +
				(lowerSupport && prefix.segments.length > 0 && firstPrefix !== 'US99' ? 800 : 0) +
				(prefix.heightFt > 0 ? Math.abs(prefix.heightFt - Math.max(0, nominalJackFt - support.z + removed.removedHeightFt - JACK_MAX_IN / 12)) : 0)

			if (!best || score < best.score) {
				best = {
					segments,
					jackExtensionIn: Math.max(JACK_MIN_IN, Math.min(JACK_MAX_IN, requiredJackIn)),
					designLiftToLocalLift,
					score,
				}
			}
		}
	}

	let issue: SupportAwareLayoutIssue | null = null
	if (!best) {
		const topSupportZ = Math.max(
			0,
			...Array.from(targetZByDesignLift.values()).filter((value) => Number.isFinite(value)),
		)
		issue = {
			kind: support.z > topSupportZ + ALIGN_TOLERANCE_FT ? 'support-too-high' : 'unresolved-stack',
			x,
			y,
			supportZ: support.z,
			topSupportZ,
		}
		best = {
			segments: nominalSegments,
			jackExtensionIn: Math.max(JACK_MIN_IN, Math.min(JACK_MAX_IN, recipe.baseSettings.jackExtensionIn)),
			designLiftToLocalLift: new Map(
				relevantDesignLifts
					.filter((designLift) => designLift === 0 || designLift >= 1)
					.map((designLift) => [designLift, designLift] as const),
			),
			score: Number.POSITIVE_INFINITY,
		}
	}

	return {
		spec: {
			key: makeStackPositionKey(x, y, support.z),
			x,
			y,
			gridPositionZ: support.z,
			baseSupport: support.baseSupport,
			jackExtensionIn: best.jackExtensionIn,
			standardSegments: best.segments,
			designLiftToLocalLift: best.designLiftToLocalLift,
		},
		issue,
	}
}

export function resolveSupportAwareBlockLayout(params: {
	centerX: number
	centerY: number
	recipe: SupportAwareBlockRecipe
	objects: SceneObject[]
	supportSurfaces?: ResolvedBuildingSupportSurface[]
	cutVolumes?: ResolvedBuildingCutVolume[]
}) : SupportAwareBlockLayout {
	const { centerX, centerY, recipe, objects, supportSurfaces, cutVolumes } = params
	const cacheKey = makeSupportAwareLayoutCacheKey(centerX, centerY, recipe)
	const cacheOwner = supportSurfaces ?? objects
	let perObjectCache = supportAwareLayoutCache.get(cacheOwner)
	if (!perObjectCache) {
		perObjectCache = new Map<string, SupportAwareBlockLayout>()
		supportAwareLayoutCache.set(cacheOwner, perObjectCache)
	}
	const cachedLayout = perObjectCache.get(cacheKey)
	if (cachedLayout) return cachedLayout
	const layoutX = chooseBayLayout(recipe.widthFt)
	const layoutY = chooseBayLayout(recipe.depthFt)
	const nominalPlan = buildStandardPlan({
		heightFt: recipe.heightFt,
		ledgerEveryN: recipe.ledgerEveryNRosettes,
		plankedLevelsCount: recipe.plankedLevelsCount,
		includeBaseDeck: recipe.includeBaseDeck,
		jackExtensionIn: recipe.baseSettings.jackExtensionIn,
		showWoodSill: recipe.baseSettings.showWoodSill,
		showBaseCollar: recipe.baseSettings.showBaseCollar,
	})
	const targetZByDesignLift = buildTargetZByDesignLift(recipe, nominalPlan)
	const criticalDesignLifts = buildCriticalDesignLiftIndices(nominalPlan)
	const halfWidth = recipe.widthFt / 2
	const halfDepth = recipe.depthFt / 2
	const stackKeys: string[][] = []
	const stackSpecsByKey = new Map<string, SupportAwareStackSpec>()
	let placementIssue: SupportAwareLayoutIssue | null = null
	for (let bayY = 0; bayY <= layoutY.bays; bayY++) {
		const row: string[] = []
		for (let bayX = 0; bayX <= layoutX.bays; bayX++) {
			const local = {
				x: bayX * layoutX.spacingFt - halfWidth,
				y: bayY * layoutY.spacingFt - halfDepth,
			}
			const rotated = rotateOffset90(local, recipe.rotationSteps)
			const x = centerX + rotated.x
			const y = centerY + rotated.y
			const resolved = resolveStackSpec({
				x,
				y,
				objects,
				supportSurfaces,
				cutVolumes,
				recipe,
				nominalPlan,
				targetZByDesignLift,
				criticalDesignLifts,
			})
			if (!placementIssue && resolved.issue) placementIssue = resolved.issue
			const stack = resolved.spec
			stackSpecsByKey.set(stack.key, stack)
			row.push(stack.key)
		}
		stackKeys.push(row)
	}

	const ledgerSpecs: SupportAwareLedgerSpec[] = []
	const pushLedger = (
		stackKeyA: string,
		stackKeyB: string,
		ledgerPartNumber: string,
		designLiftIndex: number,
	) => {
		const stackA = stackSpecsByKey.get(stackKeyA)
		const stackB = stackSpecsByKey.get(stackKeyB)
		if (!stackA || !stackB) return
		const liftIndexA = stackA.designLiftToLocalLift.get(designLiftIndex)
		const liftIndexB = stackB.designLiftToLocalLift.get(designLiftIndex)
		if (liftIndexA === undefined || liftIndexB === undefined) return
		ledgerSpecs.push({
			key: makeLedgerConnectionKey(stackKeyA, liftIndexA, stackKeyB, liftIndexB),
			stackKeyA,
			stackKeyB,
			liftIndexA,
			liftIndexB,
			ledgerPartNumber,
			designLiftIndex,
		})
	}

	for (const designLiftIndex of nominalPlan.ledgerLiftIndices) {
		for (let bayY = 0; bayY <= layoutY.bays; bayY++) {
			for (let bayX = 0; bayX < layoutX.bays; bayX++) {
				pushLedger(
					stackKeys[bayY]![bayX]!,
					stackKeys[bayY]![bayX + 1]!,
					layoutX.ledgerPartNumber,
					designLiftIndex,
				)
			}
		}
		for (let bayY = 0; bayY < layoutY.bays; bayY++) {
			for (let bayX = 0; bayX <= layoutX.bays; bayX++) {
				pushLedger(
					stackKeys[bayY]![bayX]!,
					stackKeys[bayY + 1]![bayX]!,
					layoutY.ledgerPartNumber,
					designLiftIndex,
				)
			}
		}
	}

	const workingDeckTargetZByLift = new Map<number, number>()
	for (const designLiftIndex of nominalPlan.workingDeckLiftIndices) {
		const targetZ = targetZByDesignLift.get(designLiftIndex)
		if (targetZ !== undefined) workingDeckTargetZByLift.set(designLiftIndex, targetZ)
	}

	const layout = {
		layoutX,
		layoutY,
		stackKeys,
		stackSpecsByKey,
		ledgerSpecs,
		workingDeckTargetZByLift,
		nominalPlan,
		placementIssue,
	}
	perObjectCache.set(cacheKey, layout)
	return layout
}
