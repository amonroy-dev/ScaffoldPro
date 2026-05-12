import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import { RotateCcw, Copy, Eye, LayoutGrid, Pencil, Check, X, Box, Move } from 'lucide-react'
import { useTool, type SceneObject } from '../contexts/ToolContext'
import { useSettings } from '../contexts/SettingsContext'
import { useScaffoldBaseSettings } from '../contexts/ScaffoldBaseSettings'
import { useCatalogSelection } from '../contexts/CatalogContext'
import {
  getBaseMassFaceInfo,
  getDefaultParapetEdgeIdsForHost,
  getParapetEdgeOptionsForHost,
  getHostedFeatureDefaultAnalysis,
  getHostedFeatureDefaultDepthFt,
  getHostedFeatureDefaultHandrailEnabled,
  getHostedFeatureDefaultHandrailHeightFt,
  getHostedFeatureDefaultHandrailInsetFt,
  getHostedFeatureDefaultHandrailThicknessFt,
  getHostedFeatureDefaultHeightFt,
  getHostedFeatureHandrailSettings,
  getHostedFeaturePresetLabel,
  getHostedPatternContentLabel,
  getProxyDefaultDepthFt,
  resolveHostedPatternInstances,
  resolveHostedRectEntityTopFaceInfo,
  getProxyDefaultHeightFt,
  isTopHostedBoxWithinHost,
  getProxyDefaultColor,
  getProxyModeLabel,
  getResolvedParapetEdgeIdsForHost,
  getRoofTypeLabel,
  isBaseMassEntity,
  isFeatureEntity,
  isHostedRectEntity,
  isPatternEntity,
  isParapetEntity,
  isProxyEntity,
  isRoofEntity,
  type BaseMassEntity,
  type BuildingEntity,
  type HostedFeatureEntity,
  type HostedFeaturePreset,
  type HostedPatternAxisMode,
  type HostedPatternCornerBehavior,
  type HostedPatternContentType,
  type HostedPatternEntity,
  type ResolvedHostedPatternInstance,
  sanitizeHostedPatternCornerBehavior,
  sanitizeHostedPatternWallFaceIds,
  type HostedPatternWrapMode,
  type HostedParapetEntity,
  type HostedProxyEntity,
  type HostedRoofEntity,
  type ParapetEdgeId,
  type ProxyFeatureMode,
  type RoofDirection,
  type SideFeatureFaceId,
} from '../types/buildingEntities'
import { formatDisplayWeight, getGenericPartDisplayName, roundDisplayWeightLb } from '../catalog/scaffoldDisplay'
import type { ScaffoldObject } from '../types/scaffoldObjects'
import { SCAFFOLD_WEIGHTS } from '../types/scaffoldObjects'
import type { BlockBraceDirection, ScaffoldBlockInstance, ScaffoldStack } from '../types/scaffoldGraph'
import {
	UNIVERSAL_RINGLOCK_DIAGONALS,
  UNIVERSAL_RINGLOCK_HORIZONTALS,
	findClosestDiagonal,
  UNIVERSAL_RINGLOCK_TRUSSES,
} from '../types/scaffoldGraph'
import { buildStandardPlan, chooseBayLayout, makeBlockLiveLoadBayKey } from './scaffold/blockPlanning'
import { UNIVERSAL_RINGLOCK_STANDARDS } from './scaffold/ringlockCatalog'
import { resolveScaffoldBuildingGeometry } from '../utils/building/scaffoldBuildingGeometry'
import './PropertiesPanel.css'

type DimField = 'length' | 'height' | 'depth'

const BLOCK_BRACE_OPTIONS: Array<{ value: BlockBraceDirection; label: string }> = [
	{ value: 'off', label: 'Off' },
	{ value: 'slash', label: '/' },
	{ value: 'backslash', label: '\\' },
]

const ROOF_KIND_OPTIONS: Array<{ value: HostedRoofEntity['kind']; label: string }> = [
  { value: 'flat-roof', label: 'Flat' },
  { value: 'shed-roof', label: 'Shed' },
  { value: 'gable-roof', label: 'Gable' },
  { value: 'hip-roof', label: 'Hip' },
  { value: 'cone-roof', label: 'Cone' },
  { value: 'dome-roof', label: 'Dome' },
]

const TOP_FEATURE_PRESET_OPTIONS: Array<{ value: HostedFeaturePreset; label: string }> = [
  { value: 'penthouse', label: 'Penthouse' },
  { value: 'roof-unit', label: 'Roof Unit' },
  { value: 'top-box', label: 'Top Box' },
]

const SIDE_FEATURE_PRESET_OPTIONS: Array<{ value: HostedFeaturePreset; label: string }> = [
  { value: 'balcony', label: 'Balcony' },
  { value: 'canopy', label: 'Canopy' },
  { value: 'screen', label: 'Screen Wall' },
  { value: 'side-box', label: 'Side Box' },
]

const SIDE_FEATURE_FACE_OPTIONS: Array<{ value: SideFeatureFaceId; label: string }> = [
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
]

const PROXY_MODE_OPTIONS: Array<{ value: ProxyFeatureMode; label: string }> = [
  { value: 'add', label: 'Volume' },
  { value: 'cut', label: 'Cut Volume' },
]

const PROXY_FACE_OPTIONS: Array<{ value: 'top' | SideFeatureFaceId; label: string }> = [
  { value: 'top', label: 'Top' },
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
]

const PATTERN_WRAP_MODE_OPTIONS: Array<{ value: HostedPatternWrapMode; label: string }> = [
  { value: 'single-face', label: 'Single Face' },
  { value: 'all-walls', label: 'All Walls' },
  { value: 'selected-walls', label: 'Selected Walls' },
]

const PATTERN_CORNER_BEHAVIOR_OPTIONS: Array<{ value: HostedPatternCornerBehavior; label: string }> = [
  { value: 'continuous', label: 'Continuous' },
  { value: 'restart-each-face', label: 'Restart Each Face' },
  { value: 'align-to-corners', label: 'Align To Corners' },
]

type HostedSelectionItem = HostedRoofEntity | HostedParapetEntity | HostedFeatureEntity | HostedProxyEntity | HostedPatternEntity

function getHostedSelectionLabel(entity: HostedSelectionItem): string {
  if (isRoofEntity(entity)) return getRoofTypeLabel(entity.kind)
  if (isParapetEntity(entity)) return 'Parapet'
  if (isFeatureEntity(entity)) return getHostedFeaturePresetLabel(entity.params.preset)
  if (isPatternEntity(entity)) return getHostedPatternContentLabel(entity.params.contentType, entity.params.featurePreset)
  return entity.params.mode === 'cut' ? 'Cut Volume' : 'Volume'
}

function getHostedSelectionCaption(entity: HostedSelectionItem): string {
  if (isRoofEntity(entity)) return 'Hosted roof'
  if (isParapetEntity(entity)) return 'Perimeter wrap'
  if (isPatternEntity(entity)) {
    if (entity.host.faceId === 'top') return 'Hosted pattern · top'
    if (entity.params.wrapMode === 'selected-walls') {
      return `Hosted pattern · selected walls from ${entity.host.faceId}`
    }
    return entity.params.wrapMode === 'all-walls'
      ? `Hosted pattern · wraps from ${entity.host.faceId}`
      : `Hosted pattern · ${entity.host.faceId}`
  }
  if (isFeatureEntity(entity)) return entity.kind === 'side-feature' ? `Wall feature · ${entity.host.faceId}` : 'Top feature'
  return entity.host.faceId === 'top'
    ? (entity.params.mode === 'cut' ? 'Top cut volume' : 'Top volume')
    : `${entity.params.mode === 'cut' ? 'Wall cut volume' : 'Wall volume'} · ${entity.host.faceId}`
}

function getDefaultSideFeatureFaceId(viewMode: string): SideFeatureFaceId {
  switch (viewMode) {
    case 'ortho-back':
      return 'back'
    case 'ortho-left':
      return 'left'
    case 'ortho-right':
      return 'right'
    case 'ortho-front':
    default:
      return 'front'
  }
}

function getPreferredSketchFaceIdForRectHost(viewMode: string): 'top' | SideFeatureFaceId {
  switch (viewMode) {
    case 'ortho-front':
      return 'front'
    case 'ortho-back':
      return 'back'
    case 'ortho-left':
      return 'left'
    case 'ortho-right':
      return 'right'
    default:
      return 'top'
  }
}

function getRoofKindOptionsForHostShape(shape: BaseMassEntity['params']['shape'] | null): Array<{ value: HostedRoofEntity['kind']; label: string }> {
  switch (shape) {
    case 'rect':
      return ROOF_KIND_OPTIONS.filter((option) => (
        option.value === 'flat-roof'
        || option.value === 'shed-roof'
        || option.value === 'gable-roof'
        || option.value === 'hip-roof'
      ))
    case 'circle':
      return ROOF_KIND_OPTIONS.filter((option) => (
        option.value === 'flat-roof'
        || option.value === 'cone-roof'
        || option.value === 'dome-roof'
      ))
    case 'ring':
      return ROOF_KIND_OPTIONS.filter((option) => (
        option.value === 'flat-roof'
        || option.value === 'cone-roof'
        || option.value === 'dome-roof'
      ))
    case 'polygon':
    default:
      return ROOF_KIND_OPTIONS.filter((option) => option.value === 'flat-roof')
  }
}

function getProxyFaceOptionsForHostShape(shape: BaseMassEntity['params']['shape'] | null): Array<{ value: 'top' | SideFeatureFaceId; label: string }> {
  return shape === 'rect'
    ? PROXY_FACE_OPTIONS
    : PROXY_FACE_OPTIONS.filter((option) => option.value === 'top')
}

function getPatternFaceOptionsForHostShape(shape: BaseMassEntity['params']['shape'] | null): Array<{ value: 'top' | SideFeatureFaceId; label: string }> {
  return getProxyFaceOptionsForHostShape(shape)
}

function getPatternPresetOptionsForFace(faceId: 'top' | SideFeatureFaceId): Array<{ value: HostedFeaturePreset; label: string }> {
  return faceId === 'top' ? TOP_FEATURE_PRESET_OPTIONS : SIDE_FEATURE_PRESET_OPTIONS
}

function getDefaultPatternFeaturePresetForFace(faceId: 'top' | SideFeatureFaceId): HostedFeaturePreset {
  return faceId === 'top' ? 'top-box' : 'balcony'
}

function sanitizePatternFeaturePresetForFace(
  faceId: 'top' | SideFeatureFaceId,
  preset: HostedFeaturePreset | undefined,
): HostedFeaturePreset {
  const options = getPatternPresetOptionsForFace(faceId).map((option) => option.value)
  if (preset && options.includes(preset)) return preset
  return getDefaultPatternFeaturePresetForFace(faceId)
}

function getHostedPatternDefaultAnalysis(
  contentType: HostedPatternContentType,
  featurePreset: HostedFeaturePreset,
) {
  if (contentType === 'feature') return getHostedFeatureDefaultAnalysis(featurePreset)
  if (contentType === 'cut-volume') {
    return {
      blocksScaffold: false,
      supportsScaffold: false,
      countsAsRoof: false,
      countsAsPerimeter: false,
    }
  }
  return {
    blocksScaffold: true,
    supportsScaffold: false,
    countsAsRoof: false,
    countsAsPerimeter: false,
  }
}

function getHostedPatternDefaultColor(
  contentType: HostedPatternContentType,
  hostColor: string,
) {
  if (contentType === 'feature') return hostColor
  return contentType === 'cut-volume' ? getProxyDefaultColor('cut') : getProxyDefaultColor('add')
}

function getHostedPatternDefaultDimensions(
  contentType: HostedPatternContentType,
  faceId: 'top' | SideFeatureFaceId,
  featurePreset: HostedFeaturePreset,
) {
  const widthFt = faceId === 'top' ? 10 : 8
  if (contentType === 'feature') {
    return {
      widthFt,
      depthFt: getHostedFeatureDefaultDepthFt(featurePreset),
      heightFt: getHostedFeatureDefaultHeightFt(featurePreset),
    }
  }

  const proxyMode = contentType === 'cut-volume' ? 'cut' : 'add'
  return {
    widthFt,
    depthFt: getProxyDefaultDepthFt(proxyMode),
    heightFt: getProxyDefaultHeightFt(proxyMode),
  }
}

function remapHostedPatternInstanceState(params: {
  previousInstances: ResolvedHostedPatternInstance[]
  nextInstances: ResolvedHostedPatternInstance[]
  previousOverrides: HostedPatternEntity['instanceOverrides']
  previousSkippedInstanceIds: string[]
  selectedInstanceId?: string | null
}) {
  const {
    previousInstances,
    nextInstances,
    previousOverrides,
    previousSkippedInstanceIds,
    selectedInstanceId,
  } = params

  const previousById = new Map(previousInstances.map((instance) => [instance.instanceId, instance] as const))
  const availableNextIds = new Set(nextInstances.map((instance) => instance.instanceId))
  const usedNextIds = new Set<string>()
  const remapCache = new Map<string, string | null>()

  const resolveNearestNextId = (instanceId: string) => {
    if (remapCache.has(instanceId)) return remapCache.get(instanceId) ?? null
    const previous = previousById.get(instanceId)
    if (!previous) {
      remapCache.set(instanceId, null)
      return null
    }

    let bestId: string | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const candidate of nextInstances) {
      if (usedNextIds.has(candidate.instanceId)) continue
      const facePenalty = candidate.faceId === previous.faceId ? 0 : 1000
      const score = facePenalty
        + Math.abs(candidate.globalCenterUFt - previous.globalCenterUFt) * 10
        + Math.abs(candidate.offsetVFt - previous.offsetVFt) * 10
        + Math.abs(candidate.widthFt - previous.widthFt)
        + Math.abs(candidate.depthFt - previous.depthFt)
        + Math.abs(candidate.heightFt - previous.heightFt)
      if (score < bestScore) {
        bestScore = score
        bestId = candidate.instanceId
      }
    }

    if (bestId) usedNextIds.add(bestId)
    remapCache.set(instanceId, bestId)
    return bestId
  }

  const nextOverrides: HostedPatternEntity['instanceOverrides'] = {}
  for (const [instanceId, override] of Object.entries(previousOverrides)) {
    const remappedId = resolveNearestNextId(instanceId)
    if (remappedId && !nextOverrides[remappedId]) {
      nextOverrides[remappedId] = override
    } else {
      nextOverrides[instanceId] = override
    }
  }

  const nextSkippedInstanceIds = Array.from(new Set(
    previousSkippedInstanceIds.map((instanceId) => resolveNearestNextId(instanceId) ?? instanceId),
  ))

  const remappedSelectedInstanceId = selectedInstanceId
    ? resolveNearestNextId(selectedInstanceId)
    : null

  return {
    instanceOverrides: nextOverrides,
    skippedInstanceIds: nextSkippedInstanceIds,
    selectedInstanceId: remappedSelectedInstanceId,
    orphanedOverrideIds: Object.keys(nextOverrides).filter((instanceId) => !availableNextIds.has(instanceId)),
  }
}

type HostedFaceInfo = NonNullable<ReturnType<typeof getBaseMassFaceInfo>>

function clampToRange(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function resolveHostedAnchorPoint(faceInfo: HostedFaceInfo, offsetU: number, offsetV: number) {
  return {
    x: faceInfo.center.x + faceInfo.axisU.x * offsetU + faceInfo.axisV.x * offsetV,
    y: faceInfo.center.y + faceInfo.axisU.y * offsetU + faceInfo.axisV.y * offsetV,
    z: faceInfo.center.z + faceInfo.axisU.z * offsetU + faceInfo.axisV.z * offsetV,
  }
}

function projectHostedOffsets(faceInfo: HostedFaceInfo, worldPoint: { x: number; y: number; z: number }) {
  const offset = {
    x: worldPoint.x - faceInfo.center.x,
    y: worldPoint.y - faceInfo.center.y,
    z: worldPoint.z - faceInfo.center.z,
  }
  return {
    offsetUFt: offset.x * faceInfo.axisU.x + offset.y * faceInfo.axisU.y + offset.z * faceInfo.axisU.z,
    offsetVFt: offset.x * faceInfo.axisV.x + offset.y * faceInfo.axisV.y + offset.z * faceInfo.axisV.z,
  }
}

function clampHostedOffsetsToFace(
  faceInfo: HostedFaceInfo,
  widthFt: number,
  planeSpanVFt: number,
  offsets: { offsetUFt: number; offsetVFt: number },
) {
  const halfWidth = Math.max(0.05, widthFt / 2)
  const halfSpanV = Math.max(0.05, planeSpanVFt / 2)
  return {
    offsetUFt: clampToRange(offsets.offsetUFt, -faceInfo.spanU / 2 + halfWidth, faceInfo.spanU / 2 - halfWidth),
    offsetVFt: clampToRange(offsets.offsetVFt, -faceInfo.spanV / 2 + halfSpanV, faceInfo.spanV / 2 - halfSpanV),
  }
}

function clampTopHostedOffsetsToHost(
  host: BaseMassEntity,
  widthFt: number,
  depthFt: number,
  offsets: { offsetUFt: number; offsetVFt: number },
) {
  if (isTopHostedBoxWithinHost(host, offsets.offsetUFt, offsets.offsetVFt, widthFt, depthFt)) {
    return offsets
  }
  if (isTopHostedBoxWithinHost(host, 0, 0, widthFt, depthFt)) {
    return { offsetUFt: 0, offsetVFt: 0 }
  }
  return offsets
}

function formatBlockBraceDirection(value: BlockBraceDirection | undefined): string {
	if (value === 'slash') return '/'
	if (value === 'backslash') return '\\'
	return 'Off'
}

function isRoundAutoGeneratedScaffoldBlock(
	block: ScaffoldBlockInstance | null | undefined,
): block is ScaffoldBlockInstance & {
	autoGeneratedTargetShape: 'circle' | 'ring'
	autoGeneratedRoundInnerLedgerFt: number
	autoGeneratedRoundOuterLedgerFt: number
	autoGeneratedRoundBayIndex: number
	autoGeneratedRoundBayCount: number
	autoGeneratedRoundClosure: boolean
} {
	return Boolean(
		block
		&& block.autoGeneratedMode === 'around-building'
		&& (block.autoGeneratedTargetShape === 'circle' || block.autoGeneratedTargetShape === 'ring')
		&& Number.isFinite(block.autoGeneratedRoundInnerLedgerFt)
		&& Number.isFinite(block.autoGeneratedRoundOuterLedgerFt)
		&& Number.isFinite(block.autoGeneratedRoundBayIndex)
		&& Number.isFinite(block.autoGeneratedRoundBayCount),
	)
}

function formatFeetCompact(value: number | null | undefined): string {
	if (!Number.isFinite(Number(value))) return '—'
	const numeric = Number(value)
	const roundedInteger = Math.round(numeric)
	if (Math.abs(numeric - roundedInteger) < 1e-6) return `${roundedInteger} ft`
	const roundedTenth = Math.round(numeric * 10) / 10
	if (Math.abs(roundedTenth - roundedInteger) < 1e-6) return `${roundedInteger} ft`
	return `${roundedTenth.toFixed(1)} ft`
}

function getRoundAutoBayDiagonalSpanFt(
	block: Pick<
		ScaffoldBlockInstance,
		'depthFt' | 'autoGeneratedRoundInnerLedgerFt' | 'autoGeneratedRoundOuterLedgerFt'
	>,
	braceGroup: 'frontBack' | 'leftRight',
	faceSign: 1 | -1,
): number | null {
	const innerLedgerFt = Number(block.autoGeneratedRoundInnerLedgerFt)
	const outerLedgerFt = Number(block.autoGeneratedRoundOuterLedgerFt)
	if (!Number.isFinite(innerLedgerFt) || !Number.isFinite(outerLedgerFt)) return null
	if (braceGroup === 'frontBack') return faceSign === 1 ? innerLedgerFt : outerLedgerFt
	const halfDeltaFt = Math.abs(outerLedgerFt - innerLedgerFt) / 2
	return Math.hypot(Math.max(0.1, Number(block.depthFt) || 0.1), halfDeltaFt)
}

function parseDiagonalSelectionId(selectedObjectId: string | null): {
	diagonalId: string
	blockId: string
	braceGroup: 'frontBack' | 'leftRight'
	faceSign: 1 | -1
} | null {
	if (!selectedObjectId?.startsWith('diagonal-')) return null
	const diagonalId = selectedObjectId.slice('diagonal-'.length)
	const markerIndex = diagonalId.indexOf('@brace-')
	if (markerIndex <= 0) return null
	const blockId = diagonalId.slice(0, markerIndex)
	const suffix = diagonalId.slice(markerIndex + '@brace-'.length)
	const parts = suffix.split(':')
	if (parts.length < 2) return null
	const faceSign = Number(parts[1]) === -1 ? -1 : Number(parts[1]) === 1 ? 1 : null
	if (faceSign === null) return null
	if (parts[0] === 'fb') return { diagonalId, blockId, braceGroup: 'frontBack', faceSign }
	if (parts[0] === 'lr') return { diagonalId, blockId, braceGroup: 'leftRight', faceSign }
	return null
}

function stepFromPrecision(precision: number) {
  if (precision <= 0) return 1
  return Number(`0.${'0'.repeat(Math.max(0, precision - 1))}1`)
}

type BlockWorldRect = {
	id: string
	xMin: number
	xMax: number
	yMin: number
	yMax: number
}

type LiveLoadLevelEntry = {
	blockId: string
	liftIndex: number
	bayKeys: string[]
	totalBayCount: number
	activeBayCount: number
	isEnabled: boolean
}

type LiveLoadLevelSummary = {
	levelNumber: number
	label: string
	title: string
	detail: string
	sectionCount: number
	activeSectionCount: number
	isActive: boolean
	isPartial: boolean
	entries: LiveLoadLevelEntry[]
}

function getBlockWorldRect(block: Pick<ScaffoldBlockInstance, 'id' | 'center' | 'widthFt' | 'depthFt' | 'rotationSteps'>): BlockWorldRect {
	const rr = (((block.rotationSteps ?? 0) % 4) + 4) % 4
	const rotIsOdd = rr % 2 === 1
	const worldWidthFt = rotIsOdd ? block.depthFt : block.widthFt
	const worldDepthFt = rotIsOdd ? block.widthFt : block.depthFt
	return {
		id: block.id,
		xMin: block.center.x - worldWidthFt / 2,
		xMax: block.center.x + worldWidthFt / 2,
		yMin: block.center.y - worldDepthFt / 2,
		yMax: block.center.y + worldDepthFt / 2,
	}
}

function buildConnectedBlockTranslations(
	blocks: ScaffoldBlockInstance[],
	rootBlockId: string,
	rootOldRect: BlockWorldRect,
	rootNewRect: BlockWorldRect,
): Array<{ blockId: string; dx: number; dy: number }> {
	const tol = 0.05
	const byId = new Map(blocks.map((block) => [block.id, block]))
	const moveMap = new Map<string, { dx: number; dy: number }>()
	const blockedIds = new Set<string>()
	const queue: Array<{ blockId: string; oldRect: BlockWorldRect; newRect: BlockWorldRect }> = [{
		blockId: rootBlockId,
		oldRect: rootOldRect,
		newRect: rootNewRect,
	}]
	const hasSignificantMove = (dx: number, dy: number) => Math.abs(dx) > tol || Math.abs(dy) > tol
	const sameMove = (a: { dx: number; dy: number }, b: { dx: number; dy: number }) => (
		Math.abs(a.dx - b.dx) < tol && Math.abs(a.dy - b.dy) < tol
	)
	const getCorners = (rect: BlockWorldRect) => [
		{ x: rect.xMin, y: rect.yMin },
		{ x: rect.xMin, y: rect.yMax },
		{ x: rect.xMax, y: rect.yMin },
		{ x: rect.xMax, y: rect.yMax },
	]
	const assignMove = (blockId: string, dx: number, dy: number) => {
		if (!hasSignificantMove(dx, dy) || blockedIds.has(blockId)) return false
		const next = { dx, dy }
		const existing = moveMap.get(blockId)
		if (!existing) {
			moveMap.set(blockId, next)
			const block = byId.get(blockId)
			if (block) {
				const oldRect = getBlockWorldRect(block)
				queue.push({
					blockId,
					oldRect,
					newRect: {
						...oldRect,
						xMin: oldRect.xMin + dx,
						xMax: oldRect.xMax + dx,
						yMin: oldRect.yMin + dy,
						yMax: oldRect.yMax + dy,
					},
				})
			}
			return true
		}
		if (!sameMove(existing, next)) {
			moveMap.delete(blockId)
			blockedIds.add(blockId)
			return false
		}
		return false
	}

	const collectMoveFromRelationship = (sourceOldRect: BlockWorldRect, sourceNewRect: BlockWorldRect, otherRect: BlockWorldRect) => {
		const yOverlap = sourceOldRect.yMin < otherRect.yMax - tol && sourceOldRect.yMax > otherRect.yMin + tol
		const xOverlap = sourceOldRect.xMin < otherRect.xMax - tol && sourceOldRect.xMax > otherRect.xMin + tol
		let dx: number | null = null
		let dy: number | null = null
		let conflict = false
		const applyDx = (value: number) => {
			if (Math.abs(value) < tol) return
			if (dx === null) {
				dx = value
				return
			}
			if (Math.abs(dx - value) >= tol) conflict = true
		}
		const applyDy = (value: number) => {
			if (Math.abs(value) < tol) return
			if (dy === null) {
				dy = value
				return
			}
			if (Math.abs(dy - value) >= tol) conflict = true
		}

		if (yOverlap && Math.abs(sourceOldRect.xMax - otherRect.xMin) < tol) applyDx(sourceNewRect.xMax - sourceOldRect.xMax)
		if (yOverlap && Math.abs(sourceOldRect.xMin - otherRect.xMax) < tol) applyDx(sourceNewRect.xMin - sourceOldRect.xMin)
		if (xOverlap && Math.abs(sourceOldRect.yMax - otherRect.yMin) < tol) applyDy(sourceNewRect.yMax - sourceOldRect.yMax)
		if (xOverlap && Math.abs(sourceOldRect.yMin - otherRect.yMax) < tol) applyDy(sourceNewRect.yMin - sourceOldRect.yMin)

		const oldCorners = getCorners(sourceOldRect)
		const newCorners = getCorners(sourceNewRect)
		const otherCorners = getCorners(otherRect)
		for (let i = 0; i < oldCorners.length; i++) {
			const oldCorner = oldCorners[i]!
			const nextCorner = newCorners[i]!
			const sharedCorner = otherCorners.some((corner) => (
				Math.abs(corner.x - oldCorner.x) < tol && Math.abs(corner.y - oldCorner.y) < tol
			))
			if (!sharedCorner) continue
			applyDx(nextCorner.x - oldCorner.x)
			applyDy(nextCorner.y - oldCorner.y)
		}

		if (conflict || !hasSignificantMove(dx ?? 0, dy ?? 0)) return null
		return { dx: dx ?? 0, dy: dy ?? 0 }
	}

	while (queue.length > 0) {
		const current = queue.shift()!
		for (const other of blocks) {
			if (other.id === current.blockId || blockedIds.has(other.id)) continue
			if (current.blockId !== rootBlockId && other.id === rootBlockId) continue
			const move = collectMoveFromRelationship(current.oldRect, current.newRect, getBlockWorldRect(other))
			if (!move) continue
			assignMove(other.id, move.dx, move.dy)
		}
	}

	return Array.from(moveMap.entries()).map(([blockId, delta]) => ({
		blockId,
		dx: delta.dx,
		dy: delta.dy,
	}))
}

/** Type guard to check if an object is a SceneObject (building) */
function isSceneObject(obj: SceneObject | ScaffoldObject): obj is SceneObject {
  return 'type' in obj && 'workspace' in obj && 'dimensions' in obj
}

/** Type guard to check if an object is a ScaffoldObject */
function isScaffoldObject(obj: SceneObject | ScaffoldObject): obj is ScaffoldObject {
  return 'componentType' in obj && 'displayName' in obj
}

function getBaseMassHeightFt(entity: BaseMassEntity): number {
  return entity.params.heightFt
}

function getBaseMassWidthFt(entity: BaseMassEntity): number {
  if (entity.params.shape === 'rect') return entity.params.widthFt
  return 0
}

function getBaseMassDepthFt(entity: BaseMassEntity): number {
  if (entity.params.shape === 'rect') return entity.params.depthFt
  return 0
}

function getBaseMassRadiusFt(entity: BaseMassEntity): number {
  if (entity.params.shape === 'circle' || entity.params.shape === 'ring') return entity.params.radiusFt
  return 0
}

function getBaseMassInnerRadiusFt(entity: BaseMassEntity): number {
  if (entity.params.shape === 'ring') return entity.params.innerRadiusFt
  return 0
}

/**
 * Properties panel for the currently selected object.
 * Editing dimensions updates the object instantly and keeps its centroid fixed.
 * Supports both SceneObject (buildings) and ScaffoldObject (scaffold components).
 */
export function PropertiesPanel() {
  const { settings } = useSettings()
  const { baseSettings } = useScaffoldBaseSettings()
  const { categoryKey } = useCatalogSelection()
  const {
    activeTool,
    blockToolSettings,
    updateBlockToolSettings,
			blockPlacementWarning,
			blockEditMode,
			setBlockEditMode,
			blockEditActionMode,
			setBlockEditActionMode,
			scaffoldBlocks,
			selectedBlockId,
			selectedBlockIds,
			clearBlockSelection,
			applyScaffoldBlockEdits,
			updateScaffoldBlockLiveLoad,
			isEditingBlock,
			setIsEditingBlock,
    addBuildingEntity,
    beginBuildingHostedSketch,
    buildingHostedSketchIntent,
    clearBuildingHostedSketch,
    setActiveTool,
    updateObject,
     buildingEntities,
     selectedBuildingEntityId,
     setSelectedBuildingEntityId,
     selectedHostedPatternInstance,
     setSelectedHostedPatternInstance,
     buildingHostedPatternPreview,
     setBuildingHostedPatternPreview,
     updateBuildingEntity,
     removeBuildingEntity,
     viewMode,
     objects,
     getSelectedObject,
     workspaceMode,
    selectedObjectId,
    setSelectedObjectId,
    scaffoldStacks,
    ledgerConnections,
    manualLiveLoadPlacements,
    liveLoadPlacementPsf,
    setLiveLoadPlacementPsf,
    activeLiveLoadLevelNumber,
    setActiveLiveLoadLevelNumber,
    setHoveredLiveLoadDeckTargets,
    selectedLiveLoadDeckTargets,
    setSelectedLiveLoadDeckTargets,
    selectedStackIds,
    getSelectedStacks,
    updateScaffoldStack,
    updateManualLiveLoadPlacement,
		requestAutoScaffoldAroundBuilding,
  } = useTool()

	const selectedBlock = useMemo(() => {
			if (!selectedBlockId) return null
			return scaffoldBlocks.find(b => b.id === selectedBlockId) ?? null
		}, [scaffoldBlocks, selectedBlockId])
	const selectedRoundAutoBlock = useMemo(
		() => (isRoundAutoGeneratedScaffoldBlock(selectedBlock) ? selectedBlock : null),
		[selectedBlock],
	)
	const canEditSelectedBlock = Boolean(selectedBlock && !selectedRoundAutoBlock)
	const resolvedBuildingGeometry = useMemo(
		() => resolveScaffoldBuildingGeometry({ buildingEntities, objects }),
		[buildingEntities, objects],
	)
	const autoScaffoldTargets = resolvedBuildingGeometry.autoScaffoldTargets
	const [autoScaffoldModalOpen, setAutoScaffoldModalOpen] = useState(false)
	const [autoScaffoldDraft, setAutoScaffoldDraft] = useState({
		depthFt: String(blockToolSettings.depthFt),
		heightFt: String(blockToolSettings.heightFt),
		plankedLevelsCount: String(blockToolSettings.plankedLevelsCount ?? 1),
		buildingOffsetFt: String(blockToolSettings.buildingOffsetFt),
		braceFrontBack: blockToolSettings.braceFrontBack ?? 'off',
		braceLeftRight: blockToolSettings.braceLeftRight ?? 'off',
		roundBayFamily: '6x8',
	})
	const openAutoScaffoldModal = useCallback(() => {
		setAutoScaffoldDraft({
			depthFt: String(blockToolSettings.depthFt),
			heightFt: String(blockToolSettings.heightFt),
			plankedLevelsCount: String(blockToolSettings.plankedLevelsCount ?? 1),
			buildingOffsetFt: String(blockToolSettings.buildingOffsetFt),
			braceFrontBack: blockToolSettings.braceFrontBack ?? 'off',
			braceLeftRight: blockToolSettings.braceLeftRight ?? 'off',
			roundBayFamily: '6x8',
		})
		setAutoScaffoldModalOpen(true)
	}, [
		blockToolSettings.braceFrontBack,
		blockToolSettings.braceLeftRight,
		blockToolSettings.buildingOffsetFt,
		blockToolSettings.depthFt,
		blockToolSettings.heightFt,
		blockToolSettings.plankedLevelsCount,
	])
	useEffect(() => {
		if (!autoScaffoldModalOpen) return
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			event.preventDefault()
			event.stopPropagation()
			setAutoScaffoldModalOpen(false)
		}
		window.addEventListener('keydown', onKeyDown, true)
		return () => window.removeEventListener('keydown', onKeyDown, true)
	}, [autoScaffoldModalOpen])
	const scaffoldBlockById = useMemo(
		() => new Map(scaffoldBlocks.map(block => [block.id, block] as const)),
		[scaffoldBlocks],
	)
	const liveLoadLevels = useMemo<LiveLoadLevelSummary[]>(() => {
		const byLevel = new Map<number, LiveLoadLevelEntry[]>()

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
			if (sortedLiftIndices.length === 0) continue

			const layoutX = chooseBayLayout(block.widthFt)
			const layoutY = chooseBayLayout(block.depthFt)
			const totalBayCount = layoutX.bays * layoutY.bays
			const enabledLiftSet = new Set(
				(block.liveLoadDeckLiftIndices ?? [])
					.map(value => Math.round(Number(value)))
					.filter(value => Number.isFinite(value)),
			)
			const excludedBayKeySet = new Set(
				(block.liveLoadExcludedBayKeys ?? []).map(value => String(value)),
			)

			sortedLiftIndices.forEach((liftIndex, index) => {
				const bayKeys: string[] = []
				let excludedBayCount = 0
				for (let bayY = 0; bayY < layoutY.bays; bayY++) {
					for (let bayX = 0; bayX < layoutX.bays; bayX++) {
						const bayKey = makeBlockLiveLoadBayKey(liftIndex, bayX, bayY)
						bayKeys.push(bayKey)
						if (excludedBayKeySet.has(bayKey)) excludedBayCount += 1
					}
				}

				const levelNumber = index + 1
				const entries = byLevel.get(levelNumber)
				const nextEntry: LiveLoadLevelEntry = {
					blockId: block.id,
					liftIndex,
					bayKeys,
					totalBayCount,
					activeBayCount: enabledLiftSet.has(liftIndex) ? Math.max(0, totalBayCount - excludedBayCount) : 0,
					isEnabled: enabledLiftSet.has(liftIndex),
				}
				if (entries) entries.push(nextEntry)
				else byLevel.set(levelNumber, [nextEntry])
			})
		}

		return Array.from(byLevel.entries())
			.sort((a, b) => a[0] - b[0])
			.map(([levelNumber, entries]) => {
				const sectionCount = entries.length
				const activeSectionCount = entries.filter(entry => entry.activeBayCount > 0).length
				const allActive = sectionCount > 0 && entries.every(entry => entry.activeBayCount > 0)
				const anyActive = entries.some(entry => entry.activeBayCount > 0)
				const title = levelNumber === 1 ? 'Top working deck' : `Working deck ${levelNumber}`
				return {
					levelNumber,
					label: `Level ${levelNumber}`,
					title,
					detail: `${title} · ${activeSectionCount}/${sectionCount} sections active`,
					sectionCount,
					activeSectionCount,
					isActive: allActive,
					isPartial: anyActive && !allActive,
					entries,
				}
			})
	}, [scaffoldBlocks])
	const getHoverTargetsForLiveLoadLevel = useCallback((level: LiveLoadLevelSummary) => {
		const targets: Array<{ blockId: string; liftIndex: number; bayKey?: string }> = []
		for (const entry of level.entries) {
			if (!entry.isEnabled || entry.activeBayCount <= 0) continue
			const block = scaffoldBlockById.get(entry.blockId)
			if (!block) continue
			const excludedBayKeySet = new Set((block.liveLoadExcludedBayKeys ?? []).map((value) => String(value)))
			for (const bayKey of entry.bayKeys) {
				if (excludedBayKeySet.has(String(bayKey))) continue
				targets.push({ blockId: entry.blockId, liftIndex: entry.liftIndex, bayKey })
			}
		}
		return targets
	}, [scaffoldBlockById])

	useEffect(() => {
		if (categoryKey !== 'liveLoads') return
		if (liveLoadLevels.length === 0) {
			if (activeLiveLoadLevelNumber !== null) setActiveLiveLoadLevelNumber(null)
			return
		}
		if (activeLiveLoadLevelNumber !== null && liveLoadLevels.some((level) => level.levelNumber === activeLiveLoadLevelNumber)) return
		setActiveLiveLoadLevelNumber(liveLoadLevels[0]!.levelNumber)
	}, [activeLiveLoadLevelNumber, categoryKey, liveLoadLevels, setActiveLiveLoadLevelNumber])

	const selectedLiveLoadSectionState = useMemo(() => {
		if (selectedLiveLoadDeckTargets.length === 0) return null
		const entries = selectedLiveLoadDeckTargets
			.map((target) => {
				const level = liveLoadLevels.find((candidateLevel) => candidateLevel.entries.some((entry) => (
					entry.blockId === target.blockId && entry.liftIndex === target.liftIndex
				))) ?? null
				if (!level) return null
				const entry = level.entries.find((candidateEntry) => (
					candidateEntry.blockId === target.blockId && candidateEntry.liftIndex === target.liftIndex
				))
				if (!entry) return null
				const block = scaffoldBlockById.get(entry.blockId)
				if (!block) return null
				const layoutX = chooseBayLayout(block.widthFt)
				const layoutY = chooseBayLayout(block.depthFt)
				const focusedBayKeys = target.bayKey ? [target.bayKey] : entry.bayKeys
				const excludedBayKeySet = new Set((block.liveLoadExcludedBayKeys ?? []).map((value) => String(value)))
				const activeFocusedBayCount = focusedBayKeys.filter((bayKey) => !excludedBayKeySet.has(String(bayKey))).length
				let dimensionSummary = `${block.widthFt.toFixed(1)}' x ${block.depthFt.toFixed(1)}' x ${block.heightFt.toFixed(1)}'`
				if (target.bayKey) {
					const [rawLift, rawBayX, rawBayY] = target.bayKey.split(':')
					const bayLiftIndex = Math.round(Number(rawLift))
					const bayX = Math.round(Number(rawBayX))
					const bayY = Math.round(Number(rawBayY))
					if (
						Number.isFinite(bayLiftIndex)
						&& bayLiftIndex === entry.liftIndex
						&& Number.isFinite(bayX)
						&& Number.isFinite(bayY)
						&& bayX >= 0
						&& bayX < layoutX.bays
						&& bayY >= 0
						&& bayY < layoutY.bays
					) {
						dimensionSummary = `${layoutX.spacingFt.toFixed(1)}' x ${layoutY.spacingFt.toFixed(1)}' section`
					}
				}
				return {
					target,
					block,
					entry,
					level,
					focusedBayKeys,
					isExcluded: entry.isEnabled && activeFocusedBayCount === 0,
					isIncluded: entry.isEnabled && activeFocusedBayCount > 0,
					dimensionSummary,
				}
			})
			.filter(Boolean) as Array<{
				target: { blockId: string; liftIndex: number; bayKey?: string }
				block: ScaffoldBlockInstance
				entry: LiveLoadLevelEntry
				level: LiveLoadLevelSummary
				focusedBayKeys: string[]
				isExcluded: boolean
				isIncluded: boolean
				dimensionSummary: string
			}>
		if (entries.length === 0) return null
		const includedCount = entries.filter((entry) => entry.isIncluded).length
		const excludedCount = entries.filter((entry) => entry.isExcluded).length
		const levelLabels = Array.from(new Set(entries.map((entry) => entry.level.label)))
		if (entries.length === 1) {
			return {
				mode: 'single' as const,
				...entries[0],
				entries,
			}
		}
		return {
			mode: 'multi' as const,
			entries,
			isIncluded: includedCount === entries.length,
			isExcluded: excludedCount === entries.length,
			isMixed: includedCount > 0 && excludedCount > 0,
			title: `${entries.length} focused sections`,
			detail: `${levelLabels.join(', ')} · ${includedCount} included / ${excludedCount} excluded`,
		}
	}, [liveLoadLevels, scaffoldBlockById, selectedLiveLoadDeckTargets])
	const selectedLiveLoadSectionCardTitle = useMemo(() => {
		if (!selectedLiveLoadSectionState) return ''
		if (selectedLiveLoadSectionState.mode === 'multi') return selectedLiveLoadSectionState.title
		return `${selectedLiveLoadSectionState.level.label} · ${selectedLiveLoadSectionState.dimensionSummary}`
	}, [selectedLiveLoadSectionState])
	const selectedLiveLoadSectionCardDetail = useMemo(() => {
		if (!selectedLiveLoadSectionState) return ''
		if (selectedLiveLoadSectionState.mode === 'multi') return selectedLiveLoadSectionState.detail
		return selectedLiveLoadSectionState.isExcluded
			? 'This section is excluded from the live load at this level.'
			: 'This section is carrying live load at this level.'
	}, [selectedLiveLoadSectionState])
	const selectedBlockCount = selectedBlockIds.length
	const scaffoldBlocksRef = useRef(scaffoldBlocks)

	useEffect(() => {
		scaffoldBlocksRef.current = scaffoldBlocks
	}, [scaffoldBlocks])

  const selected = useMemo(() => getSelectedObject(), [getSelectedObject])
  const selectedBuildingEntity = useMemo(() => {
    if (!selectedBuildingEntityId) return null
    return buildingEntities.find(candidate => candidate.id === selectedBuildingEntityId) ?? null
  }, [buildingEntities, selectedBuildingEntityId])
  const selectedBaseMassEntity = useMemo(
    () => (selectedBuildingEntity && isBaseMassEntity(selectedBuildingEntity) ? selectedBuildingEntity : null),
    [selectedBuildingEntity],
  )
  const selectedRoofEntity = useMemo(
    () => (selectedBuildingEntity && isRoofEntity(selectedBuildingEntity) ? selectedBuildingEntity : null),
    [selectedBuildingEntity],
  )
  const selectedParapetEntity = useMemo(
    () => (selectedBuildingEntity && isParapetEntity(selectedBuildingEntity) ? selectedBuildingEntity : null),
    [selectedBuildingEntity],
  )
  const selectedFeatureEntity = useMemo(
    () => (selectedBuildingEntity && isFeatureEntity(selectedBuildingEntity) ? selectedBuildingEntity : null),
    [selectedBuildingEntity],
  )
  const selectedProxyEntity = useMemo(
    () => (selectedBuildingEntity && isProxyEntity(selectedBuildingEntity) ? selectedBuildingEntity : null),
    [selectedBuildingEntity],
  )
  const selectedPatternEntity = useMemo(
    () => (selectedBuildingEntity && isPatternEntity(selectedBuildingEntity) ? selectedBuildingEntity : null),
    [selectedBuildingEntity],
  )
  const selectedRoofHost = useMemo(() => {
    if (!selectedRoofEntity) return null
    const host = buildingEntities.find(candidate => candidate.id === selectedRoofEntity.host.entityId) ?? null
    return host && (isBaseMassEntity(host) || isHostedRectEntity(host)) ? host : null
  }, [buildingEntities, selectedRoofEntity])
  const selectedParapetHost = useMemo(() => {
    if (!selectedParapetEntity) return null
    const host = buildingEntities.find(candidate => candidate.id === selectedParapetEntity.host.entityId) ?? null
    return host && isBaseMassEntity(host) ? host : null
  }, [buildingEntities, selectedParapetEntity])
  const selectedParapetEdgeOptions = useMemo(
    () => (selectedParapetHost ? getParapetEdgeOptionsForHost(selectedParapetHost) : []),
    [selectedParapetHost],
  )
  const selectedParapetEdgeIds = useMemo(
    () => (
      selectedParapetHost && selectedParapetEntity
        ? getResolvedParapetEdgeIdsForHost(selectedParapetHost, selectedParapetEntity.params.edgeIds)
        : []
    ),
    [selectedParapetEntity, selectedParapetHost],
  )
  const selectedRoofHostShape = useMemo(
    () => (selectedRoofHost ? (isBaseMassEntity(selectedRoofHost) ? selectedRoofHost.params.shape : 'rect') : null),
    [selectedRoofHost],
  )
  const selectedMassRoof = useMemo(() => {
    if (!selectedBaseMassEntity) return null
    const roof = buildingEntities.find((candidate) => (
      isRoofEntity(candidate) && candidate.host.entityId === selectedBaseMassEntity.id
    )) ?? null
    return roof && isRoofEntity(roof) ? roof : null
  }, [buildingEntities, selectedBaseMassEntity])
  const selectedMassParapet = useMemo(() => {
    if (!selectedBaseMassEntity) return null
    const parapet = buildingEntities.find((candidate) => (
      isParapetEntity(candidate) && candidate.host.entityId === selectedBaseMassEntity.id
    )) ?? null
    return parapet && isParapetEntity(parapet) ? parapet : null
  }, [buildingEntities, selectedBaseMassEntity])
  const selectedMassHostedGroups = useMemo(() => {
    if (!selectedBaseMassEntity) return []

    const hostedItems = buildingEntities
      .filter((candidate): candidate is HostedSelectionItem => (
        !isBaseMassEntity(candidate) && candidate.host.entityId === selectedBaseMassEntity.id
      ))
      .sort((a, b) => a.createdAt - b.createdAt)

    return [
      {
        key: 'roofs',
        title: 'Roofs',
        items: hostedItems.filter((candidate): candidate is HostedRoofEntity => isRoofEntity(candidate)),
      },
      {
        key: 'parapets',
        title: 'Parapets',
        items: hostedItems.filter((candidate): candidate is HostedParapetEntity => isParapetEntity(candidate)),
      },
      {
        key: 'top-features',
        title: 'Top Features',
        items: hostedItems.filter((candidate): candidate is HostedFeatureEntity => isFeatureEntity(candidate) && candidate.kind === 'top-feature'),
      },
      {
        key: 'side-features',
        title: 'Side Features',
        items: hostedItems.filter((candidate): candidate is HostedFeatureEntity => isFeatureEntity(candidate) && candidate.kind === 'side-feature'),
      },
      {
        key: 'volumes',
        title: 'Volumes',
        items: hostedItems.filter((candidate): candidate is HostedProxyEntity => isProxyEntity(candidate) && candidate.params.mode === 'add'),
      },
      {
        key: 'cuts',
        title: 'Cut Volumes',
        items: hostedItems.filter((candidate): candidate is HostedProxyEntity => isProxyEntity(candidate) && candidate.params.mode === 'cut'),
      },
      {
        key: 'patterns',
        title: 'Patterns',
        items: hostedItems.filter((candidate): candidate is HostedPatternEntity => isPatternEntity(candidate)),
      },
    ].filter(group => group.items.length > 0)
  }, [buildingEntities, selectedBaseMassEntity])
  const selectedFeatureHost = useMemo(() => {
    if (!selectedFeatureEntity) return null
    const host = buildingEntities.find(candidate => candidate.id === selectedFeatureEntity.host.entityId) ?? null
    return host ?? null
  }, [buildingEntities, selectedFeatureEntity])
  const selectedProxyHost = useMemo(() => {
    if (!selectedProxyEntity) return null
    const host = buildingEntities.find(candidate => candidate.id === selectedProxyEntity.host.entityId) ?? null
    return host ?? null
  }, [buildingEntities, selectedProxyEntity])
  const buildingEntityById = useMemo(
    () => new Map(buildingEntities.map((entity) => [entity.id, entity] as const)),
    [buildingEntities],
  )
  const selectedPatternHost = useMemo(() => {
    if (!selectedPatternEntity) return null
    const host = buildingEntities.find(candidate => candidate.id === selectedPatternEntity.host.entityId) ?? null
    return host && isBaseMassEntity(host) ? host : null
  }, [buildingEntities, selectedPatternEntity])
  const previewPatternEntity = useMemo(() => {
    if (!buildingHostedPatternPreview) return null
    const host = buildingEntities.find((candidate) => candidate.id === buildingHostedPatternPreview.host.entityId) ?? null
    if (!host || !isBaseMassEntity(host)) return null
    return buildingHostedPatternPreview
  }, [buildingEntities, buildingHostedPatternPreview])
  const previewPatternHost = useMemo(() => {
    if (!previewPatternEntity) return null
    const host = buildingEntities.find((candidate) => candidate.id === previewPatternEntity.host.entityId) ?? null
    return host && isBaseMassEntity(host) ? host : null
  }, [buildingEntities, previewPatternEntity])
  const editablePatternEntity = selectedPatternEntity ?? previewPatternEntity
  const editablePatternHost = selectedPatternEntity ? selectedPatternHost : previewPatternHost
  const isPatternPreviewActive = Boolean(!selectedPatternEntity && previewPatternEntity)
  const selectedPatternInstances = useMemo(() => (
    selectedPatternEntity && selectedPatternHost
      ? resolveHostedPatternInstances(selectedPatternEntity, selectedPatternHost)
      : []
  ), [selectedPatternEntity, selectedPatternHost])
  const editablePatternInstances = useMemo(() => (
    editablePatternEntity && editablePatternHost
      ? resolveHostedPatternInstances(editablePatternEntity, editablePatternHost)
      : []
  ), [editablePatternEntity, editablePatternHost])
  const selectedPatternInstanceResolved = useMemo(() => {
    if (!selectedPatternEntity || !selectedHostedPatternInstance || selectedHostedPatternInstance.patternId !== selectedPatternEntity.id) {
      return null
    }
    return selectedPatternInstances.find((instance) => instance.instanceId === selectedHostedPatternInstance.instanceId) ?? null
  }, [selectedHostedPatternInstance, selectedPatternEntity, selectedPatternInstances])
  const selectedPatternInstanceOverride = useMemo(() => (
    selectedPatternEntity && selectedPatternInstanceResolved
      ? selectedPatternEntity.instanceOverrides[selectedPatternInstanceResolved.instanceId] ?? null
      : null
  ), [selectedPatternEntity, selectedPatternInstanceResolved])
  const selectedPatternDetachedEntityId = selectedPatternInstanceOverride?.detachedEntityId ?? null
  const selectedPatternDetachedEntity = useMemo(() => {
    if (!selectedPatternDetachedEntityId) return null
    const entity = buildingEntities.find((candidate) => candidate.id === selectedPatternDetachedEntityId) ?? null
    return entity && (isFeatureEntity(entity) || isProxyEntity(entity)) ? entity : null
  }, [buildingEntities, selectedPatternDetachedEntityId])
  const selectedPatternOverrideItems = useMemo(() => {
    if (!selectedPatternEntity) return []
    const overrideIds = new Set<string>([
      ...selectedPatternEntity.skippedInstanceIds,
      ...Object.keys(selectedPatternEntity.instanceOverrides),
    ])
    return selectedPatternInstances
      .map((instance, index) => ({
        index,
        instance,
        override: selectedPatternEntity.instanceOverrides[instance.instanceId] ?? null,
      }))
      .filter(({ instance, override }) => instance.hidden || Boolean(override) || overrideIds.has(instance.instanceId))
  }, [selectedPatternEntity, selectedPatternInstances])
  const selectedFeatureHostedGroups = useMemo(() => {
    if (!selectedFeatureEntity) return []
    const hostedItems = buildingEntities
      .filter((candidate): candidate is HostedSelectionItem => (
        !isBaseMassEntity(candidate)
        && candidate.host.entityId === selectedFeatureEntity.id
      ))
      .sort((a, b) => a.createdAt - b.createdAt)
    return [
      {
        key: 'roofs',
        title: 'Roofs',
        items: hostedItems.filter((candidate): candidate is HostedRoofEntity => isRoofEntity(candidate)),
      },
      {
        key: 'top-features',
        title: 'Top Features',
        items: hostedItems.filter((candidate): candidate is HostedFeatureEntity => isFeatureEntity(candidate) && candidate.kind === 'top-feature'),
      },
      {
        key: 'volumes',
        title: 'Volumes',
        items: hostedItems.filter((candidate): candidate is HostedProxyEntity => isProxyEntity(candidate) && candidate.params.mode === 'add'),
      },
      {
        key: 'cuts',
        title: 'Cut Volumes',
        items: hostedItems.filter((candidate): candidate is HostedProxyEntity => isProxyEntity(candidate) && candidate.params.mode === 'cut'),
      },
    ].filter(group => group.items.length > 0)
  }, [buildingEntities, selectedFeatureEntity])
  const selectedFeatureRoof = useMemo(() => {
    if (!selectedFeatureEntity) return null
    const roof = buildingEntities.find((candidate) => (
      isRoofEntity(candidate) && candidate.host.entityId === selectedFeatureEntity.id
    )) ?? null
    return roof && isRoofEntity(roof) ? roof : null
  }, [buildingEntities, selectedFeatureEntity])
  const selectedProxyHostedGroups = useMemo(() => {
    if (!selectedProxyEntity) return []
    const hostedItems = buildingEntities
      .filter((candidate): candidate is HostedSelectionItem => (
        !isBaseMassEntity(candidate)
        && candidate.host.entityId === selectedProxyEntity.id
      ))
      .sort((a, b) => a.createdAt - b.createdAt)
    return [
      {
        key: 'roofs',
        title: 'Roofs',
        items: hostedItems.filter((candidate): candidate is HostedRoofEntity => isRoofEntity(candidate)),
      },
      {
        key: 'top-features',
        title: 'Top Features',
        items: hostedItems.filter((candidate): candidate is HostedFeatureEntity => isFeatureEntity(candidate) && candidate.kind === 'top-feature'),
      },
      {
        key: 'volumes',
        title: 'Volumes',
        items: hostedItems.filter((candidate): candidate is HostedProxyEntity => isProxyEntity(candidate) && candidate.params.mode === 'add'),
      },
      {
        key: 'cuts',
        title: 'Cut Volumes',
        items: hostedItems.filter((candidate): candidate is HostedProxyEntity => isProxyEntity(candidate) && candidate.params.mode === 'cut'),
      },
    ].filter(group => group.items.length > 0)
  }, [buildingEntities, selectedProxyEntity])
  const selectedProxyRoof = useMemo(() => {
    if (!selectedProxyEntity) return null
    const roof = buildingEntities.find((candidate) => (
      isRoofEntity(candidate) && candidate.host.entityId === selectedProxyEntity.id
    )) ?? null
    return roof && isRoofEntity(roof) ? roof : null
  }, [buildingEntities, selectedProxyEntity])
  const selectedAutoScaffoldTargetId = useMemo(() => {
    const hasTarget = (id: string | null | undefined) => !!id && autoScaffoldTargets.some((target) => target.id === id)
    if (hasTarget(selectedBaseMassEntity?.id)) return selectedBaseMassEntity!.id
    if (hasTarget(selectedRoofHost?.id)) return selectedRoofHost!.id
    if (hasTarget(selectedParapetHost?.id)) return selectedParapetHost!.id
    if (hasTarget(selectedFeatureHost?.id)) return selectedFeatureHost!.id
    if (hasTarget(selectedProxyHost?.id)) return selectedProxyHost!.id
    if (hasTarget(selectedPatternHost?.id)) return selectedPatternHost!.id
    if (!selectedObjectId) return null
    return hasTarget(selectedObjectId) ? selectedObjectId : null
  }, [
		autoScaffoldTargets,
		selectedBaseMassEntity,
		selectedFeatureHost,
		selectedObjectId,
		selectedParapetHost,
		selectedPatternHost,
		selectedProxyHost,
		selectedRoofHost,
	])
  const selectedAutoScaffoldTarget = useMemo(
    () => autoScaffoldTargets.find((target) => target.id === selectedAutoScaffoldTargetId) ?? (autoScaffoldTargets[0] ?? null),
    [autoScaffoldTargets, selectedAutoScaffoldTargetId],
  )
  const sketchHostId = buildingHostedSketchIntent?.hostEntityId ?? null
  const isSketchingTopFeature = Boolean(
    selectedBaseMassEntity
    && buildingHostedSketchIntent?.target === 'feature'
    && buildingHostedSketchIntent.hostKind === 'top-face'
    && sketchHostId === selectedBaseMassEntity.id,
  )
  const isSketchingSideFeature = Boolean(
    selectedBaseMassEntity
    && buildingHostedSketchIntent?.target === 'feature'
    && buildingHostedSketchIntent.hostKind === 'side-face'
    && sketchHostId === selectedBaseMassEntity.id,
  )
  const isSketchingAddProxy = Boolean(
    selectedBaseMassEntity
    && buildingHostedSketchIntent?.target === 'proxy'
    && buildingHostedSketchIntent.proxyMode === 'add'
    && sketchHostId === selectedBaseMassEntity.id,
  )
  const isSketchingCutProxy = Boolean(
    selectedBaseMassEntity
    && buildingHostedSketchIntent?.target === 'proxy'
    && buildingHostedSketchIntent.proxyMode === 'cut'
    && sketchHostId === selectedBaseMassEntity.id,
  )
  const canAutoScaffoldAroundBuilding = autoScaffoldTargets.length > 0
  const autoScaffoldHint = useMemo(() => {
    if (autoScaffoldTargets.length === 0) return 'Draw a building mass first, then use Auto Around Building.'
    if (selectedAutoScaffoldTargetId) return 'Uses the selected structure perimeter and auto-sizes each scaffold run around it.'
    if (autoScaffoldTargets.length === 1) return 'Uses the only structure in the model and auto-sizes each scaffold run around it.'
    return 'No scaffold target is selected, so Auto Around Building will target the largest structure.'
  }, [autoScaffoldTargets.length, selectedAutoScaffoldTargetId])
  const submitAutoScaffoldModal = useCallback(() => {
    const depthFt = clamp(Number(autoScaffoldDraft.depthFt), 0.1)
    const heightFt = clamp(Number(autoScaffoldDraft.heightFt), 0.1)
    const plankedLevelsCount = clamp(Math.round(Number(autoScaffoldDraft.plankedLevelsCount) || 1), 1, 20)
    const buildingOffsetFt = clamp(Number(autoScaffoldDraft.buildingOffsetFt), 0, 1000)
    requestAutoScaffoldAroundBuilding(selectedAutoScaffoldTargetId, {
      depthFt,
      heightFt,
      plankedLevelsCount,
      includeBaseDeck: !!blockToolSettings.includeBaseDeck,
      braceFrontBack: autoScaffoldDraft.braceFrontBack as BlockBraceDirection,
      braceLeftRight: autoScaffoldDraft.braceLeftRight as BlockBraceDirection,
      buildingOffsetFt,
      preferredBayWidthFt: 7,
      roundBayFamily: (autoScaffoldDraft.roundBayFamily === '6x6' || autoScaffoldDraft.roundBayFamily === '8x8' ? autoScaffoldDraft.roundBayFamily : '6x8'),
    })
    setAutoScaffoldModalOpen(false)
  }, [
    autoScaffoldDraft,
    blockToolSettings.includeBaseDeck,
    requestAutoScaffoldAroundBuilding,
    selectedAutoScaffoldTargetId,
  ])

  // Check if we have a standard selected (either via selectedObjectId or multi-select)
  // Also detect selection of base components (wood-sill, screw-jack, base-collar)
  const selectedStacks = useMemo((): ScaffoldStack[] => {
    // First check multi-select
    if (selectedStackIds.length > 0) {
      return getSelectedStacks()
    }
    // Fall back to single selection via selectedObjectId
    // Check for standard, wood-sill, screw-jack, or base-collar selection
    if (selectedObjectId) {
      let stackId: string | null = null
      if (selectedObjectId.startsWith('standard-')) {
	        const payload = selectedObjectId.slice('standard-'.length)
	        const at = payload.indexOf('@')
	        stackId = at >= 0 ? payload.slice(0, at) : payload
      } else if (selectedObjectId.startsWith('wood-sill-')) {
        stackId = selectedObjectId.replace('wood-sill-', '')
      } else if (selectedObjectId.startsWith('screw-jack-')) {
        stackId = selectedObjectId.replace('screw-jack-', '')
      } else if (selectedObjectId.startsWith('base-collar-')) {
        stackId = selectedObjectId.replace('base-collar-', '')
      }
      if (stackId) {
        const stack = scaffoldStacks.find(s => s.id === stackId)
        return stack ? [stack] : []
      }
    }
    return []
  }, [selectedStackIds, selectedObjectId, scaffoldStacks, getSelectedStacks])

	// If the user clicked a stacked standard *segment* (not the whole stack), capture which piece.
	const selectedStandardSegment = useMemo(() => {
		if (!selectedObjectId?.startsWith('standard-')) return null
		const payload = selectedObjectId.slice('standard-'.length)
		const at = payload.indexOf('@')
		if (at < 0) return null
		const stackId = payload.slice(0, at)
		const idxStr = payload.slice(at + 1)
		const segmentIndex = Number.parseInt(idxStr, 10)
		if (!Number.isFinite(segmentIndex) || segmentIndex < 0) return null
		const stack = scaffoldStacks.find(s => s.id === stackId)
		if (!stack) return null
		const segmentCount = Array.isArray(stack.standardSegments) ? stack.standardSegments.length : 0
		const partNumber = String(stack.standardSegments?.[segmentIndex]?.partNumber ?? '')
		return { stackId, segmentIndex, segmentCount, partNumber: partNumber || null }
	}, [selectedObjectId, scaffoldStacks])

  // Detect if a ledger/truss is selected
  const selectedLedgerConnection = useMemo(() => {
    if (!selectedObjectId?.startsWith('ledger-')) return null
    const connectionId = selectedObjectId.replace('ledger-', '')
    return ledgerConnections.find(c => c.id === connectionId) || null
  }, [selectedObjectId, ledgerConnections])

	const selectedLiveLoad = useMemo(() => {
		if (!selectedObjectId?.startsWith('live-load-')) return null
		const placementId = selectedObjectId.replace('live-load-', '')
		return manualLiveLoadPlacements.find(placement => placement.id === placementId) ?? null
	}, [selectedObjectId, manualLiveLoadPlacements])

	const selectedDiagonal = useMemo(() => {
		const parsed = parseDiagonalSelectionId(selectedObjectId)
		if (!parsed) return null
		const block = scaffoldBlocks.find((candidate) => candidate.id === parsed.blockId)
		if (!block) return null
		const baySpacingFt = isRoundAutoGeneratedScaffoldBlock(block)
			? (getRoundAutoBayDiagonalSpanFt(block, parsed.braceGroup, parsed.faceSign) ?? (
				parsed.braceGroup === 'frontBack'
					? chooseBayLayout(block.widthFt).spacingFt
					: chooseBayLayout(block.depthFt).spacingFt
			))
			: (parsed.braceGroup === 'frontBack'
				? chooseBayLayout(block.widthFt).spacingFt
				: chooseBayLayout(block.depthFt).spacingFt)
		const partNumber = findClosestDiagonal(baySpacingFt * 12) ?? null
		const weightLbs = partNumber
			? UNIVERSAL_RINGLOCK_DIAGONALS[partNumber as keyof typeof UNIVERSAL_RINGLOCK_DIAGONALS]?.weightLbs ?? null
			: null
		return { ...parsed, block, partNumber, weightLbs }
	}, [selectedObjectId, scaffoldBlocks])

  // Detect base component type from selection ID (wood-sill, screw-jack, base-collar)
  const selectedBaseComponentType = useMemo(() => {
    if (!selectedObjectId) return null
    if (selectedObjectId.startsWith('wood-sill-')) return 'wood-sill'
    if (selectedObjectId.startsWith('screw-jack-')) return 'screw-jack'
    if (selectedObjectId.startsWith('base-collar-')) return 'base-collar'
    return null
  }, [selectedObjectId])

	  // Standards are selected via stack selection (multi or single), but base components
	  // also map back to a stack. Treat base-component selection separately.
	  const hasStandardSelected = selectedStacks.length > 0 && !selectedBaseComponentType

  // Get weight for currently selected component
  const selectedWeight = useMemo((): number | null => {
    if (selectedBaseComponentType) {
      if (selectedBaseComponentType === 'wood-sill') return roundDisplayWeightLb(SCAFFOLD_WEIGHTS['wood-sill-9x9']) ?? null
      return roundDisplayWeightLb(SCAFFOLD_WEIGHTS[selectedBaseComponentType]) ?? null
    }
    if (selectedStacks.length === 1) {
			// Sum weight across all stacked segments (bottom â top)
			const segs = selectedStacks[0].standardSegments
			let sum = 0
			let any = false
			for (const seg of segs) {
				const pn = String(seg?.partNumber ?? '')
				const w = roundDisplayWeightLb(UNIVERSAL_RINGLOCK_STANDARDS[pn as keyof typeof UNIVERSAL_RINGLOCK_STANDARDS]?.weightLbs)
				if (typeof w === 'number') {
					sum += w
					any = true
				}
			}
			return any ? sum : null
    }
    if (selectedLedgerConnection) {
      const partNum = selectedLedgerConnection.ledgerPartNumber
      if (partNum.startsWith('UHT')) {
        return roundDisplayWeightLb(UNIVERSAL_RINGLOCK_TRUSSES[partNum as keyof typeof UNIVERSAL_RINGLOCK_TRUSSES]?.weightLbs) ?? null
      }
      return roundDisplayWeightLb(UNIVERSAL_RINGLOCK_HORIZONTALS[partNum as keyof typeof UNIVERSAL_RINGLOCK_HORIZONTALS]?.weightLbs) ?? null
    }
		if (selectedDiagonal?.weightLbs !== null && selectedDiagonal?.weightLbs !== undefined) {
			return roundDisplayWeightLb(selectedDiagonal.weightLbs) ?? null
		}
    return null
	  }, [selectedStacks, selectedLedgerConnection, selectedBaseComponentType, selectedDiagonal])

  // Base assembly is only valid for base-level standards:
  // - grid (today)
  // - shape (future)
  // NOT for stacked standards.
  const eligibleBaseStacks = useMemo(() => {
    return selectedStacks.filter(s => (s.baseSupport ?? 'grid') !== 'stacked')
  }, [selectedStacks])
  const ineligibleBaseCount = selectedStacks.length - eligibleBaseStacks.length
  const hasEligibleBaseSelection = eligibleBaseStacks.length > 0

  // Compute jack extension value with Mixed state support
  const jackExtensionValue = useMemo(() => {
    if (eligibleBaseStacks.length === 0) return null
    const values = eligibleBaseStacks.map(s => s.jackExtensionIn)
    const allSame = values.every(v => v === values[0])
    return allSame ? values[0] : null // null = Mixed
  }, [eligibleBaseStacks])

	  const isMixedJackExtension = hasEligibleBaseSelection && jackExtensionValue === null

  const woodSillValue = useMemo(() => {
    if (eligibleBaseStacks.length === 0) return null
    const values = eligibleBaseStacks.map(s => (s.showWoodSill ?? baseSettings.showWoodSill))
    const allSame = values.every(v => v === values[0])
    return allSame ? values[0] : null
  }, [eligibleBaseStacks, baseSettings.showWoodSill])

  const baseCollarValue = useMemo(() => {
    if (eligibleBaseStacks.length === 0) return null
    const values = eligibleBaseStacks.map(s => (s.showBaseCollar ?? baseSettings.showBaseCollar))
    const allSame = values.every(v => v === values[0])
    return allSame ? values[0] : null
  }, [eligibleBaseStacks, baseSettings.showBaseCollar])

  const woodSillCheckboxRef = useRef<HTMLInputElement>(null)
  const baseCollarCheckboxRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (woodSillCheckboxRef.current) {
      woodSillCheckboxRef.current.indeterminate = woodSillValue === null
    }
  }, [woodSillValue])

  useEffect(() => {
    if (baseCollarCheckboxRef.current) {
      baseCollarCheckboxRef.current.indeterminate = baseCollarValue === null
    }
  }, [baseCollarValue])

  // Handler to update jack extension for selected stacks
  const handleJackExtensionChange = (value: number) => {
    if (!hasEligibleBaseSelection) return
    const clamped = Math.max(0, Math.min(12, value))
    for (const s of eligibleBaseStacks) {
      updateScaffoldStack(s.id, { jackExtensionIn: clamped })
    }
  }

	  // Reset visibility overrides to workspace defaults (does not touch jack extension).
	  const handleResetJackExtensionToDefault = () => {
	    if (!hasEligibleBaseSelection) return
	    for (const s of eligibleBaseStacks) {
	      updateScaffoldStack(s.id, { jackExtensionIn: baseSettings.defaultJackExtensionIn })
	    }
	  }

  const eligibleAllBaseStacks = useMemo(() => {
    // Base components exist for base-level standards only (future-proof for stacking).
    return scaffoldStacks.filter(s => (s.baseSupport ?? 'grid') !== 'stacked')
  }, [scaffoldStacks])

  const baseComponentCount = eligibleAllBaseStacks.length

  const applyWoodSillToAll = (checked: boolean) => {
    for (const s of eligibleAllBaseStacks) {
      updateScaffoldStack(s.id, { showWoodSill: checked })
    }
  }

  const applyBaseCollarToAll = (checked: boolean) => {
    for (const s of eligibleAllBaseStacks) {
      updateScaffoldStack(s.id, { showBaseCollar: checked })
    }
  }

  const applyJackExtensionToAll = (value: number) => {
    const clamped = Math.max(0, Math.min(12, value))
    for (const s of eligibleAllBaseStacks) {
      updateScaffoldStack(s.id, { jackExtensionIn: clamped })
    }
  }

  const handleSetWoodSill = (checked: boolean) => {
    if (!hasEligibleBaseSelection) return
    for (const s of eligibleBaseStacks) {
      updateScaffoldStack(s.id, { showWoodSill: checked })
    }
  }

  const handleSetBaseCollar = (checked: boolean) => {
    if (!hasEligibleBaseSelection) return
    for (const s of eligibleBaseStacks) {
      updateScaffoldStack(s.id, { showBaseCollar: checked })
    }
  }

  const hiddenWoodSillsInSelection = useMemo(() => {
    return eligibleBaseStacks.filter(s => !(s.showWoodSill ?? baseSettings.showWoodSill)).length
  }, [eligibleBaseStacks, baseSettings.showWoodSill])

  const hiddenBaseCollarsInSelection = useMemo(() => {
    return eligibleBaseStacks.filter(s => !(s.showBaseCollar ?? baseSettings.showBaseCollar)).length
  }, [eligibleBaseStacks, baseSettings.showBaseCollar])

  const hiddenWoodSillsInProject = useMemo(() => {
    return eligibleAllBaseStacks.filter(s => !(s.showWoodSill ?? baseSettings.showWoodSill)).length
  }, [eligibleAllBaseStacks, baseSettings.showWoodSill])

  const hiddenBaseCollarsInProject = useMemo(() => {
    return eligibleAllBaseStacks.filter(s => !(s.showBaseCollar ?? baseSettings.showBaseCollar)).length
  }, [eligibleAllBaseStacks, baseSettings.showBaseCollar])

  const unitLabel = settings.unitSystem === 'imperial' ? 'ft' : 'm'
  const step = stepFromPrecision(settings.decimalPrecision)

  const isLoadToolActive = workspaceMode === 'SCAFFOLD_MODE' && categoryKey === 'liveLoads'
  const isBlockToolActive = workspaceMode === 'SCAFFOLD_MODE' && activeTool === 'block' && !isLoadToolActive
	const blockToolWarningNotice = isBlockToolActive && blockPlacementWarning
		? <div className="properties-hint properties-warning">{blockPlacementWarning}</div>
		: null
	const renderCopyLoadsToggle = () => (
		blockToolMode === 'assemble' && blockEditMode && blockEditActionMode === 'copy' ? (
			<div className="prop-row prop-row-compact">
				<label>Copy live loads</label>
				<div className="prop-toggle">
					<input
						type="checkbox"
						aria-label="Copy live loads"
						checked={blockCopyLoadsOnCopy}
						onChange={e => updateBlockToolSettings({ copyLoadsOnCopy: e.target.checked })}
					/>
				</div>
			</div>
		) : null
	)

	// Block tool uses feet internally (scaffold workspace is currently imperial-first).
	// Width/Depth/Height are direct total dimensions in feet (no bay spacing input).
	const blockWidthFt = Math.max(1e-3, Number(blockToolSettings.widthFt))
	const blockDepthFt = Math.max(1e-3, Number(blockToolSettings.depthFt))
	const blockHeightFt = Math.max(1e-3, Number(blockToolSettings.heightFt))
		const blockPlankedLevelsCount = Math.max(1, Math.round(Number(blockToolSettings.plankedLevelsCount ?? 1)))
		const blockIncludeBaseDeck = !!blockToolSettings.includeBaseDeck
	const blockBraceFrontBack = blockToolSettings.braceFrontBack ?? 'off'
	const blockBraceLeftRight = blockToolSettings.braceLeftRight ?? 'off'
	const blockCopyLoadsOnCopy = !!blockToolSettings.copyLoadsOnCopy
	const blockToolMode = blockToolSettings.mode
	const activeBlockFunction = !blockEditMode
		? 'place'
		: blockEditActionMode === 'neutral'
			? 'neutral'
		: blockEditActionMode === 'copy'
			? 'copy'
			: blockEditActionMode === 'move'
				? 'move'
				: 'select'

	const preventWheelChange = (e: any) => {
		// User request: disable mouse wheel changes on these boxes.
		// Blurring is the most reliable cross-browser behavior.
		e.currentTarget?.blur?.()
	}

	// Block tool inputs should behave like normal text inputs while typing.
	// Keep draft strings so the user can backspace/clear, then validate on blur.
		type BlockDraftKey = 'widthFt' | 'depthFt' | 'heightFt' | 'plankedLevelsCount' | 'ledgerEveryNRosettes' | 'buildingOffsetFt'
	const [blockDraft, setBlockDraft] = useState<Record<BlockDraftKey, string>>({
		widthFt: '',
		depthFt: '',
		heightFt: '',
			plankedLevelsCount: '',
		ledgerEveryNRosettes: '',
		buildingOffsetFt: '',
	})
	const [blockDraftFocusKey, setBlockDraftFocusKey] = useState<BlockDraftKey | null>(null)

	useEffect(() => {
		// When the block tool is not active, clear drafts.
		if (!isBlockToolActive) {
				setBlockDraft({ widthFt: '', depthFt: '', heightFt: '', plankedLevelsCount: '', ledgerEveryNRosettes: '', buildingOffsetFt: '' })
			setBlockDraftFocusKey(null)
			return
		}
		// Don't overwrite the value while the user is actively editing.
		if (blockDraftFocusKey) return
		setBlockDraft({
			widthFt: String(blockToolSettings.widthFt),
			depthFt: String(blockToolSettings.depthFt),
			heightFt: String(blockToolSettings.heightFt),
				plankedLevelsCount: String(blockToolSettings.plankedLevelsCount ?? 1),
			ledgerEveryNRosettes: String(blockToolSettings.ledgerEveryNRosettes),
			buildingOffsetFt: String(blockToolSettings.buildingOffsetFt),
		})
	}, [
		isBlockToolActive,
		blockDraftFocusKey,
		blockToolSettings.widthFt,
		blockToolSettings.depthFt,
		blockToolSettings.heightFt,
			blockToolSettings.plankedLevelsCount,
		blockToolSettings.ledgerEveryNRosettes,
		blockToolSettings.buildingOffsetFt,
	])

	const clamp = (v: number, min: number, max?: number) => {
		const hi = typeof max === 'number' ? Math.min(max, v) : v
		return Math.max(min, hi)
	}

	const commitBlockDraft = (key: BlockDraftKey, raw: string) => {
		// Empty/invalid values revert to the last valid setting.
		const trimmed = raw.trim()
		if (trimmed === '') {
			setBlockDraft(prev => ({ ...prev, [key]: String(blockToolSettings[key]) }))
			return
		}

			if (key === 'plankedLevelsCount') {
				const parsed = Number(trimmed)
				if (!Number.isFinite(parsed)) {
					setBlockDraft(prev => ({ ...prev, [key]: String(blockToolSettings.plankedLevelsCount ?? 1) }))
					return
				}
				const clamped = clamp(Math.round(parsed), 1, 20)
				updateBlockToolSettings({ plankedLevelsCount: clamped })
				setBlockDraft(prev => ({ ...prev, [key]: String(clamped) }))
				return
			}

		if (key === 'ledgerEveryNRosettes') {
			const parsed = Number(trimmed)
			if (!Number.isFinite(parsed)) {
				setBlockDraft(prev => ({ ...prev, [key]: String(blockToolSettings.ledgerEveryNRosettes) }))
				return
			}
			const clamped = clamp(Math.round(parsed), 1, 12)
			updateBlockToolSettings({ ledgerEveryNRosettes: clamped })
			setBlockDraft(prev => ({ ...prev, [key]: String(clamped) }))
			return
		}

		const parsed = Number(trimmed)
		if (!Number.isFinite(parsed)) {
			setBlockDraft(prev => ({ ...prev, [key]: String(blockToolSettings[key]) }))
			return
		}
		const clamped = clamp(parsed, 0.1)
		if (key === 'widthFt') updateBlockToolSettings({ widthFt: clamped })
		else if (key === 'depthFt') updateBlockToolSettings({ depthFt: clamped })
		else if (key === 'buildingOffsetFt') updateBlockToolSettings({ buildingOffsetFt: clamp(parsed, 0) })
		else updateBlockToolSettings({ heightFt: clamped })
		setBlockDraft(prev => ({ ...prev, [key]: String(key === 'buildingOffsetFt' ? clamp(parsed, 0) : clamped) }))
	}

	const updateBlockDraftLive = (key: BlockDraftKey, raw: string) => {
		setBlockDraft(prev => ({ ...prev, [key]: raw }))
		const trimmed = raw.trim()
		if (trimmed === '') return
		const parsed = Number(trimmed)
		if (!Number.isFinite(parsed)) return
		if (key === 'ledgerEveryNRosettes') {
			updateBlockToolSettings({ ledgerEveryNRosettes: clamp(Math.round(parsed), 1, 12) })
			return
		}
			if (key === 'plankedLevelsCount') {
				updateBlockToolSettings({ plankedLevelsCount: clamp(Math.round(parsed), 1, 20) })
				return
			}
		if (key === 'buildingOffsetFt') {
			updateBlockToolSettings({ buildingOffsetFt: clamp(parsed, 0) })
			return
		}
		const clamped = clamp(parsed, 0.1)
		if (key === 'widthFt') updateBlockToolSettings({ widthFt: clamped })
		else if (key === 'depthFt') updateBlockToolSettings({ depthFt: clamped })
		else updateBlockToolSettings({ heightFt: clamped })
	}

		// Block editor drafts (when an existing block is selected in Blocks mode)
		const [blockEditDraft, setBlockEditDraft] = useState<Record<BlockDraftKey, string>>({
			widthFt: '',
			depthFt: '',
			heightFt: '',
				plankedLevelsCount: '',
			ledgerEveryNRosettes: '',
			buildingOffsetFt: '',
		})
			const [blockEditIncludeBaseDeck, setBlockEditIncludeBaseDeck] = useState(false)
			const [blockEditBraceFrontBack, setBlockEditBraceFrontBack] = useState<BlockBraceDirection>('off')
			const [blockEditBraceLeftRight, setBlockEditBraceLeftRight] = useState<BlockBraceDirection>('off')

			// Keep the block editor draft synced to selection *only when not actively editing*.
			// Important: clicking the Apply (checkmark) button blurs the input first. If we
			// resync on blur, we would overwrite the user's draft before Apply reads it.
			useEffect(() => {
				if (!selectedBlock) {
					setBlockEditDraft({ widthFt: '', depthFt: '', heightFt: '', plankedLevelsCount: '', ledgerEveryNRosettes: '', buildingOffsetFt: '' })
					setIsEditingBlock(false)
					setBlockEditIncludeBaseDeck(false)
					setBlockEditBraceFrontBack('off')
					setBlockEditBraceLeftRight('off')
					return
				}

				if (isEditingBlock) return

				setBlockEditDraft({
					widthFt: String(selectedBlock.widthFt),
					depthFt: String(selectedBlock.depthFt),
					heightFt: String(selectedBlock.heightFt),
					plankedLevelsCount: String(selectedBlock.plankedLevelsCount ?? 1),
					ledgerEveryNRosettes: String(selectedBlock.ledgerEveryNRosettes),
					buildingOffsetFt: String(blockToolSettings.buildingOffsetFt),
				})
				setBlockEditIncludeBaseDeck(!!selectedBlock.includeBaseDeck)
				setBlockEditBraceFrontBack(selectedBlock.braceFrontBack ?? 'off')
				setBlockEditBraceLeftRight(selectedBlock.braceLeftRight ?? 'off')
			}, [selectedBlock, isEditingBlock, blockToolSettings.buildingOffsetFt])

		useEffect(() => {
			if (!selectedRoundAutoBlock || !isEditingBlock) return
			setIsEditingBlock(false)
		}, [isEditingBlock, selectedRoundAutoBlock, setIsEditingBlock])

		const enterBlockEditMode = useCallback(() => {
			if (!selectedBlock || isRoundAutoGeneratedScaffoldBlock(selectedBlock)) return
			setBlockEditDraft({
				widthFt: String(selectedBlock.widthFt),
				depthFt: String(selectedBlock.depthFt),
				heightFt: String(selectedBlock.heightFt),
					plankedLevelsCount: String(selectedBlock.plankedLevelsCount ?? 1),
				ledgerEveryNRosettes: String(selectedBlock.ledgerEveryNRosettes),
				buildingOffsetFt: String(blockToolSettings.buildingOffsetFt),
			})
				setBlockEditIncludeBaseDeck(!!selectedBlock.includeBaseDeck)
				setBlockEditBraceFrontBack(selectedBlock.braceFrontBack ?? 'off')
				setBlockEditBraceLeftRight(selectedBlock.braceLeftRight ?? 'off')
			setIsEditingBlock(true)
		}, [selectedBlock, setIsEditingBlock])

		const cancelBlockEdit = useCallback(() => {
			if (!selectedBlock || isRoundAutoGeneratedScaffoldBlock(selectedBlock)) return
			setBlockEditDraft({
				widthFt: String(selectedBlock.widthFt),
				depthFt: String(selectedBlock.depthFt),
				heightFt: String(selectedBlock.heightFt),
					plankedLevelsCount: String(selectedBlock.plankedLevelsCount ?? 1),
				ledgerEveryNRosettes: String(selectedBlock.ledgerEveryNRosettes),
				buildingOffsetFt: String(blockToolSettings.buildingOffsetFt),
			})
				setBlockEditIncludeBaseDeck(!!selectedBlock.includeBaseDeck)
				setBlockEditBraceFrontBack(selectedBlock.braceFrontBack ?? 'off')
				setBlockEditBraceLeftRight(selectedBlock.braceLeftRight ?? 'off')
			setIsEditingBlock(false)
		}, [selectedBlock, setIsEditingBlock])

		const applySelectedBlockEdits = useCallback(() => {
			if (!selectedBlock || isRoundAutoGeneratedScaffoldBlock(selectedBlock)) return
			const parseOr = (raw: string, fallback: number) => {
				const t = raw.trim()
				if (t === '') return fallback
				const n = Number(t)
				return Number.isFinite(n) ? n : fallback
			}
			const width = Math.max(0.1, parseOr(blockEditDraft.widthFt, selectedBlock.widthFt))
			const depth = Math.max(0.1, parseOr(blockEditDraft.depthFt, selectedBlock.depthFt))
			const height = Math.max(0.1, parseOr(blockEditDraft.heightFt, selectedBlock.heightFt))
				const levels = Math.max(1, Math.round(parseOr(blockEditDraft.plankedLevelsCount, selectedBlock.plankedLevelsCount ?? 1)))
			const ledgerEvery = Math.max(1, Math.round(parseOr(blockEditDraft.ledgerEveryNRosettes, selectedBlock.ledgerEveryNRosettes)))
			const oldRect = getBlockWorldRect(selectedBlock)
			const rotIsOdd = (((selectedBlock.rotationSteps ?? 0) % 4) + 4) % 4 % 2 === 1
			const newWorldW = rotIsOdd ? depth : width
			const newWorldD = rotIsOdd ? width : depth
			const edgeTol = 0.05
			let anchorLeft = false
			let anchorRight = false
			let anchorBottom = false
			let anchorTop = false
			for (const other of scaffoldBlocks) {
				if (other.id === selectedBlock.id) continue
				const otherRect = getBlockWorldRect(other)
				const yOverlap = oldRect.yMin < otherRect.yMax - edgeTol && oldRect.yMax > otherRect.yMin + edgeTol
				const xOverlap = oldRect.xMin < otherRect.xMax - edgeTol && oldRect.xMax > otherRect.xMin + edgeTol
				if (yOverlap && Math.abs(oldRect.xMax - otherRect.xMin) < edgeTol) anchorRight = true
				if (yOverlap && Math.abs(oldRect.xMin - otherRect.xMax) < edgeTol) anchorLeft = true
				if (xOverlap && Math.abs(oldRect.yMax - otherRect.yMin) < edgeTol) anchorTop = true
				if (xOverlap && Math.abs(oldRect.yMin - otherRect.yMax) < edgeTol) anchorBottom = true
			}
			let newCenterX = selectedBlock.center.x
			let newCenterY = selectedBlock.center.y
			if (anchorRight && !anchorLeft) newCenterX = oldRect.xMax - newWorldW / 2
			else if (anchorLeft && !anchorRight) newCenterX = oldRect.xMin + newWorldW / 2
			else if (anchorLeft && anchorRight) newCenterX = oldRect.xMin + newWorldW / 2
			if (anchorTop && !anchorBottom) newCenterY = oldRect.yMax - newWorldD / 2
			else if (anchorBottom && !anchorTop) newCenterY = oldRect.yMin + newWorldD / 2
			else if (anchorBottom && anchorTop) newCenterY = oldRect.yMin + newWorldD / 2
			const nextRect: BlockWorldRect = {
				id: selectedBlock.id,
				xMin: newCenterX - newWorldW / 2,
				xMax: newCenterX + newWorldW / 2,
				yMin: newCenterY - newWorldD / 2,
				yMax: newCenterY + newWorldD / 2,
			}
			const connectedMoves = buildConnectedBlockTranslations(scaffoldBlocks, selectedBlock.id, oldRect, nextRect)
			applyScaffoldBlockEdits(selectedBlock.id, {
				widthFt: width,
				depthFt: depth,
				heightFt: height,
					plankedLevelsCount: levels,
					includeBaseDeck: blockEditIncludeBaseDeck,
					braceFrontBack: blockEditBraceFrontBack,
					braceLeftRight: blockEditBraceLeftRight,
				ledgerEveryNRosettes: ledgerEvery,
			})
			if (connectedMoves.length > 0) {
				window.requestAnimationFrame(() => {
					const liveBlockById = new Map(scaffoldBlocksRef.current.map((block) => [block.id, block]))
					for (const move of connectedMoves) {
						const liveBlock = liveBlockById.get(move.blockId)
						if (!liveBlock) continue
						applyScaffoldBlockEdits(liveBlock.id, {
							widthFt: liveBlock.widthFt,
							depthFt: liveBlock.depthFt,
							heightFt: liveBlock.heightFt,
							plankedLevelsCount: liveBlock.plankedLevelsCount ?? 1,
							includeBaseDeck: !!liveBlock.includeBaseDeck,
							braceFrontBack: liveBlock.braceFrontBack ?? 'off',
							braceLeftRight: liveBlock.braceLeftRight ?? 'off',
							ledgerEveryNRosettes: liveBlock.ledgerEveryNRosettes,
							center: {
								x: liveBlock.center.x + move.dx,
								y: liveBlock.center.y + move.dy,
							},
						})
					}
				})
			}
			setIsEditingBlock(false)
				}, [applyScaffoldBlockEdits, blockEditDraft, scaffoldBlocks, selectedBlock, setIsEditingBlock, blockEditIncludeBaseDeck, blockEditBraceFrontBack, blockEditBraceLeftRight])

  // Determine object type
  const isBuilding = selected && isSceneObject(selected)
  const isScaffold = selected && isScaffoldObject(selected)
  const hasBuildingEntitySelection = Boolean(selectedBuildingEntity)
  const isBuildingSelection = Boolean(isBuilding || hasBuildingEntitySelection)

  // Edits/deletes are only permitted inside the active workspace.
  // SceneObjects have workspace; ScaffoldObjects are always scaffold workspace
  const activeOwner = workspaceMode === 'BUILDING_MODE' ? 'building' : 'scaffold'
  const canEditSelected = hasBuildingEntitySelection
    ? workspaceMode === 'BUILDING_MODE'
    : isBuilding
    ? selected.workspace === activeOwner
    : isScaffold
      ? workspaceMode === 'SCAFFOLD_MODE'
			      : (!!selectedBlock || hasStandardSelected || selectedLedgerConnection || !!selectedLiveLoad || !!selectedBaseComponentType || !!selectedDiagonal)
        ? workspaceMode === 'SCAFFOLD_MODE'
        : false

	const showLiveLoadPlacementControls = isLoadToolActive
		&& !selectedLiveLoad
		&& !selectedLedgerConnection
		&& !selectedDiagonal
		&& !selectedBaseComponentType
		&& !hasStandardSelected

  // Keep inputs as strings so the user can type naturally (for building objects only).
  const [draft, setDraft] = useState<{ length: string; height: string; depth: string; radius: string; thickness: string }>({
    length: '',
    height: '',
    depth: '',
    radius: '',
    thickness: '',
  })
  const [roofDraft, setRoofDraft] = useState<{
    kind: HostedRoofEntity['kind']
    thickness: string
    overhang: string
    rise: string
    ridgeDirection: RoofDirection
  }>({
    kind: 'flat-roof',
    thickness: '',
    overhang: '',
    rise: '',
    ridgeDirection: 'x',
  })
  const [parapetDraft, setParapetDraft] = useState<{
    height: string
    thickness: string
  }>({
    height: '',
    thickness: '',
  })
  const [featureDraft, setFeatureDraft] = useState<{
    preset: HostedFeaturePreset
    width: string
    depth: string
    height: string
    offsetU: string
    offsetV: string
    faceId: SideFeatureFaceId
    handrailEnabled: boolean
    handrailHeight: string
    handrailInset: string
    handrailThickness: string
    blocksScaffold: boolean
    supportsScaffold: boolean
  }>({
    preset: 'top-box',
    width: '',
    depth: '',
    height: '',
    offsetU: '',
    offsetV: '',
    faceId: 'front',
    handrailEnabled: false,
    handrailHeight: '',
    handrailInset: '',
    handrailThickness: '',
    blocksScaffold: true,
    supportsScaffold: false,
  })
  const [proxyDraft, setProxyDraft] = useState<{
    mode: ProxyFeatureMode
    width: string
    depth: string
    height: string
    offsetU: string
    offsetV: string
    faceId: 'top' | SideFeatureFaceId
    blocksScaffold: boolean
    supportsScaffold: boolean
  }>({
    mode: 'add',
    width: '',
    depth: '',
    height: '',
    offsetU: '',
    offsetV: '',
    faceId: 'top',
    blocksScaffold: true,
    supportsScaffold: false,
  })
  const [patternDraft, setPatternDraft] = useState<{
    contentType: HostedPatternContentType
    featurePreset: HostedFeaturePreset
    faceId: 'top' | SideFeatureFaceId
    wrapMode: HostedPatternWrapMode
    cornerBehavior: HostedPatternCornerBehavior
    wallFaceIds: SideFeatureFaceId[]
    width: string
    depth: string
    height: string
    uMode: HostedPatternAxisMode
    uCount: string
    uSpacing: string
    uStart: string
    uEnd: string
    uCentered: boolean
    vMode: HostedPatternAxisMode
    vCount: string
    vSpacing: string
    vStart: string
    vEnd: string
    vCentered: boolean
    handrailEnabled: boolean
    handrailHeight: string
    handrailInset: string
    handrailThickness: string
    blocksScaffold: boolean
    supportsScaffold: boolean
  }>({
    contentType: 'feature',
    featurePreset: 'balcony',
    faceId: 'front',
    wrapMode: 'single-face',
    cornerBehavior: 'continuous',
    wallFaceIds: ['front'],
    width: '',
    depth: '',
    height: '',
    uMode: 'count',
    uCount: '4',
    uSpacing: '2',
    uStart: '2',
    uEnd: '2',
    uCentered: true,
    vMode: 'count',
    vCount: '1',
    vSpacing: '2',
    vStart: '0',
    vEnd: '0',
    vCentered: true,
    handrailEnabled: true,
    handrailHeight: '3.5',
    handrailInset: '0.15',
    handrailThickness: '0.18',
    blocksScaffold: true,
    supportsScaffold: false,
  })
  const [patternInstanceDraft, setPatternInstanceDraft] = useState<{
    hidden: boolean
    width: string
    depth: string
    height: string
    offsetU: string
    offsetV: string
    blocksScaffold: boolean
    supportsScaffold: boolean
  }>({
    hidden: false,
    width: '',
    depth: '',
    height: '',
    offsetU: '',
    offsetV: '',
    blocksScaffold: true,
    supportsScaffold: false,
  })
	const [liveLoadDraft, setLiveLoadDraft] = useState('')
	const [liveLoadPlacementDraft, setLiveLoadPlacementDraft] = useState('')

  useEffect(() => {
    if (selectedBaseMassEntity) {
      const radiusFt = getBaseMassRadiusFt(selectedBaseMassEntity)
      const innerRadiusFt = getBaseMassInnerRadiusFt(selectedBaseMassEntity)
      setDraft({
        length: String(Number(getBaseMassWidthFt(selectedBaseMassEntity).toFixed(settings.decimalPrecision))),
        depth: String(Number(getBaseMassDepthFt(selectedBaseMassEntity).toFixed(settings.decimalPrecision))),
        height: String(Number(getBaseMassHeightFt(selectedBaseMassEntity).toFixed(settings.decimalPrecision))),
        radius: String(Number(radiusFt.toFixed(settings.decimalPrecision))),
        thickness: String(Number(Math.max(0, radiusFt - innerRadiusFt).toFixed(settings.decimalPrecision))),
      })
      return
    }

    if (!selected || !isBuilding) {
      setDraft({ length: '', height: '', depth: '', radius: '', thickness: '' })
      return
    }
    const buildingObj = selected as SceneObject
    const r = buildingObj.radius ?? buildingObj.dimensions.x / 2
    const ir = buildingObj.innerRadius ?? r * 0.6
    setDraft({
      length: String(Number(buildingObj.dimensions.x.toFixed(settings.decimalPrecision))),
      depth: String(Number(buildingObj.dimensions.y.toFixed(settings.decimalPrecision))),
      height: String(Number(buildingObj.dimensions.z.toFixed(settings.decimalPrecision))),
      radius: String(Number(r.toFixed(settings.decimalPrecision))),
      thickness: String(Number((r - ir).toFixed(settings.decimalPrecision))),
    })
	}, [selectedBaseMassEntity, selected, settings.decimalPrecision, isBuilding])

  useEffect(() => {
    if (!selectedRoofEntity) {
      setRoofDraft({
        kind: 'flat-roof',
        thickness: '',
        overhang: '',
        rise: '',
        ridgeDirection: 'x',
      })
      return
    }
    setRoofDraft({
      kind: selectedRoofEntity.kind,
      thickness: String(Number(selectedRoofEntity.params.thicknessFt.toFixed(settings.decimalPrecision))),
      overhang: String(Number(selectedRoofEntity.params.overhangFt.toFixed(settings.decimalPrecision))),
      rise: String(Number(selectedRoofEntity.params.riseFt.toFixed(settings.decimalPrecision))),
      ridgeDirection: selectedRoofEntity.params.ridgeDirection,
    })
  }, [selectedRoofEntity, settings.decimalPrecision])

  useEffect(() => {
    if (!selectedParapetEntity) {
      setParapetDraft({
        height: '',
        thickness: '',
      })
      return
    }
    setParapetDraft({
      height: String(Number(selectedParapetEntity.params.heightFt.toFixed(settings.decimalPrecision))),
      thickness: String(Number(selectedParapetEntity.params.thicknessFt.toFixed(settings.decimalPrecision))),
    })
  }, [selectedParapetEntity, settings.decimalPrecision])

  useEffect(() => {
    if (!selectedFeatureEntity) {
      const defaultFeatureAnalysis = getHostedFeatureDefaultAnalysis('top-box')
      setFeatureDraft({
        preset: 'top-box',
        width: '',
        depth: '',
        height: '',
        offsetU: '',
        offsetV: '',
        faceId: 'front',
        handrailEnabled: false,
        handrailHeight: '',
        handrailInset: '',
        handrailThickness: '',
        blocksScaffold: defaultFeatureAnalysis.blocksScaffold,
        supportsScaffold: defaultFeatureAnalysis.supportsScaffold,
      })
      return
    }
    const handrail = getHostedFeatureHandrailSettings(selectedFeatureEntity.params)
    setFeatureDraft({
      preset: selectedFeatureEntity.params.preset,
      width: String(Number(selectedFeatureEntity.params.widthFt.toFixed(settings.decimalPrecision))),
      depth: String(Number(selectedFeatureEntity.params.depthFt.toFixed(settings.decimalPrecision))),
      height: String(Number(selectedFeatureEntity.params.heightFt.toFixed(settings.decimalPrecision))),
      offsetU: String(Number(selectedFeatureEntity.params.offsetUFt.toFixed(settings.decimalPrecision))),
      offsetV: String(Number(selectedFeatureEntity.params.offsetVFt.toFixed(settings.decimalPrecision))),
      faceId: selectedFeatureEntity.kind === 'side-feature' ? selectedFeatureEntity.host.faceId : 'front',
      handrailEnabled: handrail.enabled,
      handrailHeight: String(Number(handrail.heightFt.toFixed(settings.decimalPrecision))),
      handrailInset: String(Number(handrail.insetFt.toFixed(settings.decimalPrecision))),
      handrailThickness: String(Number(handrail.thicknessFt.toFixed(settings.decimalPrecision))),
      blocksScaffold: !!selectedFeatureEntity.analysis.blocksScaffold,
      supportsScaffold: !!selectedFeatureEntity.analysis.supportsScaffold,
    })
  }, [selectedFeatureEntity, settings.decimalPrecision])

  useEffect(() => {
    if (!selectedProxyEntity) {
      setProxyDraft({
        mode: 'add',
        width: '',
        depth: '',
        height: '',
        offsetU: '',
        offsetV: '',
        faceId: 'top',
        blocksScaffold: true,
        supportsScaffold: false,
      })
      return
    }
    setProxyDraft({
      mode: selectedProxyEntity.params.mode,
      width: String(Number(selectedProxyEntity.params.widthFt.toFixed(settings.decimalPrecision))),
      depth: String(Number(selectedProxyEntity.params.depthFt.toFixed(settings.decimalPrecision))),
      height: String(Number(selectedProxyEntity.params.heightFt.toFixed(settings.decimalPrecision))),
      offsetU: String(Number(selectedProxyEntity.params.offsetUFt.toFixed(settings.decimalPrecision))),
      offsetV: String(Number(selectedProxyEntity.params.offsetVFt.toFixed(settings.decimalPrecision))),
      faceId: selectedProxyEntity.host.faceId,
      blocksScaffold: !!selectedProxyEntity.analysis.blocksScaffold,
      supportsScaffold: !!selectedProxyEntity.analysis.supportsScaffold,
    })
  }, [selectedProxyEntity, settings.decimalPrecision])

  useEffect(() => {
    if (!editablePatternEntity) {
      setPatternDraft({
        contentType: 'feature',
        featurePreset: 'balcony',
        faceId: 'front',
        wrapMode: 'single-face',
        cornerBehavior: 'continuous',
        wallFaceIds: ['front'],
        width: '',
        depth: '',
        height: '',
        uMode: 'count',
        uCount: '4',
        uSpacing: '2',
        uStart: '2',
        uEnd: '2',
        uCentered: true,
        vMode: 'count',
        vCount: '1',
        vSpacing: '2',
        vStart: '0',
        vEnd: '0',
        vCentered: true,
        handrailEnabled: true,
        handrailHeight: '3.5',
        handrailInset: '0.15',
        handrailThickness: '0.18',
        blocksScaffold: true,
        supportsScaffold: false,
      })
      return
    }
    const patternHandrail = getHostedFeatureHandrailSettings(editablePatternEntity.params)
    setPatternDraft({
      contentType: editablePatternEntity.params.contentType,
      featurePreset: sanitizePatternFeaturePresetForFace(
        editablePatternEntity.host.faceId === 'top' ? 'top' : editablePatternEntity.host.faceId,
        editablePatternEntity.params.featurePreset,
      ),
      faceId: editablePatternEntity.host.faceId === 'top' ? 'top' : editablePatternEntity.host.faceId,
      wrapMode: editablePatternEntity.params.wrapMode === 'all-walls'
        ? 'all-walls'
        : editablePatternEntity.params.wrapMode === 'selected-walls'
          ? 'selected-walls'
          : 'single-face',
      cornerBehavior: sanitizeHostedPatternCornerBehavior(
        editablePatternEntity.params.cornerBehavior,
        editablePatternEntity.host.faceId,
        editablePatternEntity.params.wrapMode,
      ),
      wallFaceIds: editablePatternEntity.host.faceId === 'top'
        ? []
        : sanitizeHostedPatternWallFaceIds(
            editablePatternEntity.params.wallFaceIds,
            editablePatternEntity.host.faceId as SideFeatureFaceId,
          ),
      width: String(Number(editablePatternEntity.params.widthFt.toFixed(settings.decimalPrecision))),
      depth: String(Number(editablePatternEntity.params.depthFt.toFixed(settings.decimalPrecision))),
      height: String(Number(editablePatternEntity.params.heightFt.toFixed(settings.decimalPrecision))),
      uMode: editablePatternEntity.params.distributionU.mode,
      uCount: String(editablePatternEntity.params.distributionU.count),
      uSpacing: String(Number(editablePatternEntity.params.distributionU.spacingFt.toFixed(settings.decimalPrecision))),
      uStart: String(Number(editablePatternEntity.params.distributionU.startSetbackFt.toFixed(settings.decimalPrecision))),
      uEnd: String(Number(editablePatternEntity.params.distributionU.endSetbackFt.toFixed(settings.decimalPrecision))),
      uCentered: editablePatternEntity.params.distributionU.centered,
      vMode: editablePatternEntity.params.distributionV.mode,
      vCount: String(editablePatternEntity.params.distributionV.count),
      vSpacing: String(Number(editablePatternEntity.params.distributionV.spacingFt.toFixed(settings.decimalPrecision))),
      vStart: String(Number(editablePatternEntity.params.distributionV.startSetbackFt.toFixed(settings.decimalPrecision))),
      vEnd: String(Number(editablePatternEntity.params.distributionV.endSetbackFt.toFixed(settings.decimalPrecision))),
      vCentered: editablePatternEntity.params.distributionV.centered,
      handrailEnabled: patternHandrail.enabled,
      handrailHeight: String(Number(patternHandrail.heightFt.toFixed(settings.decimalPrecision))),
      handrailInset: String(Number(patternHandrail.insetFt.toFixed(settings.decimalPrecision))),
      handrailThickness: String(Number(patternHandrail.thicknessFt.toFixed(settings.decimalPrecision))),
      blocksScaffold: !!editablePatternEntity.analysis.blocksScaffold,
      supportsScaffold: !!editablePatternEntity.analysis.supportsScaffold,
    })
  }, [editablePatternEntity, settings.decimalPrecision])

  useEffect(() => {
    if (!selectedPatternInstanceResolved) {
      setPatternInstanceDraft({
        hidden: false,
        width: '',
        depth: '',
        height: '',
        offsetU: '',
        offsetV: '',
        blocksScaffold: true,
        supportsScaffold: false,
      })
      return
    }
    setPatternInstanceDraft({
      hidden: !!selectedPatternInstanceResolved.hidden,
      width: String(Number(selectedPatternInstanceResolved.widthFt.toFixed(settings.decimalPrecision))),
      depth: String(Number(selectedPatternInstanceResolved.depthFt.toFixed(settings.decimalPrecision))),
      height: String(Number(selectedPatternInstanceResolved.heightFt.toFixed(settings.decimalPrecision))),
      offsetU: String(Number(selectedPatternInstanceResolved.offsetUFt.toFixed(settings.decimalPrecision))),
      offsetV: String(Number(selectedPatternInstanceResolved.offsetVFt.toFixed(settings.decimalPrecision))),
      blocksScaffold: !!selectedPatternInstanceResolved.analysis.blocksScaffold,
      supportsScaffold: !!selectedPatternInstanceResolved.analysis.supportsScaffold,
    })
  }, [selectedPatternInstanceResolved, settings.decimalPrecision])

	useEffect(() => {
		if (!selectedLiveLoad) {
			setLiveLoadDraft('')
			return
		}
		setLiveLoadDraft(String(Number(selectedLiveLoad.magnitudePsf.toFixed(2))))
	}, [selectedLiveLoad])

	useEffect(() => {
		setLiveLoadPlacementDraft(String(Number(liveLoadPlacementPsf.toFixed(2))))
	}, [liveLoadPlacementPsf])


  const commitDimension = (field: DimField, nextValue: string) => {
    if (!canEditSelected) return

    setDraft(prev => ({ ...prev, [field]: nextValue }))

    const parsed = Number(nextValue)
    if (!Number.isFinite(parsed)) return
    if (parsed <= 0) return

    if (selectedBaseMassEntity?.params.shape === 'rect') {
      const nextParams = { ...selectedBaseMassEntity.params }
      if (field === 'length') nextParams.widthFt = parsed
      if (field === 'depth') nextParams.depthFt = parsed
      const nextPartial: Parameters<typeof updateBuildingEntity>[1] = { params: nextParams }
      if (field === 'height') {
        nextParams.heightFt = parsed
        nextPartial.position = {
          ...selectedBaseMassEntity.position,
          z: parsed / 2,
        }
      }
      updateBuildingEntity(selectedBaseMassEntity.id, nextPartial)
      return
    }

    if (selectedBaseMassEntity?.params.shape === 'polygon' && field === 'height') {
      updateBuildingEntity(selectedBaseMassEntity.id, {
        params: {
          ...selectedBaseMassEntity.params,
          heightFt: parsed,
        },
        position: {
          ...selectedBaseMassEntity.position,
          z: parsed / 2,
        },
      })
      return
    }

    if (!selected || !isBuilding) return

    const buildingObj = selected as SceneObject

    const nextDims = buildingObj.dimensions.clone()
    if (field === 'length') nextDims.x = parsed
    // Z-UP: depth is Y, height is Z
    if (field === 'depth') nextDims.y = parsed
    if (field === 'height') nextDims.z = parsed

    // Length/Depth: keep centroid fixed by changing only dimensions.
    // Height: keep the bottom face glued to the grid (world Z=0) by adjusting position.z.
    if (field === 'height') {
      updateObject(buildingObj.id, {
        dimensions: new THREE.Vector3(nextDims.x, nextDims.y, nextDims.z),
        position: new THREE.Vector3(buildingObj.position.x, buildingObj.position.y, parsed / 2),
      })
    } else {
      updateObject(buildingObj.id, { dimensions: new THREE.Vector3(nextDims.x, nextDims.y, nextDims.z) })
    }
  }

  const commitRadius = (nextValue: string) => {
    if (!canEditSelected) return
    setDraft(prev => ({ ...prev, radius: nextValue }))
    const parsed = Number(nextValue)
    if (!Number.isFinite(parsed) || parsed <= 0) return

    if (selectedBaseMassEntity && (selectedBaseMassEntity.params.shape === 'circle' || selectedBaseMassEntity.params.shape === 'ring')) {
      if (selectedBaseMassEntity.params.shape === 'circle') {
        updateBuildingEntity(selectedBaseMassEntity.id, {
          params: {
            ...selectedBaseMassEntity.params,
            radiusFt: parsed,
          },
        })
        return
      }

      const wallThickness = selectedBaseMassEntity.params.radiusFt - selectedBaseMassEntity.params.innerRadiusFt
      updateBuildingEntity(selectedBaseMassEntity.id, {
        params: {
          ...selectedBaseMassEntity.params,
          radiusFt: parsed,
          innerRadiusFt: Math.max(0.1, parsed - wallThickness),
        },
      })
      return
    }

    if (!selected || !isBuilding) return
    const buildingObj = selected as SceneObject
    const update: any = {
      radius: parsed,
      dimensions: new THREE.Vector3(parsed * 2, parsed * 2, buildingObj.dimensions.z),
    }
    // For rings, keep wall thickness constant â adjust innerRadius
    if (buildingObj.type === 'ring') {
      const oldOuter = buildingObj.radius ?? buildingObj.dimensions.x / 2
      const oldInner = buildingObj.innerRadius ?? oldOuter * 0.6
      const wallThickness = oldOuter - oldInner
      update.innerRadius = Math.max(0.1, parsed - wallThickness)
    }
    updateObject(buildingObj.id, update)
  }

  const commitThickness = (nextValue: string) => {
    if (!canEditSelected) return
    setDraft(prev => ({ ...prev, thickness: nextValue }))
    const parsed = Number(nextValue)
    if (!Number.isFinite(parsed) || parsed <= 0) return

    if (selectedBaseMassEntity?.params.shape === 'ring') {
      const outerR = selectedBaseMassEntity.params.radiusFt
      const newInner = Math.max(0.1, outerR - parsed)
      if (newInner >= outerR) return
      updateBuildingEntity(selectedBaseMassEntity.id, {
        params: {
          ...selectedBaseMassEntity.params,
          innerRadiusFt: newInner,
        },
      })
      return
    }

    if (!selected || !isBuilding) return
    const buildingObj = selected as SceneObject
    const outerR = buildingObj.radius ?? buildingObj.dimensions.x / 2
    const newInner = Math.max(0.1, outerR - parsed)
    if (newInner >= outerR) return // thickness can't exceed radius
    updateObject(buildingObj.id, { innerRadius: newInner })
  }

  const commitCircleHeight = (nextValue: string) => {
    if (!canEditSelected) return
    setDraft(prev => ({ ...prev, height: nextValue }))
    const parsed = Number(nextValue)
    if (!Number.isFinite(parsed) || parsed <= 0) return

    if (selectedBaseMassEntity && (selectedBaseMassEntity.params.shape === 'circle' || selectedBaseMassEntity.params.shape === 'ring')) {
      updateBuildingEntity(selectedBaseMassEntity.id, {
        params: {
          ...selectedBaseMassEntity.params,
          heightFt: parsed,
        },
        position: {
          ...selectedBaseMassEntity.position,
          z: parsed / 2,
        },
      })
      return
    }

    if (!selected || !isBuilding) return
    const buildingObj = selected as SceneObject
    updateObject(buildingObj.id, {
      dimensions: new THREE.Vector3(buildingObj.dimensions.x, buildingObj.dimensions.y, parsed),
      position: new THREE.Vector3(buildingObj.position.x, buildingObj.position.y, parsed / 2),
    })
  }

  const handleAddOrSelectRoof = useCallback(() => {
    if (!selectedBaseMassEntity || workspaceMode !== 'BUILDING_MODE') return
    if (selectedMassRoof) {
      setSelectedBuildingEntityId(selectedMassRoof.id)
      setSelectedObjectId(selectedMassRoof.id)
      return
    }

    const now = Date.now()
    const roof: HostedRoofEntity = {
      id: `roof-${now}-${Math.random().toString(36).slice(2, 9)}`,
      category: 'roof',
      kind: 'flat-roof',
      host: {
        entityId: selectedBaseMassEntity.id,
        hostKind: 'top-face',
        faceId: 'top',
      },
      color: selectedBaseMassEntity.color,
      params: {
        thicknessFt: 1,
        overhangFt: 0.5,
        riseFt: 2,
        ridgeDirection: 'x',
      },
      analysis: {
        blocksScaffold: true,
        supportsScaffold: false,
        countsAsRoof: true,
        countsAsPerimeter: false,
      },
      children: [],
      createdAt: now,
      updatedAt: now,
    }

    addBuildingEntity(roof)
    if (!selectedBaseMassEntity.children.includes(roof.id)) {
      updateBuildingEntity(selectedBaseMassEntity.id, {
        children: [...selectedBaseMassEntity.children, roof.id],
      })
    }
    setSelectedBuildingEntityId(roof.id)
    setSelectedObjectId(roof.id)
  }, [
    addBuildingEntity,
    selectedBaseMassEntity,
    selectedMassRoof,
    setSelectedBuildingEntityId,
    setSelectedObjectId,
    updateBuildingEntity,
    workspaceMode,
  ])

  const handleAddOrSelectParapet = useCallback(() => {
    if (!selectedBaseMassEntity || workspaceMode !== 'BUILDING_MODE') return
    if (selectedMassParapet) {
      setSelectedBuildingEntityId(selectedMassParapet.id)
      setSelectedObjectId(selectedMassParapet.id)
      return
    }

    const now = Date.now()
    const edgeIds = getDefaultParapetEdgeIdsForHost(selectedBaseMassEntity)
    const parapet: HostedParapetEntity = {
      id: `parapet-${now}-${Math.random().toString(36).slice(2, 9)}`,
      category: 'parapet',
      kind: 'parapet',
      host: {
        entityId: selectedBaseMassEntity.id,
        hostKind: 'perimeter',
        faceId: 'top',
      },
      color: selectedBaseMassEntity.color,
      params: {
        heightFt: 3.5,
        thicknessFt: 0.5,
        offsetMode: 'inside',
        edgeIds,
      },
      analysis: {
        blocksScaffold: true,
        supportsScaffold: false,
        countsAsRoof: false,
        countsAsPerimeter: true,
      },
      children: [],
      createdAt: now,
      updatedAt: now,
    }

    addBuildingEntity(parapet)
    if (!selectedBaseMassEntity.children.includes(parapet.id)) {
      updateBuildingEntity(selectedBaseMassEntity.id, {
        children: [...selectedBaseMassEntity.children, parapet.id],
      })
    }
    setSelectedBuildingEntityId(parapet.id)
    setSelectedObjectId(parapet.id)
  }, [
    addBuildingEntity,
    selectedBaseMassEntity,
    selectedMassParapet,
    setSelectedBuildingEntityId,
    setSelectedObjectId,
    updateBuildingEntity,
    workspaceMode,
  ])

  const handleAddOrSelectTopFeature = useCallback(() => {
    if (!selectedBaseMassEntity || workspaceMode !== 'BUILDING_MODE') return
    if (isSketchingTopFeature) {
      clearBuildingHostedSketch()
      setActiveTool('select')
      return
    }
    beginBuildingHostedSketch({
      target: 'feature',
      hostEntityId: selectedBaseMassEntity.id,
      hostKind: 'top-face',
      faceId: 'top',
      preset: 'penthouse',
    })
  }, [
    beginBuildingHostedSketch,
    clearBuildingHostedSketch,
    isSketchingTopFeature,
    selectedBaseMassEntity,
    setActiveTool,
    workspaceMode,
  ])

  const handleAddOrSelectSideFeature = useCallback(() => {
    if (!selectedBaseMassEntity || selectedBaseMassEntity.params.shape !== 'rect' || workspaceMode !== 'BUILDING_MODE') return
    if (isSketchingSideFeature) {
      clearBuildingHostedSketch()
      setActiveTool('select')
      return
    }
    beginBuildingHostedSketch({
      target: 'feature',
      hostEntityId: selectedBaseMassEntity.id,
      hostKind: 'side-face',
      faceId: getDefaultSideFeatureFaceId(viewMode),
      preset: 'balcony',
    })
  }, [
    beginBuildingHostedSketch,
    clearBuildingHostedSketch,
    isSketchingSideFeature,
    selectedBaseMassEntity,
    setActiveTool,
    viewMode,
    workspaceMode,
  ])

  const handleAddProxyVolume = useCallback((mode: ProxyFeatureMode) => {
    if (!selectedBaseMassEntity || workspaceMode !== 'BUILDING_MODE') return
    const isActive = mode === 'add' ? isSketchingAddProxy : isSketchingCutProxy
    if (isActive) {
      clearBuildingHostedSketch()
      setActiveTool('select')
      return
    }
    beginBuildingHostedSketch({
      target: 'proxy',
      hostEntityId: selectedBaseMassEntity.id,
      hostKind: 'auto-face',
      faceId: 'top',
      proxyMode: mode,
    })
  }, [
    beginBuildingHostedSketch,
    clearBuildingHostedSketch,
    isSketchingAddProxy,
    isSketchingCutProxy,
    selectedBaseMassEntity,
    setActiveTool,
    workspaceMode,
  ])
  const handleAddPatternOnFace = useCallback(() => {
    if (!selectedBaseMassEntity || workspaceMode !== 'BUILDING_MODE') return
    if (buildingHostedPatternPreview?.host.entityId === selectedBaseMassEntity.id) {
      setBuildingHostedPatternPreview(null)
      return
    }

    const allowedFaces = getPatternFaceOptionsForHostShape(selectedBaseMassEntity.params.shape).map((option) => option.value)
    const preferredFace = selectedBaseMassEntity.params.shape === 'rect'
      ? getPreferredSketchFaceIdForRectHost(viewMode)
      : 'top'
    const faceId = allowedFaces.includes(preferredFace) ? preferredFace : 'top'
    const featurePreset = getDefaultPatternFeaturePresetForFace(faceId)
    const dimensions = getHostedPatternDefaultDimensions('feature', faceId, featurePreset)
    const analysis = getHostedPatternDefaultAnalysis('feature', featurePreset)
    const now = Date.now()
    const pattern: HostedPatternEntity = {
      id: `pattern-${now}-${Math.random().toString(36).slice(2, 9)}`,
      category: 'pattern',
      kind: 'hosted-pattern',
      host: {
        entityId: selectedBaseMassEntity.id,
        hostKind: faceId === 'top' ? 'top-face' : 'side-face',
        faceId,
      },
      color: getHostedPatternDefaultColor('feature', selectedBaseMassEntity.color),
      params: {
        contentType: 'feature',
        featurePreset,
        balconyHandrailEnabled: getHostedFeatureDefaultHandrailEnabled(featurePreset),
        balconyHandrailHeightFt: getHostedFeatureDefaultHandrailHeightFt(featurePreset),
        balconyHandrailInsetFt: getHostedFeatureDefaultHandrailInsetFt(featurePreset),
        balconyHandrailThicknessFt: getHostedFeatureDefaultHandrailThicknessFt(featurePreset),
        widthFt: dimensions.widthFt,
        depthFt: dimensions.depthFt,
        heightFt: dimensions.heightFt,
        wrapMode: 'single-face',
        cornerBehavior: 'continuous',
        wallFaceIds: faceId === 'top' ? [] : [faceId],
        distributionU: {
          mode: 'count',
          count: 4,
          spacingFt: 2,
          startSetbackFt: 2,
          endSetbackFt: 2,
          centered: true,
        },
        distributionV: {
          mode: 'count',
          count: 1,
          spacingFt: 2,
          startSetbackFt: 0,
          endSetbackFt: 0,
          centered: true,
        },
      },
      analysis,
      skippedInstanceIds: [],
      instanceOverrides: {},
      children: [],
      createdAt: now,
      updatedAt: now,
    }

    setSelectedHostedPatternInstance(null)
    setSelectedBuildingEntityId(selectedBaseMassEntity.id)
    setSelectedObjectId(selectedBaseMassEntity.id)
    setBuildingHostedPatternPreview(pattern)
  }, [
    buildingHostedPatternPreview,
    selectedBaseMassEntity,
    setBuildingHostedPatternPreview,
    setSelectedBuildingEntityId,
    setSelectedHostedPatternInstance,
    setSelectedObjectId,
    viewMode,
    workspaceMode,
  ])

  const applyEditablePatternUpdate = useCallback((partial: Partial<HostedPatternEntity>) => {
    if (selectedPatternEntity) {
      updateBuildingEntity(selectedPatternEntity.id, partial)
      return
    }
    if (!previewPatternEntity) return
    setBuildingHostedPatternPreview({
      ...previewPatternEntity,
      ...partial,
      host: partial.host ?? previewPatternEntity.host,
      color: partial.color ?? previewPatternEntity.color,
      analysis: partial.analysis ?? previewPatternEntity.analysis,
      params: partial.params ?? previewPatternEntity.params,
      skippedInstanceIds: partial.skippedInstanceIds ?? previewPatternEntity.skippedInstanceIds,
      instanceOverrides: partial.instanceOverrides ?? previewPatternEntity.instanceOverrides,
      children: partial.children ?? previewPatternEntity.children,
      updatedAt: Date.now(),
    })
  }, [previewPatternEntity, selectedPatternEntity, setBuildingHostedPatternPreview, updateBuildingEntity])

  const handleCreatePatternFromPreview = useCallback(() => {
    if (!previewPatternEntity || !previewPatternHost || workspaceMode !== 'BUILDING_MODE') return
    const now = Date.now()
    const pattern: HostedPatternEntity = {
      ...previewPatternEntity,
      id: `pattern-${now}-${Math.random().toString(36).slice(2, 9)}`,
      children: [],
      createdAt: now,
      updatedAt: now,
    }
    addBuildingEntity(pattern)
    if (!previewPatternHost.children.includes(pattern.id)) {
      updateBuildingEntity(previewPatternHost.id, {
        children: [...previewPatternHost.children, pattern.id],
      })
    }
    setBuildingHostedPatternPreview(null)
    setSelectedBuildingEntityId(pattern.id)
    setSelectedObjectId(pattern.id)
  }, [
    addBuildingEntity,
    previewPatternEntity,
    previewPatternHost,
    setBuildingHostedPatternPreview,
    setSelectedBuildingEntityId,
    setSelectedObjectId,
    updateBuildingEntity,
    workspaceMode,
  ])

  const handleCancelPatternPreview = useCallback(() => {
    if (!previewPatternEntity) return
    setBuildingHostedPatternPreview(null)
    setSelectedHostedPatternInstance(null)
  }, [previewPatternEntity, setBuildingHostedPatternPreview, setSelectedHostedPatternInstance])
  const handleDeleteHostedEntity = useCallback((entityId: string, hostId: string | null) => {
    removeBuildingEntity(entityId)
    setSelectedHostedPatternInstance(null)
    if (hostId) {
      setSelectedBuildingEntityId(hostId)
      setSelectedObjectId(hostId)
    }
  }, [removeBuildingEntity, setSelectedBuildingEntityId, setSelectedHostedPatternInstance, setSelectedObjectId])
  const handleSelectHostedChild = useCallback((entityId: string) => {
    setSelectedHostedPatternInstance(null)
    setSelectedBuildingEntityId(entityId)
    setSelectedObjectId(entityId)
  }, [setSelectedBuildingEntityId, setSelectedHostedPatternInstance, setSelectedObjectId])

  const createNestedTopFeature = useCallback((hostEntity: HostedFeatureEntity | HostedProxyEntity) => {
    if (!canEditSelected) return
    const hostFace = resolveHostedRectEntityTopFaceInfo(hostEntity, buildingEntityById)
    if (!hostFace) return
    beginBuildingHostedSketch({
      target: 'feature',
      hostEntityId: hostEntity.id,
      hostKind: 'top-face',
      faceId: 'top',
      preset: 'top-box',
    })
  }, [
    beginBuildingHostedSketch,
    buildingEntityById,
    canEditSelected,
  ])

  const handleAddOrSelectNestedRoof = useCallback((hostEntity: HostedFeatureEntity | HostedProxyEntity) => {
    if (!canEditSelected) return
    const existingRoof = buildingEntities.find((candidate) => (
      isRoofEntity(candidate) && candidate.host.entityId === hostEntity.id
    )) ?? null
    if (existingRoof && isRoofEntity(existingRoof)) {
      setSelectedBuildingEntityId(existingRoof.id)
      setSelectedObjectId(existingRoof.id)
      return
    }
    const hostFace = resolveHostedRectEntityTopFaceInfo(hostEntity, buildingEntityById)
    if (!hostFace) return
    const now = Date.now()
    const roof: HostedRoofEntity = {
      id: `roof-${now}-${Math.random().toString(36).slice(2, 9)}`,
      category: 'roof',
      kind: 'flat-roof',
      host: {
        entityId: hostEntity.id,
        hostKind: 'top-face',
        faceId: 'top',
      },
      color: hostEntity.color,
      params: {
        thicknessFt: 1,
        overhangFt: 0.5,
        riseFt: 2,
        ridgeDirection: 'x',
      },
      analysis: {
        blocksScaffold: true,
        supportsScaffold: false,
        countsAsRoof: true,
        countsAsPerimeter: false,
      },
      children: [],
      createdAt: now,
      updatedAt: now,
    }
    addBuildingEntity(roof)
    if (!hostEntity.children.includes(roof.id)) {
      updateBuildingEntity(hostEntity.id, {
        children: [...hostEntity.children, roof.id],
      })
    }
    setSelectedBuildingEntityId(roof.id)
    setSelectedObjectId(roof.id)
  }, [
    addBuildingEntity,
    buildingEntities,
    buildingEntityById,
    canEditSelected,
    setSelectedBuildingEntityId,
    setSelectedObjectId,
    updateBuildingEntity,
  ])

  const createNestedTopVolume = useCallback((hostEntity: HostedFeatureEntity | HostedProxyEntity, mode: ProxyFeatureMode) => {
    if (!canEditSelected) return
    const hostFace = resolveHostedRectEntityTopFaceInfo(hostEntity, buildingEntityById)
    if (!hostFace) return
    beginBuildingHostedSketch({
      target: 'proxy',
      hostEntityId: hostEntity.id,
      hostKind: 'top-face',
      faceId: 'top',
      proxyMode: mode,
    })
  }, [
    beginBuildingHostedSketch,
    buildingEntityById,
    canEditSelected,
  ])

  const createNestedSideFeature = useCallback((hostEntity: HostedFeatureEntity | HostedProxyEntity) => {
    if (!canEditSelected) return
    beginBuildingHostedSketch({
      target: 'feature',
      hostEntityId: hostEntity.id,
      hostKind: 'side-face',
      faceId: getDefaultSideFeatureFaceId(viewMode),
      preset: 'balcony',
    })
  }, [beginBuildingHostedSketch, canEditSelected, viewMode])

  const createNestedSideVolume = useCallback((hostEntity: HostedFeatureEntity | HostedProxyEntity, mode: ProxyFeatureMode) => {
    if (!canEditSelected) return
    beginBuildingHostedSketch({
      target: 'proxy',
      hostEntityId: hostEntity.id,
      hostKind: 'side-face',
      faceId: getDefaultSideFeatureFaceId(viewMode),
      proxyMode: mode,
    })
  }, [beginBuildingHostedSketch, canEditSelected, viewMode])

  const commitRoofKind = useCallback((nextKind: HostedRoofEntity['kind']) => {
    if (!selectedRoofEntity || !selectedRoofHost) return
    const allowedKinds = getRoofKindOptionsForHostShape(selectedRoofHostShape).map(option => option.value)
    const sanitizedKind = allowedKinds.includes(nextKind) ? nextKind : 'flat-roof'
    const nextRiseFt = sanitizedKind === 'flat-roof'
      ? 0
      : Math.max(0.1, selectedRoofEntity.params.riseFt)
    setRoofDraft(prev => ({ ...prev, kind: sanitizedKind }))
    updateBuildingEntity(selectedRoofEntity.id, {
      kind: sanitizedKind,
      params: {
        ...selectedRoofEntity.params,
        riseFt: nextRiseFt,
      },
    })
  }, [selectedRoofEntity, selectedRoofHost, selectedRoofHostShape, updateBuildingEntity])

  const commitRoofNumeric = useCallback((field: 'thicknessFt' | 'overhangFt' | 'riseFt', nextValue: string) => {
    if (!selectedRoofEntity || !canEditSelected) return
    if (field === 'thicknessFt') setRoofDraft(prev => ({ ...prev, thickness: nextValue }))
    if (field === 'overhangFt') setRoofDraft(prev => ({ ...prev, overhang: nextValue }))
    if (field === 'riseFt') setRoofDraft(prev => ({ ...prev, rise: nextValue }))
    const parsed = Number(nextValue)
    if (!Number.isFinite(parsed)) return
    const minValue = field === 'overhangFt' ? 0 : 0.1
    if (parsed < minValue) return
    updateBuildingEntity(selectedRoofEntity.id, {
      params: {
        ...selectedRoofEntity.params,
        [field]: selectedRoofEntity.kind === 'flat-roof' && field === 'riseFt' ? 0 : parsed,
      },
    })
  }, [canEditSelected, selectedRoofEntity, updateBuildingEntity])

  const commitRoofDirection = useCallback((nextDirection: RoofDirection) => {
    if (!selectedRoofEntity || !canEditSelected) return
    setRoofDraft(prev => ({ ...prev, ridgeDirection: nextDirection }))
    updateBuildingEntity(selectedRoofEntity.id, {
      params: {
        ...selectedRoofEntity.params,
        ridgeDirection: nextDirection,
      },
    })
  }, [canEditSelected, selectedRoofEntity, updateBuildingEntity])

  const commitParapetNumeric = useCallback((field: 'heightFt' | 'thicknessFt', nextValue: string) => {
    if (!selectedParapetEntity || !canEditSelected) return
    if (field === 'heightFt') setParapetDraft(prev => ({ ...prev, height: nextValue }))
    if (field === 'thicknessFt') setParapetDraft(prev => ({ ...prev, thickness: nextValue }))
    const parsed = Number(nextValue)
    if (!Number.isFinite(parsed) || parsed <= 0) return
    updateBuildingEntity(selectedParapetEntity.id, {
      params: {
        ...selectedParapetEntity.params,
        offsetMode: 'inside',
        [field]: parsed,
      },
    })
  }, [canEditSelected, selectedParapetEntity, updateBuildingEntity])

  const toggleParapetEdge = useCallback((edgeId: ParapetEdgeId) => {
    if (!selectedParapetEntity || !selectedParapetHost || !canEditSelected) return
    const availableEdgeIds = getParapetEdgeOptionsForHost(selectedParapetHost).map(option => option.value)
    if (!availableEdgeIds.includes(edgeId)) return
    const current = getResolvedParapetEdgeIdsForHost(selectedParapetHost, selectedParapetEntity.params.edgeIds)
    const nextEdgeIds = current.includes(edgeId)
      ? current.filter(value => value !== edgeId)
      : [...current, edgeId]
    if (nextEdgeIds.length === 0) return
    const normalized = availableEdgeIds
      .filter(value => nextEdgeIds.includes(value))
    updateBuildingEntity(selectedParapetEntity.id, {
      host: {
        ...selectedParapetEntity.host,
        hostKind: normalized.length === availableEdgeIds.length ? 'perimeter' : 'edge-chain',
      },
      params: {
        ...selectedParapetEntity.params,
        edgeIds: normalized,
      },
    })
  }, [canEditSelected, selectedParapetEntity, selectedParapetHost, updateBuildingEntity])

  const commitFeaturePreset = useCallback((nextPreset: HostedFeaturePreset) => {
    if (!selectedFeatureEntity || !canEditSelected) return
    const allowedPresets = selectedFeatureEntity.kind === 'top-feature'
      ? TOP_FEATURE_PRESET_OPTIONS.map(option => option.value)
      : SIDE_FEATURE_PRESET_OPTIONS.map(option => option.value)
    const sanitizedPreset = allowedPresets.includes(nextPreset)
      ? nextPreset
      : allowedPresets[0]!
    const previousDefaultAnalysis = getHostedFeatureDefaultAnalysis(selectedFeatureEntity.params.preset)
    const nextDefaultAnalysis = getHostedFeatureDefaultAnalysis(sanitizedPreset)
    const preserveAnalysisOverride = (
      selectedFeatureEntity.analysis.blocksScaffold !== previousDefaultAnalysis.blocksScaffold
      || selectedFeatureEntity.analysis.supportsScaffold !== previousDefaultAnalysis.supportsScaffold
      || selectedFeatureEntity.analysis.countsAsRoof !== previousDefaultAnalysis.countsAsRoof
      || selectedFeatureEntity.analysis.countsAsPerimeter !== previousDefaultAnalysis.countsAsPerimeter
    )
    const nextAnalysis = preserveAnalysisOverride
      ? selectedFeatureEntity.analysis
      : nextDefaultAnalysis
    const nextHandrailEnabled = getHostedFeatureDefaultHandrailEnabled(sanitizedPreset)
    const nextHandrailHeightFt = getHostedFeatureDefaultHandrailHeightFt(sanitizedPreset)
    const nextHandrailInsetFt = getHostedFeatureDefaultHandrailInsetFt(sanitizedPreset)
    const nextHandrailThicknessFt = getHostedFeatureDefaultHandrailThicknessFt(sanitizedPreset)
    setFeatureDraft(prev => ({
      ...prev,
      preset: sanitizedPreset,
      handrailEnabled: nextHandrailEnabled,
      handrailHeight: String(Number(nextHandrailHeightFt.toFixed(settings.decimalPrecision))),
      handrailInset: String(Number(nextHandrailInsetFt.toFixed(settings.decimalPrecision))),
      handrailThickness: String(Number(nextHandrailThicknessFt.toFixed(settings.decimalPrecision))),
      blocksScaffold: nextAnalysis.blocksScaffold,
      supportsScaffold: nextAnalysis.supportsScaffold,
    }))
    updateBuildingEntity(selectedFeatureEntity.id, {
      color: selectedFeatureHost?.color ?? selectedFeatureEntity.color,
      params: {
        ...selectedFeatureEntity.params,
        preset: sanitizedPreset,
        balconyHandrailEnabled: nextHandrailEnabled,
        balconyHandrailHeightFt: nextHandrailHeightFt,
        balconyHandrailInsetFt: nextHandrailInsetFt,
        balconyHandrailThicknessFt: nextHandrailThicknessFt,
      },
      analysis: nextAnalysis,
    })
  }, [canEditSelected, selectedFeatureEntity, selectedFeatureHost, settings.decimalPrecision, updateBuildingEntity])

  const commitFeatureNumeric = useCallback((field: 'widthFt' | 'depthFt' | 'heightFt' | 'offsetUFt' | 'offsetVFt' | 'balconyHandrailHeightFt' | 'balconyHandrailInsetFt' | 'balconyHandrailThicknessFt', nextValue: string) => {
    if (!selectedFeatureEntity || !canEditSelected) return
    const draftFieldMap = {
      widthFt: 'width',
      depthFt: 'depth',
      heightFt: 'height',
      offsetUFt: 'offsetU',
      offsetVFt: 'offsetV',
      balconyHandrailHeightFt: 'handrailHeight',
      balconyHandrailInsetFt: 'handrailInset',
      balconyHandrailThicknessFt: 'handrailThickness',
    } as const
    setFeatureDraft(prev => ({ ...prev, [draftFieldMap[field]]: nextValue }))
    const parsed = Number(nextValue)
    if (!Number.isFinite(parsed)) return
    if ((field === 'widthFt' || field === 'depthFt' || field === 'heightFt' || field === 'balconyHandrailHeightFt' || field === 'balconyHandrailThicknessFt') && parsed <= 0) return
    if (field === 'balconyHandrailInsetFt' && parsed < 0) return
    updateBuildingEntity(selectedFeatureEntity.id, {
      params: {
        ...selectedFeatureEntity.params,
        [field]: parsed,
      },
    })
  }, [canEditSelected, selectedFeatureEntity, updateBuildingEntity])

  const commitSideFeatureFace = useCallback((nextFaceId: SideFeatureFaceId) => {
    if (!selectedFeatureEntity || selectedFeatureEntity.kind !== 'side-feature' || !selectedFeatureHost || !isBaseMassEntity(selectedFeatureHost) || !canEditSelected) return
    const currentFace = getBaseMassFaceInfo(selectedFeatureHost, selectedFeatureEntity.host.faceId)
    const nextFace = getBaseMassFaceInfo(selectedFeatureHost, nextFaceId)
    if (!currentFace || !nextFace) return
    const anchorPoint = resolveHostedAnchorPoint(
      currentFace,
      selectedFeatureEntity.params.offsetUFt,
      selectedFeatureEntity.params.offsetVFt,
    )
    const nextOffsets = clampHostedOffsetsToFace(
      nextFace,
      selectedFeatureEntity.params.widthFt,
      selectedFeatureEntity.params.heightFt,
      projectHostedOffsets(nextFace, anchorPoint),
    )
    setFeatureDraft(prev => ({ ...prev, faceId: nextFaceId }))
    updateBuildingEntity(selectedFeatureEntity.id, {
      host: {
        ...selectedFeatureEntity.host,
        hostKind: 'side-face',
        faceId: nextFaceId,
      },
      params: {
        ...selectedFeatureEntity.params,
        offsetUFt: nextOffsets.offsetUFt,
        offsetVFt: nextOffsets.offsetVFt,
      },
    })
  }, [canEditSelected, selectedFeatureEntity, selectedFeatureHost, updateBuildingEntity])

  const commitFeatureAnalysisFlag = useCallback((field: 'blocksScaffold' | 'supportsScaffold', checked: boolean) => {
    if (!selectedFeatureEntity || !canEditSelected) return
    setFeatureDraft(prev => ({ ...prev, [field]: checked }))
    updateBuildingEntity(selectedFeatureEntity.id, {
      analysis: {
        ...selectedFeatureEntity.analysis,
        [field]: checked,
      },
    })
  }, [canEditSelected, selectedFeatureEntity, updateBuildingEntity])

  const commitFeatureHandrailEnabled = useCallback((checked: boolean) => {
    if (!selectedFeatureEntity || !canEditSelected) return
    setFeatureDraft(prev => ({ ...prev, handrailEnabled: checked }))
    updateBuildingEntity(selectedFeatureEntity.id, {
      params: {
        ...selectedFeatureEntity.params,
        balconyHandrailEnabled: checked,
      },
    })
  }, [canEditSelected, selectedFeatureEntity, updateBuildingEntity])

  const commitProxyMode = useCallback((nextMode: ProxyFeatureMode) => {
    if (!selectedProxyEntity || !canEditSelected) return
    setProxyDraft(prev => ({
      ...prev,
      mode: nextMode,
      blocksScaffold: nextMode === 'cut' ? false : prev.blocksScaffold,
      supportsScaffold: nextMode === 'cut' ? false : prev.supportsScaffold,
    }))
    updateBuildingEntity(selectedProxyEntity.id, {
      color: getProxyDefaultColor(nextMode),
      params: {
        ...selectedProxyEntity.params,
        mode: nextMode,
      },
      analysis: nextMode === 'cut'
        ? {
            ...selectedProxyEntity.analysis,
            blocksScaffold: false,
            supportsScaffold: false,
          }
        : selectedProxyEntity.analysis,
    })
  }, [canEditSelected, selectedProxyEntity, updateBuildingEntity])

  const commitProxyNumeric = useCallback((field: 'widthFt' | 'depthFt' | 'heightFt' | 'offsetUFt' | 'offsetVFt', nextValue: string) => {
    if (!selectedProxyEntity || !canEditSelected) return
    const draftFieldMap = {
      widthFt: 'width',
      depthFt: 'depth',
      heightFt: 'height',
      offsetUFt: 'offsetU',
      offsetVFt: 'offsetV',
    } as const
    setProxyDraft(prev => ({ ...prev, [draftFieldMap[field]]: nextValue }))
    const parsed = Number(nextValue)
    if (!Number.isFinite(parsed)) return
    if ((field === 'widthFt' || field === 'depthFt' || field === 'heightFt') && parsed <= 0) return
    updateBuildingEntity(selectedProxyEntity.id, {
      params: {
        ...selectedProxyEntity.params,
        [field]: parsed,
      },
    })
  }, [canEditSelected, selectedProxyEntity, updateBuildingEntity])

  const commitProxyFace = useCallback((nextFaceId: 'top' | SideFeatureFaceId) => {
    if (!selectedProxyEntity || !selectedProxyHost || !isBaseMassEntity(selectedProxyHost) || !canEditSelected) return
    const allowedFaces = getProxyFaceOptionsForHostShape(selectedProxyHost.params.shape).map(option => option.value)
    const sanitizedFaceId = allowedFaces.includes(nextFaceId) ? nextFaceId : 'top'
    const currentFace = getBaseMassFaceInfo(selectedProxyHost, selectedProxyEntity.host.faceId)
    const nextFace = getBaseMassFaceInfo(selectedProxyHost, sanitizedFaceId)
    if (!currentFace || !nextFace) return
    const anchorPoint = resolveHostedAnchorPoint(
      currentFace,
      selectedProxyEntity.params.offsetUFt,
      selectedProxyEntity.params.offsetVFt,
    )
    const swapDepthAndHeight = (selectedProxyEntity.host.faceId === 'top') !== (sanitizedFaceId === 'top')
    const nextDepthFt = swapDepthAndHeight
      ? selectedProxyEntity.params.heightFt
      : selectedProxyEntity.params.depthFt
    const nextHeightFt = swapDepthAndHeight
      ? selectedProxyEntity.params.depthFt
      : selectedProxyEntity.params.heightFt
    const nextPlaneSpanVFt = sanitizedFaceId === 'top' ? nextDepthFt : nextHeightFt
    const projectedOffsets = projectHostedOffsets(nextFace, anchorPoint)
    const nextOffsets = sanitizedFaceId === 'top'
      ? clampTopHostedOffsetsToHost(
          selectedProxyHost,
          selectedProxyEntity.params.widthFt,
          nextDepthFt,
          projectedOffsets,
        )
      : clampHostedOffsetsToFace(
          nextFace,
          selectedProxyEntity.params.widthFt,
          nextPlaneSpanVFt,
          projectedOffsets,
        )
    setProxyDraft(prev => ({ ...prev, faceId: sanitizedFaceId }))
    updateBuildingEntity(selectedProxyEntity.id, {
      host: {
        ...selectedProxyEntity.host,
        hostKind: sanitizedFaceId === 'top' ? 'top-face' : 'side-face',
        faceId: sanitizedFaceId,
      },
      params: {
        ...selectedProxyEntity.params,
        depthFt: nextDepthFt,
        heightFt: nextHeightFt,
        offsetUFt: nextOffsets.offsetUFt,
        offsetVFt: nextOffsets.offsetVFt,
      },
    })
  }, [canEditSelected, selectedProxyEntity, selectedProxyHost, updateBuildingEntity])

  const commitProxyAnalysisFlag = useCallback((field: 'blocksScaffold' | 'supportsScaffold', checked: boolean) => {
    if (!selectedProxyEntity || !canEditSelected || selectedProxyEntity.params.mode === 'cut') return
    setProxyDraft(prev => ({ ...prev, [field]: checked }))
    updateBuildingEntity(selectedProxyEntity.id, {
      analysis: {
        ...selectedProxyEntity.analysis,
        [field]: checked,
      },
    })
  }, [canEditSelected, selectedProxyEntity, updateBuildingEntity])

  const commitPatternContentType = useCallback((nextContentType: HostedPatternContentType) => {
    if (!editablePatternEntity || !editablePatternHost || !canEditSelected) return
    const faceId = editablePatternEntity.host.faceId === 'top' ? 'top' : editablePatternEntity.host.faceId
    const nextFeaturePreset = sanitizePatternFeaturePresetForFace(faceId, editablePatternEntity.params.featurePreset)
    const nextHandrailEnabled = getHostedFeatureDefaultHandrailEnabled(nextFeaturePreset)
    const nextHandrailHeightFt = getHostedFeatureDefaultHandrailHeightFt(nextFeaturePreset)
    const nextHandrailInsetFt = getHostedFeatureDefaultHandrailInsetFt(nextFeaturePreset)
    const nextHandrailThicknessFt = getHostedFeatureDefaultHandrailThicknessFt(nextFeaturePreset)
    const previousDefaultAnalysis = getHostedPatternDefaultAnalysis(
      editablePatternEntity.params.contentType,
      sanitizePatternFeaturePresetForFace(faceId, editablePatternEntity.params.featurePreset),
    )
    const nextDefaultAnalysis = getHostedPatternDefaultAnalysis(nextContentType, nextFeaturePreset)
    const preserveAnalysisOverride = (
      editablePatternEntity.analysis.blocksScaffold !== previousDefaultAnalysis.blocksScaffold
      || editablePatternEntity.analysis.supportsScaffold !== previousDefaultAnalysis.supportsScaffold
      || editablePatternEntity.analysis.countsAsRoof !== previousDefaultAnalysis.countsAsRoof
      || editablePatternEntity.analysis.countsAsPerimeter !== previousDefaultAnalysis.countsAsPerimeter
    )
    const nextAnalysis = nextContentType === 'cut-volume'
      ? nextDefaultAnalysis
      : preserveAnalysisOverride
        ? {
            ...nextDefaultAnalysis,
            blocksScaffold: editablePatternEntity.analysis.blocksScaffold,
            supportsScaffold: editablePatternEntity.analysis.supportsScaffold,
          }
        : nextDefaultAnalysis

    setPatternDraft((prev) => ({
      ...prev,
      contentType: nextContentType,
      featurePreset: nextFeaturePreset,
      handrailEnabled: nextHandrailEnabled,
      handrailHeight: String(Number(nextHandrailHeightFt.toFixed(settings.decimalPrecision))),
      handrailInset: String(Number(nextHandrailInsetFt.toFixed(settings.decimalPrecision))),
      handrailThickness: String(Number(nextHandrailThicknessFt.toFixed(settings.decimalPrecision))),
      blocksScaffold: nextAnalysis.blocksScaffold,
      supportsScaffold: nextAnalysis.supportsScaffold,
    }))
    applyEditablePatternUpdate({
      color: getHostedPatternDefaultColor(nextContentType, editablePatternHost.color),
      params: {
        ...editablePatternEntity.params,
        contentType: nextContentType,
        featurePreset: nextContentType === 'feature' ? nextFeaturePreset : editablePatternEntity.params.featurePreset,
        balconyHandrailEnabled: nextHandrailEnabled,
        balconyHandrailHeightFt: nextHandrailHeightFt,
        balconyHandrailInsetFt: nextHandrailInsetFt,
        balconyHandrailThicknessFt: nextHandrailThicknessFt,
      },
      analysis: nextAnalysis,
    })
  }, [applyEditablePatternUpdate, canEditSelected, editablePatternEntity, editablePatternHost, settings.decimalPrecision])

  const commitPatternFeaturePreset = useCallback((nextPreset: HostedFeaturePreset) => {
    if (!editablePatternEntity || !editablePatternHost || !canEditSelected || editablePatternEntity.params.contentType !== 'feature') return
    const faceId = editablePatternEntity.host.faceId === 'top' ? 'top' : editablePatternEntity.host.faceId
    const sanitizedPreset = sanitizePatternFeaturePresetForFace(faceId, nextPreset)
    const nextHandrailEnabled = getHostedFeatureDefaultHandrailEnabled(sanitizedPreset)
    const nextHandrailHeightFt = getHostedFeatureDefaultHandrailHeightFt(sanitizedPreset)
    const nextHandrailInsetFt = getHostedFeatureDefaultHandrailInsetFt(sanitizedPreset)
    const nextHandrailThicknessFt = getHostedFeatureDefaultHandrailThicknessFt(sanitizedPreset)
    const previousDefaultAnalysis = getHostedPatternDefaultAnalysis('feature', sanitizePatternFeaturePresetForFace(faceId, editablePatternEntity.params.featurePreset))
    const nextDefaultAnalysis = getHostedPatternDefaultAnalysis('feature', sanitizedPreset)
    const preserveAnalysisOverride = (
      editablePatternEntity.analysis.blocksScaffold !== previousDefaultAnalysis.blocksScaffold
      || editablePatternEntity.analysis.supportsScaffold !== previousDefaultAnalysis.supportsScaffold
      || editablePatternEntity.analysis.countsAsRoof !== previousDefaultAnalysis.countsAsRoof
      || editablePatternEntity.analysis.countsAsPerimeter !== previousDefaultAnalysis.countsAsPerimeter
    )
    const nextAnalysis = preserveAnalysisOverride
      ? editablePatternEntity.analysis
      : nextDefaultAnalysis

    setPatternDraft((prev) => ({
      ...prev,
      featurePreset: sanitizedPreset,
      handrailEnabled: nextHandrailEnabled,
      handrailHeight: String(Number(nextHandrailHeightFt.toFixed(settings.decimalPrecision))),
      handrailInset: String(Number(nextHandrailInsetFt.toFixed(settings.decimalPrecision))),
      handrailThickness: String(Number(nextHandrailThicknessFt.toFixed(settings.decimalPrecision))),
      blocksScaffold: nextAnalysis.blocksScaffold,
      supportsScaffold: nextAnalysis.supportsScaffold,
    }))
    applyEditablePatternUpdate({
      color: editablePatternHost.color,
      params: {
        ...editablePatternEntity.params,
        featurePreset: sanitizedPreset,
        balconyHandrailEnabled: nextHandrailEnabled,
        balconyHandrailHeightFt: nextHandrailHeightFt,
        balconyHandrailInsetFt: nextHandrailInsetFt,
        balconyHandrailThicknessFt: nextHandrailThicknessFt,
      },
      analysis: nextAnalysis,
    })
  }, [applyEditablePatternUpdate, canEditSelected, editablePatternEntity, editablePatternHost, settings.decimalPrecision])

  const commitPatternFace = useCallback((nextFaceId: 'top' | SideFeatureFaceId) => {
    if (!editablePatternEntity || !editablePatternHost || !canEditSelected) return
    const allowedFaces = getPatternFaceOptionsForHostShape(editablePatternHost.params.shape).map((option) => option.value)
    const sanitizedFaceId = allowedFaces.includes(nextFaceId) ? nextFaceId : 'top'
    const currentFaceId = editablePatternEntity.host.faceId === 'top' ? 'top' : editablePatternEntity.host.faceId
    const swapDepthAndHeight = (currentFaceId === 'top') !== (sanitizedFaceId === 'top')
    const nextDepthFt = swapDepthAndHeight
      ? editablePatternEntity.params.heightFt
      : editablePatternEntity.params.depthFt
    const nextHeightFt = swapDepthAndHeight
      ? editablePatternEntity.params.depthFt
      : editablePatternEntity.params.heightFt
    const nextFeaturePreset = editablePatternEntity.params.contentType === 'feature'
      ? sanitizePatternFeaturePresetForFace(sanitizedFaceId, editablePatternEntity.params.featurePreset)
      : editablePatternEntity.params.featurePreset
    const nextHandrailPreset = nextFeaturePreset ?? 'balcony'
    const nextHandrailEnabled = getHostedFeatureDefaultHandrailEnabled(nextHandrailPreset)
    const nextHandrailHeightFt = getHostedFeatureDefaultHandrailHeightFt(nextHandrailPreset)
    const nextHandrailInsetFt = getHostedFeatureDefaultHandrailInsetFt(nextHandrailPreset)
    const nextHandrailThicknessFt = getHostedFeatureDefaultHandrailThicknessFt(nextHandrailPreset)
    const nextWrapMode: HostedPatternWrapMode = (
      editablePatternHost.params.shape === 'rect'
      && sanitizedFaceId !== 'top'
    )
      ? (
          editablePatternEntity.params.wrapMode === 'all-walls'
            ? 'all-walls'
            : editablePatternEntity.params.wrapMode === 'selected-walls'
              ? 'selected-walls'
              : 'single-face'
        )
      : 'single-face'
    const nextCornerBehavior = sanitizeHostedPatternCornerBehavior(
      editablePatternEntity.params.cornerBehavior,
      sanitizedFaceId,
      nextWrapMode,
    )
    const nextWallFaceIds = sanitizedFaceId === 'top'
      ? []
      : nextWrapMode === 'all-walls'
        ? sanitizeHostedPatternWallFaceIds(
            SIDE_FEATURE_FACE_OPTIONS.map((option) => option.value),
            sanitizedFaceId,
          )
        : nextWrapMode === 'selected-walls'
          ? sanitizeHostedPatternWallFaceIds(
              editablePatternEntity.params.wallFaceIds,
              sanitizedFaceId,
            )
          : [sanitizedFaceId]
    const previousDefaultAnalysis = getHostedPatternDefaultAnalysis(
      editablePatternEntity.params.contentType,
      sanitizePatternFeaturePresetForFace(currentFaceId, editablePatternEntity.params.featurePreset),
    )
    const nextDefaultAnalysis = getHostedPatternDefaultAnalysis(
      editablePatternEntity.params.contentType,
      sanitizePatternFeaturePresetForFace(sanitizedFaceId, nextFeaturePreset),
    )
    const preserveAnalysisOverride = (
      editablePatternEntity.analysis.blocksScaffold !== previousDefaultAnalysis.blocksScaffold
      || editablePatternEntity.analysis.supportsScaffold !== previousDefaultAnalysis.supportsScaffold
      || editablePatternEntity.analysis.countsAsRoof !== previousDefaultAnalysis.countsAsRoof
      || editablePatternEntity.analysis.countsAsPerimeter !== previousDefaultAnalysis.countsAsPerimeter
    )
    const nextAnalysis = editablePatternEntity.params.contentType === 'cut-volume'
      ? nextDefaultAnalysis
      : preserveAnalysisOverride
        ? {
            ...nextDefaultAnalysis,
            blocksScaffold: editablePatternEntity.analysis.blocksScaffold,
            supportsScaffold: editablePatternEntity.analysis.supportsScaffold,
          }
        : nextDefaultAnalysis

    setPatternDraft((prev) => ({
      ...prev,
      faceId: sanitizedFaceId,
      wrapMode: nextWrapMode,
      cornerBehavior: nextCornerBehavior,
      wallFaceIds: nextWallFaceIds,
      featurePreset: sanitizePatternFeaturePresetForFace(sanitizedFaceId, nextFeaturePreset),
      depth: String(Number(nextDepthFt.toFixed(settings.decimalPrecision))),
      height: String(Number(nextHeightFt.toFixed(settings.decimalPrecision))),
      handrailEnabled: nextHandrailEnabled,
      handrailHeight: String(Number(nextHandrailHeightFt.toFixed(settings.decimalPrecision))),
      handrailInset: String(Number(nextHandrailInsetFt.toFixed(settings.decimalPrecision))),
      handrailThickness: String(Number(nextHandrailThicknessFt.toFixed(settings.decimalPrecision))),
      blocksScaffold: nextAnalysis.blocksScaffold,
      supportsScaffold: nextAnalysis.supportsScaffold,
    }))
    const nextPattern: HostedPatternEntity = {
      ...editablePatternEntity,
      host: {
        ...editablePatternEntity.host,
        hostKind: sanitizedFaceId === 'top' ? 'top-face' : 'side-face',
        faceId: sanitizedFaceId,
      },
      params: {
        ...editablePatternEntity.params,
        featurePreset: nextFeaturePreset,
        balconyHandrailEnabled: nextHandrailEnabled,
        balconyHandrailHeightFt: nextHandrailHeightFt,
        balconyHandrailInsetFt: nextHandrailInsetFt,
        balconyHandrailThicknessFt: nextHandrailThicknessFt,
        wrapMode: nextWrapMode,
        cornerBehavior: nextCornerBehavior,
        wallFaceIds: nextWallFaceIds,
        depthFt: nextDepthFt,
        heightFt: nextHeightFt,
      },
      analysis: nextAnalysis,
    }
    const remappedState = remapHostedPatternInstanceState({
      previousInstances: resolveHostedPatternInstances(editablePatternEntity, editablePatternHost),
      nextInstances: resolveHostedPatternInstances(nextPattern, editablePatternHost),
      previousOverrides: editablePatternEntity.instanceOverrides,
      previousSkippedInstanceIds: editablePatternEntity.skippedInstanceIds,
      selectedInstanceId: selectedHostedPatternInstance?.patternId === editablePatternEntity.id
        ? selectedHostedPatternInstance.instanceId
        : null,
    })
    if (selectedHostedPatternInstance?.patternId === editablePatternEntity.id) {
      setSelectedHostedPatternInstance(remappedState.selectedInstanceId ? {
        patternId: editablePatternEntity.id,
        instanceId: remappedState.selectedInstanceId,
      } : null)
    }
    applyEditablePatternUpdate({
      host: nextPattern.host,
      params: nextPattern.params,
      analysis: nextAnalysis,
      instanceOverrides: remappedState.instanceOverrides,
      skippedInstanceIds: remappedState.skippedInstanceIds,
    })
  }, [
    applyEditablePatternUpdate,
    canEditSelected,
    editablePatternEntity,
    editablePatternHost,
    selectedHostedPatternInstance,
    setSelectedHostedPatternInstance,
    settings.decimalPrecision,
  ])

  const commitPatternWrapMode = useCallback((nextWrapMode: HostedPatternWrapMode) => {
    if (!editablePatternEntity || !editablePatternHost || !canEditSelected) return
    const canWrapWalls = editablePatternHost.params.shape === 'rect' && editablePatternEntity.host.faceId !== 'top'
    const startFaceId = editablePatternEntity.host.faceId === 'top' ? null : editablePatternEntity.host.faceId
    const sanitizedWrapMode: HostedPatternWrapMode = canWrapWalls
      ? (
          nextWrapMode === 'all-walls'
            ? 'all-walls'
            : nextWrapMode === 'selected-walls'
              ? 'selected-walls'
              : 'single-face'
        )
      : 'single-face'
    const nextWallFaceIds = !startFaceId
      ? []
      : sanitizedWrapMode === 'all-walls'
        ? sanitizeHostedPatternWallFaceIds(
            SIDE_FEATURE_FACE_OPTIONS.map((option) => option.value),
            startFaceId,
          )
        : sanitizedWrapMode === 'selected-walls'
          ? sanitizeHostedPatternWallFaceIds(patternDraft.wallFaceIds, startFaceId)
          : [startFaceId]
    const nextCornerBehavior = sanitizeHostedPatternCornerBehavior(
      patternDraft.cornerBehavior,
      editablePatternEntity.host.faceId,
      sanitizedWrapMode,
    )
    const nextPattern: HostedPatternEntity = {
      ...editablePatternEntity,
      params: {
        ...editablePatternEntity.params,
        wrapMode: sanitizedWrapMode,
        cornerBehavior: nextCornerBehavior,
        wallFaceIds: nextWallFaceIds,
      },
    }
    const remappedState = remapHostedPatternInstanceState({
      previousInstances: resolveHostedPatternInstances(editablePatternEntity, editablePatternHost),
      nextInstances: resolveHostedPatternInstances(nextPattern, editablePatternHost),
      previousOverrides: editablePatternEntity.instanceOverrides,
      previousSkippedInstanceIds: editablePatternEntity.skippedInstanceIds,
      selectedInstanceId: selectedHostedPatternInstance?.patternId === editablePatternEntity.id
        ? selectedHostedPatternInstance.instanceId
        : null,
    })
    setPatternDraft((prev) => ({
      ...prev,
      wrapMode: sanitizedWrapMode,
      cornerBehavior: nextCornerBehavior,
      wallFaceIds: nextWallFaceIds,
    }))
    if (selectedHostedPatternInstance?.patternId === editablePatternEntity.id) {
      setSelectedHostedPatternInstance(remappedState.selectedInstanceId ? {
        patternId: editablePatternEntity.id,
        instanceId: remappedState.selectedInstanceId,
      } : null)
    }
    applyEditablePatternUpdate({
      params: nextPattern.params,
      instanceOverrides: remappedState.instanceOverrides,
      skippedInstanceIds: remappedState.skippedInstanceIds,
    })
  }, [
    applyEditablePatternUpdate,
    canEditSelected,
    editablePatternEntity,
    editablePatternHost,
    patternDraft.cornerBehavior,
    patternDraft.wallFaceIds,
    selectedHostedPatternInstance,
    setSelectedHostedPatternInstance,
  ])

  const commitPatternCornerBehavior = useCallback((nextCornerBehavior: HostedPatternCornerBehavior) => {
    if (!editablePatternEntity || !editablePatternHost || !canEditSelected) return
    const sanitizedCornerBehavior = sanitizeHostedPatternCornerBehavior(
      nextCornerBehavior,
      editablePatternEntity.host.faceId,
      editablePatternEntity.params.wrapMode,
    )
    const nextPattern: HostedPatternEntity = {
      ...editablePatternEntity,
      params: {
        ...editablePatternEntity.params,
        cornerBehavior: sanitizedCornerBehavior,
      },
    }
    const remappedState = remapHostedPatternInstanceState({
      previousInstances: resolveHostedPatternInstances(editablePatternEntity, editablePatternHost),
      nextInstances: resolveHostedPatternInstances(nextPattern, editablePatternHost),
      previousOverrides: editablePatternEntity.instanceOverrides,
      previousSkippedInstanceIds: editablePatternEntity.skippedInstanceIds,
      selectedInstanceId: selectedHostedPatternInstance?.patternId === editablePatternEntity.id
        ? selectedHostedPatternInstance.instanceId
        : null,
    })
    setPatternDraft((prev) => ({
      ...prev,
      cornerBehavior: sanitizedCornerBehavior,
    }))
    if (selectedHostedPatternInstance?.patternId === editablePatternEntity.id) {
      setSelectedHostedPatternInstance(remappedState.selectedInstanceId ? {
        patternId: editablePatternEntity.id,
        instanceId: remappedState.selectedInstanceId,
      } : null)
    }
    applyEditablePatternUpdate({
      params: nextPattern.params,
      instanceOverrides: remappedState.instanceOverrides,
      skippedInstanceIds: remappedState.skippedInstanceIds,
    })
  }, [
    applyEditablePatternUpdate,
    canEditSelected,
    editablePatternEntity,
    editablePatternHost,
    selectedHostedPatternInstance,
    setSelectedHostedPatternInstance,
  ])

  const commitPatternWallFaceSelection = useCallback((faceId: SideFeatureFaceId, checked: boolean) => {
    if (!editablePatternEntity || !editablePatternHost || !canEditSelected) return
    if (editablePatternHost.params.shape !== 'rect' || editablePatternEntity.host.faceId === 'top') return
    const startFaceId = editablePatternEntity.host.faceId
    if (faceId === startFaceId) return
    const currentFaceIds = patternDraft.wallFaceIds.length > 0
      ? patternDraft.wallFaceIds
      : editablePatternEntity.params.wallFaceIds ?? []
    const nextWallFaceIds = sanitizeHostedPatternWallFaceIds(
      checked
        ? [...currentFaceIds, faceId]
        : currentFaceIds.filter((value) => value !== faceId),
      startFaceId,
    )
    setPatternDraft((prev) => ({
      ...prev,
      wrapMode: 'selected-walls',
      wallFaceIds: nextWallFaceIds,
    }))
    applyEditablePatternUpdate({
      params: {
        ...editablePatternEntity.params,
        wrapMode: 'selected-walls',
        wallFaceIds: nextWallFaceIds,
      },
    })
  }, [applyEditablePatternUpdate, canEditSelected, editablePatternEntity, editablePatternHost, patternDraft.wallFaceIds])

  const commitPatternNumeric = useCallback((
    field: 'widthFt' | 'depthFt' | 'heightFt' | 'balconyHandrailHeightFt' | 'balconyHandrailInsetFt' | 'balconyHandrailThicknessFt',
    nextValue: string,
  ) => {
    if (!editablePatternEntity || !canEditSelected) return
    const draftFieldMap = {
      widthFt: 'width',
      depthFt: 'depth',
      heightFt: 'height',
      balconyHandrailHeightFt: 'handrailHeight',
      balconyHandrailInsetFt: 'handrailInset',
      balconyHandrailThicknessFt: 'handrailThickness',
    } as const
    setPatternDraft((prev) => ({ ...prev, [draftFieldMap[field]]: nextValue }))
    const parsed = Number(nextValue)
    if (!Number.isFinite(parsed)) return
    if ((field === 'widthFt' || field === 'depthFt' || field === 'heightFt' || field === 'balconyHandrailHeightFt' || field === 'balconyHandrailThicknessFt') && parsed <= 0) return
    if (field === 'balconyHandrailInsetFt' && parsed < 0) return
    applyEditablePatternUpdate({
      params: {
        ...editablePatternEntity.params,
        [field]: parsed,
      },
    })
  }, [applyEditablePatternUpdate, canEditSelected, editablePatternEntity])

  const commitPatternHandrailEnabled = useCallback((checked: boolean) => {
    if (!editablePatternEntity || !canEditSelected || editablePatternEntity.params.contentType !== 'feature') return
    setPatternDraft((prev) => ({ ...prev, handrailEnabled: checked }))
    applyEditablePatternUpdate({
      params: {
        ...editablePatternEntity.params,
        balconyHandrailEnabled: checked,
      },
    })
  }, [applyEditablePatternUpdate, canEditSelected, editablePatternEntity])

  const commitPatternAxisMode = useCallback((axis: 'distributionU' | 'distributionV', nextMode: HostedPatternAxisMode) => {
    if (!editablePatternEntity || !canEditSelected) return
    setPatternDraft((prev) => ({
      ...prev,
      ...(axis === 'distributionU' ? { uMode: nextMode } : { vMode: nextMode }),
    }))
    applyEditablePatternUpdate({
      params: {
        ...editablePatternEntity.params,
        [axis]: {
          ...editablePatternEntity.params[axis],
          mode: nextMode,
        },
      },
    })
  }, [applyEditablePatternUpdate, canEditSelected, editablePatternEntity])

  const commitPatternAxisNumeric = useCallback((
    axis: 'distributionU' | 'distributionV',
    field: 'count' | 'spacingFt' | 'startSetbackFt' | 'endSetbackFt',
    nextValue: string,
  ) => {
    if (!editablePatternEntity || !canEditSelected) return
    const draftKeyMap = axis === 'distributionU'
      ? {
          count: 'uCount',
          spacingFt: 'uSpacing',
          startSetbackFt: 'uStart',
          endSetbackFt: 'uEnd',
        } as const
      : {
          count: 'vCount',
          spacingFt: 'vSpacing',
          startSetbackFt: 'vStart',
          endSetbackFt: 'vEnd',
        } as const
    setPatternDraft((prev) => ({ ...prev, [draftKeyMap[field]]: nextValue }))
    const parsed = Number(nextValue)
    if (!Number.isFinite(parsed)) return
    const normalizedValue = field === 'count'
      ? Math.max(1, Math.round(parsed))
      : Math.max(0, parsed)
    applyEditablePatternUpdate({
      params: {
        ...editablePatternEntity.params,
        [axis]: {
          ...editablePatternEntity.params[axis],
          [field]: normalizedValue,
        },
      },
    })
  }, [applyEditablePatternUpdate, canEditSelected, editablePatternEntity])

  const commitPatternAxisCentered = useCallback((axis: 'distributionU' | 'distributionV', centered: boolean) => {
    if (!editablePatternEntity || !canEditSelected) return
    setPatternDraft((prev) => ({
      ...prev,
      ...(axis === 'distributionU' ? { uCentered: centered } : { vCentered: centered }),
    }))
    applyEditablePatternUpdate({
      params: {
        ...editablePatternEntity.params,
        [axis]: {
          ...editablePatternEntity.params[axis],
          centered,
        },
      },
    })
  }, [applyEditablePatternUpdate, canEditSelected, editablePatternEntity])

  const commitPatternAnalysisFlag = useCallback((field: 'blocksScaffold' | 'supportsScaffold', checked: boolean) => {
    if (!editablePatternEntity || !canEditSelected || editablePatternEntity.params.contentType === 'cut-volume') return
    setPatternDraft((prev) => ({ ...prev, [field]: checked }))
    applyEditablePatternUpdate({
      analysis: {
        ...editablePatternEntity.analysis,
        [field]: checked,
      },
    })
  }, [applyEditablePatternUpdate, canEditSelected, editablePatternEntity])

  const patchPatternInstanceOverride = useCallback((patch: {
    hidden?: boolean
    offsetUFt?: number
    offsetVFt?: number
    widthFt?: number
    depthFt?: number
    heightFt?: number
    analysis?: Partial<HostedPatternEntity['analysis']>
  }) => {
    if (!selectedPatternEntity || !selectedPatternInstanceResolved) return
    const currentOverride = selectedPatternEntity.instanceOverrides[selectedPatternInstanceResolved.instanceId] ?? {}
    const nextOverride = {
      ...currentOverride,
      ...patch,
      ...(patch.analysis !== undefined
        ? { analysis: { ...(currentOverride.analysis ?? {}), ...(patch.analysis ?? {}) } }
        : {}),
    }
    updateBuildingEntity(selectedPatternEntity.id, {
      instanceOverrides: {
        ...selectedPatternEntity.instanceOverrides,
        [selectedPatternInstanceResolved.instanceId]: nextOverride,
      },
    })
  }, [selectedPatternEntity, selectedPatternInstanceResolved, updateBuildingEntity])

  const restoreOrResetPatternInstanceOverride = useCallback(() => {
    if (!selectedPatternEntity || !selectedPatternInstanceResolved) return
    if (selectedPatternDetachedEntityId) {
      removeBuildingEntity(selectedPatternDetachedEntityId)
    }
    const nextOverrides = { ...selectedPatternEntity.instanceOverrides }
    delete nextOverrides[selectedPatternInstanceResolved.instanceId]
    updateBuildingEntity(selectedPatternEntity.id, {
      instanceOverrides: nextOverrides,
      skippedInstanceIds: selectedPatternEntity.skippedInstanceIds.filter((candidate) => candidate !== selectedPatternInstanceResolved.instanceId),
    })
  }, [
    removeBuildingEntity,
    selectedPatternDetachedEntityId,
    selectedPatternEntity,
    selectedPatternInstanceResolved,
    updateBuildingEntity,
  ])

  const commitPatternInstanceHidden = useCallback((hidden: boolean) => {
    if (!selectedPatternEntity || !selectedPatternInstanceResolved || !canEditSelected || selectedPatternDetachedEntityId) return
    setPatternInstanceDraft((prev) => ({ ...prev, hidden }))
    patchPatternInstanceOverride({ hidden })
  }, [
    canEditSelected,
    patchPatternInstanceOverride,
    selectedPatternDetachedEntityId,
    selectedPatternEntity,
    selectedPatternInstanceResolved,
  ])

  const commitPatternInstanceNumeric = useCallback((field: 'widthFt' | 'depthFt' | 'heightFt' | 'offsetUFt' | 'offsetVFt', nextValue: string) => {
    if (!selectedPatternEntity || !selectedPatternInstanceResolved || !canEditSelected || selectedPatternDetachedEntityId) return
    const draftFieldMap = {
      widthFt: 'width',
      depthFt: 'depth',
      heightFt: 'height',
      offsetUFt: 'offsetU',
      offsetVFt: 'offsetV',
    } as const
    setPatternInstanceDraft((prev) => ({ ...prev, [draftFieldMap[field]]: nextValue }))
    const parsed = Number(nextValue)
    if (!Number.isFinite(parsed)) return
    if ((field === 'widthFt' || field === 'depthFt' || field === 'heightFt') && parsed <= 0) return
    patchPatternInstanceOverride({ [field]: parsed })
  }, [
    canEditSelected,
    patchPatternInstanceOverride,
    selectedPatternDetachedEntityId,
    selectedPatternEntity,
    selectedPatternInstanceResolved,
  ])

  const commitPatternInstanceAnalysisFlag = useCallback((field: 'blocksScaffold' | 'supportsScaffold', checked: boolean) => {
    if (
      !selectedPatternEntity
      || !selectedPatternInstanceResolved
      || !canEditSelected
      || selectedPatternEntity.params.contentType === 'cut-volume'
      || selectedPatternDetachedEntityId
    ) return
    setPatternInstanceDraft((prev) => ({ ...prev, [field]: checked }))
    patchPatternInstanceOverride({ analysis: { [field]: checked } })
  }, [
    canEditSelected,
    patchPatternInstanceOverride,
    selectedPatternDetachedEntityId,
    selectedPatternEntity,
    selectedPatternInstanceResolved,
  ])

  const handleDetachPatternInstance = useCallback(() => {
    if (
      !selectedPatternEntity
      || !selectedPatternHost
      || !selectedPatternInstanceResolved
      || !canEditSelected
      || selectedPatternInstanceResolved.hidden
      || selectedPatternDetachedEntityId
    ) return

    const now = Date.now()
    const uid = `${now}-${Math.random().toString(36).slice(2, 9)}`
    const faceId = selectedPatternInstanceResolved.faceId
    const baseParams = {
      color: selectedPatternEntity.color,
      analysis: selectedPatternInstanceResolved.analysis,
      children: [],
      createdAt: now,
      updatedAt: now,
    }

    const detachedEntity: HostedFeatureEntity | HostedProxyEntity = selectedPatternEntity.params.contentType === 'feature'
      ? (faceId === 'top'
          ? {
              id: `feature-top-${uid}`,
              category: 'feature',
              kind: 'top-feature',
              host: {
                entityId: selectedPatternHost.id,
                hostKind: 'top-face',
                faceId: 'top',
              },
              ...baseParams,
              params: {
                preset: selectedPatternInstanceResolved.featurePreset ?? sanitizePatternFeaturePresetForFace('top', selectedPatternEntity.params.featurePreset),
                widthFt: selectedPatternInstanceResolved.widthFt,
                depthFt: selectedPatternInstanceResolved.depthFt,
                heightFt: selectedPatternInstanceResolved.heightFt,
                offsetUFt: selectedPatternInstanceResolved.offsetUFt,
                offsetVFt: selectedPatternInstanceResolved.offsetVFt,
                balconyHandrailEnabled: selectedPatternEntity.params.balconyHandrailEnabled,
                balconyHandrailHeightFt: selectedPatternEntity.params.balconyHandrailHeightFt,
                balconyHandrailInsetFt: selectedPatternEntity.params.balconyHandrailInsetFt,
                balconyHandrailThicknessFt: selectedPatternEntity.params.balconyHandrailThicknessFt,
              },
            }
          : {
              id: `feature-side-${uid}`,
              category: 'feature',
              kind: 'side-feature',
              host: {
                entityId: selectedPatternHost.id,
                hostKind: 'side-face',
                faceId,
              },
              ...baseParams,
              params: {
                preset: selectedPatternInstanceResolved.featurePreset ?? sanitizePatternFeaturePresetForFace(faceId, selectedPatternEntity.params.featurePreset),
                widthFt: selectedPatternInstanceResolved.widthFt,
                depthFt: selectedPatternInstanceResolved.depthFt,
                heightFt: selectedPatternInstanceResolved.heightFt,
                offsetUFt: selectedPatternInstanceResolved.offsetUFt,
                offsetVFt: selectedPatternInstanceResolved.offsetVFt,
                balconyHandrailEnabled: selectedPatternEntity.params.balconyHandrailEnabled,
                balconyHandrailHeightFt: selectedPatternEntity.params.balconyHandrailHeightFt,
                balconyHandrailInsetFt: selectedPatternEntity.params.balconyHandrailInsetFt,
                balconyHandrailThicknessFt: selectedPatternEntity.params.balconyHandrailThicknessFt,
              },
            })
      : {
          id: `proxy-${selectedPatternEntity.params.contentType === 'cut-volume' ? 'cut' : 'add'}-${uid}`,
          category: 'proxy',
          kind: 'proxy-feature',
          host: {
            entityId: selectedPatternHost.id,
            hostKind: faceId === 'top' ? 'top-face' : 'side-face',
            faceId,
          },
          ...baseParams,
          params: {
            mode: selectedPatternEntity.params.contentType === 'cut-volume' ? 'cut' : 'add',
            widthFt: selectedPatternInstanceResolved.widthFt,
            depthFt: selectedPatternInstanceResolved.depthFt,
            heightFt: selectedPatternInstanceResolved.heightFt,
            offsetUFt: selectedPatternInstanceResolved.offsetUFt,
            offsetVFt: selectedPatternInstanceResolved.offsetVFt,
          },
        }

    addBuildingEntity(detachedEntity)
    if (!selectedPatternHost.children.includes(detachedEntity.id)) {
      updateBuildingEntity(selectedPatternHost.id, {
        children: [...selectedPatternHost.children, detachedEntity.id],
      })
    }

    const currentOverride = selectedPatternEntity.instanceOverrides[selectedPatternInstanceResolved.instanceId] ?? {}
    updateBuildingEntity(selectedPatternEntity.id, {
      skippedInstanceIds: selectedPatternEntity.skippedInstanceIds.filter((candidate) => candidate !== selectedPatternInstanceResolved.instanceId),
      instanceOverrides: {
        ...selectedPatternEntity.instanceOverrides,
        [selectedPatternInstanceResolved.instanceId]: {
          ...currentOverride,
          hidden: true,
          detachedEntityId: detachedEntity.id,
        },
      },
    })
  }, [
    addBuildingEntity,
    canEditSelected,
    selectedPatternDetachedEntityId,
    selectedPatternEntity,
    selectedPatternHost,
    selectedPatternInstanceResolved,
    updateBuildingEntity,
  ])

  const handleSelectDetachedPatternEntity = useCallback(() => {
    if (!selectedPatternDetachedEntity) return
    setSelectedHostedPatternInstance(null)
    setSelectedBuildingEntityId(selectedPatternDetachedEntity.id)
    setSelectedObjectId(selectedPatternDetachedEntity.id)
  }, [
    selectedPatternDetachedEntity,
    setSelectedBuildingEntityId,
    setSelectedHostedPatternInstance,
    setSelectedObjectId,
  ])

	const commitLiveLoadMagnitude = useCallback((nextValue: string) => {
		setLiveLoadDraft(nextValue)
		if (!selectedLiveLoad || !canEditSelected) return

		const parsed = Number(nextValue)
		if (!Number.isFinite(parsed) || parsed <= 0) {
			setLiveLoadDraft(String(Number(selectedLiveLoad.magnitudePsf.toFixed(2))))
			return
		}
		updateManualLiveLoadPlacement(selectedLiveLoad.id, { magnitudePsf: parsed })
	}, [canEditSelected, selectedLiveLoad, updateManualLiveLoadPlacement])

	const commitLiveLoadPlacementMagnitude = useCallback((nextValue: string) => {
		setLiveLoadPlacementDraft(nextValue)
		const parsed = Number(nextValue)
		if (!Number.isFinite(parsed) || parsed <= 0) {
			setLiveLoadPlacementDraft(String(Number(liveLoadPlacementPsf.toFixed(2))))
			return
		}
		setLiveLoadPlacementPsf(parsed)
		for (const block of scaffoldBlocks) {
			if ((block.liveLoadDeckLiftIndices ?? []).length === 0) continue
			updateScaffoldBlockLiveLoad(block.id, { liveLoadPsf: parsed })
		}
	}, [liveLoadPlacementPsf, scaffoldBlocks, setLiveLoadPlacementPsf, updateScaffoldBlockLiveLoad])

  const supportsSideFeatureActions = selectedBaseMassEntity?.params.shape === 'rect'
  const buildingSketchHint = isSketchingTopFeature
    ? 'Sketch mode active: drag on the highlighted top face to place a rooftop feature. Press Esc to cancel.'
    : isSketchingSideFeature
      ? 'Sketch mode active: move onto the building wall you want, then drag directly on that host face to place a side feature. Press Esc to cancel.'
      : isSketchingAddProxy
        ? 'Sketch mode active: move onto the top or wall face you want, then drag directly on that host face to place an additive volume. Press Esc to cancel.'
        : isSketchingCutProxy
          ? 'Sketch mode active: move onto the top or wall face you want, then drag directly on that host face to place a cut volume. Press Esc to cancel.'
          : null
  const buildingActionTiles = [
    {
      key: 'roof',
      tone: 'default' as const,
      token: 'Top',
      title: 'Roof',
      subtitle: selectedMassRoof ? 'Select hosted roof' : 'Top cap',
      status: selectedMassRoof ? 'Existing' : null,
      tooltip: selectedMassRoof
        ? 'Select the roof already hosted on this mass.'
        : 'Create a roof hosted on the top face of the selected mass.',
      onClick: handleAddOrSelectRoof,
      disabled: false,
      wide: false,
      active: false,
    },
    {
      key: 'parapet',
      tone: 'default' as const,
      token: 'Edge',
      title: 'Parapet',
      subtitle: selectedMassParapet ? 'Select perimeter wrap' : 'Perimeter wrap',
      status: selectedMassParapet ? 'Existing' : null,
      tooltip: selectedMassParapet
        ? 'Select the parapet already hosted on this mass.'
        : 'Wrap the selected roof edges or the full perimeter with a parapet.',
      onClick: handleAddOrSelectParapet,
      disabled: false,
      wide: false,
      active: false,
    },
    {
      key: 'top-feature',
      tone: 'default' as const,
      token: 'Sketch',
      title: 'Top Feature',
      subtitle: 'Rooftop feature',
      status: isSketchingTopFeature ? 'Active' : null,
      tooltip: isSketchingTopFeature
        ? 'Top-feature sketch mode is active. Click to cancel.'
        : 'Sketch a hosted rooftop feature such as a penthouse, unit, or rooftop box.',
      onClick: handleAddOrSelectTopFeature,
      disabled: false,
      wide: false,
      active: isSketchingTopFeature,
    },
    {
      key: 'side-feature',
      tone: 'default' as const,
      token: 'Wall',
      title: 'Side Feature',
      subtitle: supportsSideFeatureActions ? 'Wall-hosted sketch' : 'Rect wall hosts only',
      status: isSketchingSideFeature ? 'Active' : (!supportsSideFeatureActions ? 'Locked' : null),
      tooltip: supportsSideFeatureActions
        ? (isSketchingSideFeature
            ? 'Side-feature sketch mode is active. Click to cancel.'
            : 'Sketch a wall-hosted feature such as a balcony, canopy, or screen.')
        : 'Side-hosted feature sketching is currently limited to rectangular wall faces.',
      onClick: handleAddOrSelectSideFeature,
      disabled: !supportsSideFeatureActions,
      wide: false,
      active: isSketchingSideFeature,
    },
    {
      key: 'volume',
      tone: 'default' as const,
      token: 'Volume',
      title: 'Volume',
      subtitle: 'Additive volume',
      status: isSketchingAddProxy ? 'Active' : null,
      tooltip: isSketchingAddProxy
        ? 'Additive-volume sketch mode is active. Click to cancel.'
        : 'Sketch an additive volume for obstructions, placeholder geometry, or scaffold analysis.',
      onClick: () => handleAddProxyVolume('add'),
      disabled: false,
      wide: false,
      active: isSketchingAddProxy,
    },
    {
      key: 'cut-volume',
      tone: 'danger' as const,
      token: 'Volume',
      title: 'Cut Volume',
      subtitle: 'Subtract volume',
      status: isSketchingCutProxy ? 'Active' : null,
      tooltip: isSketchingCutProxy
        ? 'Cut-volume sketch mode is active. Click to cancel.'
        : 'Sketch a cut volume that subtracts support or occupied volume from the host.',
      onClick: () => handleAddProxyVolume('cut'),
      disabled: false,
      wide: false,
      active: isSketchingCutProxy,
    },
    {
      key: 'pattern',
      tone: 'default' as const,
      token: 'Repeat',
      title: 'Pattern on Face',
      subtitle: supportsSideFeatureActions ? 'Associative repeat' : 'Top repeat only',
      status: isPatternPreviewActive && buildingHostedPatternPreview?.host.entityId === selectedBaseMassEntity?.id ? 'Preview' : null,
      tooltip: supportsSideFeatureActions
        ? 'Create an associative repeated pattern on the top face or on any rectangular wall face. Click again to cancel the draft preview.'
        : 'Create an associative repeated pattern on the top face of the selected mass. Click again to cancel the draft preview.',
      onClick: handleAddPatternOnFace,
      disabled: false,
      wide: false,
      active: isPatternPreviewActive && buildingHostedPatternPreview?.host.entityId === selectedBaseMassEntity?.id,
    },
  ]
  const buildingFeatureActionTiles = buildingActionTiles.filter(tile => (
    tile.key === 'roof'
    || tile.key === 'parapet'
    || tile.key === 'top-feature'
    || tile.key === 'side-feature'
  ))
  const buildingVolumeActionTiles = buildingActionTiles.filter(tile => (
    tile.key === 'volume'
    || tile.key === 'cut-volume'
  ))
  const buildingPatternActionTiles = buildingActionTiles.filter(tile => tile.key === 'pattern')
  const renderBuildingActionTile = (tile: typeof buildingActionTiles[number]) => (
    <div
      key={tile.key}
      className={[
        'building-action-tile',
        tile.wide ? 'building-action-tile-wide' : '',
      ].filter(Boolean).join(' ')}
    >
      <button
        type="button"
        className={[
          'building-action-btn',
          tile.active ? 'is-active' : '',
          tile.disabled ? 'is-disabled' : '',
          tile.tone === 'danger' ? 'building-action-btn-cut' : '',
          tile.wide ? 'building-action-btn-wide' : '',
        ].filter(Boolean).join(' ')}
        onClick={tile.disabled ? undefined : tile.onClick}
        aria-disabled={tile.disabled || undefined}
        tabIndex={tile.disabled ? -1 : 0}
      >
        <span className="building-action-topline">
          <span className="building-action-token">{tile.token}</span>
          {tile.status ? (
            <span className={`building-action-status${tile.active ? ' is-active' : ''}${tile.disabled ? ' is-disabled' : ''}`}>
              {tile.status}
            </span>
          ) : null}
        </span>
        <span className="building-action-title-row">
          <span className="building-action-title">{tile.title}</span>
        </span>
        <span className="building-action-caption">{tile.subtitle}</span>
      </button>
      <span className="building-action-tooltip" role="tooltip">{tile.tooltip}</span>
    </div>
  )
  const buildingFeatureActionButtons = selectedBaseMassEntity ? (
    <div className="building-action-panel">
      <div className="building-section-header">
        <div className="building-section-kicker">Hosted Elements</div>
        <div className="building-section-note">Hover tools for detail</div>
      </div>
      <div className="building-action-stack">
        <div className="building-action-section">
          <div className="building-action-section-title">Features</div>
          <div className="building-action-grid">
            {buildingFeatureActionTiles.map(renderBuildingActionTile)}
          </div>
        </div>
        <div className="building-action-section">
          <div className="building-action-section-title">Volumes</div>
          <div className="building-action-grid">
            {buildingVolumeActionTiles.map(renderBuildingActionTile)}
          </div>
        </div>
        <div className="building-action-section">
          <div className="building-action-section-title">Patterns</div>
          <div className="building-action-grid">
            {buildingPatternActionTiles.map(renderBuildingActionTile)}
          </div>
        </div>
      </div>
      {buildingSketchHint ? (
        <div className="building-sketch-hint">
          {buildingSketchHint}
        </div>
      ) : null}
      {selectedMassHostedGroups.length > 0 ? (
        <div className="building-hosted-panel">
          <div className="building-section-kicker">Existing Hosted Items</div>
          <div className="building-hosted-groups">
            {selectedMassHostedGroups.map((group) => (
              <div className="building-hosted-group" key={group.key}>
                <div className="building-hosted-group-header">
                  <span className="building-hosted-group-title">{group.title}</span>
                  <span className="building-hosted-group-count">{group.items.length}</span>
                </div>
                <div className="building-hosted-chip-row">
                  {group.items.map((entity, index) => {
                    const labelBase = getHostedSelectionLabel(entity)
                    const label = group.items.length > 1 ? `${labelBase} ${index + 1}` : labelBase
                    return (
                      <button
                        type="button"
                        key={entity.id}
                        className={`building-hosted-chip${selectedBuildingEntityId === entity.id ? ' is-selected' : ''}`}
                        onClick={() => handleSelectHostedChild(entity.id)}
                      >
                        <span className="building-hosted-chip-title">{label}</span>
                        <span className="building-hosted-chip-caption">{getHostedSelectionCaption(entity)}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  ) : null

  const renderBuildingMetricStrip = (metrics: Array<{ label: string; value: ReactNode }>) => (
    <div className="block-dims building-metric-strip">
      {metrics.map((metric) => (
        <div className="block-dim-field" key={String(metric.label)}>
          <label>{metric.label}</label>
          <span className="block-dim-value">{metric.value}</span>
        </div>
      ))}
    </div>
  )

  const renderBuildingCard = (params: {
    title: string
    subtitle?: string
    actions?: ReactNode
    summary?: ReactNode
    body: ReactNode
    hint?: ReactNode
  }) => (
    <div className="block-card building-editor-card">
      <div className="block-card-header building-card-header">
        <div className="block-card-copy">
          <div className="block-card-title">{params.title}</div>
          {params.subtitle ? <div className="building-card-subtitle">{params.subtitle}</div> : null}
        </div>
        {params.actions ? <div className="building-card-header-actions">{params.actions}</div> : null}
      </div>
      {params.summary}
      <div className="building-card-body">{params.body}</div>
      {params.hint ? <div className="building-card-footnote properties-hint">{params.hint}</div> : null}
    </div>
  )

	const handleToggleLiveLoadLevel = useCallback((level: LiveLoadLevelSummary) => {
		const parsedDraft = Number(liveLoadPlacementDraft)
		const nextPsf = Number.isFinite(parsedDraft) && parsedDraft > 0 ? parsedDraft : liveLoadPlacementPsf
		const shouldEnable = !level.isActive || level.isPartial
		setActiveLiveLoadLevelNumber(level.levelNumber)
		setSelectedLiveLoadDeckTargets([])

		for (const entry of level.entries) {
			const block = scaffoldBlockById.get(entry.blockId)
			if (!block) continue
			const nextLiftSet = new Set(
				(block.liveLoadDeckLiftIndices ?? [])
					.map(value => Math.round(Number(value)))
					.filter(value => Number.isFinite(value)),
			)
			if (shouldEnable) nextLiftSet.add(entry.liftIndex)
			else nextLiftSet.delete(entry.liftIndex)

			updateScaffoldBlockLiveLoad(block.id, {
				...(shouldEnable ? { liveLoadPsf: nextPsf } : {}),
				liveLoadDeckLiftIndices: Array.from(nextLiftSet).sort((a, b) => a - b),
				...(shouldEnable
					? {
						liveLoadExcludedBayKeys: (block.liveLoadExcludedBayKeys ?? [])
							.filter(bayKey => !entry.bayKeys.includes(String(bayKey))),
					}
					: {}),
			})
		}
	}, [liveLoadPlacementDraft, liveLoadPlacementPsf, scaffoldBlockById, setActiveLiveLoadLevelNumber, setSelectedLiveLoadDeckTargets, updateScaffoldBlockLiveLoad])

	const handleSetSelectedLiveLoadSectionExcluded = useCallback((excluded: boolean) => {
		if (!selectedLiveLoadSectionState) return
		const parsedDraft = Number(liveLoadPlacementDraft)
		const nextPsf = Number.isFinite(parsedDraft) && parsedDraft > 0 ? parsedDraft : liveLoadPlacementPsf
		const nextByBlock = new Map<string, {
			block: ScaffoldBlockInstance
			liftSet: Set<number>
			excludedBayKeys: Set<string>
		}>()
		const targetEntries = selectedLiveLoadSectionState.mode === 'single'
			? selectedLiveLoadSectionState.entries
			: selectedLiveLoadSectionState.entries
		for (const focusedEntry of targetEntries) {
			const existing = nextByBlock.get(focusedEntry.block.id) ?? {
				block: focusedEntry.block,
				liftSet: new Set(
					(focusedEntry.block.liveLoadDeckLiftIndices ?? [])
						.map((value) => Math.round(Number(value)))
						.filter((value) => Number.isFinite(value)),
				),
				excludedBayKeys: new Set(
					(focusedEntry.block.liveLoadExcludedBayKeys ?? []).map((value) => String(value)),
				),
			}
			existing.liftSet.add(focusedEntry.entry.liftIndex)
			for (const bayKey of focusedEntry.focusedBayKeys) {
				if (excluded) existing.excludedBayKeys.add(bayKey)
				else existing.excludedBayKeys.delete(bayKey)
			}
			nextByBlock.set(focusedEntry.block.id, existing)
		}
		for (const { block, liftSet, excludedBayKeys } of nextByBlock.values()) {
			updateScaffoldBlockLiveLoad(block.id, {
				liveLoadPsf: nextPsf,
				liveLoadDeckLiftIndices: Array.from(liftSet).sort((a, b) => a - b),
				liveLoadExcludedBayKeys: Array.from(excludedBayKeys).sort(),
			})
		}
	}, [liveLoadPlacementDraft, liveLoadPlacementPsf, selectedLiveLoadSectionState, updateScaffoldBlockLiveLoad])

  const headerTitle = useMemo(() => {
				if (isBlockToolActive && selectedBlock) {
					return 'Block'
				}
			if (showLiveLoadPlacementControls) {
				return 'Live Load'
			}
			if (
				isBlockToolActive &&
				!selectedBaseComponentType &&
				!hasStandardSelected &&
				!selectedLedgerConnection &&
					!selectedLiveLoad &&
					!selectedDiagonal &&
				!selected
			) {
				return 'Block Generator'
			}
			if (selectedDiagonal) {
				return selectedDiagonal.partNumber ? getGenericPartDisplayName(selectedDiagonal.partNumber, 'braces') : 'Brace Diagonal'
			}
			if (selectedLiveLoad) {
				return 'Live Load'
			}
	    if (selectedBaseComponentType) {
	      const labels: Record<string, string> = {
	        'wood-sill': 'Wood Sill',
	        'screw-jack': 'Screw Jack',
	        'base-collar': 'Base Collar',
	      }
	      return labels[selectedBaseComponentType] || 'Base Component'
	    }
    if (hasStandardSelected) {
      if (selectedStacks.length === 1) {
					// If a stacked segment is selected, show the specific piece.
					if (selectedStandardSegment?.partNumber) {
						const { partNumber, segmentIndex, segmentCount } = selectedStandardSegment
						const displayPart = getGenericPartDisplayName(partNumber, 'standards')
						if (segmentCount > 0) return `${displayPart} (${segmentIndex + 1}/${segmentCount})`
						return displayPart
					}

					const parts = selectedStacks[0].standardSegments.map(s => String(s?.partNumber ?? '')).filter(Boolean)
					if (parts.length <= 1) return parts[0] ? getGenericPartDisplayName(parts[0], 'standards') : 'Standard'
					// More informative than "Top ...": show the full composition.
					const counts = new Map<string, number>()
					for (const p of parts) {
					const displayPart = getGenericPartDisplayName(p, 'standards')
					counts.set(displayPart, (counts.get(displayPart) ?? 0) + 1)
				}
					const summary = Array.from(counts.entries())
						.map(([pn, c]) => (c > 1 ? `${pn} x${c}` : pn))
						.join(' + ')
					return `Stack (${parts.length}) - ${summary}`
      }
      return `Standards (${selectedStacks.length})`
    }
    if (selectedLedgerConnection) {
      return getGenericPartDisplayName(
        selectedLedgerConnection.ledgerPartNumber,
        selectedLedgerConnection.ledgerPartNumber.startsWith('UHT') ? 'trusses' : 'ledgers',
      )
    }
    if (selected) return 'Selection'
    return workspaceMode === 'SCAFFOLD_MODE' ? 'Workspace Defaults' : 'Workspace'
	  }, [
		isBlockToolActive,
			selectedBlock,
		showLiveLoadPlacementControls,
		hasStandardSelected,
		selectedStacks,
			selectedStandardSegment,
		selectedLedgerConnection,
			selectedLiveLoad,
			selectedDiagonal,
		selectedBaseComponentType,
		selected,
		workspaceMode,
	])

  // Generate subtitle based on object type
	const getSubtitle = () => {
				if (isBlockToolActive && selectedBlock) {
					return 'Edit dimensions in Blocks mode, then Apply (manual edits inside the block are preserved)'
				}
			if (showLiveLoadPlacementControls) {
				return 'Set the live load psf, then click the working levels that should load the full scaffold run'
			}
			if (
				isBlockToolActive &&
				!selectedBaseComponentType &&
				!hasStandardSelected &&
				!selectedLedgerConnection &&
				!selectedLiveLoad &&
				!selectedDiagonal &&
				!selected
			) {
				return 'Configure dimensions, then click the grid to place a scaffold block'
			}
			if (selectedDiagonal) {
				const weight = selectedWeight
				return weight !== null ? `Brace diagonal - ${formatDisplayWeight(weight)}` : 'Brace diagonal'
			}
			if (selectedLiveLoad) {
				return `One-way bay load | ${selectedLiveLoad.magnitudePsf.toFixed(1)} psf`
			}
	    if (selectedBaseComponentType) {
	      const labels: Record<string, string> = {
	        'wood-sill': 'Wood Sill',
	        'screw-jack': 'Screw Jack',
	        'base-collar': 'Base Collar',
	      }
	      const label = labels[selectedBaseComponentType] || 'Base Component'
	      const weight = selectedWeight
	      if (weight !== null) return `${label} - ${formatDisplayWeight(weight)}`
	      return label
	    }
    if (hasStandardSelected) {
      if (selectedStacks.length === 1) {
				const segCount = selectedStacks[0].standardSegments.length
        const weight = selectedWeight
				const label = segCount > 1 ? 'Standard Stack' : 'Standard'
				if (weight !== null) return `${label} - ${formatDisplayWeight(weight)}`
				return label
      }
      if (!hasEligibleBaseSelection) return 'Base assembly unavailable for stacked standards'
      return 'Editing selected standard(s)'
    }
    if (selectedLedgerConnection) {
      const partNum = selectedLedgerConnection.ledgerPartNumber
      const type = partNum.startsWith('UHT') ? 'Truss' : 'Ledger'
      const weight = selectedWeight
      if (weight !== null) return `${type} - ${formatDisplayWeight(weight)}`
      return type
    }
    if (!selected && !selectedBuildingEntity) {
      return workspaceMode === 'SCAFFOLD_MODE' ? 'No selection (defaults)' : 'No selection'
    }
    if (isSketchingTopFeature) return 'Selected: sketching top feature'
    if (isSketchingSideFeature) return 'Selected: sketching side feature'
    if (isSketchingAddProxy) return 'Selected: sketching volume'
    if (isSketchingCutProxy) return 'Selected: sketching cut volume'
    if (selectedRoofEntity) return `Selected: ${getRoofTypeLabel(selectedRoofEntity.kind).toLowerCase()}`
    if (selectedParapetEntity) return 'Selected: parapet'
    if (selectedFeatureEntity) return `Selected: ${getHostedFeaturePresetLabel(selectedFeatureEntity.params.preset).toLowerCase()}`
    if (selectedProxyEntity) return `Selected: ${getProxyModeLabel(selectedProxyEntity.params.mode).toLowerCase()}`
    if (selectedPatternInstanceResolved) return 'Selected: pattern instance'
    if (selectedPatternEntity) return `Selected: ${getHostedPatternContentLabel(selectedPatternEntity.params.contentType, selectedPatternEntity.params.featurePreset).toLowerCase()}`
    if (isPatternPreviewActive) return 'Selected: pattern preview'
    if (selectedBaseMassEntity?.params.shape === 'polygon') return 'Selected: polygon'
    if (selectedBaseMassEntity) return `Selected: ${selectedBaseMassEntity.params.shape}`
    if (isBuilding) return `Selected: ${(selected as SceneObject).type}`
    if (isScaffold) return `Selected: ${(selected as ScaffoldObject).displayName}`
    return 'No selection'
  }

  return (
    <>
    <div className="properties-panel" aria-label="Properties">
      <div className="properties-header">
        <div>
          <div className="properties-title">{headerTitle}</div>
          <div className="properties-subtitle">{getSubtitle()}</div>
        </div>

				<div className="properties-header-actions">
					{isBlockToolActive && (
						<>
							<button
								className={`properties-icon-btn ${activeBlockFunction === 'place' ? 'active' : ''}`}
									title="Place blocks"
								aria-pressed={activeBlockFunction === 'place'}
								onClick={() => {
									updateBlockToolSettings({ mode: 'assemble' })
									setIsEditingBlock(false)
									setBlockEditMode(false)
									setBlockEditActionMode('neutral')
									clearBlockSelection()
								}}
								type="button"
							>
								<LayoutGrid size={16} />
							</button>
							{blockToolMode === 'assemble' && (
								<button
									className={`properties-icon-btn ${activeBlockFunction === 'select' ? 'active' : ''}`}
									title={activeBlockFunction === 'select' ? 'Exit Edit Blocks selection mode' : 'Edit existing blocks (selection mode)'}
									aria-pressed={activeBlockFunction === 'select'}
									onClick={() => {
										setIsEditingBlock(false)
										if (activeBlockFunction === 'select') {
											setBlockEditActionMode('neutral')
											clearBlockSelection()
											return
										}
										setBlockEditMode(true)
										setBlockEditActionMode('select')
									}}
									type="button"
								>
									<Pencil size={16} />
								</button>
							)}
							{blockToolMode === 'assemble' && blockEditMode && (
								<>
									<button
										className={`properties-icon-btn ${blockEditActionMode === 'copy' ? 'active' : ''}`}
										title="Copy Pull mode (select a block, then drag an exposed-side arrow outward to array copies)"
										aria-pressed={blockEditActionMode === 'copy'}
										onClick={() => {
											setBlockEditMode(true)
											setBlockEditActionMode('copy')
										}}
										type="button"
									>
										<Copy size={16} />
									</button>
									<button
										className={`properties-icon-btn ${blockEditActionMode === 'move' ? 'active' : ''}`}
										title="Move mode (drag selected blocks to reposition them)"
										aria-pressed={blockEditActionMode === 'move'}
										onClick={() => {
											setBlockEditMode(true)
											setBlockEditActionMode('move')
										}}
										type="button"
									>
										<Move size={16} />
									</button>
								</>
							)}
						</>
					)}


				</div>
      </div>

				<>
					{isBlockToolActive && (
						<div className="properties-body">
						{selectedBlock ? (
							<div className="block-card">
								{/* Block card header */}
								<div className="block-card-header">
									<div className="block-card-title-row">
										<Box size={14} style={{ opacity: 0.6 }} />
										<span className="block-card-title">{selectedRoundAutoBlock ? 'Round Bay' : 'Block'}</span>
									</div>
									{selectedRoundAutoBlock ? (
										<span className="block-status-pill">Recipe-driven</span>
									) : !isEditingBlock ? (
										<button
											className="block-edit-btn"
											onClick={enterBlockEditMode}
											title="Edit block dimensions"
											type="button"
										>
											<Pencil size={13} />
											<span>Edit</span>
										</button>
									) : (
										<div className="block-edit-actions">
											<button
												className="block-action-btn block-action-apply"
												onClick={applySelectedBlockEdits}
												title="Apply changes"
												type="button"
											>
												<Check size={13} />
											</button>
											<button
												className="block-action-btn block-action-cancel"
												onClick={cancelBlockEdit}
												title="Cancel editing"
												type="button"
											>
												<X size={13} />
											</button>
										</div>
									)}
								</div>

								{/* Dimensions â read-only or editable */}
								<div className="block-dims">
									{selectedRoundAutoBlock ? (
										<>
											<div className="block-dim-field">
												<label>Inner Run</label>
												<span className="block-dim-value">{formatFeetCompact(selectedRoundAutoBlock.autoGeneratedRoundInnerLedgerFt)}</span>
											</div>
											<div className="block-dim-field">
												<label>Outer Run</label>
												<span className="block-dim-value">{formatFeetCompact(selectedRoundAutoBlock.autoGeneratedRoundOuterLedgerFt)}</span>
											</div>
											<div className="block-dim-field">
												<label>Depth</label>
												<span className="block-dim-value">{formatFeetCompact(selectedRoundAutoBlock.depthFt)}</span>
											</div>
										</>
									) : (['widthFt', 'depthFt', 'heightFt'] as const).map(key => {
										const label = key === 'widthFt' ? 'Width' : key === 'depthFt' ? 'Depth' : 'Height'
										return (
											<div className="block-dim-field" key={key}>
												<label>{label}</label>
												{isEditingBlock ? (
													<input
														type="text"
														inputMode="decimal"
														value={blockEditDraft[key]}
														onWheel={preventWheelChange}
														onChange={e => setBlockEditDraft(prev => ({ ...prev, [key]: e.target.value }))}
														onKeyDown={e => { if (e.key === 'Enter') applySelectedBlockEdits() }}
														autoFocus={key === 'widthFt'}
													/>
												) : (
													<span className="block-dim-value">{selectedBlock[key]} ft</span>
												)}
											</div>
										)
									})}
								</div>

								{selectedRoundAutoBlock ? (
									<>
										<div className="block-dim-field block-ledger-field">
											<label>Height</label>
											<span className="block-dim-value">{formatFeetCompact(selectedRoundAutoBlock.heightFt)}</span>
										</div>
										<div className="block-dim-field block-ledger-field">
											<label>Bay</label>
											<span className="block-dim-value">
												{selectedRoundAutoBlock.autoGeneratedRoundBayIndex} of {selectedRoundAutoBlock.autoGeneratedRoundBayCount}
											</span>
										</div>
										<div className="block-dim-field block-ledger-field">
											<label>Closure</label>
											<span className="block-dim-value">
												{selectedRoundAutoBlock.autoGeneratedRoundClosure ? 'Tube-and-coupler closure' : 'Standard bay'}
											</span>
										</div>
									</>
								) : null}

									{/* Planked levels */}
									<div className="block-dim-field block-ledger-field">
										<label>Planked levels</label>
										{isEditingBlock ? (
											<div className="block-ledger-input-wrap">
												<input
													type="text"
													inputMode="numeric"
													value={blockEditDraft.plankedLevelsCount}
													onWheel={preventWheelChange}
													onChange={e => setBlockEditDraft(prev => ({ ...prev, plankedLevelsCount: e.target.value }))}
													onKeyDown={e => { if (e.key === 'Enter') applySelectedBlockEdits() }}
												/>
												<span className="block-unit">levels</span>
											</div>
										) : (
											<span className="block-dim-value">{Math.max(1, Math.round(Number(selectedBlock.plankedLevelsCount ?? 1)))} level(s)</span>
										)}
									</div>

									{/* Base deck toggle */}
									<div className="block-dim-field block-ledger-field">
										<label>Include base deck (lift 0)</label>
										{isEditingBlock ? (
											<div className="prop-toggle">
												<input
													type="checkbox"
													checked={blockEditIncludeBaseDeck}
													onChange={e => setBlockEditIncludeBaseDeck(e.target.checked)}
												/>
											</div>
										) : (
											<span className="block-dim-value">{selectedBlock.includeBaseDeck ? 'Yes' : 'No'}</span>
										)}
									</div>

								<div className="block-dim-field block-ledger-field">
									<label>Front/Back braces</label>
									{isEditingBlock ? (
										<select
											value={blockEditBraceFrontBack}
											onChange={e => setBlockEditBraceFrontBack(e.target.value as BlockBraceDirection)}
										>
											{BLOCK_BRACE_OPTIONS.map(option => (
												<option key={option.value} value={option.value}>{option.label}</option>
											))}
										</select>
									) : (
										<span className="block-dim-value">{formatBlockBraceDirection(selectedBlock.braceFrontBack)}</span>
									)}
								</div>

								<div className="block-dim-field block-ledger-field">
									<label>Left/Right braces</label>
									{isEditingBlock ? (
										<select
											value={blockEditBraceLeftRight}
											onChange={e => setBlockEditBraceLeftRight(e.target.value as BlockBraceDirection)}
										>
											{BLOCK_BRACE_OPTIONS.map(option => (
												<option key={option.value} value={option.value}>{option.label}</option>
											))}
										</select>
									) : (
										<span className="block-dim-value">{formatBlockBraceDirection(selectedBlock.braceLeftRight)}</span>
									)}
								</div>

								<div className="properties-hint" style={{ marginTop: 6 }}>
									{selectedRoundAutoBlock
										? 'Round auto bays share standards with adjacent bays and deck off the short inner run. Any remaining closure strip is intended for 3/4 inch plywood infill.'
										: <>Press <kbd>Del</kbd> to delete | Manual edits are preserved</>}
								</div>
								{renderCopyLoadsToggle()}
								{blockToolWarningNotice}
							</div>
						) : blockToolMode === 'assemble' && blockEditMode ? (
							<>
								<div className="properties-hint" style={{ marginBottom: 10 }}>
									{blockEditActionMode === 'neutral'
										? 'Block mode is active â click an existing block footprint to select it.'
										: 'Edit Blocks mode is active â click an existing block footprint to select it.'}
								</div>
								<div className="properties-hint" style={{ marginBottom: 10 }}>
									{blockEditActionMode === 'copy'
										? 'Copy Pull mode: select a block and the exposed-side pull handles stay visible, then drag a handle outward to array copies of that block.'
										: blockEditActionMode === 'move'
											? 'Move mode: select a block and the exposed-side arrows stay visible, then drag an arrow or the selected footprint to reposition it.'
											: blockEditActionMode === 'select'
												? 'Selection mode: click a block to select it, Ctrl/Cmd+click to add to the selection, or drag a marquee to select multiple blocks.'
												: 'Block mode: nothing is armed yet. Click a block to select it, or choose Copy Pull / Move when you are ready.'}
								</div>
								<div className="prop-row prop-actions">
									<button
										className="prop-btn"
										disabled={!canAutoScaffoldAroundBuilding}
										onClick={openAutoScaffoldModal}
										title="Automatically generate scaffold around the building"
										type="button"
										data-testid="open-auto-scaffold-modal"
									>
										<Box size={14} />
										Auto Around Building
									</button>
									<button
										className="prop-btn prop-btn-secondary"
										onClick={() => {
											setIsEditingBlock(false)
											setBlockEditMode(false)
											setBlockEditActionMode('neutral')
											clearBlockSelection()
										}}
										title="Return to placement mode"
										type="button"
									>
										Done
									</button>
								</div>
								<div className="properties-hint">
									Footprint: {blockWidthFt.toFixed(2)}ft x {blockDepthFt.toFixed(2)}ft | Height: {blockHeightFt.toFixed(2)}ft | Levels: {blockPlankedLevelsCount}
								</div>
								<div className="properties-hint">
									Braces: Front/Back {formatBlockBraceDirection(blockBraceFrontBack)} | Left/Right {formatBlockBraceDirection(blockBraceLeftRight)}
								</div>
								<div className="properties-hint">
									{autoScaffoldHint}
								</div>
								<div className="properties-hint">
									Tip: Press <kbd>Esc</kbd> to step back to block selection first.
								</div>
								{renderCopyLoadsToggle()}
								{blockToolWarningNotice}
							</>
						) : (
							<>
								<div className="prop-section-title">Dimensions</div>

					<div className="prop-row">
							<label>Width (ft)</label>
						<input
								type="text"
								inputMode="decimal"
								value={blockDraft.widthFt}
								onWheel={preventWheelChange}
								onFocus={() => setBlockDraftFocusKey('widthFt')}
								onBlur={e => {
									setBlockDraftFocusKey(null)
									commitBlockDraft('widthFt', e.target.value)
								}}
								onKeyDown={e => {
									if (e.key === 'Enter') (e.currentTarget as any)?.blur?.()
								}}
								onChange={e => updateBlockDraftLive('widthFt', e.target.value)}
						/>
					</div>

					<div className="prop-row">
							<label>Depth (ft)</label>
						<input
								type="text"
								inputMode="decimal"
								value={blockDraft.depthFt}
								onWheel={preventWheelChange}
								onFocus={() => setBlockDraftFocusKey('depthFt')}
								onBlur={e => {
									setBlockDraftFocusKey(null)
									commitBlockDraft('depthFt', e.target.value)
								}}
								onKeyDown={e => {
									if (e.key === 'Enter') (e.currentTarget as any)?.blur?.()
								}}
								onChange={e => updateBlockDraftLive('depthFt', e.target.value)}
						/>
					</div>

					<div className="prop-row">
						<label>Height (ft)</label>
						<input
								type="text"
								inputMode="decimal"
								value={blockDraft.heightFt}
								onWheel={preventWheelChange}
								onFocus={() => setBlockDraftFocusKey('heightFt')}
								onBlur={e => {
									setBlockDraftFocusKey(null)
									commitBlockDraft('heightFt', e.target.value)
								}}
								onKeyDown={e => {
									if (e.key === 'Enter') (e.currentTarget as any)?.blur?.()
								}}
								onChange={e => updateBlockDraftLive('heightFt', e.target.value)}
						/>
					</div>

						<div className="prop-row">
							<label>Planked levels</label>
							<input
									type="text"
									inputMode="numeric"
									value={blockDraft.plankedLevelsCount}
									onWheel={preventWheelChange}
									onFocus={() => setBlockDraftFocusKey('plankedLevelsCount')}
									onBlur={e => {
										setBlockDraftFocusKey(null)
										commitBlockDraft('plankedLevelsCount', e.target.value)
									}}
									onKeyDown={e => {
										if (e.key === 'Enter') (e.currentTarget as any)?.blur?.()
									}}
									onChange={e => updateBlockDraftLive('plankedLevelsCount', e.target.value)}
							/>
						</div>

						<div className="prop-row prop-row-compact">
							<label>Include base deck (lift 0)</label>
							<div className="prop-toggle">
								<input
									type="checkbox"
									checked={blockIncludeBaseDeck}
									onChange={e => updateBlockToolSettings({ includeBaseDeck: e.target.checked })}
								/>
							</div>
						</div>

							<div className="prop-row">
								<label>Front/Back braces</label>
								<select
									value={blockBraceFrontBack}
									onChange={e => updateBlockToolSettings({ braceFrontBack: e.target.value as BlockBraceDirection })}
								>
									{BLOCK_BRACE_OPTIONS.map(option => (
										<option key={option.value} value={option.value}>{option.label}</option>
									))}
								</select>
							</div>

							<div className="prop-row">
								<label>Left/Right braces</label>
								<select
									value={blockBraceLeftRight}
									onChange={e => updateBlockToolSettings({ braceLeftRight: e.target.value as BlockBraceDirection })}
								>
									{BLOCK_BRACE_OPTIONS.map(option => (
										<option key={option.value} value={option.value}>{option.label}</option>
									))}
								</select>
							</div>

					<div className="prop-row">
						<label>Building Offset (ft)</label>
						<input
								type="text"
								inputMode="decimal"
								value={blockDraft.buildingOffsetFt}
								onWheel={preventWheelChange}
								onFocus={() => setBlockDraftFocusKey('buildingOffsetFt')}
								onBlur={e => {
									setBlockDraftFocusKey(null)
									commitBlockDraft('buildingOffsetFt', e.target.value)
								}}
								onKeyDown={e => {
									if (e.key === 'Enter') (e.currentTarget as any)?.blur?.()
								}}
								onChange={e => updateBlockDraftLive('buildingOffsetFt', e.target.value)}
						/>
					</div>

					<div className="prop-row prop-actions">
						<button
							className="prop-btn prop-btn-secondary"
							onClick={() =>
								updateBlockToolSettings({
										widthFt: 7,
										depthFt: 3,
										heightFt: 10,
											plankedLevelsCount: 1,
											includeBaseDeck: false,
										braceFrontBack: 'off',
										braceLeftRight: 'off',
										ledgerEveryNRosettes: 4,
										buildingOffsetFt: 1,
										copyLoadsOnCopy: false,
								})
							}
							title="Reset to default block settings"
						>
							<RotateCcw size={14} />
							Reset
						</button>
						<button
							className="prop-btn"
							disabled={!canAutoScaffoldAroundBuilding}
							onClick={openAutoScaffoldModal}
							title="Automatically generate scaffold around the building"
							type="button"
							data-testid="open-auto-scaffold-modal"
						>
							<Box size={14} />
							Auto Around Building
						</button>
									{blockToolMode === 'assemble' && (
										<button
											className="prop-btn"
											onClick={() => {
												setBlockEditActionMode('select')
												setBlockEditMode(true)
											}}
											title="Select and edit existing blocks"
											type="button"
										>
											<Pencil size={14} />
											Edit Blocks
										</button>
									)}
					</div>

								<div className="properties-hint">
									Footprint: {blockWidthFt.toFixed(2)}ft x {blockDepthFt.toFixed(2)}ft | Height: {blockHeightFt.toFixed(2)}ft | Levels: {blockPlankedLevelsCount}
								</div>
							<div className="properties-hint">
								Braces: Front/Back {formatBlockBraceDirection(blockBraceFrontBack)} | Left/Right {formatBlockBraceDirection(blockBraceLeftRight)}
							</div>
							<div className="properties-hint">
								{autoScaffoldHint}
							</div>
							<div className="properties-hint">
								Offset: {blockToolSettings.buildingOffsetFt}ft
							</div>
								<div className="properties-hint">
									Mode: {blockToolMode === 'assemble' ? (blockEditMode ? (blockEditActionMode === 'copy' ? 'Blocks (Copy Pull)' : blockEditActionMode === 'move' ? 'Blocks (Move)' : blockEditActionMode === 'select' ? 'Blocks (Select)' : 'Blocks (Idle)') : 'Blocks (Place)') : 'Scaffold'} | <kbd>Esc</kbd>: step back
								</div>
								{blockToolMode === 'assemble' ? (
									<div className="properties-hint">
										{blockEditMode
											? blockEditActionMode === 'copy'
												? 'Edit: select a block, then drag an exposed-side handle to array copies. Press Esc to return to selection mode.'
												: blockEditActionMode === 'move'
													? 'Edit: select a block, then drag an exposed-side handle or the selected footprint to move it. Press Esc to return to selection mode.'
													: blockEditActionMode === 'select'
														? 'Edit: click a block to select, Ctrl/Cmd+click to add, drag left-to-right for window select, drag right-to-left for crossing select, or choose Copy Pull / Move from the header.'
														: 'Idle: choose a block, or choose Copy Pull / Move from the header. Press Esc to return here from any active block function.'
											: 'Place: click grid to place | Press R to rotate | Click pencil to edit existing blocks'}
									</div>
								) : (
									<div className="properties-hint">
										Scaffold: select standards/ledgers/bases without leaving the Block tool
									</div>
								)}
								{blockToolMode === 'assemble' && blockEditMode && selectedBlockCount > 1 ? (
									<div className="properties-hint">
										{selectedBlockCount} blocks selected. Properties below still target the primary block.
									</div>
								) : null}
								{renderCopyLoadsToggle()}
								{blockToolWarningNotice}
							</>
						)}
						</div>
					)}

					{selectedBaseComponentType ? (
	        /* Base component selection: show component info; jack extension only for screw jack */
	        <div className="properties-body">
	          <div className="properties-hint">
			        Base component. Press Delete to remove.
			        {selectedBaseComponentType === 'screw-jack' ? ' Adjust extension below.' : ''}
	          </div>

			      {selectedBaseComponentType === 'wood-sill' && (
			        !hasEligibleBaseSelection ? (
			          <div className="properties-empty">No base-level standards selected.</div>
			        ) : (
			          <>
			            <div className="prop-row prop-row-compact">
			              <label>Show wood sill</label>
			              <div className="prop-toggle">
			                <input
			                  ref={woodSillCheckboxRef}
			                  type="checkbox"
			                  checked={woodSillValue ?? false}
			                  onChange={e => handleSetWoodSill(e.target.checked)}
			                />
			              </div>
			            </div>

			            <div className="prop-row prop-actions">
			              <button
			                className="prop-btn prop-btn-secondary"
			                onClick={() => applyWoodSillToAll(!!woodSillValue)}
			                disabled={baseComponentCount === 0 || woodSillValue === null}
			                title="Apply this value to all wood sills in the current project"
			              >
			                <Copy size={14} />
			                Apply to all wood sills ({baseComponentCount})
			              </button>
			            </div>

			            <div className="properties-hint">
			              Unchecking hides this wood sill. If you hide it, select the standard to reveal it later.
			            </div>
			          </>
			        )
			      )}

			      {selectedBaseComponentType === 'base-collar' && (
			        !hasEligibleBaseSelection ? (
			          <div className="properties-empty">No base-level standards selected.</div>
			        ) : (
			          <>
			            <div className="prop-row prop-row-compact">
			              <label>Show base collar</label>
			              <div className="prop-toggle">
			                <input
			                  ref={baseCollarCheckboxRef}
			                  type="checkbox"
			                  checked={baseCollarValue ?? false}
			                  onChange={e => handleSetBaseCollar(e.target.checked)}
			                />
			              </div>
			            </div>

			            <div className="prop-row prop-actions">
			              <button
			                className="prop-btn prop-btn-secondary"
			                onClick={() => applyBaseCollarToAll(!!baseCollarValue)}
			                disabled={baseComponentCount === 0 || baseCollarValue === null}
			                title="Apply this value to all base collars in the current project"
			              >
			                <Copy size={14} />
			                Apply to all base collars ({baseComponentCount})
			              </button>
			            </div>

			            <div className="properties-hint">
			              Unchecking hides this base collar. If you hide it, select the standard to reveal it later.
			            </div>
			          </>
			        )
			      )}

	          {selectedBaseComponentType === 'screw-jack' && (
	            !hasEligibleBaseSelection ? (
	              <div className="properties-empty">No base-level standards selected.</div>
	            ) : (
	              <>
	                <div className="prop-row">
	                  <label>Screw Jack Extension (in)</label>
	                  <div className="prop-slider-row">
	                    <input
	                      type="range"
	                      min={0}
	                      max={12}
	                      step={0.5}
	                      value={jackExtensionValue ?? baseSettings.defaultJackExtensionIn}
	                      onChange={e => handleJackExtensionChange(parseFloat(e.target.value))}
	                      className={isMixedJackExtension ? 'mixed-value' : ''}
	                    />
	                    <input
	                      type="number"
	                      min={0}
	                      max={12}
	                      step={0.5}
	                      value={isMixedJackExtension ? '' : (jackExtensionValue ?? baseSettings.defaultJackExtensionIn)}
	                      placeholder={isMixedJackExtension ? 'Mixed' : undefined}
	                      onChange={e => {
	                        const val = parseFloat(e.target.value)
	                        if (!isNaN(val)) {
	                          handleJackExtensionChange(val)
	                        }
	                      }}
	                      style={{ width: 56 }}
	                    />
	                  </div>
	                </div>

	                <div className="prop-row prop-actions">
			              <button
			                className="prop-btn prop-btn-secondary"
			                onClick={() => applyJackExtensionToAll(jackExtensionValue ?? baseSettings.defaultJackExtensionIn)}
			                disabled={baseComponentCount === 0}
			                title="Apply this extension to all screw jacks in the current project"
			              >
			                <Copy size={14} />
			                Apply to all screw jacks ({baseComponentCount})
			              </button>
	                  <button
	                    className="prop-btn prop-btn-secondary"
	                    onClick={handleResetJackExtensionToDefault}
	                    title="Reset jack extension to workspace default"
	                  >
	                    <RotateCcw size={14} />
	                    Reset Extension
	                  </button>
	                </div>
	              </>
	            )
	          )}
	        </div>
	      ) : hasStandardSelected ? (
	        /* Standard selection: show reveal actions for hidden base components */
        <div className="properties-body">
	          <div className="properties-hint">
	            Standard selection. Select a base component (wood sill / base collar / screw jack) to edit it.
	          </div>

          {ineligibleBaseCount > 0 && (
            <div className="properties-hint">
	              Base components exist only on base-level standards (on grid / on shape).{' '}
              {ineligibleBaseCount} selected standard{ineligibleBaseCount === 1 ? '' : 's'} appear to be stacked.
            </div>
          )}

	          {!hasEligibleBaseSelection ? (
	            <div className="properties-empty">No base-level standards selected.</div>
	          ) : (
	            (hiddenWoodSillsInSelection > 0 || hiddenBaseCollarsInSelection > 0 || hiddenWoodSillsInProject > 0 || hiddenBaseCollarsInProject > 0) ? (
	              <>
	                <div className="prop-section-title">Hidden components</div>

			                {(hiddenWoodSillsInSelection > 0 || hiddenBaseCollarsInSelection > 0) && (
			                  <div className="prop-actions">
			                    {hiddenWoodSillsInSelection > 0 && (
			                      <button
			                        className="prop-btn prop-btn-secondary"
			                        onClick={() => {
			                          for (const s of eligibleBaseStacks) updateScaffoldStack(s.id, { showWoodSill: true })
			                        }}
			                        title="Reveal wood sills for the selected standard(s)"
			                      >
			                        <Eye size={14} />
			                        Reveal wood sills (selected | {hiddenWoodSillsInSelection})
			                      </button>
			                    )}

			                    {hiddenBaseCollarsInSelection > 0 && (
			                      <button
			                        className="prop-btn prop-btn-secondary"
			                        onClick={() => {
			                          for (const s of eligibleBaseStacks) updateScaffoldStack(s.id, { showBaseCollar: true })
			                        }}
			                        title="Reveal base collars for the selected standard(s)"
			                      >
			                        <Eye size={14} />
			                        Reveal base collars (selected | {hiddenBaseCollarsInSelection})
			                      </button>
			                    )}
			                  </div>
			                )}

			                {(hiddenWoodSillsInProject > 0 || hiddenBaseCollarsInProject > 0) && (
			                  <div className="prop-actions">
			                    {hiddenWoodSillsInProject > 0 && (
			                      <button
			                        className="prop-btn prop-btn-secondary"
			                        onClick={() => applyWoodSillToAll(true)}
			                        title="Reveal all wood sills in the current project"
			                      >
			                        <Eye size={14} />
			                        Reveal wood sills (all | {hiddenWoodSillsInProject})
			                      </button>
			                    )}
			                    {hiddenBaseCollarsInProject > 0 && (
			                      <button
			                        className="prop-btn prop-btn-secondary"
			                        onClick={() => applyBaseCollarToAll(true)}
			                        title="Reveal all base collars in the current project"
			                      >
			                        <Eye size={14} />
			                        Reveal base collars (all | {hiddenBaseCollarsInProject})
			                      </button>
			                    )}
			                  </div>
			                )}

	                <div className="properties-hint">
	                  To hide/show a specific component, click it directly. Use these buttons to recover hidden parts.
	                </div>
	              </>
	            ) : (
	              <div className="properties-empty">No hidden base components.</div>
	            )
	          )}
        </div>
      ) : selectedLedgerConnection ? (
        /* Ledger/Truss selection: show component info */
        <div className="properties-body">
          <div className="properties-hint">
            {selectedLedgerConnection.ledgerPartNumber.startsWith('UHT')
              ? 'Truss component. Press Delete to remove.'
              : 'Ledger component. Press Delete to remove.'}
          </div>
        </div>
	      ) : selectedLiveLoad ? (
	        <div className="properties-body">
	          <div className="prop-row">
	            <label>Live load (psf)</label>
	            <input
	              type="text"
	              inputMode="decimal"
	              value={liveLoadDraft}
	              onWheel={preventWheelChange}
	              onChange={e => setLiveLoadDraft(e.target.value)}
	              onBlur={e => commitLiveLoadMagnitude(e.target.value)}
	              onKeyDown={e => {
	                if (e.key === 'Enter') {
	                  commitLiveLoadMagnitude((e.currentTarget as HTMLInputElement).value)
	                  ;(e.currentTarget as HTMLInputElement).blur()
	                }
	              }}
	            />
	          </div>

	          <div className="prop-row">
	            <label>Distribution</label>
	            <span className="prop-value">One-way</span>
	          </div>

	          <div className="properties-hint">
	            One-way bay live load spanning from the clicked ledger to the opposite parallel support. Press Delete to remove.
	          </div>
	        </div>
	      ) : showLiveLoadPlacementControls ? (
	        <div className="properties-body">
	          <div className="live-load-workflow">
	            <div className="prop-row">
              <label>Live load (psf)</label>
              <input
                type="text"
                inputMode="decimal"
                value={liveLoadPlacementDraft}
                onWheel={preventWheelChange}
                onChange={e => setLiveLoadPlacementDraft(e.target.value)}
                onBlur={e => commitLiveLoadPlacementMagnitude(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    commitLiveLoadPlacementMagnitude((e.currentTarget as HTMLInputElement).value)
                    ;(e.currentTarget as HTMLInputElement).blur()
                  }
                }}
              />
            </div>

            <div className="prop-row">
              <label>Distribution</label>
              <span className="prop-value">One-way by plank direction</span>
            </div>

            {selectedLiveLoadSectionState ? (
              <div className="live-load-section-card">
                <div className="live-load-section-card-topline">
                  <span className="live-load-section-label">
                    {selectedLiveLoadSectionState.mode === 'multi' ? 'Focused sections' : 'Focused section'}
                  </span>
                  <button
                    type="button"
                    className="live-load-section-clear"
                    onClick={() => setSelectedLiveLoadDeckTargets([])}
                  >
                    Clear
                  </button>
                </div>
                <div className="live-load-section-title">
                  {selectedLiveLoadSectionCardTitle}
                </div>
                <div className="live-load-section-detail">
                  {selectedLiveLoadSectionCardDetail}
                </div>
                <div className="live-load-section-toggle">
                  <button
                    type="button"
                    className={`live-load-section-toggle-btn${selectedLiveLoadSectionState.isIncluded ? ' is-active' : ''}`}
                    onClick={() => handleSetSelectedLiveLoadSectionExcluded(false)}
                  >
                    Included
                  </button>
                  <button
                    type="button"
                    className={`live-load-section-toggle-btn${selectedLiveLoadSectionState.isExcluded ? ' is-active is-off' : ''}`}
                    onClick={() => handleSetSelectedLiveLoadSectionExcluded(true)}
                  >
                    Excluded
                  </button>
                </div>
              </div>
            ) : null}
            <div className="live-load-deck-list">
	              {liveLoadLevels.length > 0 ? (
	                liveLoadLevels.map(level => (
	                  <button
	                    type="button"
	                    className={`live-load-deck-option${level.isActive ? ' is-active' : ''}${level.isPartial ? ' is-partial' : ''}${activeLiveLoadLevelNumber === level.levelNumber ? ' is-focused' : ''}`}
	                    key={`live-load-deck-option-${level.levelNumber}`}
	                    onClick={() => handleToggleLiveLoadLevel(level)}
	                    onMouseEnter={() => setHoveredLiveLoadDeckTargets(getHoverTargetsForLiveLoadLevel(level))}
	                    onMouseLeave={() => setHoveredLiveLoadDeckTargets([])}
	                    onFocus={() => setHoveredLiveLoadDeckTargets(getHoverTargetsForLiveLoadLevel(level))}
	                    onBlur={() => setHoveredLiveLoadDeckTargets([])}
	                  >
	                    <span className={`live-load-deck-check${level.isActive ? ' is-active' : ''}${level.isPartial ? ' is-partial' : ''}`}>
	                      {level.isActive ? '?' : level.isPartial ? '-' : ''}
	                    </span>
	                    <span className="live-load-deck-copy">
	                      <span className="live-load-deck-title">{level.label}</span>
	                      <span className="live-load-deck-detail">{level.detail}</span>
	                    </span>
	                  </button>
	                ))
	              ) : scaffoldBlocks.length > 0 ? (
	                <div className="properties-hint" style={{ marginTop: 0 }}>
	                  No working decks fit the current scaffold blocks yet.
	                </div>
	              ) : (
	                <div className="properties-hint" style={{ marginTop: 0 }}>
	                  Place scaffold blocks first, then use Levels here to load the full run.
	                </div>
	              )}
	            </div>

	            <div className="properties-hint live-load-workflow-tip">
	              Hover a level to preview it in the scene. Click a highlighted scaffold section to focus it, then use the include or exclude toggle here without leaving Loads.
	            </div>
	          </div>
	        </div>
	      ) : selectedDiagonal ? (
	        <div className="properties-body">
	          <div className="properties-hint">
	            Brace diagonal. Press Delete to remove this member.
	          </div>
	        </div>
	      ) : !selected && !selectedBuildingEntity ? (
        /* No selection: show workspace defaults (Option A) */
        <div className="properties-body">
	          <div className="properties-empty">
	            Click an object to view/edit its properties.
	          </div>
        </div>
      ) : isBuildingSelection ? (
        /* Building object properties (editable) */
        <div className="properties-body">
          {(() => {
            if (selectedRoofEntity) {
              const hostShape = selectedRoofHostShape
              const roofKindOptions = getRoofKindOptionsForHostShape(hostShape)
              const supportsRiseControl = selectedRoofEntity.kind !== 'flat-roof'
              const supportsRidgeDirection = hostShape === 'rect'
                && (selectedRoofEntity.kind === 'shed-roof' || selectedRoofEntity.kind === 'gable-roof')

              return renderBuildingCard({
                title: 'ROOF',
                subtitle: getRoofTypeLabel(selectedRoofEntity.kind),
                actions: (
                  <>
                    {selectedRoofHost ? (
                      <button
                        type="button"
                        className="block-edit-btn"
                        onClick={() => {
                          setSelectedBuildingEntityId(selectedRoofHost.id)
                          setSelectedObjectId(selectedRoofHost.id)
                        }}
                      >
                        Select Host
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="block-edit-btn block-edit-btn-danger"
                      disabled={!canEditSelected}
                      onClick={() => handleDeleteHostedEntity(selectedRoofEntity.id, selectedRoofHost?.id ?? null)}
                    >
                      Delete
                    </button>
                  </>
                ),
                summary: renderBuildingMetricStrip([
                  { label: 'Type', value: getRoofTypeLabel(selectedRoofEntity.kind) },
                  { label: 'Thickness', value: `${roofDraft.thickness || '0'} ${unitLabel}` },
                  { label: 'Overhang', value: `${roofDraft.overhang || '0'} ${unitLabel}` },
                ]),
                body: (
                  <div className="building-form-grid">
                    <div className="prop-row">
                      <label>Type</label>
                      <select
                        value={roofDraft.kind}
                        disabled={!canEditSelected}
                        onChange={(e) => commitRoofKind(e.target.value as HostedRoofEntity['kind'])}
                      >
                        {roofKindOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="prop-row">
                      <label>Thickness ({unitLabel})</label>
                      <input
                        type="number"
                        value={roofDraft.thickness}
                        step={step}
                        min={step}
                        disabled={!canEditSelected}
                        onChange={(e) => commitRoofNumeric('thicknessFt', e.target.value)}
                      />
                    </div>

                    <div className="prop-row">
                      <label>Overhang ({unitLabel})</label>
                      <input
                        type="number"
                        value={roofDraft.overhang}
                        step={step}
                        min={0}
                        disabled={!canEditSelected}
                        onChange={(e) => commitRoofNumeric('overhangFt', e.target.value)}
                      />
                    </div>

                    {supportsRiseControl && (
                      <>
                        <div className="prop-row">
                          <label>Rise ({unitLabel})</label>
                          <input
                            type="number"
                            value={roofDraft.rise}
                            step={step}
                            min={step}
                            disabled={!canEditSelected}
                            onChange={(e) => commitRoofNumeric('riseFt', e.target.value)}
                          />
                        </div>

                        {supportsRidgeDirection && (
                          <div className="prop-row">
                            <label>Ridge Direction</label>
                            <select
                              value={roofDraft.ridgeDirection}
                              disabled={!canEditSelected}
                              onChange={(e) => commitRoofDirection(e.target.value as RoofDirection)}
                            >
                              <option value="x">Along length</option>
                              <option value="y">Along depth</option>
                            </select>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ),
                hint: hostShape === 'rect'
                  ? 'Roofs stay hosted to the selected mass and update as the mass changes. Flat, shed, gable, and hip are available on rectangular hosts.'
                  : hostShape === 'circle'
                    ? 'Circular hosts support flat, cone, and dome roofs. Rise controls the height of the curved roof family.'
                    : 'This host currently supports a flat roof footprint.',
              })
            }

            if (selectedParapetEntity) {
              const hostShape = selectedParapetHost?.params.shape ?? null

              return renderBuildingCard({
                title: 'PARAPET',
                subtitle: 'Inside',
                actions: (
                  <>
                    {selectedParapetHost ? (
                      <button
                        type="button"
                        className="block-edit-btn"
                        onClick={() => {
                          setSelectedBuildingEntityId(selectedParapetHost.id)
                          setSelectedObjectId(selectedParapetHost.id)
                        }}
                      >
                        Select Host
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="block-edit-btn block-edit-btn-danger"
                      disabled={!canEditSelected}
                      onClick={() => handleDeleteHostedEntity(selectedParapetEntity.id, selectedParapetHost?.id ?? null)}
                    >
                      Delete
                    </button>
                  </>
                ),
                summary: renderBuildingMetricStrip([
                  { label: 'Height', value: `${parapetDraft.height || '0'} ${unitLabel}` },
                  { label: 'Thickness', value: `${parapetDraft.thickness || '0'} ${unitLabel}` },
                ]),
                body: (
                  <div className="building-form-grid">
                    <div className="prop-row">
                      <label>Height ({unitLabel})</label>
                      <input
                        type="number"
                        value={parapetDraft.height}
                        step={step}
                        min={step}
                        disabled={!canEditSelected}
                        onChange={(e) => commitParapetNumeric('heightFt', e.target.value)}
                      />
                    </div>

                    <div className="prop-row">
                      <label>Thickness ({unitLabel})</label>
                      <input
                        type="number"
                        value={parapetDraft.thickness}
                        step={step}
                        min={step}
                        disabled={!canEditSelected}
                        onChange={(e) => commitParapetNumeric('thicknessFt', e.target.value)}
                      />
                    </div>

                    {selectedParapetEdgeOptions.length > 1 && (
                      <div className="prop-row building-prop-row-stack">
                        <label>{hostShape === 'circle' || hostShape === 'ring' ? 'Arc Segments' : 'Edges'}</label>
                        <div className="building-check-grid">
                          {selectedParapetEdgeOptions.map((option) => (
                            <label key={option.value} className="building-check-chip">
                              <input
                                type="checkbox"
                                checked={selectedParapetEdgeIds.includes(option.value)}
                                disabled={!canEditSelected}
                                onChange={() => toggleParapetEdge(option.value)}
                              />
                              <span>{option.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ),
                hint: hostShape === 'rect'
                  ? 'Parapets stay inside the roof perimeter. Rectangular hosts can apply the parapet to the full perimeter or only the checked sides.'
                  : hostShape === 'polygon'
                    ? 'Parapets stay inside the roof perimeter. Polygon hosts can apply the parapet to the full perimeter or only the checked footprint edges.'
                    : hostShape === 'circle' || hostShape === 'ring'
                      ? 'Parapets stay inside the roof perimeter. Circular hosts can apply the parapet to the full perimeter or only the checked quarter-arc segments.'
                      : 'This parapet wraps the inside of the selected host perimeter.',
              })
            }

            if (selectedFeatureEntity) {
              const presetOptions = selectedFeatureEntity.kind === 'top-feature'
                ? TOP_FEATURE_PRESET_OPTIONS
                : SIDE_FEATURE_PRESET_OPTIONS
              const isSideFeature = selectedFeatureEntity.kind === 'side-feature'
              const showBalconyHandrailControls = isSideFeature && featureDraft.preset === 'balcony'
              const featureTitle = isSideFeature ? 'SIDE FEATURE' : 'TOP FEATURE'

              return renderBuildingCard({
                title: featureTitle,
                subtitle: getHostedFeaturePresetLabel(selectedFeatureEntity.params.preset),
                actions: (
                  <>
                    {selectedFeatureHost ? (
                      <button
                        type="button"
                        className="block-edit-btn"
                        onClick={() => {
                          setSelectedBuildingEntityId(selectedFeatureHost.id)
                          setSelectedObjectId(selectedFeatureHost.id)
                        }}
                      >
                        Select Host
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="block-edit-btn block-edit-btn-danger"
                      disabled={!canEditSelected}
                      onClick={() => handleDeleteHostedEntity(selectedFeatureEntity.id, selectedFeatureHost?.id ?? null)}
                    >
                      Delete
                    </button>
                  </>
                ),
                summary: renderBuildingMetricStrip([
                  { label: 'Style', value: getHostedFeaturePresetLabel(featureDraft.preset) },
                  { label: isSideFeature ? 'Projection' : 'Depth', value: `${featureDraft.depth || '0'} ${unitLabel}` },
                  { label: 'Height', value: `${featureDraft.height || '0'} ${unitLabel}` },
                ]),
                body: (
                  <div className="building-form-grid">
                    <div className="prop-row">
                      <label>Style</label>
                      <select
                        value={featureDraft.preset}
                        disabled={!canEditSelected}
                        onChange={(e) => commitFeaturePreset(e.target.value as HostedFeaturePreset)}
                      >
                        {presetOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    {isSideFeature && (
                      <div className="prop-row">
                        <label>Face</label>
                        <select
                          value={featureDraft.faceId}
                          disabled={!canEditSelected}
                          onChange={(e) => commitSideFeatureFace(e.target.value as SideFeatureFaceId)}
                        >
                          {SIDE_FEATURE_FACE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="prop-row">
                      <label>Width ({unitLabel})</label>
                      <input
                        type="number"
                        value={featureDraft.width}
                        step={step}
                        min={step}
                        disabled={!canEditSelected}
                        onChange={(e) => commitFeatureNumeric('widthFt', e.target.value)}
                      />
                    </div>

                    <div className="prop-row">
                      <label>{isSideFeature ? `Projection (${unitLabel})` : `Depth (${unitLabel})`}</label>
                      <input
                        type="number"
                        value={featureDraft.depth}
                        step={step}
                        min={step}
                        disabled={!canEditSelected}
                        onChange={(e) => commitFeatureNumeric('depthFt', e.target.value)}
                      />
                    </div>

                    <div className="prop-row">
                      <label>Height ({unitLabel})</label>
                      <input
                        type="number"
                        value={featureDraft.height}
                        step={step}
                        min={step}
                        disabled={!canEditSelected}
                        onChange={(e) => commitFeatureNumeric('heightFt', e.target.value)}
                      />
                    </div>

                    {isSideFeature && (
                      <>
                        <div className="prop-row">
                          <label>Horizontal Offset ({unitLabel})</label>
                          <input
                            type="number"
                            value={featureDraft.offsetU}
                            step={step}
                            disabled={!canEditSelected}
                            onChange={(e) => commitFeatureNumeric('offsetUFt', e.target.value)}
                          />
                        </div>

                        <div className="prop-row">
                          <label>Vertical Offset ({unitLabel})</label>
                          <input
                            type="number"
                            value={featureDraft.offsetV}
                            step={step}
                            disabled={!canEditSelected}
                            onChange={(e) => commitFeatureNumeric('offsetVFt', e.target.value)}
                          />
                        </div>
                      </>
                    )}

                    {showBalconyHandrailControls && (
                      <div className="building-pattern-axis-group">
                        <div className="building-pattern-axis-heading">Balcony Handrail</div>
                        <div className="prop-row prop-row-compact">
                          <label>Show Handrail</label>
                          <div className="prop-toggle">
                            <input
                              type="checkbox"
                              checked={featureDraft.handrailEnabled}
                              disabled={!canEditSelected}
                              onChange={(e) => commitFeatureHandrailEnabled(e.target.checked)}
                            />
                          </div>
                        </div>
                        <div className="prop-row">
                          <label>Rail Height ({unitLabel})</label>
                          <input
                            type="number"
                            value={featureDraft.handrailHeight}
                            step={step}
                            min={step}
                            disabled={!canEditSelected || !featureDraft.handrailEnabled}
                            onChange={(e) => commitFeatureNumeric('balconyHandrailHeightFt', e.target.value)}
                          />
                        </div>
                        <div className="prop-row">
                          <label>Rail Inset ({unitLabel})</label>
                          <input
                            type="number"
                            value={featureDraft.handrailInset}
                            step={step}
                            min={0}
                            disabled={!canEditSelected || !featureDraft.handrailEnabled}
                            onChange={(e) => commitFeatureNumeric('balconyHandrailInsetFt', e.target.value)}
                          />
                        </div>
                        <div className="prop-row">
                          <label>Rail Thickness ({unitLabel})</label>
                          <input
                            type="number"
                            value={featureDraft.handrailThickness}
                            step={step}
                            min={step}
                            disabled={!canEditSelected || !featureDraft.handrailEnabled}
                            onChange={(e) => commitFeatureNumeric('balconyHandrailThicknessFt', e.target.value)}
                          />
                        </div>
                      </div>
                    )}

                    <div className="prop-row prop-row-compact">
                      <label>Blocks scaffold</label>
                      <div className="prop-toggle">
                        <input
                          type="checkbox"
                          checked={featureDraft.blocksScaffold}
                          disabled={!canEditSelected}
                          onChange={(e) => commitFeatureAnalysisFlag('blocksScaffold', e.target.checked)}
                        />
                      </div>
                    </div>

                    <div className="prop-row prop-row-compact">
                      <label>Supports scaffold</label>
                      <div className="prop-toggle">
                        <input
                          type="checkbox"
                          checked={featureDraft.supportsScaffold}
                          disabled={!canEditSelected}
                          onChange={(e) => commitFeatureAnalysisFlag('supportsScaffold', e.target.checked)}
                        />
                      </div>
                    </div>

                    <div className="building-pattern-axis-group">
                      <div className="building-pattern-axis-heading">Top Of This Feature</div>
                      <div className="building-nested-tool-note">Choose a tool, then place it on the highlighted top face.</div>
                      <div className="building-nested-tool-row">
                        <button
                          type="button"
                          className="building-nested-tool"
                          disabled={!canEditSelected}
                          onClick={() => handleAddOrSelectNestedRoof(selectedFeatureEntity)}
                        >
                          <span className="building-nested-tool-kicker">Roof</span>
                          <span className="building-nested-tool-title">{selectedFeatureRoof ? 'Select Roof' : 'Roof'}</span>
                          <span className="building-nested-tool-caption">{selectedFeatureRoof ? 'Open the hosted roof' : 'Top cap'}</span>
                        </button>
                        <button
                          type="button"
                          className="building-nested-tool"
                          disabled={!canEditSelected}
                          onClick={() => createNestedTopFeature(selectedFeatureEntity)}
                        >
                          <span className="building-nested-tool-kicker">Feature</span>
                          <span className="building-nested-tool-title">Top Feature</span>
                          <span className="building-nested-tool-caption">Hosted form</span>
                        </button>
                        <button
                          type="button"
                          className="building-nested-tool"
                          disabled={!canEditSelected}
                          onClick={() => createNestedTopVolume(selectedFeatureEntity, 'add')}
                        >
                          <span className="building-nested-tool-kicker">Volume</span>
                          <span className="building-nested-tool-title">Volume</span>
                          <span className="building-nested-tool-caption">Add mass</span>
                        </button>
                        <button
                          type="button"
                          className="building-nested-tool is-cut"
                          disabled={!canEditSelected}
                          onClick={() => createNestedTopVolume(selectedFeatureEntity, 'cut')}
                        >
                          <span className="building-nested-tool-kicker">Cut</span>
                          <span className="building-nested-tool-title">Cut Volume</span>
                          <span className="building-nested-tool-caption">Subtract mass</span>
                        </button>
                      </div>
                    </div>

                    <div className="building-pattern-axis-group">
                      <div className="building-pattern-axis-heading">Sides Of This Feature</div>
                      <div className="building-nested-tool-note">Choose a wall-hosted tool, then draw directly on the side you want.</div>
                      <div className="building-nested-tool-row">
                        <button
                          type="button"
                          className="building-nested-tool"
                          disabled={!canEditSelected}
                          onClick={() => createNestedSideFeature(selectedFeatureEntity)}
                        >
                          <span className="building-nested-tool-kicker">Wall</span>
                          <span className="building-nested-tool-title">Side Feature</span>
                          <span className="building-nested-tool-caption">Balcony, canopy, screen</span>
                        </button>
                        <button
                          type="button"
                          className="building-nested-tool"
                          disabled={!canEditSelected}
                          onClick={() => createNestedSideVolume(selectedFeatureEntity, 'add')}
                        >
                          <span className="building-nested-tool-kicker">Volume</span>
                          <span className="building-nested-tool-title">Side Volume</span>
                          <span className="building-nested-tool-caption">Add wall mass</span>
                        </button>
                        <button
                          type="button"
                          className="building-nested-tool is-cut"
                          disabled={!canEditSelected}
                          onClick={() => createNestedSideVolume(selectedFeatureEntity, 'cut')}
                        >
                          <span className="building-nested-tool-kicker">Cut</span>
                          <span className="building-nested-tool-title">Side Cut</span>
                          <span className="building-nested-tool-caption">Subtract wall mass</span>
                        </button>
                      </div>
                    </div>

                    {selectedFeatureHostedGroups.length > 0 ? (
                      <div className="building-hosted-panel">
                        <div className="building-section-kicker">Hosted On This Feature</div>
                        <div className="building-hosted-groups">
                          {selectedFeatureHostedGroups.map((group) => (
                            <div className="building-hosted-group" key={group.key}>
                              <div className="building-hosted-group-header">
                                <span className="building-hosted-group-title">{group.title}</span>
                                <span className="building-hosted-group-count">{group.items.length}</span>
                              </div>
                              <div className="building-hosted-chip-row">
                                {group.items.map((entity, index) => {
                                  const labelBase = getHostedSelectionLabel(entity)
                                  const label = group.items.length > 1 ? `${labelBase} ${index + 1}` : labelBase
                                  return (
                                    <button
                                      type="button"
                                      key={entity.id}
                                      className={`building-hosted-chip${selectedBuildingEntityId === entity.id ? ' is-selected' : ''}`}
                                      onClick={() => handleSelectHostedChild(entity.id)}
                                    >
                                      <span className="building-hosted-chip-title">{label}</span>
                                      <span className="building-hosted-chip-caption">{getHostedSelectionCaption(entity)}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ),
                hint: isSideFeature
                  ? 'Side features stay attached to the selected wall face. Balcony features can add handrails here, and any solid feature can host a new top feature or volume on its upper face.'
                  : 'Top features stay attached to the host roof plane. Use the size and scaffold settings here, or click the live dimension labels in the viewport to place the footprint precisely.',
              })
            }

            if (selectedProxyEntity) {
              const hostShape = selectedProxyHost && isBaseMassEntity(selectedProxyHost)
                ? selectedProxyHost.params.shape
                : null
              const faceOptions = getProxyFaceOptionsForHostShape(hostShape)
              const isSideProxy = proxyDraft.faceId !== 'top'
              const canHostNestedOnProxy = selectedProxyEntity.params.mode === 'add'

              return renderBuildingCard({
                title: 'VOLUME',
                subtitle: getProxyModeLabel(selectedProxyEntity.params.mode),
                actions: (
                  <>
                    {selectedProxyHost ? (
                      <button
                        type="button"
                        className="block-edit-btn"
                        onClick={() => {
                          setSelectedBuildingEntityId(selectedProxyHost.id)
                          setSelectedObjectId(selectedProxyHost.id)
                        }}
                      >
                        Select Host
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="block-edit-btn block-edit-btn-danger"
                      disabled={!canEditSelected}
                      onClick={() => handleDeleteHostedEntity(selectedProxyEntity.id, selectedProxyHost?.id ?? null)}
                    >
                      Delete
                    </button>
                  </>
                ),
                summary: renderBuildingMetricStrip([
                  { label: 'Mode', value: getProxyModeLabel(proxyDraft.mode) },
                  { label: 'Face', value: proxyDraft.faceId === 'top' ? 'Top' : proxyDraft.faceId },
                  { label: 'Height', value: `${proxyDraft.height || '0'} ${unitLabel}` },
                ]),
                body: (
                  <div className="building-form-grid">
                    <div className="prop-row">
                      <label>Mode</label>
                      <select
                        value={proxyDraft.mode}
                        disabled={!canEditSelected}
                        onChange={(e) => commitProxyMode(e.target.value as ProxyFeatureMode)}
                      >
                        {PROXY_MODE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    {faceOptions.length > 1 && (
                      <div className="prop-row">
                        <label>Face</label>
                        <select
                          value={proxyDraft.faceId}
                          disabled={!canEditSelected}
                          onChange={(e) => commitProxyFace(e.target.value as 'top' | SideFeatureFaceId)}
                        >
                          {faceOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="prop-row">
                      <label>Width ({unitLabel})</label>
                      <input
                        type="number"
                        value={proxyDraft.width}
                        step={step}
                        min={step}
                        disabled={!canEditSelected}
                        onChange={(e) => commitProxyNumeric('widthFt', e.target.value)}
                      />
                    </div>

                    <div className="prop-row">
                      <label>{isSideProxy ? `${proxyDraft.mode === 'cut' ? 'Inset' : 'Projection'} (${unitLabel})` : `Depth (${unitLabel})`}</label>
                      <input
                        type="number"
                        value={proxyDraft.depth}
                        step={step}
                        min={step}
                        disabled={!canEditSelected}
                        onChange={(e) => commitProxyNumeric('depthFt', e.target.value)}
                      />
                    </div>

                    <div className="prop-row">
                      <label>Height ({unitLabel})</label>
                      <input
                        type="number"
                        value={proxyDraft.height}
                        step={step}
                        min={step}
                        disabled={!canEditSelected}
                        onChange={(e) => commitProxyNumeric('heightFt', e.target.value)}
                      />
                    </div>

                    {isSideProxy && (
                      <>
                        <div className="prop-row">
                          <label>Horizontal Offset ({unitLabel})</label>
                          <input
                            type="number"
                            value={proxyDraft.offsetU}
                            step={step}
                            disabled={!canEditSelected}
                            onChange={(e) => commitProxyNumeric('offsetUFt', e.target.value)}
                          />
                        </div>

                        <div className="prop-row">
                          <label>Vertical Offset ({unitLabel})</label>
                          <input
                            type="number"
                            value={proxyDraft.offsetV}
                            step={step}
                            disabled={!canEditSelected}
                            onChange={(e) => commitProxyNumeric('offsetVFt', e.target.value)}
                          />
                        </div>
                      </>
                    )}

                    {proxyDraft.mode === 'add' && (
                      <>
                        <div className="prop-row prop-row-compact">
                          <label>Blocks scaffold</label>
                          <div className="prop-toggle">
                            <input
                              type="checkbox"
                              checked={proxyDraft.blocksScaffold}
                              disabled={!canEditSelected}
                              onChange={(e) => commitProxyAnalysisFlag('blocksScaffold', e.target.checked)}
                            />
                          </div>
                        </div>

                        <div className="prop-row prop-row-compact">
                          <label>Supports scaffold</label>
                          <div className="prop-toggle">
                            <input
                              type="checkbox"
                              checked={proxyDraft.supportsScaffold}
                              disabled={!canEditSelected}
                              onChange={(e) => commitProxyAnalysisFlag('supportsScaffold', e.target.checked)}
                            />
                          </div>
                        </div>
                      </>
                    )}

                    {canHostNestedOnProxy ? (
                      <>
                        <div className="building-pattern-axis-group">
                        <div className="building-pattern-axis-heading">Top Of This Volume</div>
                        <div className="building-nested-tool-note">Choose a tool, then place it on the highlighted top face.</div>
                        <div className="building-nested-tool-row">
                          <button
                            type="button"
                            className="building-nested-tool"
                            disabled={!canEditSelected}
                            onClick={() => handleAddOrSelectNestedRoof(selectedProxyEntity)}
                          >
                            <span className="building-nested-tool-kicker">Roof</span>
                            <span className="building-nested-tool-title">{selectedProxyRoof ? 'Select Roof' : 'Roof'}</span>
                            <span className="building-nested-tool-caption">{selectedProxyRoof ? 'Open the hosted roof' : 'Top cap'}</span>
                          </button>
                          <button
                            type="button"
                            className="building-nested-tool"
                            disabled={!canEditSelected}
                            onClick={() => createNestedTopFeature(selectedProxyEntity)}
                          >
                            <span className="building-nested-tool-kicker">Feature</span>
                            <span className="building-nested-tool-title">Top Feature</span>
                            <span className="building-nested-tool-caption">Hosted form</span>
                          </button>
                          <button
                            type="button"
                            className="building-nested-tool"
                            disabled={!canEditSelected}
                            onClick={() => createNestedTopVolume(selectedProxyEntity, 'add')}
                          >
                            <span className="building-nested-tool-kicker">Volume</span>
                            <span className="building-nested-tool-title">Volume</span>
                            <span className="building-nested-tool-caption">Add mass</span>
                          </button>
                          <button
                            type="button"
                            className="building-nested-tool is-cut"
                            disabled={!canEditSelected}
                            onClick={() => createNestedTopVolume(selectedProxyEntity, 'cut')}
                          >
                            <span className="building-nested-tool-kicker">Cut</span>
                            <span className="building-nested-tool-title">Cut Volume</span>
                            <span className="building-nested-tool-caption">Subtract mass</span>
                          </button>
                        </div>
                      </div>

                        <div className="building-pattern-axis-group">
                        <div className="building-pattern-axis-heading">Sides Of This Volume</div>
                        <div className="building-nested-tool-note">Choose a wall-hosted tool, then draw directly on the side you want.</div>
                        <div className="building-nested-tool-row">
                          <button
                            type="button"
                            className="building-nested-tool"
                            disabled={!canEditSelected}
                            onClick={() => createNestedSideFeature(selectedProxyEntity)}
                          >
                            <span className="building-nested-tool-kicker">Wall</span>
                            <span className="building-nested-tool-title">Side Feature</span>
                            <span className="building-nested-tool-caption">Balcony, canopy, screen</span>
                          </button>
                          <button
                            type="button"
                            className="building-nested-tool"
                            disabled={!canEditSelected}
                            onClick={() => createNestedSideVolume(selectedProxyEntity, 'add')}
                          >
                            <span className="building-nested-tool-kicker">Volume</span>
                            <span className="building-nested-tool-title">Side Volume</span>
                            <span className="building-nested-tool-caption">Add wall mass</span>
                          </button>
                          <button
                            type="button"
                            className="building-nested-tool is-cut"
                            disabled={!canEditSelected}
                            onClick={() => createNestedSideVolume(selectedProxyEntity, 'cut')}
                          >
                            <span className="building-nested-tool-kicker">Cut</span>
                            <span className="building-nested-tool-title">Side Cut</span>
                            <span className="building-nested-tool-caption">Subtract wall mass</span>
                          </button>
                        </div>
                        </div>
                      </>
                    ) : null}

                    {selectedProxyHostedGroups.length > 0 ? (
                      <div className="building-hosted-panel">
                        <div className="building-section-kicker">Hosted On This Volume</div>
                        <div className="building-hosted-groups">
                          {selectedProxyHostedGroups.map((group) => (
                            <div className="building-hosted-group" key={group.key}>
                              <div className="building-hosted-group-header">
                                <span className="building-hosted-group-title">{group.title}</span>
                                <span className="building-hosted-group-count">{group.items.length}</span>
                              </div>
                              <div className="building-hosted-chip-row">
                                {group.items.map((entity, index) => {
                                  const labelBase = getHostedSelectionLabel(entity)
                                  const label = group.items.length > 1 ? `${labelBase} ${index + 1}` : labelBase
                                  return (
                                    <button
                                      type="button"
                                      key={entity.id}
                                      className={`building-hosted-chip${selectedBuildingEntityId === entity.id ? ' is-selected' : ''}`}
                                      onClick={() => handleSelectHostedChild(entity.id)}
                                    >
                                      <span className="building-hosted-chip-title">{label}</span>
                                      <span className="building-hosted-chip-caption">{getHostedSelectionCaption(entity)}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ),
                hint: proxyDraft.mode === 'cut'
                  ? (isSideProxy
                      ? 'Cut volumes remove support where they intersect the selected wall face. Use the face, size, and offset settings here to control the cut.'
                      : 'Top cut volumes remove support where they intersect the roof host. Use the size settings here, or click the live dimension labels in the viewport to place the cut footprint precisely.')
                  : (isSideProxy
                      ? 'Volumes stay attached to the selected wall face. Solid volumes can also host a new top feature or volume on their upper face.'
                      : 'Top volumes stay attached to the host roof plane. Use the size and scaffold settings here, or click the live dimension labels in the viewport to place the footprint precisely.'),
              })
            }

            if (editablePatternEntity && editablePatternHost) {
              const faceOptions = getPatternFaceOptionsForHostShape(editablePatternHost?.params.shape ?? null)
              const patternFaceId = patternDraft.faceId
              const patternPresetOptions = getPatternPresetOptionsForFace(patternFaceId)
              const isTopPattern = patternFaceId === 'top'
              const canWrapWalls = editablePatternHost.params.shape === 'rect' && !isTopPattern
              const isWrappedPattern = canWrapWalls && patternDraft.wrapMode !== 'single-face'
              const isSelectedWallsPattern = canWrapWalls && patternDraft.wrapMode === 'selected-walls'
              const showPatternBalconyHandrailControls = !isTopPattern
                && patternDraft.contentType === 'feature'
                && patternDraft.featurePreset === 'balcony'
              const selectedWallFaceIds = !isTopPattern
                ? sanitizeHostedPatternWallFaceIds(patternDraft.wallFaceIds, patternFaceId as SideFeatureFaceId)
                : []
              const visiblePatternInstances = editablePatternInstances.filter((instance) => !instance.hidden)
              const visiblePatternRowCount = Math.max(1, new Set(visiblePatternInstances.map((instance) => instance.offsetVFt.toFixed(4))).size)
              const selectedPatternInstanceIndex = selectedPatternInstanceResolved
                ? selectedPatternInstances.findIndex((instance) => instance.instanceId === selectedPatternInstanceResolved.instanceId)
                : -1
              const selectedPatternInstanceLabel = selectedPatternInstanceIndex >= 0
                ? `Instance ${selectedPatternInstanceIndex + 1}`
                : 'Instance'
              const faceSummaryLabel = patternDraft.wrapMode === 'all-walls'
                ? `All Walls · start ${patternFaceId}`
                : patternDraft.wrapMode === 'selected-walls'
                  ? `Selected Walls / ${selectedWallFaceIds.length} walls`
                  : patternFaceId === 'top'
                    ? 'Top'
                    : patternFaceId

              return renderBuildingCard({
                title: isPatternPreviewActive ? 'PATTERN PREVIEW' : 'PATTERN',
                subtitle: getHostedPatternContentLabel(editablePatternEntity.params.contentType, editablePatternEntity.params.featurePreset),
                actions: (
                  <>
                    {!isPatternPreviewActive ? (
                      <>
                        <button
                          type="button"
                          className="block-edit-btn"
                          onClick={() => {
                            setSelectedBuildingEntityId(editablePatternHost.id)
                            setSelectedObjectId(editablePatternHost.id)
                          }}
                        >
                          Select Host
                        </button>
                        <button
                          type="button"
                          className="block-edit-btn block-edit-btn-danger"
                          disabled={!canEditSelected}
                          onClick={() => handleDeleteHostedEntity(editablePatternEntity.id, editablePatternHost.id)}
                        >
                          Delete
                        </button>
                      </>
                    ) : null}
                  </>
                ),
                summary: renderBuildingMetricStrip([
                  { label: 'Content', value: patternDraft.contentType === 'feature' ? 'Feature' : patternDraft.contentType === 'cut-volume' ? 'Cut Volume' : 'Volume' },
                  { label: isWrappedPattern ? 'Wrap' : 'Face', value: faceSummaryLabel },
                  { label: isTopPattern ? 'Bands' : 'Rows', value: String(visiblePatternRowCount) },
                  { label: 'Instances', value: String(visiblePatternInstances.length) },
                ]),
                body: (
                  <div className="building-form-grid">
                    <div className="prop-row">
                      <label>Content</label>
                      <select
                        value={patternDraft.contentType}
                        disabled={!canEditSelected}
                        onChange={(e) => commitPatternContentType(e.target.value as HostedPatternContentType)}
                      >
                        <option value="feature">Feature</option>
                        <option value="volume">Volume</option>
                        <option value="cut-volume">Cut Volume</option>
                      </select>
                    </div>

                    {patternDraft.contentType === 'feature' && (
                      <div className="prop-row">
                        <label>Preset</label>
                        <select
                          value={patternDraft.featurePreset}
                          disabled={!canEditSelected}
                          onChange={(e) => commitPatternFeaturePreset(e.target.value as HostedFeaturePreset)}
                        >
                          {patternPresetOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {canWrapWalls && (
                      <div className="prop-row">
                        <label>Wrap</label>
                        <select
                          value={patternDraft.wrapMode}
                          disabled={!canEditSelected}
                          onChange={(e) => commitPatternWrapMode(e.target.value as HostedPatternWrapMode)}
                        >
                          {PATTERN_WRAP_MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {isWrappedPattern && (
                      <div className="prop-row">
                        <label>Corner Behavior</label>
                        <select
                          value={patternDraft.cornerBehavior}
                          disabled={!canEditSelected}
                          onChange={(e) => commitPatternCornerBehavior(e.target.value as HostedPatternCornerBehavior)}
                        >
                          {PATTERN_CORNER_BEHAVIOR_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {faceOptions.length > 1 && (
                      <div className="prop-row">
                        <label>{isWrappedPattern ? 'Start Face' : 'Face'}</label>
                        <select
                          value={patternDraft.faceId}
                          disabled={!canEditSelected}
                          onChange={(e) => commitPatternFace(e.target.value as 'top' | SideFeatureFaceId)}
                        >
                          {faceOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {isSelectedWallsPattern && (
                      <div className="prop-row building-prop-row-stack">
                        <label>Included Walls</label>
                        <div className="building-check-grid">
                          {SIDE_FEATURE_FACE_OPTIONS.map((option) => {
                            const isStartFace = option.value === patternFaceId
                            return (
                              <label key={option.value} className="building-check-chip">
                                <input
                                  type="checkbox"
                                  checked={selectedWallFaceIds.includes(option.value)}
                                  disabled={!canEditSelected || isStartFace}
                                  onChange={(e) => commitPatternWallFaceSelection(option.value, e.target.checked)}
                                />
                                <span>{isStartFace ? `${option.label} (Start)` : option.label}</span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <div className="prop-row">
                      <label>Width ({unitLabel})</label>
                      <input
                        type="number"
                        value={patternDraft.width}
                        step={step}
                        min={step}
                        disabled={!canEditSelected}
                        onChange={(e) => commitPatternNumeric('widthFt', e.target.value)}
                      />
                    </div>

                    <div className="prop-row">
                      <label>{isTopPattern ? `Depth (${unitLabel})` : `Projection (${unitLabel})`}</label>
                      <input
                        type="number"
                        value={patternDraft.depth}
                        step={step}
                        min={step}
                        disabled={!canEditSelected}
                        onChange={(e) => commitPatternNumeric('depthFt', e.target.value)}
                      />
                    </div>

                    <div className="prop-row">
                      <label>Height ({unitLabel})</label>
                      <input
                        type="number"
                        value={patternDraft.height}
                        step={step}
                        min={step}
                        disabled={!canEditSelected}
                        onChange={(e) => commitPatternNumeric('heightFt', e.target.value)}
                      />
                    </div>

                    {showPatternBalconyHandrailControls && (
                      <div className="building-pattern-axis-group">
                        <div className="building-pattern-axis-heading">Balcony Handrail</div>
                        <div className="prop-row prop-row-compact">
                          <label>Show Handrail</label>
                          <div className="prop-toggle">
                            <input
                              type="checkbox"
                              checked={patternDraft.handrailEnabled}
                              disabled={!canEditSelected}
                              onChange={(e) => commitPatternHandrailEnabled(e.target.checked)}
                            />
                          </div>
                        </div>
                        <div className="prop-row">
                          <label>Rail Height ({unitLabel})</label>
                          <input
                            type="number"
                            value={patternDraft.handrailHeight}
                            step={step}
                            min={step}
                            disabled={!canEditSelected || !patternDraft.handrailEnabled}
                            onChange={(e) => commitPatternNumeric('balconyHandrailHeightFt', e.target.value)}
                          />
                        </div>
                        <div className="prop-row">
                          <label>Rail Inset ({unitLabel})</label>
                          <input
                            type="number"
                            value={patternDraft.handrailInset}
                            step={step}
                            min={0}
                            disabled={!canEditSelected || !patternDraft.handrailEnabled}
                            onChange={(e) => commitPatternNumeric('balconyHandrailInsetFt', e.target.value)}
                          />
                        </div>
                        <div className="prop-row">
                          <label>Rail Thickness ({unitLabel})</label>
                          <input
                            type="number"
                            value={patternDraft.handrailThickness}
                            step={step}
                            min={step}
                            disabled={!canEditSelected || !patternDraft.handrailEnabled}
                            onChange={(e) => commitPatternNumeric('balconyHandrailThicknessFt', e.target.value)}
                          />
                        </div>
                      </div>
                    )}

                    <div className="building-pattern-axis-group">
                      <div className="building-pattern-axis-heading">{isTopPattern ? 'Primary Layout' : isWrappedPattern ? 'Perimeter Run' : 'Wall Run'}</div>
                      <div className="prop-row">
                        <label>Placement</label>
                        <select
                          value={patternDraft.uMode}
                          disabled={!canEditSelected}
                          onChange={(e) => commitPatternAxisMode('distributionU', e.target.value as HostedPatternAxisMode)}
                        >
                          <option value="count">By Count</option>
                          <option value="spacing">By Spacing</option>
                          <option value="fit">Fit To Face</option>
                        </select>
                      </div>
                      <div className="prop-row">
                        <label>{patternDraft.uMode === 'count' ? (isTopPattern ? 'Items' : 'Members') : `Gap (${unitLabel})`}</label>
                        <input
                          type="number"
                          value={patternDraft.uMode === 'count' ? patternDraft.uCount : patternDraft.uSpacing}
                          step={patternDraft.uMode === 'count' ? 1 : step}
                          min={patternDraft.uMode === 'count' ? 1 : 0}
                          disabled={!canEditSelected}
                          onChange={(e) => commitPatternAxisNumeric(
                            'distributionU',
                            patternDraft.uMode === 'count' ? 'count' : 'spacingFt',
                            e.target.value,
                          )}
                        />
                      </div>
                      <div className="prop-row">
                        <label>{isWrappedPattern ? `Start Margin (${unitLabel})` : `Start Setback (${unitLabel})`}</label>
                        <input
                          type="number"
                          value={patternDraft.uStart}
                          step={step}
                          min={0}
                          disabled={!canEditSelected}
                          onChange={(e) => commitPatternAxisNumeric('distributionU', 'startSetbackFt', e.target.value)}
                        />
                      </div>
                      <div className="prop-row">
                        <label>{isWrappedPattern ? `End Margin (${unitLabel})` : `End Setback (${unitLabel})`}</label>
                        <input
                          type="number"
                          value={patternDraft.uEnd}
                          step={step}
                          min={0}
                          disabled={!canEditSelected}
                          onChange={(e) => commitPatternAxisNumeric('distributionU', 'endSetbackFt', e.target.value)}
                        />
                      </div>
                      <div className="prop-row prop-row-compact">
                        <label>{isWrappedPattern ? 'Center Run' : 'Center Pattern'}</label>
                        <div className="prop-toggle">
                          <input
                            type="checkbox"
                            checked={patternDraft.uCentered}
                            disabled={!canEditSelected}
                            onChange={(e) => commitPatternAxisCentered('distributionU', e.target.checked)}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="building-pattern-axis-group">
                      <div className="building-pattern-axis-heading">{isTopPattern ? 'Secondary Layout' : 'Rows'}</div>
                      <div className="prop-row">
                        <label>{isTopPattern ? 'Bands' : 'Rows'}</label>
                        <select
                          value={patternDraft.vMode}
                          disabled={!canEditSelected}
                          onChange={(e) => commitPatternAxisMode('distributionV', e.target.value as HostedPatternAxisMode)}
                        >
                          <option value="count">By Count</option>
                          <option value="spacing">By Spacing</option>
                          <option value="fit">Fit To Face</option>
                        </select>
                      </div>
                      <div className="prop-row">
                        <label>{patternDraft.vMode === 'count' ? (isTopPattern ? 'Band Count' : 'Row Count') : isTopPattern ? `Band Gap (${unitLabel})` : `Row Gap (${unitLabel})`}</label>
                        <input
                          type="number"
                          value={patternDraft.vMode === 'count' ? patternDraft.vCount : patternDraft.vSpacing}
                          step={patternDraft.vMode === 'count' ? 1 : step}
                          min={patternDraft.vMode === 'count' ? 1 : 0}
                          disabled={!canEditSelected}
                          onChange={(e) => commitPatternAxisNumeric(
                            'distributionV',
                            patternDraft.vMode === 'count' ? 'count' : 'spacingFt',
                            e.target.value,
                          )}
                        />
                      </div>
                      <div className="prop-row">
                        <label>{isTopPattern ? `Near Offset (${unitLabel})` : `Base Offset (${unitLabel})`}</label>
                        <input
                          type="number"
                          value={patternDraft.vStart}
                          step={step}
                          min={0}
                          disabled={!canEditSelected}
                          onChange={(e) => commitPatternAxisNumeric('distributionV', 'startSetbackFt', e.target.value)}
                        />
                      </div>
                      <div className="prop-row">
                        <label>{isTopPattern ? `Far Offset (${unitLabel})` : `Top Offset (${unitLabel})`}</label>
                        <input
                          type="number"
                          value={patternDraft.vEnd}
                          step={step}
                          min={0}
                          disabled={!canEditSelected}
                          onChange={(e) => commitPatternAxisNumeric('distributionV', 'endSetbackFt', e.target.value)}
                        />
                      </div>
                      <div className="prop-row prop-row-compact">
                        <label>{isTopPattern ? 'Center Bands' : 'Center Rows'}</label>
                        <div className="prop-toggle">
                          <input
                            type="checkbox"
                            checked={patternDraft.vCentered}
                            disabled={!canEditSelected}
                            onChange={(e) => commitPatternAxisCentered('distributionV', e.target.checked)}
                          />
                        </div>
                      </div>
                    </div>

                    {patternDraft.contentType !== 'cut-volume' && (
                      <>
                        <div className="prop-row prop-row-compact">
                          <label>Blocks scaffold</label>
                          <div className="prop-toggle">
                            <input
                              type="checkbox"
                              checked={patternDraft.blocksScaffold}
                              disabled={!canEditSelected}
                              onChange={(e) => commitPatternAnalysisFlag('blocksScaffold', e.target.checked)}
                            />
                          </div>
                        </div>

                        <div className="prop-row prop-row-compact">
                          <label>Supports scaffold</label>
                          <div className="prop-toggle">
                            <input
                              type="checkbox"
                              checked={patternDraft.supportsScaffold}
                              disabled={!canEditSelected}
                              onChange={(e) => commitPatternAnalysisFlag('supportsScaffold', e.target.checked)}
                            />
                          </div>
                        </div>
                      </>
                    )}

                    {!isPatternPreviewActive && (selectedPatternInstanceResolved || selectedPatternOverrideItems.length > 0) ? (
                      <div className="building-pattern-axis-group">
                        <div className="building-pattern-axis-heading">Member Editing</div>
                        {selectedPatternInstanceResolved ? (
                        <>
                          <div className="prop-row">
                            <label>Selected Member</label>
                            <span className="block-dim-value">{selectedPatternInstanceLabel}</span>
                          </div>
                          {selectedPatternDetachedEntityId ? (
                            <>
                              <div className="prop-row">
                                <label>Detached Member</label>
                                <span className="block-dim-value">
                                  {selectedPatternDetachedEntity
                                    ? getHostedSelectionLabel(selectedPatternDetachedEntity)
                                    : 'Detached entity missing'}
                                </span>
                              </div>
                              <div className="prop-row">
                                <label>Detached Action</label>
                                <button
                                  type="button"
                                  className="block-edit-btn"
                                  disabled={!selectedPatternDetachedEntity}
                                  onClick={handleSelectDetachedPatternEntity}
                                >
                                  Select Detached
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="prop-row prop-row-compact">
                              <label>Skip Instance</label>
                              <div className="prop-toggle">
                                <input
                                  type="checkbox"
                                  checked={patternInstanceDraft.hidden}
                                  disabled={!canEditSelected}
                                  onChange={(e) => commitPatternInstanceHidden(e.target.checked)}
                                />
                              </div>
                            </div>
                          )}
                          <div className="prop-row">
                            <label>Width ({unitLabel})</label>
                            <input
                              type="number"
                              value={patternInstanceDraft.width}
                              step={step}
                              min={step}
                              disabled={!canEditSelected || Boolean(selectedPatternDetachedEntityId)}
                              onChange={(e) => commitPatternInstanceNumeric('widthFt', e.target.value)}
                            />
                          </div>
                          <div className="prop-row">
                            <label>{selectedPatternInstanceResolved.faceId === 'top' ? `Depth (${unitLabel})` : `Projection (${unitLabel})`}</label>
                            <input
                              type="number"
                              value={patternInstanceDraft.depth}
                              step={step}
                              min={step}
                              disabled={!canEditSelected || Boolean(selectedPatternDetachedEntityId)}
                              onChange={(e) => commitPatternInstanceNumeric('depthFt', e.target.value)}
                            />
                          </div>
                          <div className="prop-row">
                            <label>Height ({unitLabel})</label>
                            <input
                              type="number"
                              value={patternInstanceDraft.height}
                              step={step}
                              min={step}
                              disabled={!canEditSelected || Boolean(selectedPatternDetachedEntityId)}
                              onChange={(e) => commitPatternInstanceNumeric('heightFt', e.target.value)}
                            />
                          </div>
                          <div className="prop-row">
                            <label>Offset U ({unitLabel})</label>
                            <input
                              type="number"
                              value={patternInstanceDraft.offsetU}
                              step={step}
                              disabled={!canEditSelected || Boolean(selectedPatternDetachedEntityId)}
                              onChange={(e) => commitPatternInstanceNumeric('offsetUFt', e.target.value)}
                            />
                          </div>
                          <div className="prop-row">
                            <label>Offset V ({unitLabel})</label>
                            <input
                              type="number"
                              value={patternInstanceDraft.offsetV}
                              step={step}
                              disabled={!canEditSelected || Boolean(selectedPatternDetachedEntityId)}
                              onChange={(e) => commitPatternInstanceNumeric('offsetVFt', e.target.value)}
                            />
                          </div>
                          {editablePatternEntity?.params.contentType !== 'cut-volume' && (
                            <>
                              <div className="prop-row prop-row-compact">
                                <label>Blocks scaffold</label>
                                <div className="prop-toggle">
                                  <input
                                    type="checkbox"
                                    checked={patternInstanceDraft.blocksScaffold}
                                    disabled={!canEditSelected || Boolean(selectedPatternDetachedEntityId)}
                                    onChange={(e) => commitPatternInstanceAnalysisFlag('blocksScaffold', e.target.checked)}
                                  />
                                </div>
                              </div>
                              <div className="prop-row prop-row-compact">
                                <label>Supports scaffold</label>
                                <div className="prop-toggle">
                                  <input
                                    type="checkbox"
                                    checked={patternInstanceDraft.supportsScaffold}
                                    disabled={!canEditSelected || Boolean(selectedPatternDetachedEntityId)}
                                    onChange={(e) => commitPatternInstanceAnalysisFlag('supportsScaffold', e.target.checked)}
                                  />
                                </div>
                              </div>
                            </>
                          )}
                          <div className="prop-row">
                            <label>Detach</label>
                            <button
                              type="button"
                              className="block-edit-btn"
                              disabled={
                                !canEditSelected
                                || Boolean(selectedPatternDetachedEntityId)
                                || selectedPatternInstanceResolved.hidden
                              }
                              onClick={handleDetachPatternInstance}
                            >
                              Detach Instance
                            </button>
                          </div>
                          <div className="prop-row">
                            <label>{selectedPatternDetachedEntityId ? 'Restore' : 'Override'}</label>
                            <button
                              type="button"
                              className="block-edit-btn"
                              disabled={!canEditSelected || (!selectedPatternInstanceOverride && !selectedPatternInstanceResolved.hidden)}
                              onClick={restoreOrResetPatternInstanceOverride}
                            >
                              {selectedPatternDetachedEntityId
                                ? 'Restore Pattern Member'
                                : selectedPatternInstanceResolved.hidden
                                  ? 'Restore Instance'
                                  : 'Reset Override'}
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          {selectedPatternOverrideItems.length > 0 ? (
                            <div className="prop-row">
                              <label>Saved Overrides</label>
                              <div className="building-pattern-member-list">
                                {selectedPatternOverrideItems.map(({ index, instance, override }) => {
                                  const hasDetachedLink = Boolean(override?.detachedEntityId)
                                  const memberStatus = hasDetachedLink
                                    ? 'Detached'
                                    : instance.hidden
                                      ? 'Skipped'
                                      : 'Override'
                                  return (
                                    <button
                                      key={instance.instanceId}
                                      type="button"
                                      className="building-pattern-member-button"
                                      onClick={() => setSelectedHostedPatternInstance({
                                        patternId: editablePatternEntity.id,
                                        instanceId: instance.instanceId,
                                      })}
                                    >
                                      {`Instance ${index + 1} · ${memberStatus}`}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          ) : null}
                          <div className="prop-row">
                            <label>Override Mode</label>
                            <span className="block-dim-value">
                              Click one repeated member in the scene to edit it independently.
                              {selectedPatternOverrideItems.length > 0 ? ' Detached and skipped members stay available here.' : ''}
                            </span>
                          </div>
                        </>
                        )}
                      </div>
                    ) : null}

                    {isPatternPreviewActive ? (
                      <div className="building-pattern-preview-footer">
                        <div className="building-pattern-preview-note">
                          The full canvas is your live preview. Tune the pattern here, then create it when the run looks right.
                        </div>
                        <div className="building-pattern-preview-actions">
                          <button
                            type="button"
                            className="building-pattern-preview-btn building-pattern-preview-btn-secondary"
                            onClick={handleCancelPatternPreview}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="building-pattern-preview-btn building-pattern-preview-btn-primary"
                            disabled={!canEditSelected}
                            onClick={handleCreatePatternFromPreview}
                          >
                            Create Pattern
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ),
                hint: isPatternPreviewActive
                  ? (isTopPattern
                      ? 'This is a live preview. Adjust the top-face pattern here, watch the repeated members update in the scene, then create the pattern when it looks right.'
                      : isSelectedWallsPattern
                        ? 'This is a live preview. Adjust the start face, choose the included walls, and tune the run before creating the pattern. Corner behavior controls whether the pattern flows through turns or restarts on each wall.'
                      : isWrappedPattern
                        ? 'This is a live preview. Adjust the wrapped wall pattern here, choose the start face, wrap mode, and corner behavior, then create it when the run looks right. The wrapped viewport dimensions will update as you tune the run.'
                        : 'This is a live preview. Adjust the wall pattern here, watch the repeated members update in the scene, then create the pattern when it looks right.')
                  : (isTopPattern
                      ? 'Patterns repeat hosted features or volumes across the top face. Use the primary and secondary layout controls here, then click any repeated member in the scene to create a local override.'
                      : isSelectedWallsPattern
                        ? 'Patterns repeat hosted features or volumes across a selected wall subset, starting from the chosen face. Use the wall picker to include only the faces you want in the run, then use Corner Behavior to choose whether the pattern flows through turns or resolves wall by wall. When rows are stacked, the viewport row-gap label lets you tune the vertical spacing directly.'
                      : isWrappedPattern
                        ? 'Patterns repeat hosted features or volumes around the wall perimeter, starting from the selected face. Use Corner Behavior to choose a continuous run, restart each wall independently, or align the layout to corners. When rows are stacked, the viewport row-gap label lets you tune the vertical spacing directly.'
                        : 'Patterns repeat hosted features or volumes across the selected wall face. Use the wall run controls for the horizontal pattern and the rows controls for stacked levels, then click any member to override it.'),
              })
            }

            const buildingObj = isBuilding ? (selected as SceneObject) : null
            const entityShape = selectedBaseMassEntity?.params.shape ?? null
            const isCircular = entityShape === 'circle'
              || entityShape === 'ring'
              || buildingObj?.type === 'circle'
              || buildingObj?.type === 'ring'
              || buildingObj?.radius != null
            const isRing = entityShape === 'ring' || buildingObj?.type === 'ring' || (isCircular && buildingObj?.innerRadius != null)

            if (isCircular) {
              return renderBuildingCard({
                title: 'BUILDING',
                subtitle: isRing ? 'Ring mass' : 'Circular mass',
                summary: renderBuildingMetricStrip([
                  { label: 'Diameter', value: `${draft.radius ? Number((Number(draft.radius) * 2).toFixed(settings.decimalPrecision)) : 0} ${unitLabel}` },
                  ...(isRing ? [{ label: 'Wall', value: `${draft.thickness || '0'} ${unitLabel}` }] : [{ label: 'Type', value: isRing ? 'Ring' : 'Circle' }]),
                  { label: 'Height', value: `${draft.height || '0'} ${unitLabel}` },
                ]),
                body: (
                  <>
                    {buildingFeatureActionButtons}
                    <div className="building-form-grid">
                      <div className="prop-row">
                        <label>Diameter ({unitLabel})</label>
                        <input
                          type="number"
                          value={draft.radius ? String(Number((Number(draft.radius) * 2).toFixed(settings.decimalPrecision))) : ''}
                          step={step}
                          min={step}
                          disabled={!canEditSelected}
                          onChange={e => {
                            const diamVal = Number(e.target.value)
                            if (Number.isFinite(diamVal) && diamVal > 0) {
                              commitRadius(String(diamVal / 2))
                            }
                          }}
                        />
                      </div>

                      {isRing && (
                        <div className="prop-row">
                          <label>Wall Thickness ({unitLabel})</label>
                          <input
                            type="number"
                            value={draft.thickness}
                            step={step}
                            min={step}
                            disabled={!canEditSelected}
                            onChange={e => commitThickness(e.target.value)}
                          />
                        </div>
                      )}

                      <div className="prop-row">
                        <label>Height ({unitLabel})</label>
                        <input
                          type="number"
                          value={draft.height}
                          step={step}
                          min={step}
                          disabled={!canEditSelected}
                          onChange={e => commitCircleHeight(e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                ),
                hint: isRing
                  ? 'Diameter and wall thickness scale from the center. Height scales upward from the grid (Z=0).'
                  : 'Diameter scales from the center. Height scales upward from the grid (Z=0).',
              })
            }

            if (entityShape === 'polygon' && selectedBaseMassEntity?.params.shape === 'polygon') {
              return renderBuildingCard({
                title: 'BUILDING',
                subtitle: 'Polygon mass',
                summary: renderBuildingMetricStrip([
                  { label: 'Vertices', value: selectedBaseMassEntity.params.points.length },
                  { label: 'Height', value: `${draft.height || '0'} ${unitLabel}` },
                  { label: 'Shape', value: 'Polygon' },
                ]),
                body: (
                  <>
                    {buildingFeatureActionButtons}
                    <div className="building-form-grid">
                      <div className="prop-row">
                        <label>Vertices</label>
                        <span className="prop-value">{selectedBaseMassEntity.params.points.length}</span>
                      </div>

                      <div className="prop-row">
                        <label>Height ({unitLabel})</label>
                        <input
                          type="number"
                          value={draft.height}
                          step={step}
                          min={step}
                          disabled={!canEditSelected}
                          onChange={e => commitDimension('height', e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                ),
                hint: 'Polygon footprints keep their plan shape. Height scales upward from the grid (Z=0).',
              })
            }

            return renderBuildingCard({
              title: 'BUILDING',
              subtitle: selectedBaseMassEntity ? 'Rectangular mass' : 'Building shape',
              summary: renderBuildingMetricStrip([
                { label: 'Length', value: `${draft.length || '0'} ${unitLabel}` },
                { label: 'Depth', value: `${draft.depth || '0'} ${unitLabel}` },
                { label: 'Height', value: `${draft.height || '0'} ${unitLabel}` },
              ]),
              body: (
                <>
                  {buildingFeatureActionButtons}
                  <div className="building-form-grid">
                    <div className="prop-row">
                      <label>Length ({unitLabel})</label>
                      <input
                        type="number"
                        value={draft.length}
                        step={step}
                        min={step}
                        disabled={!canEditSelected}
                        onChange={e => commitDimension('length', e.target.value)}
                      />
                    </div>

                    <div className="prop-row">
                      <label>Depth ({unitLabel})</label>
                      <input
                        type="number"
                        value={draft.depth}
                        step={step}
                        min={step}
                        disabled={!canEditSelected}
                        onChange={e => commitDimension('depth', e.target.value)}
                      />
                    </div>

                    <div className="prop-row">
                      <label>Height ({unitLabel})</label>
                      <input
                        type="number"
                        value={draft.height}
                        step={step}
                        min={step}
                        disabled={!canEditSelected}
                        onChange={e => commitDimension('height', e.target.value)}
                      />
                    </div>
                  </div>
                </>
              ),
              hint: 'Length and depth scale from the centroid. Height scales upward from the grid (Z=0).',
            })
          })()}
        </div>
      ) : isScaffold ? (
        /* Scaffold component properties (read-only info) */
        <div className="properties-body">
          {(() => {
            const scaffoldObj = selected as ScaffoldObject
            return (
              <>
                <div className="prop-row">
                  <label>Component</label>
                  <span className="prop-value">{scaffoldObj.displayName}</span>
                </div>

                <div className="prop-row">
                  <label>Type</label>
                  <span className="prop-value">{scaffoldObj.componentType}</span>
                </div>

                <div className="prop-row">
                  <label>Length/Height ({unitLabel})</label>
                  <span className="prop-value">{scaffoldObj.lengthFt.toFixed(settings.decimalPrecision)}</span>
                </div>

                <div className="prop-row">
                  <label>Weight (lbs)</label>
                  <span className="prop-value">{scaffoldObj.weightLbs.toFixed(1)}</span>
                </div>

                {scaffoldObj.catalogId && (
                  <div className="prop-row">
                    <label>Catalog ID</label>
                    <span className="prop-value">{scaffoldObj.catalogId}</span>
                  </div>
                )}

                <div className="properties-hint">
                  Scaffold components are read-only. Use Delete to remove.
                </div>
              </>
            )
          })()}
        </div>
	      ) : null}
				</>
    </div>
		{autoScaffoldModalOpen && typeof document !== 'undefined'
			? createPortal(
				<div
					className="properties-modal-backdrop"
					role="dialog"
					aria-modal="true"
					aria-labelledby="auto-scaffold-modal-title"
					data-scaffoldpro-modal="auto-scaffold"
					data-testid="auto-scaffold-modal"
					onPointerDownCapture={e => e.stopPropagation()}
					onPointerUpCapture={e => e.stopPropagation()}
					onPointerMoveCapture={e => e.stopPropagation()}
					onMouseDownCapture={e => e.stopPropagation()}
					onMouseUpCapture={e => e.stopPropagation()}
				>
					<div
						className="properties-modal"
						onClick={e => e.stopPropagation()}
						onPointerDownCapture={e => e.stopPropagation()}
						onPointerUpCapture={e => e.stopPropagation()}
						onPointerMoveCapture={e => e.stopPropagation()}
						onMouseDownCapture={e => e.stopPropagation()}
						onMouseUpCapture={e => e.stopPropagation()}
					>
						<div className="properties-modal-title" id="auto-scaffold-modal-title">Auto Around Building</div>
						<div className="properties-modal-subtitle">
							{selectedAutoScaffoldTarget?.shape === 'circle' || selectedAutoScaffoldTarget?.shape === 'ring'
								? 'Set the round scaffold recipe here. Bays are solved around the perimeter using shared radial legs and a closure bay.'
								: 'Set the scaffold recipe here. Width is solved automatically around the building with a strong 7 foot bay preference.'}
						</div>
						<div className="properties-modal-grid">
							{selectedAutoScaffoldTarget?.shape === 'circle' || selectedAutoScaffoldTarget?.shape === 'ring' ? (
								<div className="properties-modal-field">
									<label htmlFor="auto-scaffold-round-family">Round bay family</label>
									<select
										id="auto-scaffold-round-family"
										value={autoScaffoldDraft.roundBayFamily}
										onChange={e => setAutoScaffoldDraft(prev => ({ ...prev, roundBayFamily: e.target.value }))}
									>
										<option value="6x8">6 ft inner / 8 ft outer</option>
										<option value="6x6">6 ft inner / 6 ft outer</option>
										<option value="8x8">8 ft inner / 8 ft outer</option>
									</select>
								</div>
							) : null}
							<div className="properties-modal-field">
								<label htmlFor="auto-scaffold-depth">Depth (ft)</label>
								<input
									id="auto-scaffold-depth"
									type="text"
									inputMode="decimal"
									value={autoScaffoldDraft.depthFt}
									onChange={e => setAutoScaffoldDraft(prev => ({ ...prev, depthFt: e.target.value }))}
								/>
							</div>
							<div className="properties-modal-field">
								<label htmlFor="auto-scaffold-height">Height (ft)</label>
								<input
									id="auto-scaffold-height"
									type="text"
									inputMode="decimal"
									value={autoScaffoldDraft.heightFt}
									onChange={e => setAutoScaffoldDraft(prev => ({ ...prev, heightFt: e.target.value }))}
								/>
							</div>
							<div className="properties-modal-field">
								<label htmlFor="auto-scaffold-levels">Planked levels</label>
								<input
									id="auto-scaffold-levels"
									type="text"
									inputMode="numeric"
									value={autoScaffoldDraft.plankedLevelsCount}
									onChange={e => setAutoScaffoldDraft(prev => ({ ...prev, plankedLevelsCount: e.target.value }))}
								/>
							</div>
							<div className="properties-modal-field">
								<label htmlFor="auto-scaffold-offset">Building offset (ft)</label>
								<input
									id="auto-scaffold-offset"
									type="text"
									inputMode="decimal"
									value={autoScaffoldDraft.buildingOffsetFt}
									onChange={e => setAutoScaffoldDraft(prev => ({ ...prev, buildingOffsetFt: e.target.value }))}
								/>
							</div>
							<div className="properties-modal-field">
								<label htmlFor="auto-scaffold-front-back-braces">Front/Back braces</label>
								<select
									id="auto-scaffold-front-back-braces"
									value={autoScaffoldDraft.braceFrontBack}
									onChange={e => setAutoScaffoldDraft(prev => ({ ...prev, braceFrontBack: e.target.value as BlockBraceDirection }))}
								>
									{BLOCK_BRACE_OPTIONS.map(option => (
										<option key={option.value} value={option.value}>{option.label}</option>
									))}
								</select>
							</div>
							<div className="properties-modal-field">
								<label htmlFor="auto-scaffold-left-right-braces">Left/Right braces</label>
								<select
									id="auto-scaffold-left-right-braces"
									value={autoScaffoldDraft.braceLeftRight}
									onChange={e => setAutoScaffoldDraft(prev => ({ ...prev, braceLeftRight: e.target.value as BlockBraceDirection }))}
								>
									{BLOCK_BRACE_OPTIONS.map(option => (
										<option key={option.value} value={option.value}>{option.label}</option>
									))}
								</select>
							</div>
						</div>
						<div className="properties-modal-helper">
							{autoScaffoldHint}
						</div>
						<div className="properties-modal-actions">
							<button
								type="button"
								className="prop-btn prop-btn-secondary"
								onClick={() => setAutoScaffoldModalOpen(false)}
								data-testid="auto-scaffold-cancel"
							>
								Cancel
							</button>
							<button
								type="button"
								className="prop-btn"
								disabled={!canAutoScaffoldAroundBuilding}
								onClick={submitAutoScaffoldModal}
								data-testid="auto-scaffold-submit"
							>
								Auto Around Building
							</button>
						</div>
					</div>
				</div>,
				document.body,
			)
			: null}
		</>
  )
}



