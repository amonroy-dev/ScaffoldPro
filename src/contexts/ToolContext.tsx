import { createContext, useContext, useState, useRef, ReactNode, useCallback, useMemo, MutableRefObject, useReducer, useEffect } from 'react'
import * as THREE from 'three'
import type { ScaffoldObject } from '../types/scaffoldObjects'
import type { ScaffoldStack, LedgerConnection, RosetteNodeRef, ScaffoldBlockInstance, ManualPlankPlacement, ManualLiveLoadPlacement, BlockBraceDirection } from '../types/scaffoldGraph'
import { DEFAULT_MANUAL_LIVE_LOAD_PSF, generateStackId, generateLedgerId, generatePlankPlacementId, generateLiveLoadPlacementId, findClosestLedger, normalizeBlockBraceDirection } from '../types/scaffoldGraph'
import type {
  BaseMassFaceId,
  BaseMassEntity,
  BuildingAnalysisFlags,
  BuildingEntity,
  HostedFeaturePreset,
  HostedFeatureEntity,
  HostedPatternEntity,
  HostedPatternCornerBehavior,
  HostedPatternWrapMode,
  HostedParapetEntity,
  HostedProxyEntity,
  ProxyFeatureMode,
  HostedRoofEntity,
  HostedSideFeatureEntity,
  HostedTopFeatureEntity,
  SideFeatureFaceId,
} from '../types/buildingEntities'
import {
  clampPointToRectFaceInfo,
  clampPointToBaseMassFace,
  constrainRectFaceSketchPoint,
  constrainFaceSketchPoint,
  DEFAULT_BUILDING_ANALYSIS_FLAGS,
  getBaseMassFaceInfo,
  getHostedFeatureDefaultAnalysis,
  getHostedFeatureDefaultHandrailEnabled,
  getHostedFeatureDefaultHandrailHeightFt,
  getHostedFeatureDefaultHandrailInsetFt,
  getHostedFeatureDefaultHandrailThicknessFt,
  getHostedFeatureDefaultDepthFt,
  getHostedFeatureDefaultHeightFt,
  getProxyDefaultColor,
  getProxyDefaultDepthFt,
  getProxyDefaultHeightFt,
  isBaseMassEntity,
  isFeatureEntity,
  isHostedRectEntity,
  isPatternEntity,
  isParapetEntity,
  isProxyEntity,
  isRoofEntity,
  resolveHostedRectEntityFaceInfo,
  resolveHostedRectEntityTopFaceInfo,
  sanitizeHostedPatternCornerBehavior,
  sanitizeHostedPatternWallFaceIds,
  resolveHostedPatternInstances,
  resolveRectFaceSketchRect,
  resolveFaceSketchRect,
  resolvePreferredDrawHostFace,
} from '../types/buildingEntities'
import { cloneDrawingPackage, createDrawingEntityId, fitSheetCompositionToPage, normalizeDrawingPackageDocument, type DrawingPackageDocument, type DrawingProjection, type DrawingSavedView } from '../drawings/drawingDocument'
import { useModelStore } from '../store/useModelStore'
import { useCatalogSelection } from './CatalogContext'
import { resolveScaffoldBuildingGeometry } from '../utils/building/scaffoldBuildingGeometry'

	import { buildStandardPlan, chooseBayLayout, makeBlockLiveLoadBayKey, makeStackPositionKey, parseStackPositionKey, planStandardSegmentsForRequiredLiftIndex, posKey2 } from '../components/scaffold/blockPlanning'
	import { computeRectUnionBoundarySegments } from '../components/scaffold/guardrailPlanning'
	import { makeLedgerConnectionKey, parseLedgerConnectionKey } from '../components/scaffold/ledgerConnectionKey'
	import { UNIVERSAL_RINGLOCK_STANDARDS, type UniversalRinglockStandardId } from '../components/scaffold/ringlockCatalog'
	import { describeSupportAwareLayoutIssue, resolveSupportAwareBlockLayout, type SupportAwareBlockRecipe, type SupportAwareLedgerSpec, type SupportAwareStackSpec } from '../components/scaffold/supportAwareBlockSolver'

// Available tools
export type ToolType = 'select' | 'pan' | 'rectangle' | 'circle' | 'ring' | 'polygon' | 'block' | 'none'

/**
 * Block generator tool settings (UI-only; not persisted to Firestore project snapshots).
 * Units are feet unless otherwise noted.
 */
export type BlockToolSettings = {
	/** Block tool interaction mode.
	 * - assemble: place/snap blocks together
	 * - inspect: select/edit existing scaffold without leaving the Block tool
	 */
	mode: BlockToolMode
	/** Total block width in feet (X direction). */
	widthFt: number
	/** Total block depth in feet (Y direction). */
	depthFt: number
	/** Total block height in feet (Z direction). */
	heightFt: number
	/**
	 * Number of planked working deck levels to generate.
	 * Deck candidates are lift indices 4,8,12,... (and lift 0 when includeBaseDeck is true and a base collar exists).
	 * Selection is top-down and clamped to what fits under heightFt.
	 */
	plankedLevelsCount: number
	/** When true, allow a working deck at the base collar rosette (liftIndex=0) when base collars are enabled. */
	includeBaseDeck: boolean
	/** Full-height perimeter braces on the front/back faces. */
	braceFrontBack: BlockBraceDirection
	/** Full-height perimeter braces on the left/right faces. */
	braceLeftRight: BlockBraceDirection
	/** Place ledgers starting at liftIndex=1, then every N rosettes upward. */
	ledgerEveryNRosettes: number
	/** Distance (ft) between scaffold inner face and building face. Industry standard ~1ft (12"). */
	buildingOffsetFt: number
	/** When true, Copy Pull duplicates block live-load settings onto the copied blocks. */
	copyLoadsOnCopy: boolean
}

export type BlockToolMode = 'assemble' | 'inspect'
export type BlockEditActionMode = 'neutral' | 'select' | 'copy' | 'move'

// View modes for camera
export type ViewMode = 'perspective' | 'ortho-top' | 'ortho-front' | 'ortho-right' | 'ortho-left' | 'ortho-back' | 'ortho-bottom' | 'ortho-custom'

/**
 * Workspace modes (simple finite state machine)
 * - BUILDING_MODE: model the site/building reference geometry
 * - SCAFFOLD_MODE: model scaffolding; building geometry becomes locked reference
 */
export type WorkspaceMode = 'BUILDING_MODE' | 'SCAFFOLD_MODE'

/**
 * Three.js layer channels (0-31). We reserve:
 * - 0: always-on interaction layer (ground plane, helpers)
 * - 1: building/site geometry
 * - 2: scaffolding geometry
 */
export const WORKSPACE_LAYERS = {
  INTERACTION: 0,
  BUILDING: 1,
  SCAFFOLD: 2,
} as const

export type SceneWorkspace = 'building' | 'scaffold'

// Object in the scene
export interface SceneObject {
  id: string
  type: 'box' | 'cylinder' | 'sphere' | 'circle' | 'ring'
  /** Which workspace created/owns this object (drives locking/selection rules) */
  workspace: SceneWorkspace
  /** Three.js layer channel for rendering/picking filters */
  layer: number
  position: THREE.Vector3
  /** Z-UP: dimensions.x=Length (X), dimensions.y=Depth (Y), dimensions.z=Height (Z) */
  dimensions: THREE.Vector3
  rotation: THREE.Euler
  color: string
  /** Outer radius for circle / ring shapes (feet) */
  radius?: number
  /** Inner radius for ring (hollow circle) shapes (feet) */
  innerRadius?: number
}

export type SceneObjectUpdate = Partial<Omit<SceneObject, 'id' | 'type'>>

// Drawing state for rectangle tool
export interface DrawingState {
  isDrawing: boolean
  startPoint: THREE.Vector3 | null
  currentPoint: THREE.Vector3 | null
  polygonPoints: THREE.Vector3[]
  hostEntityId: string | null
  hostKind: 'world' | 'top-face' | 'side-face'
  hostFaceId: string | null
}

export type BuildingHostedSketchIntent = {
  target: 'feature' | 'proxy'
  hostEntityId: string
  hostKind: 'top-face' | 'side-face' | 'auto-face'
  faceId: BaseMassFaceId
  preset?: HostedFeaturePreset
  proxyMode?: ProxyFeatureMode
}

type DrawingHostOverride = {
  hostEntityId: string | null
  hostKind: 'world' | 'top-face' | 'side-face'
  hostFaceId: string | null
}

/**
 * Firestore-friendly serialization types (no THREE classes).
 * Note: Firestore does not allow `undefined` values.
 */
export type SerializedVector3 = { x: number; y: number; z: number }
export type SerializedEuler = { x: number; y: number; z: number; order: THREE.EulerOrder }

export type LiveCameraState = {
  position: SerializedVector3
  target: SerializedVector3
  zoom: number
  projection: DrawingProjection
  viewMode: ViewMode
  orthoDirection: SerializedVector3 | null
}

export type DrawingViewApplyRequest = {
  requestId: number
  viewId: string
  activateSection: boolean
}

export type AutoScaffoldRequest = {
	requestId: number
	targetBuildingId: string | null
	settings?: {
		depthFt: number
		heightFt: number
		plankedLevelsCount: number
		includeBaseDeck: boolean
		braceFrontBack: BlockBraceDirection
		braceLeftRight: BlockBraceDirection
		buildingOffsetFt: number
		preferredBayWidthFt: number
		roundBayFamily?: '6x8' | '6x6' | '8x8'
	} | null
}

export type LiveLoadDeckTarget = {
	blockId: string
	liftIndex: number
	bayKey?: string
}

export type SerializedSceneObject = Omit<SceneObject, 'position' | 'dimensions' | 'rotation'> & {
  position: SerializedVector3
  dimensions: SerializedVector3
  rotation: SerializedEuler
}

export type SerializedScaffoldStack = Omit<ScaffoldStack, 'gridPosition'> & {
  gridPosition: SerializedVector3
}

export type SerializedScaffoldObject = Omit<ScaffoldObject, 'position' | 'rotation'> & {
  position: SerializedVector3
  rotation?: SerializedEuler
  /** Ledger-only fields remain optional for non-ledger types. */
  startPosition?: SerializedVector3
  endPosition?: SerializedVector3
}

/**
 * The persisted project payload (stored under Firestore doc field: `data`).
 */
export interface ProjectDataV1 {
  workspaceMode: WorkspaceMode
  objects: SerializedSceneObject[]
  buildingEntities?: BuildingEntity[]
  /**
   * Legacy/ephemeral scaffold objects used for catalog preview / UI helpers.
   * These are not required to reconstruct the scaffold graph and may be omitted
   * from persisted projects to keep Firestore payloads small.
   */
  scaffoldObjects?: SerializedScaffoldObject[]
  scaffoldStacks: SerializedScaffoldStack[]
  ledgerConnections: LedgerConnection[]
	/** Manual plank placements anchored to persisted ledgers (optional for back-compat). */
	manualPlankPlacements?: ManualPlankPlacement[]
	/** Manual one-way live-load placements anchored to persisted ledgers (optional for back-compat). */
	manualLiveLoadPlacements?: ManualLiveLoadPlacement[]
	/** Parametric scaffold block instances (optional for back-compat). */
	scaffoldBlocks?: ScaffoldBlockInstance[]
	/** Premium drawing package lives in project history but persists separately for Firestore safety. */
	drawingPackage?: DrawingPackageDocument
}

type HistoryState = {
	entries: ProjectDataV1[]
	index: number
}

const HISTORY_LIMIT = 100
const HISTORY_COMMIT_DEBOUNCE_MS = 140

function cloneProjectDataSnapshot(data: ProjectDataV1): ProjectDataV1 {
	return JSON.parse(JSON.stringify(data)) as ProjectDataV1
}

function getProjectDataSignature(data: ProjectDataV1): string {
	return JSON.stringify(data)
}

function createProjectDataSnapshot(params: {
	workspaceMode: WorkspaceMode
	objects: SceneObject[]
	buildingEntities: BuildingEntity[]
	scaffoldStacks: ScaffoldStack[]
	ledgerConnections: LedgerConnection[]
	manualPlankPlacements: ManualPlankPlacement[]
	manualLiveLoadPlacements: ManualLiveLoadPlacement[]
	scaffoldBlocks: ScaffoldBlockInstance[]
	drawingPackage: DrawingPackageDocument
}): ProjectDataV1 {
	const {
		workspaceMode,
		objects,
		buildingEntities,
		scaffoldStacks,
		ledgerConnections,
		manualPlankPlacements,
		manualLiveLoadPlacements,
		scaffoldBlocks,
		drawingPackage,
	} = params

	const serializedObjects: SerializedSceneObject[] = objects.map(o => ({
		...o,
		position: serializeVector3Any(o.position),
		dimensions: serializeVector3Any(o.dimensions),
		rotation: serializeEulerAny(o.rotation),
	}))

	const serializedStacks: SerializedScaffoldStack[] = scaffoldStacks.map(s => {
		const base: any = {
			id: s.id,
			standardSegments: s.standardSegments,
			jackExtensionIn: s.jackExtensionIn,
			gridPosition: serializeVector3Any(s.gridPosition),
		}
		if (s.baseSupport !== undefined) base.baseSupport = s.baseSupport
		if (s.showWoodSill !== undefined) base.showWoodSill = s.showWoodSill
		if (s.showBaseCollar !== undefined) base.showBaseCollar = s.showBaseCollar
		return base as SerializedScaffoldStack
	})

	return {
		workspaceMode,
		objects: serializedObjects,
		...(buildingEntities.length > 0 ? { buildingEntities: JSON.parse(JSON.stringify(buildingEntities)) as BuildingEntity[] } : {}),
		scaffoldObjects: [],
		scaffoldStacks: serializedStacks,
		ledgerConnections,
		...(manualPlankPlacements.length > 0 ? { manualPlankPlacements } : {}),
		...(manualLiveLoadPlacements.length > 0 ? { manualLiveLoadPlacements } : {}),
		...(scaffoldBlocks.length > 0 ? {
			scaffoldBlocks: scaffoldBlocks.map(b => {
				const sanitized: Record<string, unknown> = {
					id: b.id,
					center: b.center,
					rotationSteps: b.rotationSteps,
					widthFt: b.widthFt,
					depthFt: b.depthFt,
					heightFt: b.heightFt,
					plankedLevelsCount: b.plankedLevelsCount,
					includeBaseDeck: b.includeBaseDeck,
					liveLoadPsf: b.liveLoadPsf,
					liveLoadDeckLiftIndices: b.liveLoadDeckLiftIndices,
					liveLoadExcludedBayKeys: b.liveLoadExcludedBayKeys,
					braceFrontBack: b.braceFrontBack,
					braceLeftRight: b.braceLeftRight,
					guardrailsIncludeBuildingSide: b.guardrailsIncludeBuildingSide,
					ledgerEveryNRosettes: b.ledgerEveryNRosettes,
					baseSettings: b.baseSettings,
					managedStackKeys: b.managedStackKeys,
					managedLedgerKeys: b.managedLedgerKeys,
					managedGuardrailLedgerKeys: b.managedGuardrailLedgerKeys,
					autoGeneratedMode: b.autoGeneratedMode,
					autoGeneratedTargetId: b.autoGeneratedTargetId,
					autoGeneratedSide: b.autoGeneratedSide,
					autoGeneratedTargetShape: b.autoGeneratedTargetShape,
					autoGeneratedRoundInnerLedgerFt: b.autoGeneratedRoundInnerLedgerFt,
					autoGeneratedRoundOuterLedgerFt: b.autoGeneratedRoundOuterLedgerFt,
					autoGeneratedRoundBayIndex: b.autoGeneratedRoundBayIndex,
					autoGeneratedRoundBayCount: b.autoGeneratedRoundBayCount,
					autoGeneratedRoundClosure: b.autoGeneratedRoundClosure,
					createdAt: b.createdAt,
				}
				if (b.plankedLevelsCount === undefined) delete (sanitized as any).plankedLevelsCount
				if (b.includeBaseDeck === undefined) delete (sanitized as any).includeBaseDeck
				if (b.liveLoadPsf === undefined) delete (sanitized as any).liveLoadPsf
				if (!Array.isArray(b.liveLoadDeckLiftIndices) || b.liveLoadDeckLiftIndices.length === 0) delete (sanitized as any).liveLoadDeckLiftIndices
				if (!Array.isArray(b.liveLoadExcludedBayKeys) || b.liveLoadExcludedBayKeys.length === 0) delete (sanitized as any).liveLoadExcludedBayKeys
				if (b.braceFrontBack === undefined) delete (sanitized as any).braceFrontBack
				if (b.braceLeftRight === undefined) delete (sanitized as any).braceLeftRight
				if (b.guardrailsIncludeBuildingSide === undefined) delete (sanitized as any).guardrailsIncludeBuildingSide
				if (!Array.isArray(b.managedGuardrailLedgerKeys) || b.managedGuardrailLedgerKeys.length === 0) delete (sanitized as any).managedGuardrailLedgerKeys
				if (b.autoGeneratedMode === undefined) delete (sanitized as any).autoGeneratedMode
				if (b.autoGeneratedTargetId === undefined) delete (sanitized as any).autoGeneratedTargetId
				if (b.autoGeneratedSide === undefined) delete (sanitized as any).autoGeneratedSide
				if (b.autoGeneratedTargetShape === undefined) delete (sanitized as any).autoGeneratedTargetShape
				if (b.autoGeneratedRoundInnerLedgerFt === undefined) delete (sanitized as any).autoGeneratedRoundInnerLedgerFt
				if (b.autoGeneratedRoundOuterLedgerFt === undefined) delete (sanitized as any).autoGeneratedRoundOuterLedgerFt
				if (b.autoGeneratedRoundBayIndex === undefined) delete (sanitized as any).autoGeneratedRoundBayIndex
				if (b.autoGeneratedRoundBayCount === undefined) delete (sanitized as any).autoGeneratedRoundBayCount
				if (b.autoGeneratedRoundClosure === undefined) delete (sanitized as any).autoGeneratedRoundClosure
				if (b.suppressedStackKeys && b.suppressedStackKeys.length > 0) sanitized.suppressedStackKeys = b.suppressedStackKeys
				if (b.suppressedLedgerKeys && b.suppressedLedgerKeys.length > 0) sanitized.suppressedLedgerKeys = b.suppressedLedgerKeys
				if (b.suppressedDiagonalKeys && b.suppressedDiagonalKeys.length > 0) sanitized.suppressedDiagonalKeys = b.suppressedDiagonalKeys
				if (b.updatedAt !== undefined) sanitized.updatedAt = b.updatedAt
				return sanitized as unknown as ScaffoldBlockInstance
			}),
		} : {}),
			drawingPackage: cloneDrawingPackage(drawingPackage),
	}
}

interface ToolContextType {
  activeTool: ToolType
  setActiveTool: (tool: ToolType) => void

		// Scaffold block generator tool
		blockToolSettings: BlockToolSettings
		updateBlockToolSettings: (partial: Partial<BlockToolSettings>) => void
		blockPlacementWarning: string | null
		showBlockPlacementWarning: (message: string) => void
		clearBlockPlacementWarning: () => void
			/**
			 * When true, the Block tool enters "Edit Blocks" mode:
			 * - No ghost preview / no placement
			 * - Click existing block footprints to select + edit
			 */
			blockEditMode: boolean
			setBlockEditMode: (enabled: boolean) => void
			blockEditActionMode: BlockEditActionMode
			setBlockEditActionMode: (mode: BlockEditActionMode) => void

  // Workspace state machine
  workspaceMode: WorkspaceMode
  setWorkspaceMode: (mode: WorkspaceMode) => void
  toggleWorkspaceMode: () => void

	// DXF / analysis export preview state
  dxfPreviewEnabled: boolean
  setDxfPreviewEnabled: (enabled: boolean) => void
  liveLoadPlacementPsf: number
  setLiveLoadPlacementPsf: (psf: number) => void
  activeLiveLoadLevelNumber: number | null
  setActiveLiveLoadLevelNumber: (levelNumber: number | null) => void
  hoveredLiveLoadDeckTargets: LiveLoadDeckTarget[]
  setHoveredLiveLoadDeckTargets: (targets: LiveLoadDeckTarget[]) => void
  selectedLiveLoadDeckTargets: LiveLoadDeckTarget[]
  setSelectedLiveLoadDeckTargets: (targets: LiveLoadDeckTarget[]) => void
  selectedLiveLoadDeckTarget: LiveLoadDeckTarget | null
  setSelectedLiveLoadDeckTarget: (target: LiveLoadDeckTarget | null) => void
  autoScaffoldRequest: AutoScaffoldRequest | null
  requestAutoScaffoldAroundBuilding: (
		targetBuildingId?: string | null,
		settings?: AutoScaffoldRequest['settings'],
	) => void
  clearAutoScaffoldRequest: () => void

  // Building/site objects (boxes, etc.)
  objects: SceneObject[]
  buildingEntities: BuildingEntity[]
  addObject: (obj: SceneObject) => void
  removeObject: (id: string) => void
  updateObject: (id: string, partial: SceneObjectUpdate) => void
  addBuildingEntity: (entity: BuildingEntity) => void
  updateBuildingEntity: (id: string, partial: Partial<BuildingEntity>) => void
  removeBuildingEntity: (id: string) => void

  // Scaffold objects (standards, ledgers, bases) - for selection/properties
  scaffoldObjects: ScaffoldObject[]
  addScaffoldObject: (obj: ScaffoldObject) => void
  removeScaffoldObject: (id: string) => void
  clearScaffoldObjects: () => void
  updateScaffoldObject: (id: string, partial: Partial<ScaffoldObject>) => void

  // Scaffold graph model - stacks and connections
  scaffoldStacks: ScaffoldStack[]
  ledgerConnections: LedgerConnection[]
	manualPlankPlacements: ManualPlankPlacement[]
	manualLiveLoadPlacements: ManualLiveLoadPlacement[]

	// Scaffold parametric blocks (Blocks mode)
	scaffoldBlocks: ScaffoldBlockInstance[]
	selectedBlockId: string | null
	selectedBlockIds: string[]
	blockDragPreviewIds: string[]
	blockDragHiddenStackIds: string[]
	setSelectedBlockId: (id: string | null) => void
	setSelectedBlockIds: (ids: string[]) => void
	setBlockDragPreviewIds: (ids: string[]) => void
	setBlockDragHiddenStackIds: (ids: string[]) => void
	clearBlockSelection: () => void
	toggleBlockSelection: (blockId: string, additive: boolean) => void
	/** True when user is editing an existing block's dimensions (hides ghost preview). */
	isEditingBlock: boolean
	setIsEditingBlock: (editing: boolean) => void
	addScaffoldBlock: (block: ScaffoldBlockInstance) => void
	removeScaffoldBlock: (blockId: string) => void
	updateScaffoldBlockLiveLoad: (
		blockId: string,
		partial: {
			liveLoadPsf?: number | null
			liveLoadDeckLiftIndices?: number[]
			liveLoadExcludedBayKeys?: string[]
		}
	) => void
	applyScaffoldBlockEdits: (
		blockId: string,
			params: {
				widthFt: number
				depthFt: number
				heightFt: number
				ledgerEveryNRosettes: number
				plankedLevelsCount?: number
				includeBaseDeck?: boolean
					braceFrontBack?: BlockBraceDirection
					braceLeftRight?: BlockBraceDirection
					center?: { x: number; y: number }
			}
	) => void
	cleanupMovedBlockArtifacts: (params: {
		previousManagedStackKeys?: string[]
		previousManagedLedgerKeys?: string[]
	}) => void
	suppressDiagonalMemberInBlock: (blockId: string, diagonalKey: string) => void
	addScaffoldStack: (
		gridPosition: THREE.Vector3,
		standardPartNumber: string,
		jackExtensionIn: number,
		options?: {
			showWoodSill?: boolean
			showBaseCollar?: boolean
			baseSupport?: ScaffoldStack['baseSupport']
		}
	) => ScaffoldStack
	appendStandardSegmentToStack: (stackId: string, standardPartNumber: string) => void
		setStandardSegmentsForStack: (stackId: string, standardPartNumbers: string[]) => void
  removeScaffoldStack: (stackId: string) => void
	updateScaffoldStack: (
		stackId: string,
		partial: Partial<Pick<ScaffoldStack, 'jackExtensionIn' | 'showWoodSill' | 'showBaseCollar' | 'baseSupport' | 'gridPosition'>>
	) => void
	updateAllScaffoldStacks: (
		partial: Partial<Pick<ScaffoldStack, 'jackExtensionIn' | 'showWoodSill' | 'showBaseCollar' | 'baseSupport'>>
	) => void
  addLedgerConnection: (startNode: RosetteNodeRef, endNode: RosetteNodeRef, ledgerPartNumber: string) => LedgerConnection
  removeLedgerConnection: (connectionId: string) => void
	addManualPlankPlacement: (supportLedgerId: string, sideSign: 1 | -1) => ManualPlankPlacement
	removeManualPlankPlacement: (placementId: string) => void
	addManualLiveLoadPlacement: (supportLedgerId: string, sideSign: 1 | -1, magnitudePsf?: number) => ManualLiveLoadPlacement
	updateManualLiveLoadPlacement: (placementId: string, partial: Partial<Pick<ManualLiveLoadPlacement, 'magnitudePsf'>>) => void
	removeManualLiveLoadPlacement: (placementId: string) => void
  clearScaffoldGraph: () => void

	/** Cleanup: remove duplicate scaffold graph nodes/connections (safe for older projects). */
	purgeDuplicateNodes: () => void

  // Selection (can be either a SceneObject or ScaffoldObject)
  selectedObjectId: string | null
  setSelectedObjectId: (id: string | null) => void
  selectedBuildingEntityId: string | null
  setSelectedBuildingEntityId: (id: string | null) => void
  selectedHostedPatternInstance: { patternId: string; instanceId: string } | null
  setSelectedHostedPatternInstance: (value: { patternId: string; instanceId: string } | null) => void
  buildingHostedPatternPreview: HostedPatternEntity | null
  setBuildingHostedPatternPreview: (value: HostedPatternEntity | null) => void
  /** Returns the selected object (either SceneObject or ScaffoldObject) */
  getSelectedObject: () => SceneObject | ScaffoldObject | null
  /** Multi-selection for scaffold stacks (standard IDs) */
  selectedStackIds: string[]
  setSelectedStackIds: (ids: string[]) => void
  toggleStackSelection: (stackId: string, additive: boolean) => void
  /** Get the selected scaffold stack(s) */
  getSelectedStacks: () => ScaffoldStack[]

  drawingState: DrawingState
  buildingHostedSketchIntent: BuildingHostedSketchIntent | null
  buildingHostedSketchFaceId: BaseMassFaceId | null
  beginBuildingHostedSketch: (intent: BuildingHostedSketchIntent) => void
  setBuildingHostedSketchFaceId: (faceId: BaseMassFaceId | null) => void
  clearBuildingHostedSketch: () => void
	  drawingPackage: DrawingPackageDocument
	  setDrawingPackage: (next: DrawingPackageDocument | ((prev: DrawingPackageDocument) => DrawingPackageDocument)) => void
  startDrawing: (point: THREE.Vector3, override?: DrawingHostOverride) => void
  updateDrawing: (point: THREE.Vector3) => void
  finishDrawing: () => SceneObject | null
  cancelDrawing: () => void
  // View mode for camera (perspective vs orthographic views)
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  // Custom ortho direction for edge/corner clicks
  orthoDirection: THREE.Vector3 | null
  setOrthoDirection: (dir: THREE.Vector3 | null) => void
  // Callback ref that Scene.tsx sets so App.tsx can call it before switching views
  // This saves the camera position to prevent the "jump" when switching camera types
  saveCameraStateRef: MutableRefObject<(() => void) | null>
  // Callback ref that Scene.tsx sets so App.tsx can explicitly request the home perspective reset.
  requestHomeViewRef: MutableRefObject<(() => void) | null>
  // Camera transition state - used to hide canvas during camera type switch
  cameraTransitioning: boolean
  setCameraTransitioning: (transitioning: boolean) => void
  cameraNavigationActive: boolean
  setCameraNavigationActive: (active: boolean) => void
  liveCameraState: LiveCameraState | null
  publishLiveCameraState: (next: LiveCameraState | null) => void
  captureCurrentModelAsDrawingView: (viewId: string) => void
	  createDrawingViewFromLiveModel: () => string | null
	  createLinkedDrawingViewFromActiveSection: () => string | null
  drawingViewApplyRequest: DrawingViewApplyRequest | null
  requestApplyDrawingView: (viewId: string, options?: { activateSection?: boolean }) => void
  clearDrawingViewApplyRequest: () => void
  activeDrawingSectionId: string | null
  setActiveDrawingSectionId: (sectionId: string | null) => void

  // Project persistence helpers (Firestore-safe)
  exportProjectData: () => ProjectDataV1
  loadProjectData: (data: ProjectDataV1) => void
	undo: () => void
	redo: () => void
	canUndo: boolean
	canRedo: boolean
}

const ToolContext = createContext<ToolContextType | null>(null)

type WorkspaceEvent =
  | { type: 'ENTER_BUILDING' }
  | { type: 'ENTER_SCAFFOLD' }
  | { type: 'TOGGLE' }

function workspaceReducer(state: WorkspaceMode, event: WorkspaceEvent): WorkspaceMode {
  switch (event.type) {
    case 'ENTER_BUILDING':
      return 'BUILDING_MODE'
    case 'ENTER_SCAFFOLD':
      return 'SCAFFOLD_MODE'
    case 'TOGGLE':
      return state === 'BUILDING_MODE' ? 'SCAFFOLD_MODE' : 'BUILDING_MODE'
    default:
      return state
  }
}

function workspaceToOwner(mode: WorkspaceMode): SceneWorkspace {
  return mode === 'BUILDING_MODE' ? 'building' : 'scaffold'
}

function cloneBuildingAnalysisFlags(
	source?: Partial<BuildingAnalysisFlags> | null,
): BuildingAnalysisFlags {
	return {
		blocksScaffold: source?.blocksScaffold ?? DEFAULT_BUILDING_ANALYSIS_FLAGS.blocksScaffold,
		supportsScaffold: source?.supportsScaffold ?? DEFAULT_BUILDING_ANALYSIS_FLAGS.supportsScaffold,
		countsAsRoof: source?.countsAsRoof ?? DEFAULT_BUILDING_ANALYSIS_FLAGS.countsAsRoof,
		countsAsPerimeter: source?.countsAsPerimeter ?? DEFAULT_BUILDING_ANALYSIS_FLAGS.countsAsPerimeter,
	}
}

function normalizeBuildingEntity(entity: BuildingEntity): BuildingEntity {
  if (isBaseMassEntity(entity)) {
    const normalizedBase: BaseMassEntity = {
      ...entity,
      host: entity.host ?? null,
      analysis: cloneBuildingAnalysisFlags(entity.analysis),
      children: Array.isArray(entity.children) ? [...entity.children] : [],
      updatedAt: Number(entity.updatedAt ?? Date.now()),
      createdAt: Number(entity.createdAt ?? Date.now()),
    }
    return normalizedBase
  }

  if (isRoofEntity(entity)) {
    const normalizedRoof: HostedRoofEntity = {
      ...entity,
      analysis: cloneBuildingAnalysisFlags(entity.analysis),
      children: Array.isArray(entity.children) ? [...entity.children] : [],
      updatedAt: Number(entity.updatedAt ?? Date.now()),
      createdAt: Number(entity.createdAt ?? Date.now()),
    }
    return normalizedRoof
  }

  if (isParapetEntity(entity)) {
    const normalizedParapet: HostedParapetEntity = {
      ...entity,
      params: {
        ...entity.params,
        offsetMode: 'inside',
      },
      analysis: cloneBuildingAnalysisFlags(entity.analysis),
      children: Array.isArray(entity.children) ? [...entity.children] : [],
      updatedAt: Number(entity.updatedAt ?? Date.now()),
      createdAt: Number(entity.createdAt ?? Date.now()),
    }
    return normalizedParapet
  }

  if (isFeatureEntity(entity)) {
    if (entity.kind === 'top-feature') {
      const normalizedTopFeature: HostedTopFeatureEntity = {
        ...entity,
        params: {
          ...entity.params,
          balconyHandrailEnabled: entity.params.balconyHandrailEnabled ?? getHostedFeatureDefaultHandrailEnabled(entity.params.preset),
          balconyHandrailHeightFt: Math.max(0.1, Number(entity.params.balconyHandrailHeightFt ?? getHostedFeatureDefaultHandrailHeightFt(entity.params.preset)) || 0.1),
          balconyHandrailInsetFt: Math.max(0, Number(entity.params.balconyHandrailInsetFt ?? getHostedFeatureDefaultHandrailInsetFt(entity.params.preset)) || 0),
          balconyHandrailThicknessFt: Math.max(0.05, Number(entity.params.balconyHandrailThicknessFt ?? getHostedFeatureDefaultHandrailThicknessFt(entity.params.preset)) || 0.05),
        },
        analysis: cloneBuildingAnalysisFlags(entity.analysis),
        children: Array.isArray(entity.children) ? [...entity.children] : [],
        updatedAt: Number(entity.updatedAt ?? Date.now()),
        createdAt: Number(entity.createdAt ?? Date.now()),
      }
      return normalizedTopFeature
    }

    const normalizedSideFeature: HostedSideFeatureEntity = {
      ...entity,
      params: {
        ...entity.params,
        balconyHandrailEnabled: entity.params.balconyHandrailEnabled ?? getHostedFeatureDefaultHandrailEnabled(entity.params.preset),
        balconyHandrailHeightFt: Math.max(0.1, Number(entity.params.balconyHandrailHeightFt ?? getHostedFeatureDefaultHandrailHeightFt(entity.params.preset)) || 0.1),
        balconyHandrailInsetFt: Math.max(0, Number(entity.params.balconyHandrailInsetFt ?? getHostedFeatureDefaultHandrailInsetFt(entity.params.preset)) || 0),
        balconyHandrailThicknessFt: Math.max(0.05, Number(entity.params.balconyHandrailThicknessFt ?? getHostedFeatureDefaultHandrailThicknessFt(entity.params.preset)) || 0.05),
      },
      analysis: cloneBuildingAnalysisFlags(entity.analysis),
      children: Array.isArray(entity.children) ? [...entity.children] : [],
      updatedAt: Number(entity.updatedAt ?? Date.now()),
      createdAt: Number(entity.createdAt ?? Date.now()),
    }
    return normalizedSideFeature
  }

  if (isProxyEntity(entity)) {
    const normalizedProxy: HostedProxyEntity = {
      ...entity,
      analysis: cloneBuildingAnalysisFlags(entity.analysis),
      children: Array.isArray(entity.children) ? [...entity.children] : [],
      updatedAt: Number(entity.updatedAt ?? Date.now()),
      createdAt: Number(entity.createdAt ?? Date.now()),
    }
    return normalizedProxy
  }

  if (isPatternEntity(entity)) {
    const normalizedPattern: HostedPatternEntity = {
      ...entity,
      params: {
        ...entity.params,
        distributionU: {
          mode: entity.params.distributionU?.mode === 'spacing' || entity.params.distributionU?.mode === 'fit'
            ? entity.params.distributionU.mode
            : 'count',
          count: Math.max(1, Math.round(Number(entity.params.distributionU?.count ?? 1) || 1)),
          spacingFt: Math.max(0, Number(entity.params.distributionU?.spacingFt ?? 0) || 0),
          startSetbackFt: Math.max(0, Number(entity.params.distributionU?.startSetbackFt ?? 0) || 0),
          endSetbackFt: Math.max(0, Number(entity.params.distributionU?.endSetbackFt ?? 0) || 0),
          centered: entity.params.distributionU?.centered !== false,
        },
        distributionV: {
          mode: entity.params.distributionV?.mode === 'spacing' || entity.params.distributionV?.mode === 'fit'
            ? entity.params.distributionV.mode
            : 'count',
          count: Math.max(1, Math.round(Number(entity.params.distributionV?.count ?? 1) || 1)),
          spacingFt: Math.max(0, Number(entity.params.distributionV?.spacingFt ?? 0) || 0),
          startSetbackFt: Math.max(0, Number(entity.params.distributionV?.startSetbackFt ?? 0) || 0),
          endSetbackFt: Math.max(0, Number(entity.params.distributionV?.endSetbackFt ?? 0) || 0),
          centered: entity.params.distributionV?.centered !== false,
        },
        wrapMode: entity.params.wrapMode === 'all-walls'
          ? 'all-walls'
          : entity.params.wrapMode === 'selected-walls'
            ? 'selected-walls'
            : 'single-face',
        cornerBehavior: sanitizeHostedPatternCornerBehavior(
          entity.params.cornerBehavior,
          entity.host.faceId,
          entity.params.wrapMode,
        ),
        wallFaceIds: entity.host.faceId && entity.host.faceId !== 'top'
          ? sanitizeHostedPatternWallFaceIds(
              entity.params.wallFaceIds,
              entity.host.faceId as SideFeatureFaceId,
            )
          : [],
        widthFt: Math.max(0.1, Number(entity.params.widthFt ?? 0) || 0.1),
        depthFt: Math.max(0.1, Number(entity.params.depthFt ?? 0) || 0.1),
        heightFt: Math.max(0.1, Number(entity.params.heightFt ?? 0) || 0.1),
        balconyHandrailEnabled: entity.params.balconyHandrailEnabled ?? getHostedFeatureDefaultHandrailEnabled(entity.params.featurePreset ?? 'balcony'),
        balconyHandrailHeightFt: Math.max(0.1, Number(entity.params.balconyHandrailHeightFt ?? getHostedFeatureDefaultHandrailHeightFt(entity.params.featurePreset ?? 'balcony')) || 0.1),
        balconyHandrailInsetFt: Math.max(0, Number(entity.params.balconyHandrailInsetFt ?? getHostedFeatureDefaultHandrailInsetFt(entity.params.featurePreset ?? 'balcony')) || 0),
        balconyHandrailThicknessFt: Math.max(0.05, Number(entity.params.balconyHandrailThicknessFt ?? getHostedFeatureDefaultHandrailThicknessFt(entity.params.featurePreset ?? 'balcony')) || 0.05),
      },
      analysis: cloneBuildingAnalysisFlags(entity.analysis),
      skippedInstanceIds: Array.isArray(entity.skippedInstanceIds) ? [...entity.skippedInstanceIds] : [],
      instanceOverrides: entity.instanceOverrides ? { ...entity.instanceOverrides } : {},
      children: Array.isArray(entity.children) ? [...entity.children] : [],
      updatedAt: Number(entity.updatedAt ?? Date.now()),
      createdAt: Number(entity.createdAt ?? Date.now()),
    }
    return normalizedPattern
  }

  return entity
}

function createEmptyDrawingState(): DrawingState {
	return {
		isDrawing: false,
		startPoint: null,
		currentPoint: null,
		polygonPoints: [],
		hostEntityId: null,
		hostKind: 'world',
		hostFaceId: null,
	}
}

function dedupePolygonPoints(points: THREE.Vector3[], tolerance = 0.0001): THREE.Vector3[] {
	const unique: THREE.Vector3[] = []
	for (const point of points) {
		const last = unique[unique.length - 1]
		if (last && last.distanceToSquared(point) <= tolerance * tolerance) continue
		unique.push(point.clone())
	}
	if (unique.length >= 2) {
		const first = unique[0]!
		const last = unique[unique.length - 1]!
		if (first.distanceToSquared(last) <= tolerance * tolerance) unique.pop()
	}
	return unique
}

function computePolygonArea(points: Array<{ x: number; y: number }>): number {
	if (points.length < 3) return 0
	let twiceArea = 0
	for (let i = 0; i < points.length; i++) {
		const current = points[i]!
		const next = points[(i + 1) % points.length]!
		twiceArea += current.x * next.y - next.x * current.y
	}
	return twiceArea / 2
}

function buildSceneObjectFromBaseMassEntity(entity: BaseMassEntity): SceneObject {
	const common = {
		id: entity.id,
		workspace: 'building' as const,
		layer: WORKSPACE_LAYERS.BUILDING,
		position: new THREE.Vector3(entity.position.x, entity.position.y, entity.position.z),
		rotation: new THREE.Euler(0, 0, entity.rotationZRad ?? 0),
		color: entity.color || '#d7d7d7',
	}

	switch (entity.params.shape) {
		case 'circle':
			return {
				...common,
				type: 'circle',
				dimensions: new THREE.Vector3(entity.params.radiusFt * 2, entity.params.radiusFt * 2, entity.params.heightFt),
				radius: entity.params.radiusFt,
			}
		case 'ring':
			return {
				...common,
				type: 'ring',
				dimensions: new THREE.Vector3(entity.params.radiusFt * 2, entity.params.radiusFt * 2, entity.params.heightFt),
				radius: entity.params.radiusFt,
				innerRadius: entity.params.innerRadiusFt,
			}
		case 'polygon': {
			const xs = entity.params.points.map(point => point.x)
			const ys = entity.params.points.map(point => point.y)
			const minX = xs.length > 0 ? Math.min(...xs) : -0.5
			const maxX = xs.length > 0 ? Math.max(...xs) : 0.5
			const minY = ys.length > 0 ? Math.min(...ys) : -0.5
			const maxY = ys.length > 0 ? Math.max(...ys) : 0.5
			return {
				...common,
				type: 'box',
				dimensions: new THREE.Vector3(Math.max(0.1, maxX - minX), Math.max(0.1, maxY - minY), entity.params.heightFt),
			}
		}
		case 'rect':
		default:
			return {
				...common,
				type: 'box',
				dimensions: new THREE.Vector3(entity.params.widthFt, entity.params.depthFt, entity.params.heightFt),
			}
	}
}

function buildBaseMassEntityFromSceneObject(
	object: SceneObject,
	existing?: BaseMassEntity | null,
): BaseMassEntity | null {
	if (object.workspace !== 'building') return null
	if (object.type !== 'box' && object.type !== 'circle' && object.type !== 'ring') return null

	const now = Date.now()
	const base = {
		id: object.id,
		category: 'base-mass' as const,
		host: existing?.host ?? null,
		position: {
			x: object.position.x,
			y: object.position.y,
			z: object.position.z,
		},
		rotationZRad: object.rotation.z ?? 0,
		color: object.color || existing?.color || '#d7d7d7',
		analysis: cloneBuildingAnalysisFlags(existing?.analysis),
		children: existing?.children ? [...existing.children] : [],
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	}

	if (object.type === 'circle') {
		const radiusFt = Math.max(0.1, Number(object.radius ?? object.dimensions.x / 2))
		return {
			...base,
			kind: 'circle-mass',
			params: {
				shape: 'circle',
				radiusFt,
				heightFt: Math.max(0.1, Number(object.dimensions.z)),
			},
		}
	}

	if (object.type === 'ring') {
		const radiusFt = Math.max(0.1, Number(object.radius ?? object.dimensions.x / 2))
		const innerRadiusFt = Math.max(
			0.05,
			Math.min(radiusFt - 0.05, Number(object.innerRadius ?? radiusFt * 0.6)),
		)
		return {
			...base,
			kind: 'ring-mass',
			params: {
				shape: 'ring',
				radiusFt,
				innerRadiusFt,
				heightFt: Math.max(0.1, Number(object.dimensions.z)),
			},
		}
	}

	return {
		...base,
		kind: 'rect-mass',
		params: {
			shape: 'rect',
			widthFt: Math.max(0.1, Number(object.dimensions.x)),
			depthFt: Math.max(0.1, Number(object.dimensions.y)),
			heightFt: Math.max(0.1, Number(object.dimensions.z)),
		},
	}
}

function buildSupportAwareRecipeFromBlock(block: ScaffoldBlockInstance): SupportAwareBlockRecipe {
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

function getSegmentRosetteCapacity(partNumbers: string[]) {
	return (Array.isArray(partNumbers) ? partNumbers : []).reduce((total, partNumber) => {
		const spec = UNIVERSAL_RINGLOCK_STANDARDS[String(partNumber) as UniversalRinglockStandardId]
		return total + Number(spec?.rosetteCount ?? 0)
	}, 0)
}

function getSegmentHeightFt(partNumbers: string[]) {
	return (Array.isArray(partNumbers) ? partNumbers : []).reduce((total, partNumber) => {
		const spec = UNIVERSAL_RINGLOCK_STANDARDS[String(partNumber) as UniversalRinglockStandardId]
		return total + Number(spec?.heightFt ?? 0)
	}, 0)
}

function choosePreferredSupportAwareStackSpec(
	a: SupportAwareStackSpec | undefined,
	b: SupportAwareStackSpec | undefined,
): SupportAwareStackSpec | undefined {
	if (!a) return b
	if (!b) return a
	const aRosettes = getSegmentRosetteCapacity(a.standardSegments)
	const bRosettes = getSegmentRosetteCapacity(b.standardSegments)
	if (bRosettes !== aRosettes) return bRosettes > aRosettes ? b : a
	const aHeight = getSegmentHeightFt(a.standardSegments)
	const bHeight = getSegmentHeightFt(b.standardSegments)
	if (Math.abs(bHeight - aHeight) > 1e-6) return bHeight > aHeight ? b : a
	if (b.standardSegments.length !== a.standardSegments.length) return b.standardSegments.length > a.standardSegments.length ? b : a
	return a
}

function normalizeStackKeyForLayout(key: string, layout: ReturnType<typeof resolveSupportAwareBlockLayout>): string {
	const rawKey = String(key)
	if (layout.stackSpecsByKey.has(rawKey)) return rawKey
	const parsed = parseStackPositionKey(rawKey)
	if (!parsed) return rawKey
	for (const spec of layout.stackSpecsByKey.values()) {
		if (posKey2(spec.x, spec.y) === parsed.planKey) return spec.key
	}
	return rawKey
}

function normalizeLedgerKeyForLayout(key: string, layout: ReturnType<typeof resolveSupportAwareBlockLayout>): string {
	const parsed = parseLedgerConnectionKey(String(key))
	if (!parsed) return String(key)
	return makeLedgerConnectionKey(
		normalizeStackKeyForLayout(parsed.stackKeyA, layout),
		parsed.liftIndexA,
		normalizeStackKeyForLayout(parsed.stackKeyB, layout),
		parsed.liftIndexB,
	)
}

function normalizeStringSet(values: string[] | undefined, normalize: (value: string) => string): string[] {
	if (!Array.isArray(values) || values.length === 0) return []
	const out: string[] = []
	const seen = new Set<string>()
	for (const value of values) {
		const normalized = normalize(String(value))
		if (seen.has(normalized)) continue
		seen.add(normalized)
		out.push(normalized)
	}
	return out
}

function serializeVector3(v: THREE.Vector3): SerializedVector3 {
  return { x: v.x, y: v.y, z: v.z }
}

function serializeVector3Any(v: any): SerializedVector3 {
  // Be defensive: autosave should never crash due to unexpected shapes.
  if (v instanceof THREE.Vector3) return serializeVector3(v)
  if (v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number') {
    return { x: v.x, y: v.y, z: v.z }
  }
  return { x: 0, y: 0, z: 0 }
}

function deserializeVector3(v: any): THREE.Vector3 {
  return new THREE.Vector3(
    typeof v?.x === 'number' ? v.x : 0,
    typeof v?.y === 'number' ? v.y : 0,
    typeof v?.z === 'number' ? v.z : 0,
  )
}

function serializeEuler(e: THREE.Euler): SerializedEuler {
  return { x: e.x, y: e.y, z: e.z, order: e.order }
}

function serializeEulerAny(e: any): SerializedEuler {
  if (e instanceof THREE.Euler) return serializeEuler(e)
  if (e && typeof e.x === 'number' && typeof e.y === 'number' && typeof e.z === 'number') {
    return {
      x: e.x,
      y: e.y,
      z: e.z,
      order: (typeof e.order === 'string' ? e.order : 'XYZ') as THREE.EulerOrder,
    }
  }
  return { x: 0, y: 0, z: 0, order: 'XYZ' }
}

function deserializeEuler(e: any): THREE.Euler {
  return new THREE.Euler(
    typeof e?.x === 'number' ? e.x : 0,
    typeof e?.y === 'number' ? e.y : 0,
    typeof e?.z === 'number' ? e.z : 0,
    (typeof e?.order === 'string' ? e.order : 'XYZ') as THREE.EulerOrder,
  )
}


function getDirectionLabelForViewMode(mode: ViewMode): string {
  switch (mode) {
    case 'ortho-top':
      return 'Top / Plan'
    case 'ortho-bottom':
      return 'Bottom'
    case 'ortho-front':
      return 'Front Elevation'
    case 'ortho-back':
      return 'Back Elevation'
    case 'ortho-right':
      return 'Right Elevation'
    case 'ortho-left':
      return 'Left Elevation'
    case 'ortho-custom':
      return 'Custom Ortho'
    case 'perspective':
    default:
      return 'Overall Iso'
  }
}

function getKindForViewMode(mode: ViewMode): 'iso' | 'plan' | 'elevation' {
  if (mode === 'perspective') return 'iso'
  if (mode === 'ortho-top' || mode === 'ortho-bottom') return 'plan'
  return 'elevation'
}

function getDefaultScaleLabelForProjection(projection: DrawingProjection): string {
	return projection === 'orthographic' ? "1/4\" = 1'-0\"" : 'NTS'
}

function createUniqueDrawingViewName(existingViews: readonly DrawingSavedView[], baseName: string): string {
	const normalizedBase = baseName.trim().toLowerCase()
	const existingNames = new Set(existingViews.map(view => view.name.trim().toLowerCase()))
	if (!existingNames.has(normalizedBase)) return baseName
	let index = 2
	while (existingNames.has(`${normalizedBase} ${index}`)) {
		index += 1
	}
	return `${baseName} ${index}`
}

export function ToolProvider({ children }: { children: ReactNode }) {
  const { categoryKey } = useCatalogSelection()
  const [activeTool, setActiveToolRaw] = useState<ToolType>('select')
	const [blockToolSettings, setBlockToolSettingsRaw] = useState<BlockToolSettings>({
			mode: 'assemble',
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
		const [blockEditMode, setBlockEditMode] = useState(false)
		const [blockEditActionMode, setBlockEditActionMode] = useState<BlockEditActionMode>('neutral')
	const [blockPlacementWarning, setBlockPlacementWarning] = useState<string | null>(null)

  // Default to BUILDING_MODE for the “Site Modeling Workspace” flow.
  const [workspaceMode, dispatchWorkspace] = useReducer(workspaceReducer, 'BUILDING_MODE')
	const [dxfPreviewEnabled, setDxfPreviewEnabled] = useState(false)
  const [objects, setObjects] = useState<SceneObject[]>([])
  const [buildingEntities, setBuildingEntities] = useState<BuildingEntity[]>([])
  const [selectedObjectId, setSelectedObjectIdRaw] = useState<string | null>(null)
  const [selectedBuildingEntityId, setSelectedBuildingEntityIdRaw] = useState<string | null>(null)
  const [selectedHostedPatternInstance, setSelectedHostedPatternInstanceRaw] = useState<{ patternId: string; instanceId: string } | null>(null)
  const [buildingHostedPatternPreview, setBuildingHostedPatternPreviewRaw] = useState<HostedPatternEntity | null>(null)
  const [buildingHostedSketchIntent, setBuildingHostedSketchIntent] = useState<BuildingHostedSketchIntent | null>(null)
  const [buildingHostedSketchFaceId, setBuildingHostedSketchFaceIdRaw] = useState<BaseMassFaceId | null>(null)
  const roofBaseOffsetByHostId = useMemo(() => {
    const map = new Map<string, number>()
    for (const entity of buildingEntities) {
      if (!isRoofEntity(entity)) continue
      const current = map.get(entity.host.entityId) ?? 0
      map.set(entity.host.entityId, Math.max(current, Number(entity.params.thicknessFt ?? 0)))
    }
    return map
  }, [buildingEntities])
  const [drawingState, setDrawingState] = useState<DrawingState>(createEmptyDrawingState)

		// Safety: if the block tool or mode changes, exit block-edit mode.
	useEffect(() => {
			const allow = workspaceMode === 'SCAFFOLD_MODE' && activeTool === 'block' && blockToolSettings.mode === 'assemble'
			if (!allow) {
				setBlockEditMode(false)
				setBlockEditActionMode('neutral')
				setBlockPlacementWarning(null)
			}
		}, [workspaceMode, activeTool, blockToolSettings.mode])

	// Safety/UX: DXF preview is only meaningful in scaffold mode.
	useEffect(() => {
		if (workspaceMode !== 'SCAFFOLD_MODE' && dxfPreviewEnabled) {
			setDxfPreviewEnabled(false)
		}
	}, [workspaceMode, dxfPreviewEnabled])

  /**
   * High-end/pro UX:
   * Building-geometry tools (e.g. rectangle) are only valid in BUILDING_MODE.
   * Even if some UI/shortcut attempts to set them while in SCAFFOLD_MODE,
   * we force a safe tool (select) so the user can’t accidentally create building geometry.
   */


		// Keep Escape hierarchical inside Block mode: unwind the current block sub-mode first,
		// then leave the Block tool only from the neutral block-edit state.
		useEffect(() => {
			if (!(workspaceMode === 'SCAFFOLD_MODE' && activeTool === 'block')) return
			const onKeyDown = (e: KeyboardEvent) => {
				if (e.metaKey || e.ctrlKey || e.altKey) return
				if (e.key !== 'Escape' && e.key !== 'Esc') return
				if (document.querySelector('[data-scaffxiq-modal]')) return
				e.preventDefault()
				if (categoryKey === 'liveLoads') {
					setSelectedObjectIdRaw(null)
					setSelectedStackIds([])
					setSelectedBlockIdRaw(null)
					setSelectedBlockIdsRaw([])
					setHoveredLiveLoadDeckTargets([])
					setSelectedLiveLoadDeckTargetsRaw([])
					setSelectedLiveLoadDeckTarget(null)
					setIsEditingBlock(false)
					return
				}
				if (blockToolSettings.mode === 'assemble') {
					setBlockEditMode(true)
					setBlockEditActionMode('neutral')
					setSelectedBlockIdRaw(null)
					setSelectedBlockIdsRaw([])
					setIsEditingBlock(false)
					return
				}
				setActiveToolRaw('select')
			}
			window.addEventListener('keydown', onKeyDown, true)
			return () => window.removeEventListener('keydown', onKeyDown, true)
		}, [activeTool, blockEditActionMode, blockEditMode, blockToolSettings.mode, categoryKey, workspaceMode])

	const updateBlockToolSettings = useCallback((partial: Partial<BlockToolSettings>) => {
		setBlockToolSettingsRaw(prev => ({ ...prev, ...partial }))
	}, [])
	const showBlockPlacementWarning = useCallback((message: string) => {
		const nextMessage = String(message ?? '').trim()
		if (!nextMessage) return
		setBlockPlacementWarning(nextMessage)
	}, [])
	const clearBlockPlacementWarning = useCallback(() => {
		setBlockPlacementWarning(null)
	}, [])

	useEffect(() => {
		if (!blockPlacementWarning) return
		const timeoutId = window.setTimeout(() => {
			setBlockPlacementWarning(null)
		}, 5000)
		return () => window.clearTimeout(timeoutId)
	}, [blockPlacementWarning])

  const resolvedBuildingGeometry = useMemo(
    () => resolveScaffoldBuildingGeometry({ buildingEntities, objects }),
    [buildingEntities, objects],
  )
  const buildingSupportSurfaces = resolvedBuildingGeometry.supportSurfaces
  const buildingCutVolumes = resolvedBuildingGeometry.cutVolumes

  // Wrapper to support both direct values and functional updates
  const setSelectedObjectId = useCallback((idOrFn: string | null | ((prev: string | null) => string | null)) => {
    if (typeof idOrFn === 'function') {
      setSelectedObjectIdRaw(idOrFn)
    } else {
      setSelectedObjectIdRaw(idOrFn)
    }
  }, [])
  const setSelectedBuildingEntityId = useCallback((id: string | null) => {
    setSelectedBuildingEntityIdRaw(id)
  }, [])
  const setSelectedHostedPatternInstance = useCallback((value: { patternId: string; instanceId: string } | null) => {
    setSelectedHostedPatternInstanceRaw(value)
  }, [])
  const setBuildingHostedPatternPreview = useCallback((value: HostedPatternEntity | null) => {
    setBuildingHostedPatternPreviewRaw(value)
  }, [])
  const clearBuildingHostedSketch = useCallback(() => {
    setBuildingHostedSketchIntent(null)
    setBuildingHostedSketchFaceIdRaw(null)
  }, [])
  const setBuildingHostedSketchFaceId = useCallback((faceId: BaseMassFaceId | null) => {
    setBuildingHostedSketchFaceIdRaw(faceId)
  }, [])
  const beginBuildingHostedSketch = useCallback((intent: BuildingHostedSketchIntent) => {
    if (workspaceMode !== 'BUILDING_MODE') return
    const host = buildingEntities.find(entity => entity.id === intent.hostEntityId) ?? null
    if (!host) return
    const faceInfo = isBaseMassEntity(host)
      ? getBaseMassFaceInfo(host, intent.faceId)
      : (isHostedRectEntity(host)
          ? resolveHostedRectEntityFaceInfo(host, intent.faceId, buildingEntities, roofBaseOffsetByHostId)
          : null)
    if (!faceInfo) return
    if (intent.hostKind !== 'auto-face' && faceInfo.hostKind !== intent.hostKind) return

    setDrawingState(createEmptyDrawingState())
    setSelectedBuildingEntityIdRaw(host.id)
    setSelectedObjectIdRaw(host.id)
    setBuildingHostedSketchIntent(intent)
    setBuildingHostedSketchFaceIdRaw(intent.hostKind === 'top-face' ? intent.faceId : null)
    setActiveToolRaw('rectangle')
  }, [buildingEntities, roofBaseOffsetByHostId, workspaceMode])

  useEffect(() => {
    if (!buildingHostedSketchIntent) return
    if (workspaceMode !== 'BUILDING_MODE') {
      setBuildingHostedSketchIntent(null)
      setBuildingHostedSketchFaceIdRaw(null)
      return
    }
    const host = buildingEntities.find(entity => entity.id === buildingHostedSketchIntent.hostEntityId) ?? null
    const isValidHost = Boolean(
      host
      && (
        isBaseMassEntity(host)
        || isHostedRectEntity(host)
      ),
    )
    if (!isValidHost) {
      setBuildingHostedSketchIntent(null)
      setBuildingHostedSketchFaceIdRaw(null)
    }
  }, [buildingEntities, buildingHostedSketchIntent, workspaceMode])

  /**
   * High-end/pro UX:
   * Building-geometry tools (e.g. rectangle) are only valid in BUILDING_MODE.
   * Even if some UI/shortcut attempts to set them while in SCAFFOLD_MODE,
   * we force a safe tool (select) so the user canâ€™t accidentally create building geometry.
   */
  const setActiveTool = useCallback((tool: ToolType) => {
    if ((tool === 'rectangle' || tool === 'circle' || tool === 'ring' || tool === 'polygon') && workspaceMode !== 'BUILDING_MODE') {
      setActiveToolRaw('select')
      return
    }
    if (tool === 'block' && workspaceMode !== 'SCAFFOLD_MODE') {
      setActiveToolRaw('select')
      return
    }
    if (tool !== 'rectangle' && buildingHostedSketchIntent) {
      setBuildingHostedSketchIntent(null)
      setBuildingHostedSketchFaceIdRaw(null)
    }
    setActiveToolRaw(tool)
  }, [buildingHostedSketchIntent, workspaceMode])

	useEffect(() => {
		const nextId = selectedObjectId && buildingEntities.some(entity => entity.id === selectedObjectId)
			? selectedObjectId
			: null
		setSelectedBuildingEntityIdRaw(prev => (prev === nextId ? prev : nextId))
	}, [buildingEntities, selectedObjectId])
  useEffect(() => {
    if (!selectedHostedPatternInstance) return
    if (selectedBuildingEntityId !== selectedHostedPatternInstance.patternId) {
      setSelectedHostedPatternInstanceRaw(null)
      return
    }
    const pattern = buildingEntities.find((entity) => entity.id === selectedHostedPatternInstance.patternId) ?? null
    if (!pattern || !isPatternEntity(pattern)) {
      setSelectedHostedPatternInstanceRaw(null)
      return
    }
    const host = buildingEntities.find((entity) => entity.id === pattern.host.entityId) ?? null
    if (!host || !isBaseMassEntity(host)) {
      setSelectedHostedPatternInstanceRaw(null)
      return
    }
    const resolvedInstances = resolveHostedPatternInstances(pattern, host)
    if (!resolvedInstances.some((instance) => instance.instanceId === selectedHostedPatternInstance.instanceId)) {
      setSelectedHostedPatternInstanceRaw(null)
    }
  }, [buildingEntities, selectedBuildingEntityId, selectedHostedPatternInstance])
  useEffect(() => {
    if (!buildingHostedPatternPreview) return
    const host = buildingEntities.find((entity) => entity.id === buildingHostedPatternPreview.host.entityId) ?? null
    if (!host || !isBaseMassEntity(host)) {
      setBuildingHostedPatternPreviewRaw(null)
      return
    }
    if (selectedBuildingEntityId && selectedBuildingEntityId !== host.id) {
      setBuildingHostedPatternPreviewRaw(null)
    }
  }, [buildingEntities, buildingHostedPatternPreview, selectedBuildingEntityId])
	// ── Drawing Package & Camera: delegated to Zustand Model Store ──────
	const drawingPackage = useModelStore(s => s.drawingPackage)
	const storeSetDrawingPackage = useModelStore(s => s.setDrawingPackage)
	const setDrawingPackageRaw = useCallback((next: DrawingPackageDocument) => {
		storeSetDrawingPackage(next)
	}, [storeSetDrawingPackage])
	const setDrawingPackage = useCallback((next: DrawingPackageDocument | ((prev: DrawingPackageDocument) => DrawingPackageDocument)) => {
		storeSetDrawingPackage(next)
	}, [storeSetDrawingPackage])

  // View mode state (shared between Scene and App for Home button)
  const [viewMode, setViewMode] = useState<ViewMode>('perspective')
  const [orthoDirection, setOrthoDirection] = useState<THREE.Vector3 | null>(null)

  // Ref that Scene.tsx populates with a function to save camera state
  // App.tsx calls this before switching views to prevent the "jump"
  const saveCameraStateRef = useRef<(() => void) | null>(null)
  const requestHomeViewRef = useRef<(() => void) | null>(null)

  // Camera transition state - briefly hide canvas during camera type switch to mask "bad frame"
  const [cameraTransitioning, setCameraTransitioning] = useState(false)
  const [cameraNavigationActive, setCameraNavigationActive] = useState(false)

	// Live camera state: delegated to Zustand store
	const storeLiveCamera = useModelStore(s => s.liveCamera)
	const storePublishLiveCamera = useModelStore(s => s.publishLiveCamera)
	const liveCameraState: LiveCameraState | null = useMemo(() => {
		if (!storeLiveCamera) return null
		return {
			position: storeLiveCamera.position,
			target: storeLiveCamera.target,
			zoom: storeLiveCamera.zoom,
			projection: storeLiveCamera.projection,
			viewMode: viewMode,
			orthoDirection: storeLiveCamera.orthoDirection,
		}
	}, [storeLiveCamera, viewMode])
	const publishLiveCameraState = useCallback((next: LiveCameraState | null) => {
		if (!next) { storePublishLiveCamera(null); return }
		storePublishLiveCamera({
			position: next.position,
			target: next.target,
			zoom: next.zoom,
			projection: next.projection,
			orthoDirection: next.orthoDirection,
		})
	}, [storePublishLiveCamera])

	// View apply request: delegated to Zustand store
	const drawingViewApplyRequest = useModelStore(s => s.viewApplyRequest)
	const storeRequestApplyView = useModelStore(s => s.requestApplyView)
	const storeClearViewApplyRequest = useModelStore(s => s.clearViewApplyRequest)
	const requestApplyDrawingView = useCallback((viewId: string, options?: { activateSection?: boolean }) => {
		storeRequestApplyView(viewId, options)
	}, [storeRequestApplyView])
	const clearDrawingViewApplyRequest = useCallback(() => {
		storeClearViewApplyRequest()
	}, [storeClearViewApplyRequest])

	// Active section: delegated to Zustand store
	const activeDrawingSectionId = useModelStore(s => s.activeSectionId)
	const storeSetActiveSectionId = useModelStore(s => s.setActiveSectionId)
	const setActiveDrawingSectionId = useCallback((sectionId: string | null) => {
		storeSetActiveSectionId(sectionId)
	}, [storeSetActiveSectionId])

	const captureCurrentModelAsDrawingView = useCallback((viewId: string) => {
		if (!liveCameraState) return

		setDrawingPackage(prev => ({
			...prev,
			activeViewId: viewId,
			savedViews: prev.savedViews.map(view => {
				if (view.id !== viewId) return view
				const keepSectionLink = view.kind === 'section' || !!view.sectionId
				return {
					...view,
					kind: keepSectionLink ? 'section' : getKindForViewMode(liveCameraState.viewMode),
					projection: liveCameraState.projection,
					camera: {
						position: { ...liveCameraState.position },
						target: { ...liveCameraState.target },
						zoom: liveCameraState.zoom,
					},
					directionLabel: getDirectionLabelForViewMode(liveCameraState.viewMode),
					...(keepSectionLink
						? { sectionId: activeDrawingSectionId ?? view.sectionId }
						: {}),
				}
			}),
		}))
	}, [activeDrawingSectionId, liveCameraState, setDrawingPackage])

		const createDrawingViewFromLiveModel = useCallback(() => {
			if (!liveCameraState) return null

			let createdViewId: string | null = null
			setDrawingPackage(prev => {
				const templateView = prev.savedViews.find(view => view.id === prev.activeViewId) ?? prev.savedViews[0]
				const nextProjection = liveCameraState.projection
				const nextView: DrawingSavedView = {
					id: createDrawingEntityId('view'),
					name: createUniqueDrawingViewName(prev.savedViews, getDirectionLabelForViewMode(liveCameraState.viewMode)),
					kind: getKindForViewMode(liveCameraState.viewMode),
					description: 'Authored from the live model camera. Add source notes and dimensions before placing the view on sheets.',
					projection: nextProjection,
					displayPresetId: templateView?.displayPresetId ?? prev.displayPresets[0]?.id ?? 'preset-technical',
					camera: {
						position: { ...liveCameraState.position },
						target: { ...liveCameraState.target },
						zoom: liveCameraState.zoom,
					},
					scaleLabel:
						nextProjection === 'orthographic'
							? templateView?.projection === 'orthographic'
								? templateView.scaleLabel
								: getDefaultScaleLabelForProjection(nextProjection)
							: 'NTS',
					directionLabel: getDirectionLabelForViewMode(liveCameraState.viewMode),
					authoringSource: 'live-model',
					sourceAnnotations: [],
				}
				createdViewId = nextView.id
				return {
					...prev,
					activeViewId: nextView.id,
					savedViews: [...prev.savedViews, nextView],
				}
			})
			return createdViewId
		}, [liveCameraState, setDrawingPackage])

		const createLinkedDrawingViewFromActiveSection = useCallback(() => {
			if (!liveCameraState || !activeDrawingSectionId) return null

			let createdViewId: string | null = null
			setDrawingPackage(prev => {
				const section = prev.sections.find(candidate => candidate.id === activeDrawingSectionId)
				if (!section) return prev
				const templateView = prev.savedViews.find(view => view.id === prev.activeViewId) ?? prev.savedViews[0]
				const nextView: DrawingSavedView = {
					id: createDrawingEntityId('view'),
					name: createUniqueDrawingViewName(prev.savedViews, section.name),
					kind: section.clipMode === 'elevation' ? 'elevation' : 'section',
					description: `Linked to ${section.markerLabel}. Author dimensions and notes in view space, then place this view on sheets.`,
					projection: 'orthographic',
					displayPresetId: templateView?.displayPresetId ?? prev.displayPresets[0]?.id ?? 'preset-technical',
					camera: {
						position: { ...liveCameraState.position },
						target: { ...liveCameraState.target },
						zoom: liveCameraState.zoom,
					},
					scaleLabel:
						templateView?.projection === 'orthographic'
							? templateView.scaleLabel
							: getDefaultScaleLabelForProjection('orthographic'),
					directionLabel: section.clipMode === 'elevation' ? section.name : section.markerLabel,
					sectionId: section.id,
					authoringSource: 'section-linked',
					sourceAnnotations: [],
				}
				createdViewId = nextView.id
				return {
					...prev,
					activeViewId: nextView.id,
					activeSectionId: section.id,
					savedViews: [...prev.savedViews, nextView],
				}
			})
			return createdViewId
		}, [activeDrawingSectionId, liveCameraState, setDrawingPackage])

	useEffect(() => {
		if (activeDrawingSectionId && !drawingPackage.sections.some(section => section.id === activeDrawingSectionId)) {
			storeSetActiveSectionId(null)
		}
	}, [activeDrawingSectionId, drawingPackage.sections, storeSetActiveSectionId])

	useEffect(() => {
		if (drawingViewApplyRequest && !drawingPackage.savedViews.some(view => view.id === drawingViewApplyRequest.viewId)) {
			storeClearViewApplyRequest()
		}
	}, [drawingPackage.savedViews, drawingViewApplyRequest, storeClearViewApplyRequest])

  // Scaffold objects (standards, ledgers, base components) - for selection/properties
  const [scaffoldObjects, setScaffoldObjects] = useState<ScaffoldObject[]>([])

  const addScaffoldObject = useCallback((obj: ScaffoldObject) => {
    setScaffoldObjects(prev => [...prev, obj])
  }, [])

  const removeScaffoldObject = useCallback((id: string) => {
    setScaffoldObjects(prev => prev.filter(o => o.id !== id))
    if (selectedObjectId === id) setSelectedObjectId(null)
  }, [selectedObjectId])

  const clearScaffoldObjects = useCallback(() => {
    setScaffoldObjects([])
    setSelectedObjectId(null)
  }, [])

  const updateScaffoldObject = useCallback((id: string, partial: Partial<ScaffoldObject>) => {
    setScaffoldObjects(prev =>
      prev.map(o => {
        if (o.id !== id) return o
        return { ...o, ...partial, id: o.id, componentType: o.componentType } as ScaffoldObject
      })
    )
  }, [])

  // Scaffold graph model - stacks and connections
	const [scaffoldStacks, setScaffoldStacks] = useState<ScaffoldStack[]>([])
	const [ledgerConnections, setLedgerConnections] = useState<LedgerConnection[]>([])
	const [manualPlankPlacements, setManualPlankPlacements] = useState<ManualPlankPlacement[]>([])
	const [manualLiveLoadPlacements, setManualLiveLoadPlacements] = useState<ManualLiveLoadPlacement[]>([])
	const [pendingMovedBlockArtifactCleanup, setPendingMovedBlockArtifactCleanup] = useState<{
		previousManagedStackKeys: string[]
		previousManagedLedgerKeys: string[]
	} | null>(null)
	const [liveLoadPlacementPsfRaw, setLiveLoadPlacementPsfRaw] = useState(DEFAULT_MANUAL_LIVE_LOAD_PSF)
	const [activeLiveLoadLevelNumber, setActiveLiveLoadLevelNumber] = useState<number | null>(null)
	const [hoveredLiveLoadDeckTargets, setHoveredLiveLoadDeckTargets] = useState<LiveLoadDeckTarget[]>([])
	const [selectedLiveLoadDeckTargetsRaw, setSelectedLiveLoadDeckTargetsRaw] = useState<LiveLoadDeckTarget[]>([])
	const selectedLiveLoadDeckTarget = selectedLiveLoadDeckTargetsRaw[0] ?? null
	const setSelectedLiveLoadDeckTargets = useCallback((targets: LiveLoadDeckTarget[]) => {
		const seen = new Set<string>()
		const next = (Array.isArray(targets) ? targets : [])
			.filter((target): target is LiveLoadDeckTarget => !!target && !!target.blockId && Number.isFinite(Number(target.liftIndex)))
			.map(target => ({
				blockId: String(target.blockId),
				liftIndex: Math.round(Number(target.liftIndex)),
				...(target.bayKey ? { bayKey: String(target.bayKey) } : {}),
			}))
			.filter(target => {
				const key = `${target.blockId}@${target.liftIndex}@${target.bayKey ?? '*'}`;
				if (seen.has(key)) return false
				seen.add(key)
				return true
			})
		setSelectedLiveLoadDeckTargetsRaw(next)
	}, [])
	const setSelectedLiveLoadDeckTarget = useCallback((target: LiveLoadDeckTarget | null) => {
		setSelectedLiveLoadDeckTargetsRaw(target ? [target] : [])
	}, [])
	const [autoScaffoldRequest, setAutoScaffoldRequest] = useState<AutoScaffoldRequest | null>(null)
	// Keep refs to the latest graph state so cleanup/placement logic can avoid stale closures.
	const scaffoldStacksRef = useRef<ScaffoldStack[]>([])
	useEffect(() => {
		scaffoldStacksRef.current = scaffoldStacks
	}, [scaffoldStacks])
	// Keep a ref to the latest ledgerConnections so callbacks can synchronously dedupe
	// without capturing stale state.
	const ledgerConnectionsRef = useRef<LedgerConnection[]>([])
	useEffect(() => {
		ledgerConnectionsRef.current = ledgerConnections
	}, [ledgerConnections])
	const manualPlankPlacementsRef = useRef<ManualPlankPlacement[]>([])
	useEffect(() => {
		manualPlankPlacementsRef.current = manualPlankPlacements
	}, [manualPlankPlacements])
	const manualLiveLoadPlacementsRef = useRef<ManualLiveLoadPlacement[]>([])
	useEffect(() => {
		manualLiveLoadPlacementsRef.current = manualLiveLoadPlacements
	}, [manualLiveLoadPlacements])
	const setLiveLoadPlacementPsf = useCallback((psf: number) => {
		const next = Number(psf)
		setLiveLoadPlacementPsfRaw(Number.isFinite(next) && next > 0 ? next : DEFAULT_MANUAL_LIVE_LOAD_PSF)
	}, [])
	const requestAutoScaffoldAroundBuilding = useCallback((
		targetBuildingId?: string | null,
		settings?: AutoScaffoldRequest['settings'],
	) => {
		setAutoScaffoldRequest({
			requestId: Date.now() + Math.random(),
			targetBuildingId: targetBuildingId ?? null,
			settings: settings ?? null,
		})
	}, [])
	const clearAutoScaffoldRequest = useCallback(() => {
		setAutoScaffoldRequest(null)
	}, [])
  // Multi-selection for scaffold stacks
  const [selectedStackIds, setSelectedStackIds] = useState<string[]>([])

	// Scaffold parametric blocks
	const [scaffoldBlocks, setScaffoldBlocks] = useState<ScaffoldBlockInstance[]>([])
	const scaffoldBlocksRef = useRef<ScaffoldBlockInstance[]>([])
	useEffect(() => {
		scaffoldBlocksRef.current = scaffoldBlocks
	}, [scaffoldBlocks])
	useEffect(() => {
		if (scaffoldBlocks.length === 0) return

		let changed = false
		const nextBlocks = scaffoldBlocks.map((block) => {
			const layout = resolveSupportAwareBlockLayout({
				centerX: block.center.x,
				centerY: block.center.y,
				recipe: buildSupportAwareRecipeFromBlock(block),
				objects,
				supportSurfaces: buildingSupportSurfaces,
				cutVolumes: buildingCutVolumes,
			})

			const managedStackKeys = normalizeStringSet(block.managedStackKeys, (key) => normalizeStackKeyForLayout(key, layout))
			const managedLedgerKeys = normalizeStringSet(block.managedLedgerKeys, (key) => normalizeLedgerKeyForLayout(key, layout))
			const suppressedStackKeys = normalizeStringSet(block.suppressedStackKeys, (key) => normalizeStackKeyForLayout(key, layout))
			const suppressedLedgerKeys = normalizeStringSet(block.suppressedLedgerKeys, (key) => normalizeLedgerKeyForLayout(key, layout))

			const sameArray = (a: string[] | undefined, b: string[]) =>
				(Array.isArray(a) ? a : []).length === b.length
				&& (Array.isArray(a) ? a : []).every((value, index) => String(value) === String(b[index]))

			if (
				sameArray(block.managedStackKeys, managedStackKeys)
				&& sameArray(block.managedLedgerKeys, managedLedgerKeys)
				&& sameArray(block.suppressedStackKeys, suppressedStackKeys)
				&& sameArray(block.suppressedLedgerKeys, suppressedLedgerKeys)
			) {
				return block
			}

			changed = true
			return {
				...block,
				managedStackKeys,
				managedLedgerKeys,
				...(suppressedStackKeys.length > 0 ? { suppressedStackKeys } : { suppressedStackKeys: undefined }),
				...(suppressedLedgerKeys.length > 0 ? { suppressedLedgerKeys } : { suppressedLedgerKeys: undefined }),
			}
		})

		if (changed) setScaffoldBlocks(nextBlocks)
	}, [buildingCutVolumes, buildingSupportSurfaces, objects, scaffoldBlocks])
	const [selectedBlockIdRaw, setSelectedBlockIdRaw] = useState<string | null>(null)
	const [selectedBlockIdsRaw, setSelectedBlockIdsRaw] = useState<string[]>([])
	const [blockDragPreviewIdsRaw, setBlockDragPreviewIdsRaw] = useState<string[]>([])
	const [blockDragHiddenStackIdsRaw, setBlockDragHiddenStackIdsRaw] = useState<string[]>([])
	const [isEditingBlock, setIsEditingBlock] = useState(false)
	const [historyState, setHistoryState] = useState<HistoryState>({ entries: [], index: -1 })
	const historyStateRef = useRef<HistoryState>({ entries: [], index: -1 })
	const historyCommitTimerRef = useRef<number | null>(null)
	const pendingHistorySnapshotRef = useRef<ProjectDataV1 | null>(null)
	const pendingHistorySignatureRef = useRef('')
	const lastCommittedHistorySignatureRef = useRef('')

		// Only allow block selection/editing in Block tool "Blocks" (assemble) mode AND in explicit Edit Blocks mode.
	useEffect(() => {
			const allow = workspaceMode === 'SCAFFOLD_MODE' && activeTool === 'block' && blockToolSettings.mode === 'assemble' && blockEditMode
		if (!allow) {
			setSelectedBlockIdRaw(null)
			setSelectedBlockIdsRaw([])
			setBlockDragPreviewIdsRaw([])
			setIsEditingBlock(false)
			setBlockEditActionMode('neutral')
		}
		}, [workspaceMode, activeTool, blockToolSettings.mode, blockEditMode])

		// If blocks are removed (e.g., via orphan cleanup), ensure we don't keep dangling selections.
		useEffect(() => {
			const existingIds = new Set(scaffoldBlocks.map(b => b.id))
			setSelectedBlockIdsRaw(prev => prev.filter(id => existingIds.has(id)))
		}, [scaffoldBlocks])

	useEffect(() => {
		setSelectedBlockIdRaw(prev => {
			if (prev && selectedBlockIdsRaw.includes(prev)) return prev
			const next = selectedBlockIdsRaw[0] ?? null
			if (prev !== next) setIsEditingBlock(false)
			return next
		})
	}, [selectedBlockIdsRaw])

	useEffect(() => {
		if (!(import.meta.env.DEV || navigator.webdriver)) return
		type ToolDebugWindow = Window & {
			__scaffxiqToolDebug?: {
				getBlockState: () => {
					activeTool: ToolType
					categoryKey: string | null
					workspaceMode: WorkspaceMode
					blockPlacementWarning: string | null
					blockEditMode: boolean
					blockEditActionMode: BlockEditActionMode
					selectedObjectId: string | null
					cameraNavigationActive: boolean
					selectedBlockIds: string[]
					selectedBlock: {
						id: string
						center: { x: number; y: number }
						widthFt: number
						depthFt: number
						heightFt: number
						rotationSteps: number
					} | null
					selectedLiveLoadDeckTargets: LiveLoadDeckTarget[]
					selectedLiveLoadDeckTarget: LiveLoadDeckTarget | null
					activeLiveLoadLevelNumber: number | null
					scaffoldBlocks: Array<{
						id: string
						center: { x: number; y: number }
						widthFt: number
						depthFt: number
						heightFt: number
						rotationSteps: number
						liveLoadPsf?: number
						liveLoadDeckLiftIndices: number[]
						liveLoadExcludedBayKeys: string[]
						managedStackKeys: string[]
						suppressedStackKeys: string[]
					}>
					scaffoldStacks: Array<{
						id: string
						x: number
						y: number
						z: number
						baseSupport: string
						jackExtensionIn: number
						segments: string[]
					}>
				}
				getBuildingState: () => {
					activeTool: ToolType
					workspaceMode: WorkspaceMode
					selectedObjectId: string | null
					selectedBuildingEntityId: string | null
					buildingHostedSketchFaceId: BaseMassFaceId | null
					buildingHostedSketchIntent: {
						target: 'feature' | 'proxy'
						hostEntityId: string
						hostKind: 'top-face' | 'side-face' | 'auto-face'
						faceId: BaseMassFaceId
					} | null
				}
				getBaseMassFaceDebug: (entityId: string, faceId: BaseMassFaceId) => {
					center: { x: number; y: number; z: number }
					normal: { x: number; y: number; z: number }
					axisU: { x: number; y: number; z: number }
					axisV: { x: number; y: number; z: number }
					spanU: number
					spanV: number
				} | null
				selectBuildingEntity: (id: string | null) => void
				selectBlocks: (ids: string[]) => void
				editBlock: (blockId: string, params: {
					widthFt?: number
					depthFt?: number
					heightFt?: number
					ledgerEveryNRosettes?: number
					center?: { x: number; y: number }
				}) => void
				setBlockLiveLoad: (blockId: string, params: {
					liveLoadPsf?: number | null
					liveLoadDeckLiftIndices?: number[]
					liveLoadExcludedBayKeys?: string[]
				}) => void
				addRectBaseMass: (params?: {
					center?: { x?: number; y?: number; z?: number }
					widthFt?: number
					depthFt?: number
					heightFt?: number
				}) => string
				addHostedPattern: (params: {
					hostEntityId: string
					faceId?: BaseMassFaceId
					contentType?: 'feature' | 'volume' | 'cut-volume'
					featurePreset?: HostedFeaturePreset
					wrapMode?: HostedPatternWrapMode
					cornerBehavior?: HostedPatternCornerBehavior
					wallFaceIds?: SideFeatureFaceId[]
					widthFt?: number
					depthFt?: number
					heightFt?: number
					countU?: number
					countV?: number
					spacingU?: number
					spacingV?: number
				}) => string | null
				addBuildingBox: (params?: {
					center?: { x?: number; y?: number; z?: number }
					widthFt?: number
					depthFt?: number
					heightFt?: number
				}) => string
				requestAutoScaffoldAroundBuilding: (
					targetBuildingId?: string | null,
					settings?: AutoScaffoldRequest['settings'],
				) => void
			}
		}
		const debugWindow = window as ToolDebugWindow
		debugWindow.__scaffxiqToolDebug = {
			getBlockState: () => ({
				activeTool,
				categoryKey,
				workspaceMode,
				blockPlacementWarning,
				blockEditMode,
				blockEditActionMode,
				selectedObjectId,
				cameraNavigationActive,
				selectedBlockIds: [...selectedBlockIdsRaw],
				selectedBlock: (() => {
					const selectedBlock = scaffoldBlocksRef.current.find((block) => block.id === (selectedBlockIdsRaw[0] ?? ''))
					return selectedBlock
						? {
							id: selectedBlock.id,
							center: { ...selectedBlock.center },
							widthFt: selectedBlock.widthFt,
							depthFt: selectedBlock.depthFt,
							heightFt: selectedBlock.heightFt,
							rotationSteps: selectedBlock.rotationSteps ?? 0,
						}
						: null
				})(),
				selectedLiveLoadDeckTargets: selectedLiveLoadDeckTargetsRaw.map(target => ({ ...target })),
				selectedLiveLoadDeckTarget,
				activeLiveLoadLevelNumber,
				scaffoldBlocks: scaffoldBlocksRef.current.map((block) => ({
					id: block.id,
					center: { ...block.center },
					widthFt: block.widthFt,
					depthFt: block.depthFt,
					heightFt: block.heightFt,
					rotationSteps: block.rotationSteps ?? 0,
					...(Number.isFinite(Number(block.liveLoadPsf)) && Number(block.liveLoadPsf) > 0 ? { liveLoadPsf: Number(block.liveLoadPsf) } : {}),
					liveLoadDeckLiftIndices: Array.isArray(block.liveLoadDeckLiftIndices) ? [...block.liveLoadDeckLiftIndices] : [],
					liveLoadExcludedBayKeys: Array.isArray(block.liveLoadExcludedBayKeys) ? [...block.liveLoadExcludedBayKeys] : [],
					managedStackKeys: Array.isArray(block.managedStackKeys) ? [...block.managedStackKeys] : [],
					suppressedStackKeys: Array.isArray(block.suppressedStackKeys) ? [...block.suppressedStackKeys] : [],
				})),
				scaffoldStacks: scaffoldStacksRef.current.map((stack) => ({
					id: stack.id,
					x: stack.gridPosition.x,
					y: stack.gridPosition.y,
					z: stack.gridPosition.z,
					baseSupport: stack.baseSupport ?? 'grid',
					jackExtensionIn: stack.jackExtensionIn,
					segments: Array.isArray(stack.standardSegments)
						? stack.standardSegments.map((segment) => String(segment?.partNumber ?? ''))
						: [],
				})),
			}),
			getBuildingState: () => ({
				activeTool,
				workspaceMode,
				selectedObjectId,
				selectedBuildingEntityId,
				buildingHostedSketchFaceId,
				buildingHostedSketchIntent: buildingHostedSketchIntent
					? {
						target: buildingHostedSketchIntent.target,
						hostEntityId: buildingHostedSketchIntent.hostEntityId,
						hostKind: buildingHostedSketchIntent.hostKind,
						faceId: buildingHostedSketchIntent.faceId,
					}
					: null,
			}),
			getBaseMassFaceDebug: (entityId, faceId) => {
				const entity = buildingEntities.find((candidate) => candidate.id === entityId)
				if (!entity || entity.category !== 'base-mass') return null
				const faceInfo = getBaseMassFaceInfo(entity, faceId)
				if (!faceInfo) return null
				return {
					center: { ...faceInfo.center },
					normal: { ...faceInfo.normal },
					axisU: { ...faceInfo.axisU },
					axisV: { ...faceInfo.axisV },
					spanU: faceInfo.spanU,
					spanV: faceInfo.spanV,
				}
			},
			selectBuildingEntity: (id) => {
				setSelectedBuildingEntityIdRaw(id)
				setSelectedObjectId(id)
			},
			selectBlocks: (ids: string[]) => {
				const existingIds = new Set(scaffoldBlocksRef.current.map((block) => block.id))
				const next = ids.filter((id, index) => !!id && existingIds.has(id) && ids.indexOf(id) === index)
				setSelectedBlockIdsRaw(next)
				setSelectedBlockIdRaw(next[0] ?? null)
				if (next.length > 0) {
					setSelectedObjectId(null)
					setSelectedStackIds([])
				}
			},
			editBlock: (blockId, params) => {
				const block = scaffoldBlocksRef.current.find((candidate) => candidate.id === blockId)
				if (!block) return
				applyScaffoldBlockEdits(blockId, {
					widthFt: Number(params?.widthFt ?? block.widthFt),
					depthFt: Number(params?.depthFt ?? block.depthFt),
					heightFt: Number(params?.heightFt ?? block.heightFt),
					ledgerEveryNRosettes: Number(params?.ledgerEveryNRosettes ?? block.ledgerEveryNRosettes),
					center: params?.center,
				})
			},
			setBlockLiveLoad: (blockId, params) => {
				const block = scaffoldBlocksRef.current.find((candidate) => candidate.id === blockId)
				if (!block) return
				updateScaffoldBlockLiveLoad(blockId, {
					liveLoadPsf: params?.liveLoadPsf,
					liveLoadDeckLiftIndices: params?.liveLoadDeckLiftIndices,
					liveLoadExcludedBayKeys: params?.liveLoadExcludedBayKeys,
				})
			},
			addRectBaseMass: (params) => {
				const now = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
				const widthFt = Math.max(1, Number(params?.widthFt) || 24)
				const depthFt = Math.max(1, Number(params?.depthFt) || 16)
				const heightFt = Math.max(1, Number(params?.heightFt) || 20)
				const centerX = Number(params?.center?.x) || 0
				const centerY = Number(params?.center?.y) || 0
				const centerZ = Number.isFinite(Number(params?.center?.z))
					? Number(params?.center?.z)
					: heightFt / 2
				const id = `box-${now}`
				const entity: BaseMassEntity = {
					id,
					category: 'base-mass',
					kind: 'rect-mass',
					host: null,
					position: { x: centerX, y: centerY, z: centerZ },
					rotationZRad: 0,
					color: '#a8aaad',
					params: {
						shape: 'rect',
						widthFt,
						depthFt,
						heightFt,
					},
					analysis: cloneBuildingAnalysisFlags(),
					children: [],
					createdAt: Date.now(),
					updatedAt: Date.now(),
				}
				setBuildingEntities(prev => [...prev, entity])
				const mirroredObject = buildSceneObjectFromBaseMassEntity(entity)
				setObjects(prev => {
					const next = prev.filter(object => object.id !== mirroredObject.id)
					next.push(mirroredObject)
					return next
				})
				setSelectedBuildingEntityIdRaw(id)
				setSelectedObjectId(id)
				return id
			},
			addHostedPattern: (params) => {
				const host = buildingEntities.find((candidate) => candidate.id === params.hostEntityId)
				if (!host || !isBaseMassEntity(host)) return null
				const faceId = params.faceId ?? 'front'
				const wallFaceIds = faceId === 'top' ? [] : sanitizeHostedPatternWallFaceIds(params.wallFaceIds, faceId as SideFeatureFaceId)
				const id = `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
				const contentType = params.contentType ?? 'feature'
				const preset = params.featurePreset ?? 'balcony'
				const entity: HostedPatternEntity = {
					id,
					category: 'pattern',
					kind: 'hosted-pattern',
					host: {
						entityId: host.id,
						hostKind: faceId === 'top' ? 'top-face' : 'side-face',
						faceId,
					},
					color: host.color || getProxyDefaultColor('add'),
					params: {
						contentType,
						...(contentType === 'feature' ? { featurePreset: preset } : {}),
						widthFt: Math.max(0.1, Number(params.widthFt ?? 8)),
						depthFt: Math.max(0.1, Number(params.depthFt ?? 4)),
						heightFt: Math.max(0.1, Number(params.heightFt ?? 3.5)),
						wrapMode: (
							params.wrapMode === 'all-walls'
								? 'all-walls'
								: params.wrapMode === 'selected-walls'
									? 'selected-walls'
									: 'single-face'
						) satisfies HostedPatternWrapMode,
						cornerBehavior: sanitizeHostedPatternCornerBehavior(
							params.cornerBehavior,
							faceId,
							params.wrapMode,
						),
						wallFaceIds,
						distributionU: {
							mode: 'count',
							count: Math.max(1, Math.round(Number(params.countU ?? 4) || 4)),
							spacingFt: Math.max(0, Number(params.spacingU ?? 2) || 0),
							startSetbackFt: 2,
							endSetbackFt: 2,
							centered: true,
						},
						distributionV: {
							mode: 'count',
							count: Math.max(1, Math.round(Number(params.countV ?? 1) || 1)),
							spacingFt: Math.max(0, Number(params.spacingV ?? 2) || 0),
							startSetbackFt: 2,
							endSetbackFt: 2,
							centered: true,
						},
					},
					analysis: cloneBuildingAnalysisFlags({
						blocksScaffold: true,
						supportsScaffold: contentType === 'feature' && preset === 'balcony',
					}),
					skippedInstanceIds: [],
					instanceOverrides: {},
					children: [],
					createdAt: Date.now(),
					updatedAt: Date.now(),
				}
				setBuildingEntities(prev => [...prev, entity])
				setSelectedBuildingEntityIdRaw(id)
				setSelectedObjectId(id)
				return id
			},
			addBuildingBox: (params) => {
				const now = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
				const widthFt = Math.max(1, Number(params?.widthFt) || 24)
				const depthFt = Math.max(1, Number(params?.depthFt) || 16)
				const heightFt = Math.max(1, Number(params?.heightFt) || 20)
				const centerX = Number(params?.center?.x) || 0
				const centerY = Number(params?.center?.y) || 0
				const centerZ = Number.isFinite(Number(params?.center?.z))
					? Number(params?.center?.z)
					: heightFt / 2
				const id = `box-${now}`
					setObjects(prev => [...prev, {
					id,
					type: 'box',
					workspace: 'building',
					layer: WORKSPACE_LAYERS.BUILDING,
					position: new THREE.Vector3(centerX, centerY, centerZ),
					dimensions: new THREE.Vector3(widthFt, depthFt, heightFt),
					rotation: new THREE.Euler(0, 0, 0),
					color: '#a8aaad',
					}])
				setSelectedObjectId(id)
				return id
			},
			requestAutoScaffoldAroundBuilding: (targetBuildingId, settings) => {
				requestAutoScaffoldAroundBuilding(targetBuildingId, settings)
			},
		}
		return () => {
			delete debugWindow.__scaffxiqToolDebug
		}
	}, [activeLiveLoadLevelNumber, activeTool, blockEditActionMode, blockEditMode, blockPlacementWarning, buildingEntities, buildingHostedSketchFaceId, buildingHostedSketchIntent, cameraNavigationActive, categoryKey, requestAutoScaffoldAroundBuilding, selectedBlockIdsRaw, selectedBuildingEntityId, selectedLiveLoadDeckTarget, selectedLiveLoadDeckTargetsRaw, selectedObjectId, workspaceMode])

	useEffect(() => {
		return () => {
			if (historyCommitTimerRef.current !== null) {
					window.clearTimeout(historyCommitTimerRef.current)
				}
			}
		}, [])

		const setSelectedBlockIds = useCallback((ids: string[]) => {
			const seen = new Set<string>()
			const next = ids.filter((id) => {
				if (!id || seen.has(id)) return false
				seen.add(id)
				return true
			})
			setSelectedBlockIdsRaw(next)
			if (next.length > 0) {
				// Keep selection models separate: selecting blocks clears member/object selection.
				setSelectedObjectId(null)
				setSelectedStackIds([])
			}
		}, [setSelectedObjectId])

		const clearBlockSelection = useCallback(() => {
			setSelectedBlockIdsRaw([])
			setSelectedBlockIdRaw(prev => {
				if (prev !== null) setIsEditingBlock(false)
				return null
			})
		}, [])

		const setSelectedBlockId = useCallback((id: string | null) => {
			if (!id) {
				clearBlockSelection()
				return
			}
			setSelectedBlockIdsRaw([id])
			setSelectedBlockIdRaw(prev => {
				// Switching selection should exit per-block editing to avoid applying draft values to the wrong block.
				if (prev !== id) setIsEditingBlock(false)
				return id
			})
			// Keep selection models separate: selecting a block clears member/object selection.
			setSelectedObjectId(null)
			setSelectedStackIds([])
		}, [clearBlockSelection, setSelectedObjectId])

		const toggleBlockSelection = useCallback((blockId: string, additive: boolean) => {
			if (!additive) {
				setSelectedBlockId(blockId)
				return
			}

			setSelectedObjectId(null)
			setSelectedStackIds([])
			setSelectedBlockIdsRaw(prev => {
				if (prev.includes(blockId)) {
					return prev.filter(id => id !== blockId)
				}
				return [...prev, blockId]
			})
			setSelectedBlockIdRaw(blockId)
			setIsEditingBlock(false)
		}, [setSelectedBlockId, setSelectedObjectId])

	const makeLedgerKey = useCallback((stackKeyA: string, stackKeyB: string, liftIndex: number) => {
		return makeLedgerConnectionKey(stackKeyA, liftIndex, stackKeyB, liftIndex)
	}, [])

	const addScaffoldBlock = useCallback((block: ScaffoldBlockInstance) => {
		setScaffoldBlocks(prev => [...prev, block])
	}, [])

	const updateScaffoldBlockLiveLoad = useCallback((blockId: string, partial: {
		liveLoadPsf?: number | null
		liveLoadDeckLiftIndices?: number[]
		liveLoadExcludedBayKeys?: string[]
	}) => {
		if (!blockId) return
		setScaffoldBlocks(prev => prev.map(block => {
			if (block.id !== blockId) return block

			const nextPlan = buildStandardPlan({
				heightFt: block.heightFt,
				ledgerEveryN: block.ledgerEveryNRosettes,
				plankedLevelsCount: block.plankedLevelsCount ?? 1,
				includeBaseDeck: block.includeBaseDeck ?? false,
				jackExtensionIn: block.baseSettings.jackExtensionIn,
				showWoodSill: block.baseSettings.showWoodSill,
				showBaseCollar: block.baseSettings.showBaseCollar,
			})
			const validDeckLiftSet = new Set(nextPlan.workingDeckLiftIndices)

			const nextLiveLoadPsf = partial.liveLoadPsf !== undefined
				? (Number.isFinite(Number(partial.liveLoadPsf)) && Number(partial.liveLoadPsf) > 0 ? Number(partial.liveLoadPsf) : undefined)
				: block.liveLoadPsf
			const requestedLiftIndices = partial.liveLoadDeckLiftIndices !== undefined
				? partial.liveLoadDeckLiftIndices
				: (block.liveLoadDeckLiftIndices ?? [])
			const nextDeckLiftIndices = Array.from(new Set(
				(Array.isArray(requestedLiftIndices) ? requestedLiftIndices : [])
					.map(value => Math.round(Number(value)))
					.filter(value => Number.isFinite(value) && validDeckLiftSet.has(value))
			)).sort((a, b) => a - b)
			const layoutX = chooseBayLayout(block.widthFt)
			const layoutY = chooseBayLayout(block.depthFt)
			const validExcludedBayKeySet = new Set<string>()
			for (const liftIndex of nextDeckLiftIndices) {
				for (let bayY = 0; bayY < layoutY.bays; bayY++) {
					for (let bayX = 0; bayX < layoutX.bays; bayX++) {
						validExcludedBayKeySet.add(makeBlockLiveLoadBayKey(liftIndex, bayX, bayY))
					}
				}
			}
			const requestedExcludedBayKeys = partial.liveLoadExcludedBayKeys !== undefined
				? partial.liveLoadExcludedBayKeys
				: (block.liveLoadExcludedBayKeys ?? [])
			const nextExcludedBayKeys = Array.from(new Set(
				(Array.isArray(requestedExcludedBayKeys) ? requestedExcludedBayKeys : [])
					.map(value => String(value))
					.filter(value => validExcludedBayKeySet.has(value))
			)).sort()

			return {
				...block,
				...(nextLiveLoadPsf !== undefined ? { liveLoadPsf: nextLiveLoadPsf } : { liveLoadPsf: undefined }),
				...(nextDeckLiftIndices.length > 0 ? { liveLoadDeckLiftIndices: nextDeckLiftIndices } : { liveLoadDeckLiftIndices: undefined }),
				...(nextExcludedBayKeys.length > 0 ? { liveLoadExcludedBayKeys: nextExcludedBayKeys } : { liveLoadExcludedBayKeys: undefined }),
				updatedAt: Date.now(),
			}
		}))
	}, [])

	const removeScaffoldBlock = useCallback((blockId: string) => {
				// IMPORTANT:
				// We do cleanup using refs (so this callback can run without stale closures), but
				// `scaffoldBlocksRef` is normally only updated in an effect after React commits.
				// If the user deletes multiple blocks quickly, subsequent calls can see a stale
				// block list and incorrectly treat members as "shared", leaving tall standards behind.
				//
				// To make multi-delete robust, we compute from the current ref snapshot and then
				// eagerly update the ref to the "post-delete" list.
				const blocksSnapshot = scaffoldBlocksRef.current
				const block = blocksSnapshot.find(b => b.id === blockId)
				const remainingBlocksSnapshot = blocksSnapshot.filter(b => b.id !== blockId)
				// Eagerly advance the ref so consecutive deletions in the same tick see the updated list.
				// Also eagerly apply the same guardrail-key transfer that we do in the setState call below,
				// otherwise a rapid "delete B then delete A" can temporarily lose guardrail ownership and
				// prevent the last delete from removing those guardrail ledgers.
				if (block && remainingBlocksSnapshot.length > 0) {
					const transferManaged = new Set<string>(block.managedGuardrailLedgerKeys ?? [])
					const transferSuppressed = new Set<string>(block.suppressedLedgerKeys ?? [])
					if (transferManaged.size > 0 || transferSuppressed.size > 0) {
						const sorted = remainingBlocksSnapshot.slice().sort((a, b) => {
							const da = Number(a.createdAt ?? 0)
							const db = Number(b.createdAt ?? 0)
							if (da !== db) return da - db
							return String(a.id).localeCompare(String(b.id))
						})
						const ownerId = sorted[0]!.id
						scaffoldBlocksRef.current = remainingBlocksSnapshot.map(b => {
							if (b.id !== ownerId) return b
							const nextManaged = new Set<string>(b.managedGuardrailLedgerKeys ?? [])
							for (const k of transferManaged) nextManaged.add(k)
							const nextSupp = new Set<string>(b.suppressedLedgerKeys ?? [])
							for (const k of transferSuppressed) nextSupp.add(k)
							return {
								...b,
								...(nextManaged.size > 0 ? { managedGuardrailLedgerKeys: Array.from(nextManaged) } : {}),
								...(nextSupp.size > 0 ? { suppressedLedgerKeys: Array.from(nextSupp) } : {}),
							}
						})
					} else {
						scaffoldBlocksRef.current = remainingBlocksSnapshot
					}
				} else {
					scaffoldBlocksRef.current = remainingBlocksSnapshot
				}
			if (block) {
				// Build set of stack/ledger keys managed by OTHER blocks (shared members).
				const sharedStackKeys = new Set<string>()
				const sharedLedgerKeys = new Set<string>()
				for (const other of remainingBlocksSnapshot) {
					for (const k of other.managedStackKeys ?? []) sharedStackKeys.add(k)
					for (const k of other.managedLedgerKeys ?? []) sharedLedgerKeys.add(k)
				}

				// Remove managed (grid) ledgers that are NOT shared with other blocks.
				const ledgerKeysToRemove = new Set<string>()
				for (const k of block.managedLedgerKeys ?? []) {
					if (sharedLedgerKeys.has(k)) continue
					ledgerKeysToRemove.add(k)
				}

				// If we're removing the LAST block, also remove any guardrail ledgers it was managing.
				if (remainingBlocksSnapshot.length === 0) {
					for (const k of block.managedGuardrailLedgerKeys ?? []) ledgerKeysToRemove.add(k)
				}

				if (ledgerKeysToRemove.size > 0) {
					// Build a lookup: ledgerKey → connectionId
					const keyToConnId = new Map<string, string>()
					for (const c of ledgerConnectionsRef.current) {
						const sa = scaffoldStacksRef.current.find(s => s.id === c.startNode.stackId)
						const sb = scaffoldStacksRef.current.find(s => s.id === c.endNode.stackId)
						if (!sa || !sb) continue
						const ka = makeStackPositionKey(sa.gridPosition.x, sa.gridPosition.y, sa.gridPosition.z)
						const kb = makeStackPositionKey(sb.gridPosition.x, sb.gridPosition.y, sb.gridPosition.z)
						const lk = makeLedgerConnectionKey(ka, c.startNode.liftIndex, kb, c.endNode.liftIndex)
						keyToConnId.set(lk, c.id)
					}
					const connIdsToRemove = new Set<string>()
					for (const k of ledgerKeysToRemove) {
						const cid = keyToConnId.get(k)
						if (cid) connIdsToRemove.add(cid)
					}
					if (connIdsToRemove.size > 0) {
						setLedgerConnections(prev => prev.filter(c => !connIdsToRemove.has(c.id)))
					}
				}

				// Remove managed stacks that are NOT shared with other blocks.
				const stackKeysToRemove = new Set<string>()
				for (const k of block.managedStackKeys ?? []) {
					if (sharedStackKeys.has(k)) continue
					stackKeysToRemove.add(k)
				}
				if (stackKeysToRemove.size > 0) {
					const stackIdsToRemove = new Set<string>()
					for (const s of scaffoldStacksRef.current) {
						const k = makeStackPositionKey(s.gridPosition.x, s.gridPosition.y, s.gridPosition.z)
						if (stackKeysToRemove.has(k)) stackIdsToRemove.add(s.id)
					}
					// Also remove any ledger connections that reference removed stacks
					setLedgerConnections(prev => prev.filter(c =>
						!stackIdsToRemove.has(c.startNode.stackId) && !stackIdsToRemove.has(c.endNode.stackId)
					))
					setScaffoldStacks(prev => prev.filter(s => !stackIdsToRemove.has(s.id)))
				}
			}

			// Remove the block footprint and (if needed) transfer global guardrail tracking/suppressions.
			setScaffoldBlocks(prev => {
				const removed = prev.find(b => b.id === blockId)
				const remaining = prev.filter(b => b.id !== blockId)
				if (!removed) return remaining
				if (remaining.length === 0) return remaining

				const sorted = remaining.slice().sort((a, b) => {
					const da = Number(a.createdAt ?? 0)
					const db = Number(b.createdAt ?? 0)
					if (da !== db) return da - db
					return String(a.id).localeCompare(String(b.id))
				})
				const ownerId = sorted[0]!.id

				const transferManaged = new Set<string>(removed.managedGuardrailLedgerKeys ?? [])
				const transferSuppressed = new Set<string>(removed.suppressedLedgerKeys ?? [])
				if (transferManaged.size === 0 && transferSuppressed.size === 0) return remaining

				return remaining.map(b => {
					if (b.id !== ownerId) return b
					const nextManaged = new Set<string>(b.managedGuardrailLedgerKeys ?? [])
					for (const k of transferManaged) nextManaged.add(k)
					const nextSupp = new Set<string>(b.suppressedLedgerKeys ?? [])
					for (const k of transferSuppressed) nextSupp.add(k)
					return {
						...b,
						...(nextManaged.size > 0 ? { managedGuardrailLedgerKeys: Array.from(nextManaged) } : {}),
						...(nextSupp.size > 0 ? { suppressedLedgerKeys: Array.from(nextSupp) } : {}),
						updatedAt: Date.now(),
					}
				})
			})

		setSelectedBlockIdRaw(prev => {
			if (prev === blockId) {
				setIsEditingBlock(false)
				return null
			}
			return prev
		})
		setSelectedBlockIdsRaw(prev => prev.filter(id => id !== blockId))
	}, [makeLedgerKey])

	const suppressStackKeyInBlocks = useCallback((stackKey: string) => {
		if (!stackKey) return
		const target = parseStackPositionKey(stackKey)
		setScaffoldBlocks(prev => prev.map(b => {
			const managedKeys = Array.isArray(b.managedStackKeys) ? b.managedStackKeys : []
			const matchingKeys = managedKeys.filter((candidate) => {
				if (candidate === stackKey) return true
				if (!target) return false
				const parsedCandidate = parseStackPositionKey(candidate)
				return !!parsedCandidate && parsedCandidate.planKey === target.planKey
			})
			if (matchingKeys.length === 0) return b
			const suppressed = new Set<string>(b.suppressedStackKeys ?? [])
			suppressed.add(stackKey)
			return {
				...b,
				managedStackKeys: managedKeys.filter(k => !matchingKeys.includes(k)),
				suppressedStackKeys: Array.from(suppressed),
				updatedAt: Date.now(),
			}
		}))
	}, [])

	const suppressLedgerKeyInBlocks = useCallback((ledgerKey: string) => {
		if (!ledgerKey) return
		setScaffoldBlocks(prev => prev.map(b => {
				const isManagedGrid = !!b.managedLedgerKeys?.includes(ledgerKey)
				const isManagedGuardrail = !!b.managedGuardrailLedgerKeys?.includes(ledgerKey)
				if (!isManagedGrid && !isManagedGuardrail) return b
			const suppressed = new Set<string>(b.suppressedLedgerKeys ?? [])
			suppressed.add(ledgerKey)
				const nextManagedGuardrails = isManagedGuardrail
					? (b.managedGuardrailLedgerKeys ?? []).filter(k => k !== ledgerKey)
					: b.managedGuardrailLedgerKeys
			return {
				...b,
					managedLedgerKeys: isManagedGrid ? (b.managedLedgerKeys ?? []).filter(k => k !== ledgerKey) : (b.managedLedgerKeys ?? []),
					...(nextManagedGuardrails !== undefined
						? (nextManagedGuardrails.length > 0 ? { managedGuardrailLedgerKeys: nextManagedGuardrails } : { managedGuardrailLedgerKeys: undefined })
						: {}),
				suppressedLedgerKeys: Array.from(suppressed),
				updatedAt: Date.now(),
			}
		}))
	}, [])

		const suppressDiagonalMemberInBlock = useCallback((blockId: string, diagonalKey: string) => {
			if (!blockId || !diagonalKey) return
			setScaffoldBlocks(prev => prev.map(b => {
				if (b.id !== blockId) return b
				const suppressed = new Set<string>(b.suppressedDiagonalKeys ?? [])
				if (suppressed.has(diagonalKey)) return b
				suppressed.add(diagonalKey)
				return {
					...b,
					suppressedDiagonalKeys: Array.from(suppressed),
					updatedAt: Date.now(),
				}
			}))
		}, [])

		// NOTE: applyScaffoldBlockEdits is declared later (after addScaffoldStack/addLedgerConnection)
		// to avoid use-before-declaration issues inside hooks.

  const addScaffoldStack = useCallback((
    gridPosition: THREE.Vector3,
    standardPartNumber: string,
		jackExtensionIn: number,
		options?: {
			showWoodSill?: boolean
			showBaseCollar?: boolean
			baseSupport?: ScaffoldStack['baseSupport']
		}
  ): ScaffoldStack => {
    const stack: ScaffoldStack = {
      id: generateStackId(),
      gridPosition: gridPosition.clone(),
			standardSegments: [{ partNumber: standardPartNumber }],
      jackExtensionIn,
			baseSupport: options?.baseSupport ?? 'grid',
			showWoodSill: options?.showWoodSill,
			showBaseCollar: options?.showBaseCollar,
    }
    setScaffoldStacks(prev => [...prev, stack])
    return stack
  }, [])

	const appendStandardSegmentToStack = useCallback((stackId: string, standardPartNumber: string) => {
		setScaffoldStacks(prev => prev.map(s => {
			if (s.id !== stackId) return s
			const existingSegments = Array.isArray((s as any).standardSegments) ? (s as any).standardSegments : []
			return {
				...s,
				standardSegments: [...existingSegments, { partNumber: standardPartNumber }],
			}
		}))
	}, [])

		const setStandardSegmentsForStack = useCallback((stackId: string, standardPartNumbers: string[]) => {
			setScaffoldStacks(prev => prev.map(s => {
				if (s.id !== stackId) return s
				const next = (Array.isArray(standardPartNumbers) ? standardPartNumbers : [])
					.map(pn => String(pn ?? '').trim())
					.filter(pn => pn.length > 0)
				const safe = next.length > 0 ? next : ['US66']
				return {
					...s,
					standardSegments: safe.map(partNumber => ({ partNumber })),
				}
			}))
		}, [])

	  const removeScaffoldStack = useCallback((stackId: string) => {
				// Pre-compute the next stack-key set (after removal) so we can prune orphan blocks.
				// NOTE: match the actual state-update behavior (remove only the *first* matching ID).
				let removed = false
				const nextStacks = scaffoldStacksRef.current.filter(s => {
					if (removed) return true
					if (s.id !== stackId) return true
					removed = true
					return false
				})
				const remainingStackKeys = new Set(nextStacks.map(s => makeStackPositionKey(s.gridPosition.x, s.gridPosition.y, s.gridPosition.z)))

			// If this stack was managed by any block, treat deletion as a suppression so updates won't re-add it.
			const s = scaffoldStacksRef.current.find(ss => ss.id === stackId)
			if (s) {
				const k = makeStackPositionKey(s.gridPosition.x, s.gridPosition.y, s.gridPosition.z)
				suppressStackKeyInBlocks(k)
			}
	    // Remove the stack.
			// NOTE: In well-formed data, stack IDs are unique. However, older saved projects
			// (or malformed imports) may contain duplicate IDs. To avoid a single Delete keypress
			// wiping multiple standards, remove only the *first* matching stack.
	    setScaffoldStacks(prev => {
				let removed = false
				return prev.filter(s => {
					if (removed) return true
					if (s.id !== stackId) return true
					removed = true
					return false
				})
			})
    // Also remove any ledger connections that reference this stack
    setLedgerConnections(prev => prev.filter(c =>
      c.startNode.stackId !== stackId && c.endNode.stackId !== stackId
    ))
    // Clear selection if it was related to this stack
    setSelectedObjectId(prev => {
      if (prev?.startsWith(`standard-${stackId}`) ||
          prev?.startsWith(`wood-sill-${stackId}`) ||
          prev?.startsWith(`screw-jack-${stackId}`) ||
          prev?.startsWith(`base-collar-${stackId}`)) {
        return null
      }
      return prev
    })
    // Also clear from multi-select
    setSelectedStackIds(prev => prev.filter(id => id !== stackId))

				// If this deletion removes all standards that a block "owns", drop the block footprint too.
				// We keep blocks that have no key-tracking data (older projects) to avoid unintended loss.
				setScaffoldBlocks(prev => prev.filter(b => {
					const keys = new Set<string>([
						...(b.managedStackKeys ?? []),
						...((b.suppressedStackKeys ?? []) as string[]),
					])
					if (keys.size === 0) return true
					for (const k of keys) {
						if (remainingStackKeys.has(k)) return true
					}
					return false
				}))
	  }, [suppressStackKeyInBlocks])

	const updateScaffoldStack = useCallback((
		stackId: string,
		partial: Partial<Pick<ScaffoldStack, 'jackExtensionIn' | 'showWoodSill' | 'showBaseCollar' | 'baseSupport' | 'gridPosition'>>
	) => {
		setScaffoldStacks(prev => prev.map(s => s.id === stackId ? { ...s, ...partial } : s))
	}, [])

	const updateAllScaffoldStacks = useCallback((partial: Partial<Pick<ScaffoldStack, 'jackExtensionIn' | 'showWoodSill' | 'showBaseCollar' | 'baseSupport'>>) => {
    setScaffoldStacks(prev => prev.map(s => ({ ...s, ...partial })))
  }, [])

  const addLedgerConnection = useCallback((
    startNode: RosetteNodeRef,
    endNode: RosetteNodeRef,
    ledgerPartNumber: string
  ): LedgerConnection => {
			const findExisting = (connections: LedgerConnection[]) =>
				connections.find(conn => {
					const startMatchesA = conn.startNode.stackId === startNode.stackId && conn.startNode.liftIndex === startNode.liftIndex
					const startMatchesB = conn.startNode.stackId === endNode.stackId && conn.startNode.liftIndex === endNode.liftIndex
					const endMatchesA = conn.endNode.stackId === startNode.stackId && conn.endNode.liftIndex === startNode.liftIndex
					const endMatchesB = conn.endNode.stackId === endNode.stackId && conn.endNode.liftIndex === endNode.liftIndex
					return (startMatchesA && endMatchesB) || (startMatchesB && endMatchesA)
				})

			// Fast path: if this edge already exists, return it and do not add a duplicate.
			const existing = findExisting(ledgerConnectionsRef.current)
			if (existing) return existing

			const connection: LedgerConnection = {
				id: generateLedgerId(),
				startNode,
				endNode,
				ledgerPartNumber,
			}

			setLedgerConnections(prev => {
				// Safety net: enforce uniqueness at the model layer even if multiple callers race.
				if (findExisting(prev)) return prev
				return [...prev, connection]
			})
			return connection
  }, [])

	const addManualPlankPlacement = useCallback((supportLedgerId: string, sideSign: 1 | -1): ManualPlankPlacement => {
		const findExisting = (placements: ManualPlankPlacement[]) =>
			placements.find(p => p.supportLedgerId === supportLedgerId && p.sideSign === sideSign)

		const existing = findExisting(manualPlankPlacementsRef.current)
		if (existing) return existing

		const placement: ManualPlankPlacement = {
			id: generatePlankPlacementId(),
			supportLedgerId,
			sideSign,
		}

		setManualPlankPlacements(prev => {
			if (findExisting(prev)) return prev
			return [...prev, placement]
		})
		return placement
	}, [])

	const addManualLiveLoadPlacement = useCallback((
		supportLedgerId: string,
		sideSign: 1 | -1,
		magnitudePsf = DEFAULT_MANUAL_LIVE_LOAD_PSF,
	): ManualLiveLoadPlacement => {
		const safeMagnitudePsf = Number.isFinite(magnitudePsf) && magnitudePsf > 0
			? magnitudePsf
			: DEFAULT_MANUAL_LIVE_LOAD_PSF

		const findExisting = (placements: ManualLiveLoadPlacement[]) =>
			placements.find(p => p.supportLedgerId === supportLedgerId && p.sideSign === sideSign)

		const existing = findExisting(manualLiveLoadPlacementsRef.current)
		if (existing) return existing

		const placement: ManualLiveLoadPlacement = {
			id: generateLiveLoadPlacementId(),
			supportLedgerId,
			sideSign,
			magnitudePsf: safeMagnitudePsf,
		}

		setManualLiveLoadPlacements(prev => {
			if (findExisting(prev)) return prev
			return [...prev, placement]
		})
		return placement
	}, [])

	const applySupportAwareScaffoldBlockEdits = useCallback((blockId: string, params: {
		widthFt: number
		depthFt: number
		heightFt: number
		ledgerEveryNRosettes: number
		plankedLevelsCount?: number
		includeBaseDeck?: boolean
		braceFrontBack?: BlockBraceDirection
		braceLeftRight?: BlockBraceDirection
		center?: { x: number; y: number }
	}) => {
		const block = scaffoldBlocksRef.current.find(candidate => candidate.id === blockId)
		if (!block) return false

		const nextWidthFt = Math.max(0.1, Number(params.widthFt))
		const nextDepthFt = Math.max(0.1, Number(params.depthFt))
		const nextHeightFt = Math.max(0.1, Number(params.heightFt))
		const nextLedgerEveryN = Math.max(1, Math.round(Number(params.ledgerEveryNRosettes)))
		const nextPlankedLevelsCount = Math.max(1, Math.round(Number(
			params.plankedLevelsCount ?? block.plankedLevelsCount ?? 1,
		)))
		const nextIncludeBaseDeck = params.includeBaseDeck !== undefined
			? Boolean(params.includeBaseDeck)
			: Boolean(block.includeBaseDeck ?? false)
		const nextBraceFrontBack = params.braceFrontBack ?? block.braceFrontBack ?? 'off'
		const nextBraceLeftRight = params.braceLeftRight ?? block.braceLeftRight ?? 'off'
		const base = block.baseSettings

		const oldRecipe = buildSupportAwareRecipeFromBlock(block)
		const nextRecipe: SupportAwareBlockRecipe = {
			...oldRecipe,
			widthFt: nextWidthFt,
			depthFt: nextDepthFt,
			heightFt: nextHeightFt,
			plankedLevelsCount: nextPlankedLevelsCount,
			includeBaseDeck: nextIncludeBaseDeck,
			braceFrontBack: nextBraceFrontBack,
			braceLeftRight: nextBraceLeftRight,
			ledgerEveryNRosettes: nextLedgerEveryN,
		}

		const rotIsOdd = (((block.rotationSteps ?? 0) % 4) + 4) % 4 % 2 === 1
		const oldWorldW = rotIsOdd ? block.depthFt : block.widthFt
		const oldWorldD = rotIsOdd ? block.widthFt : block.depthFt
		const oldXMin = block.center.x - oldWorldW / 2
		const oldXMax = block.center.x + oldWorldW / 2
		const oldYMin = block.center.y - oldWorldD / 2
		const oldYMax = block.center.y + oldWorldD / 2

		const newWorldW = rotIsOdd ? nextDepthFt : nextWidthFt
		const newWorldD = rotIsOdd ? nextWidthFt : nextDepthFt
		const explicitCenter = params.center
		const hasExplicitCenter = !!explicitCenter
			&& Number.isFinite(Number(explicitCenter.x))
			&& Number.isFinite(Number(explicitCenter.y))

		const edgeTol = 0.05
		let anchorLeft = false
		let anchorRight = false
		let anchorBottom = false
		let anchorTop = false
		if (!hasExplicitCenter) {
			for (const other of scaffoldBlocksRef.current) {
				if (other.id === blockId) continue
				const otherRotOdd = (((other.rotationSteps ?? 0) % 4) + 4) % 4 % 2 === 1
				const otherWorldW = otherRotOdd ? other.depthFt : other.widthFt
				const otherWorldD = otherRotOdd ? other.widthFt : other.depthFt
				const otherXMin = other.center.x - otherWorldW / 2
				const otherXMax = other.center.x + otherWorldW / 2
				const otherYMin = other.center.y - otherWorldD / 2
				const otherYMax = other.center.y + otherWorldD / 2
				const yOverlap = oldYMin < otherYMax - edgeTol && oldYMax > otherYMin + edgeTol
				const xOverlap = oldXMin < otherXMax - edgeTol && oldXMax > otherXMin + edgeTol
				if (yOverlap && Math.abs(oldXMax - otherXMin) < edgeTol) anchorRight = true
				if (yOverlap && Math.abs(oldXMin - otherXMax) < edgeTol) anchorLeft = true
				if (xOverlap && Math.abs(oldYMax - otherYMin) < edgeTol) anchorTop = true
				if (xOverlap && Math.abs(oldYMin - otherYMax) < edgeTol) anchorBottom = true
			}
		}

		let newCenterX = block.center.x
		let newCenterY = block.center.y
		if (hasExplicitCenter) {
			newCenterX = Number(explicitCenter!.x)
			newCenterY = Number(explicitCenter!.y)
		} else if (anchorRight && !anchorLeft) {
			newCenterX = oldXMax - newWorldW / 2
		} else if (anchorLeft && !anchorRight) {
			newCenterX = oldXMin + newWorldW / 2
		} else if (anchorLeft && anchorRight) {
			newCenterX = oldXMin + newWorldW / 2
		}
		if (!hasExplicitCenter && anchorTop && !anchorBottom) {
			newCenterY = oldYMax - newWorldD / 2
		} else if (!hasExplicitCenter && anchorBottom && !anchorTop) {
			newCenterY = oldYMin + newWorldD / 2
		} else if (!hasExplicitCenter && anchorBottom && anchorTop) {
			newCenterY = oldYMin + newWorldD / 2
		}

		const newCenter = { x: newCenterX, y: newCenterY }
		const nextResolvedLayout = resolveSupportAwareBlockLayout({
			centerX: newCenter.x,
			centerY: newCenter.y,
			recipe: nextRecipe,
			objects,
			supportSurfaces: buildingSupportSurfaces,
			cutVolumes: buildingCutVolumes,
		})
		if (nextResolvedLayout.placementIssue) {
			showBlockPlacementWarning(describeSupportAwareLayoutIssue(nextResolvedLayout.placementIssue))
			return true
		}
		const oldResolvedLayout = resolveSupportAwareBlockLayout({
			centerX: block.center.x,
			centerY: block.center.y,
			recipe: oldRecipe,
			objects,
			supportSurfaces: buildingSupportSurfaces,
			cutVolumes: buildingCutVolumes,
		})

		const nextWorkingDeckLiftSet = new Set(nextResolvedLayout.nominalPlan.workingDeckLiftIndices)
		const nextLiveLoadDeckLiftIndices = Array.from(new Set(
			(block.liveLoadDeckLiftIndices ?? [])
				.map(value => Math.round(Number(value)))
				.filter(value => Number.isFinite(value) && nextWorkingDeckLiftSet.has(value)),
		)).sort((a, b) => a - b)

		const baysX = nextResolvedLayout.layoutX.bays
		const baysY = nextResolvedLayout.layoutY.bays
		const nextLiveLoadValidBayKeySet = new Set<string>()
		for (const liftIndex of nextLiveLoadDeckLiftIndices) {
			for (let bayY = 0; bayY < baysY; bayY++) {
				for (let bayX = 0; bayX < baysX; bayX++) {
					nextLiveLoadValidBayKeySet.add(makeBlockLiveLoadBayKey(liftIndex, bayX, bayY))
				}
			}
		}
		const nextLiveLoadExcludedBayKeys = Array.from(new Set(
			(block.liveLoadExcludedBayKeys ?? [])
				.map(value => String(value))
				.filter(value => nextLiveLoadValidBayKeySet.has(value)),
		)).sort()

		const stackByKey = new Map<string, ScaffoldStack>()
		for (const stack of scaffoldStacksRef.current) {
			stackByKey.set(makeStackPositionKey(stack.gridPosition.x, stack.gridPosition.y, stack.gridPosition.z), stack)
		}

		const stackPartNumbers = (stack: ScaffoldStack) =>
			(Array.isArray(stack.standardSegments) ? stack.standardSegments : [])
				.map(segment => String(segment?.partNumber ?? ''))
				.filter(Boolean)

		const arraysEqual = (a: string[], b: string[]) => {
			if (a.length !== b.length) return false
			for (let index = 0; index < a.length; index++) {
				if (String(a[index]) !== String(b[index])) return false
			}
			return true
		}

		const isPrefix = (prefix: string[], value: string[]) => {
			if (prefix.length > value.length) return false
			for (let index = 0; index < prefix.length; index++) {
				if (String(prefix[index]) !== String(value[index])) return false
			}
			return true
		}

		const supportMatchesSpec = (stack: ScaffoldStack, spec: SupportAwareStackSpec) => (
			Math.abs(Number(stack.gridPosition.z ?? 0) - Number(spec.gridPositionZ)) <= 1e-6
			&& Math.abs(Number(stack.jackExtensionIn ?? 0) - Number(spec.jackExtensionIn)) <= 1e-6
			&& String(stack.baseSupport ?? 'grid') === String(spec.baseSupport ?? 'grid')
		)

		const stackMatchesSpecExact = (stack: ScaffoldStack, spec: SupportAwareStackSpec) =>
			supportMatchesSpec(stack, spec) && arraysEqual(stackPartNumbers(stack), spec.standardSegments)

		const stackMatchesSpecPrefix = (stack: ScaffoldStack, spec: SupportAwareStackSpec) =>
			supportMatchesSpec(stack, spec) && isPrefix(stackPartNumbers(stack), spec.standardSegments)

		const desiredSpecPrefixOfStack = (stack: ScaffoldStack, spec: SupportAwareStackSpec) =>
			supportMatchesSpec(stack, spec) && isPrefix(spec.standardSegments, stackPartNumbers(stack))

		const updateLocalStack = (stack: ScaffoldStack, spec: SupportAwareStackSpec, standardSegments: string[]) => ({
			...stack,
			gridPosition: new THREE.Vector3(stack.gridPosition.x, stack.gridPosition.y, spec.gridPositionZ),
			jackExtensionIn: spec.jackExtensionIn,
			baseSupport: spec.baseSupport,
			standardSegments: standardSegments.map(partNumber => ({ partNumber })),
		})

		const otherLayoutsByBlockId = new Map<string, ReturnType<typeof resolveSupportAwareBlockLayout>>()
		for (const other of scaffoldBlocksRef.current) {
			if (other.id === blockId) continue
			otherLayoutsByBlockId.set(other.id, resolveSupportAwareBlockLayout({
				centerX: other.center.x,
				centerY: other.center.y,
				recipe: buildSupportAwareRecipeFromBlock(other),
				objects,
				supportSurfaces: buildingSupportSurfaces,
				cutVolumes: buildingCutVolumes,
			}))
		}

		const otherPreferredSpecsByKey = new Map<string, SupportAwareStackSpec>()
		for (const other of scaffoldBlocksRef.current) {
			if (other.id === blockId) continue
			const otherLayout = otherLayoutsByBlockId.get(other.id)
			if (!otherLayout) continue
			const suppressed = new Set<string>(
				normalizeStringSet(other.suppressedStackKeys, (key) => normalizeStackKeyForLayout(key, otherLayout)),
			)
			for (const rawKey of other.managedStackKeys ?? []) {
				const key = normalizeStackKeyForLayout(String(rawKey), otherLayout)
				if (suppressed.has(key)) continue
				const spec = otherLayout.stackSpecsByKey.get(key)
				if (!spec) continue
				otherPreferredSpecsByKey.set(
					key,
					choosePreferredSupportAwareStackSpec(otherPreferredSpecsByKey.get(key), spec)!,
				)
			}
		}

		const getPreferredOldSpec = (key: string) =>
			choosePreferredSupportAwareStackSpec(
				otherPreferredSpecsByKey.get(key),
				oldResolvedLayout.stackSpecsByKey.get(key),
			)

		const getPreferredNextSpec = (key: string) =>
			choosePreferredSupportAwareStackSpec(
				otherPreferredSpecsByKey.get(key),
				nextResolvedLayout.stackSpecsByKey.get(key),
			)

		const managedStacks = new Set<string>(
			normalizeStringSet(block.managedStackKeys, (key) => normalizeStackKeyForLayout(key, oldResolvedLayout)),
		)
		const suppressedStacks = new Set<string>(
			normalizeStringSet(block.suppressedStackKeys, (key) => normalizeStackKeyForLayout(key, oldResolvedLayout)),
		)
		const managedLedgers = new Set<string>(
			normalizeStringSet(block.managedLedgerKeys, (key) => normalizeLedgerKeyForLayout(key, oldResolvedLayout)),
		)
		const suppressedLedgers = new Set<string>(
			normalizeStringSet(block.suppressedLedgerKeys, (key) => normalizeLedgerKeyForLayout(key, oldResolvedLayout)),
		)

		for (const key of Array.from(managedStacks)) {
			const stack = stackByKey.get(key)
			if (!stack) {
				managedStacks.delete(key)
				suppressedStacks.add(key)
				continue
			}
			const expectedOldSpec = getPreferredOldSpec(key)
			if (!expectedOldSpec || !stackMatchesSpecPrefix(stack, expectedOldSpec)) {
				managedStacks.delete(key)
			}
		}

		const stackIdByKey = new Map<string, string>()
		for (const stack of scaffoldStacksRef.current) {
			stackIdByKey.set(makeStackPositionKey(stack.gridPosition.x, stack.gridPosition.y, stack.gridPosition.z), stack.id)
		}
		const hasConnection = (stackKeyA: string, stackKeyB: string, liftIndexA: number, liftIndexB = liftIndexA) => {
			const stackIdA = stackIdByKey.get(stackKeyA)
			const stackIdB = stackIdByKey.get(stackKeyB)
			if (!stackIdA || !stackIdB) return false
			return ledgerConnectionsRef.current.some(connection => {
				const direct = connection.startNode.stackId === stackIdA
					&& connection.endNode.stackId === stackIdB
					&& connection.startNode.liftIndex === liftIndexA
					&& connection.endNode.liftIndex === liftIndexB
				const reverse = connection.startNode.stackId === stackIdB
					&& connection.endNode.stackId === stackIdA
					&& connection.startNode.liftIndex === liftIndexB
					&& connection.endNode.liftIndex === liftIndexA
				return direct || reverse
			})
		}
		for (const key of Array.from(managedLedgers)) {
			const parsed = parseLedgerConnectionKey(key)
			if (!parsed || !hasConnection(parsed.stackKeyA, parsed.stackKeyB, parsed.liftIndexA, parsed.liftIndexB)) {
				managedLedgers.delete(key)
				suppressedLedgers.add(key)
			}
		}

		const desiredStackKeys = new Set<string>(nextResolvedLayout.stackKeys.flat())
		const desiredLedgerKeys = new Set<string>(nextResolvedLayout.ledgerSpecs.map(spec => spec.key))

		const sharedStackKeys = new Set<string>()
		const sharedLedgerKeys = new Set<string>()
		for (const other of scaffoldBlocksRef.current) {
			if (other.id === blockId) continue
			const otherLayout = otherLayoutsByBlockId.get(other.id)
			if (!otherLayout) continue
			const suppressedOtherStacks = new Set<string>(
				normalizeStringSet(other.suppressedStackKeys, (key) => normalizeStackKeyForLayout(key, otherLayout)),
			)
			const suppressedOtherLedgers = new Set<string>(
				normalizeStringSet(other.suppressedLedgerKeys, (key) => normalizeLedgerKeyForLayout(key, otherLayout)),
			)
			for (const rawKey of other.managedStackKeys ?? []) {
				const key = normalizeStackKeyForLayout(String(rawKey), otherLayout)
				if (!suppressedOtherStacks.has(key)) sharedStackKeys.add(key)
			}
			for (const rawKey of other.managedLedgerKeys ?? []) {
				const key = normalizeLedgerKeyForLayout(String(rawKey), otherLayout)
				if (!suppressedOtherLedgers.has(key)) sharedLedgerKeys.add(key)
			}
		}

		const obsoleteStackKeys = new Set<string>()
		for (const key of managedStacks) {
			if (!desiredStackKeys.has(key)) obsoleteStackKeys.add(key)
		}

		const obsoleteLedgerKeys = new Set<string>()
		for (const key of managedLedgers) {
			const parsed = parseLedgerConnectionKey(key)
			if (!parsed) {
				obsoleteLedgerKeys.add(key)
				continue
			}
			if (!desiredLedgerKeys.has(key)) {
				obsoleteLedgerKeys.add(key)
				continue
			}
			if (obsoleteStackKeys.has(parsed.stackKeyA) || obsoleteStackKeys.has(parsed.stackKeyB)) {
				obsoleteLedgerKeys.add(key)
			}
		}

		if (obsoleteLedgerKeys.size > 0) {
			const keyToConnId = new Map<string, string>()
			for (const connection of ledgerConnectionsRef.current) {
				const startStack = scaffoldStacksRef.current.find(stack => stack.id === connection.startNode.stackId)
				const endStack = scaffoldStacksRef.current.find(stack => stack.id === connection.endNode.stackId)
				if (!startStack || !endStack) continue
				const ledgerKey = makeLedgerConnectionKey(
					makeStackPositionKey(startStack.gridPosition.x, startStack.gridPosition.y, startStack.gridPosition.z),
					connection.startNode.liftIndex,
					makeStackPositionKey(endStack.gridPosition.x, endStack.gridPosition.y, endStack.gridPosition.z),
					connection.endNode.liftIndex,
				)
				keyToConnId.set(ledgerKey, connection.id)
			}
			const connectionIdsToRemove = new Set<string>()
			for (const key of obsoleteLedgerKeys) {
				managedLedgers.delete(key)
				if (sharedLedgerKeys.has(key)) continue
				const connectionId = keyToConnId.get(key)
				if (connectionId) connectionIdsToRemove.add(connectionId)
			}
			if (connectionIdsToRemove.size > 0) {
				setLedgerConnections(prev => prev.filter(connection => !connectionIdsToRemove.has(connection.id)))
			}
		}

		if (obsoleteStackKeys.size > 0) {
			const stackIdsToRemove = new Set<string>()
			for (const key of obsoleteStackKeys) {
				managedStacks.delete(key)
				if (sharedStackKeys.has(key)) continue
				const stack = stackByKey.get(key)
				if (!stack) continue
				stackIdsToRemove.add(stack.id)
				stackByKey.delete(key)
			}
			if (stackIdsToRemove.size > 0) {
				setLedgerConnections(prev => prev.filter(connection =>
					!stackIdsToRemove.has(connection.startNode.stackId)
					&& !stackIdsToRemove.has(connection.endNode.stackId),
				))
				setScaffoldStacks(prev => prev.filter(stack => !stackIdsToRemove.has(stack.id)))
			}
		}

		for (const row of nextResolvedLayout.stackKeys) {
			for (const key of row) {
				if (suppressedStacks.has(key)) continue
				const ownDesiredSpec = nextResolvedLayout.stackSpecsByKey.get(key)
				const desiredSpec = getPreferredNextSpec(key) ?? ownDesiredSpec
				if (!desiredSpec) continue
				const existingStack = stackByKey.get(key)
				if (existingStack) {
					const currentParts = stackPartNumbers(existingStack)
					const supportPartial = {
						jackExtensionIn: desiredSpec.jackExtensionIn,
						baseSupport: desiredSpec.baseSupport,
						gridPosition: new THREE.Vector3(existingStack.gridPosition.x, existingStack.gridPosition.y, desiredSpec.gridPositionZ),
					}

					if (managedStacks.has(key)) {
						const expectedOldSpec = getPreferredOldSpec(key)
						if (stackMatchesSpecExact(existingStack, desiredSpec)) {
							stackByKey.set(key, updateLocalStack(existingStack, desiredSpec, desiredSpec.standardSegments))
						} else if (stackMatchesSpecPrefix(existingStack, desiredSpec)) {
							for (let index = currentParts.length; index < desiredSpec.standardSegments.length; index++) {
								appendStandardSegmentToStack(existingStack.id, desiredSpec.standardSegments[index]!)
							}
							updateScaffoldStack(existingStack.id, supportPartial)
							stackByKey.set(key, updateLocalStack(existingStack, desiredSpec, desiredSpec.standardSegments))
						} else if (desiredSpecPrefixOfStack(existingStack, desiredSpec)) {
							setStandardSegmentsForStack(existingStack.id, desiredSpec.standardSegments)
							updateScaffoldStack(existingStack.id, supportPartial)
							stackByKey.set(key, updateLocalStack(existingStack, desiredSpec, desiredSpec.standardSegments))
						} else if (expectedOldSpec && stackMatchesSpecPrefix(existingStack, expectedOldSpec)) {
							setStandardSegmentsForStack(existingStack.id, desiredSpec.standardSegments)
							updateScaffoldStack(existingStack.id, supportPartial)
							stackByKey.set(key, updateLocalStack(existingStack, desiredSpec, desiredSpec.standardSegments))
						} else {
							managedStacks.delete(key)
						}
					} else if (stackMatchesSpecPrefix(existingStack, desiredSpec)) {
						managedStacks.add(key)
						for (let index = currentParts.length; index < desiredSpec.standardSegments.length; index++) {
							appendStandardSegmentToStack(existingStack.id, desiredSpec.standardSegments[index]!)
						}
						updateScaffoldStack(existingStack.id, supportPartial)
						stackByKey.set(key, updateLocalStack(existingStack, desiredSpec, desiredSpec.standardSegments))
					}
					continue
				}

				const firstSegment = desiredSpec.standardSegments[0] ?? 'US66'
				const created = addScaffoldStack(
					new THREE.Vector3(desiredSpec.x, desiredSpec.y, desiredSpec.gridPositionZ),
					firstSegment,
					desiredSpec.jackExtensionIn,
					{
						showWoodSill: base.showWoodSill,
						showBaseCollar: base.showBaseCollar,
						baseSupport: desiredSpec.baseSupport,
					},
				)
				for (let index = 1; index < desiredSpec.standardSegments.length; index++) {
					appendStandardSegmentToStack(created.id, desiredSpec.standardSegments[index]!)
				}
				stackByKey.set(key, updateLocalStack(created, desiredSpec, desiredSpec.standardSegments))
				managedStacks.add(key)
			}
		}

		const stackIdByKeyAfter = new Map<string, string>()
		for (const [key, stack] of stackByKey.entries()) {
			stackIdByKeyAfter.set(key, stack.id)
		}

		const nextManagedLedgers = new Set<string>(managedLedgers)
		for (const ledgerSpec of nextResolvedLayout.ledgerSpecs) {
			if (suppressedLedgers.has(ledgerSpec.key)) continue
			const stackIdA = stackIdByKeyAfter.get(ledgerSpec.stackKeyA)
			const stackIdB = stackIdByKeyAfter.get(ledgerSpec.stackKeyB)
			if (!stackIdA || !stackIdB) continue
			addLedgerConnection(
				{ stackId: stackIdA, liftIndex: ledgerSpec.liftIndexA },
				{ stackId: stackIdB, liftIndex: ledgerSpec.liftIndexB },
				ledgerSpec.ledgerPartNumber,
			)
			nextManagedLedgers.add(ledgerSpec.key)
		}

		setScaffoldBlocks(prev => prev.map(candidate => {
			if (candidate.id !== blockId) return candidate
			return {
				...candidate,
				center: newCenter,
				widthFt: nextWidthFt,
				depthFt: nextDepthFt,
				heightFt: nextHeightFt,
				plankedLevelsCount: nextPlankedLevelsCount,
				includeBaseDeck: nextIncludeBaseDeck,
				...(block.liveLoadPsf !== undefined ? { liveLoadPsf: block.liveLoadPsf } : {}),
				...(nextLiveLoadDeckLiftIndices.length > 0
					? { liveLoadDeckLiftIndices: nextLiveLoadDeckLiftIndices }
					: { liveLoadDeckLiftIndices: undefined }),
				...(nextLiveLoadExcludedBayKeys.length > 0
					? { liveLoadExcludedBayKeys: nextLiveLoadExcludedBayKeys }
					: { liveLoadExcludedBayKeys: undefined }),
				braceFrontBack: nextBraceFrontBack,
				braceLeftRight: nextBraceLeftRight,
				ledgerEveryNRosettes: nextLedgerEveryN,
				managedStackKeys: Array.from(managedStacks),
				managedLedgerKeys: Array.from(nextManagedLedgers),
				...(suppressedStacks.size > 0 ? { suppressedStackKeys: Array.from(suppressedStacks) } : {}),
				...(suppressedLedgers.size > 0 ? { suppressedLedgerKeys: Array.from(suppressedLedgers) } : {}),
				...(Array.isArray(block.suppressedDiagonalKeys) && block.suppressedDiagonalKeys.length > 0
					? { suppressedDiagonalKeys: block.suppressedDiagonalKeys.slice() }
					: {}),
				updatedAt: Date.now(),
			}
		}))

		clearBlockPlacementWarning()
		return true
	}, [addLedgerConnection, addScaffoldStack, appendStandardSegmentToStack, buildingCutVolumes, buildingSupportSurfaces, clearBlockPlacementWarning, objects, setStandardSegmentsForStack, showBlockPlacementWarning, updateScaffoldStack])

			const applyScaffoldBlockEdits = useCallback((blockId: string, params: {
				widthFt: number
				depthFt: number
				heightFt: number
				ledgerEveryNRosettes: number
				plankedLevelsCount?: number
				includeBaseDeck?: boolean
				braceFrontBack?: BlockBraceDirection
				braceLeftRight?: BlockBraceDirection
				center?: { x: number; y: number }
			}) => {
			if (applySupportAwareScaffoldBlockEdits(blockId, params)) return
			const block = scaffoldBlocksRef.current.find(b => b.id === blockId)
			if (!block) return

			const nextWidthFt = Math.max(0.1, Number(params.widthFt))
			const nextDepthFt = Math.max(0.1, Number(params.depthFt))
			const nextHeightFt = Math.max(0.1, Number(params.heightFt))
			const nextLedgerEveryN = Math.max(1, Math.round(Number(params.ledgerEveryNRosettes)))
				const nextPlankedLevelsCount = Math.max(1, Math.round(Number(
					params.plankedLevelsCount ?? block.plankedLevelsCount ?? 1
				)))
				const nextIncludeBaseDeck = params.includeBaseDeck !== undefined
					? Boolean(params.includeBaseDeck)
					: Boolean(block.includeBaseDeck ?? false)
				const nextBraceFrontBack = params.braceFrontBack ?? block.braceFrontBack ?? 'off'
				const nextBraceLeftRight = params.braceLeftRight ?? block.braceLeftRight ?? 'off'

			const base = block.baseSettings
			const oldPlan = buildStandardPlan({
				heightFt: block.heightFt,
				ledgerEveryN: block.ledgerEveryNRosettes,
					plankedLevelsCount: block.plankedLevelsCount ?? 1,
					includeBaseDeck: block.includeBaseDeck ?? false,
				jackExtensionIn: base.jackExtensionIn,
				showWoodSill: base.showWoodSill,
				showBaseCollar: base.showBaseCollar,
			})
			const nextPlan = buildStandardPlan({
				heightFt: nextHeightFt,
				ledgerEveryN: nextLedgerEveryN,
					plankedLevelsCount: nextPlankedLevelsCount,
					includeBaseDeck: nextIncludeBaseDeck,
				jackExtensionIn: base.jackExtensionIn,
				showWoodSill: base.showWoodSill,
				showBaseCollar: base.showBaseCollar,
			})
			const nextWorkingDeckLiftSet = new Set(nextPlan.workingDeckLiftIndices)
			const nextLiveLoadDeckLiftIndices = Array.from(new Set(
				(block.liveLoadDeckLiftIndices ?? [])
					.map(value => Math.round(Number(value)))
					.filter(value => Number.isFinite(value) && nextWorkingDeckLiftSet.has(value))
			)).sort((a, b) => a - b)

			const layoutX = chooseBayLayout(nextWidthFt)
			const layoutY = chooseBayLayout(nextDepthFt)
			const baysX = layoutX.bays
			const baysY = layoutY.bays
			const nextLiveLoadValidBayKeySet = new Set<string>()
			for (const liftIndex of nextLiveLoadDeckLiftIndices) {
				for (let bayY = 0; bayY < baysY; bayY++) {
					for (let bayX = 0; bayX < baysX; bayX++) {
						nextLiveLoadValidBayKeySet.add(makeBlockLiveLoadBayKey(liftIndex, bayX, bayY))
					}
				}
			}
			const nextLiveLoadExcludedBayKeys = Array.from(new Set(
				(block.liveLoadExcludedBayKeys ?? [])
					.map(value => String(value))
					.filter(value => nextLiveLoadValidBayKeySet.has(value))
			)).sort()
			const spacingXFt = layoutX.spacingFt
			const spacingYFt = layoutY.spacingFt
			const ledgerPartNumberX = layoutX.ledgerPartNumber
			const ledgerPartNumberY = layoutY.ledgerPartNumber

			const stackByKey = new Map<string, ScaffoldStack>()
			for (const s of scaffoldStacksRef.current) {
				stackByKey.set(posKey2(s.gridPosition.x, s.gridPosition.y), s)
			}

			const segmentsEqual = (stack: ScaffoldStack, planSegments: string[]) => {
				const segs = Array.isArray(stack.standardSegments) ? stack.standardSegments : []
				if (segs.length !== planSegments.length) return false
				for (let i = 0; i < planSegments.length; i++) {
					if (String(segs[i]?.partNumber ?? '') !== String(planSegments[i])) return false
				}
				return true
			}
				const segmentsPrefix = (stack: ScaffoldStack, planSegments: string[]) => {
				const segs = Array.isArray(stack.standardSegments) ? stack.standardSegments : []
				if (segs.length > planSegments.length) return false
				for (let i = 0; i < segs.length; i++) {
					if (String(segs[i]?.partNumber ?? '') !== String(planSegments[i])) return false
				}
				return true
			}
				const planPrefixOfStack = (stack: ScaffoldStack, planSegments: string[]) => {
					const segs = Array.isArray(stack.standardSegments) ? stack.standardSegments : []
					if (planSegments.length > segs.length) return false
					for (let i = 0; i < planSegments.length; i++) {
						if (String(segs[i]?.partNumber ?? '') !== String(planSegments[i])) return false
					}
					return true
				}

			const managedStacks = new Set<string>(block.managedStackKeys ?? [])
			const suppressedStacks = new Set<string>(block.suppressedStackKeys ?? [])
			const managedLedgers = new Set<string>(block.managedLedgerKeys ?? [])
			const suppressedLedgers = new Set<string>(block.suppressedLedgerKeys ?? [])

				// Shared-stack height semantics:
				// For any stack-key, the "baseline" plan is the MAX required liftIndex across all blocks
				// that manage that key. This ensures shared standards don't get treated as manual edits when
				// another block extends them.
				const otherMaxRequiredLiftByKey = new Map<string, number>()
				const bumpMax = (k: string, requiredLiftIndex: number) => {
					const req = Math.max(1, Math.round(Number(requiredLiftIndex)))
					const prev = otherMaxRequiredLiftByKey.get(k) ?? 0
					if (req > prev) otherMaxRequiredLiftByKey.set(k, req)
				}
				for (const other of scaffoldBlocksRef.current) {
					if (other.id === blockId) continue
					const oBase = other.baseSettings
					if (!oBase) continue
					const plan = buildStandardPlan({
						heightFt: other.heightFt,
						ledgerEveryN: other.ledgerEveryNRosettes,
						plankedLevelsCount: other.plankedLevelsCount ?? 1,
						includeBaseDeck: other.includeBaseDeck ?? false,
						jackExtensionIn: oBase.jackExtensionIn,
						showWoodSill: oBase.showWoodSill,
						showBaseCollar: oBase.showBaseCollar,
					})
					const suppressed = new Set<string>(other.suppressedStackKeys ?? [])
					for (const k of other.managedStackKeys ?? []) {
						if (suppressed.has(k)) continue
						bumpMax(String(k), plan.requiredStandardLiftIndex)
					}
				}

				const segmentsByRequiredLift = new Map<number, UniversalRinglockStandardId[]>()
				const segmentsForRequiredLiftIndex = (requiredLiftIndex: number): UniversalRinglockStandardId[] => {
					const req = Math.max(1, Math.round(Number(requiredLiftIndex)))
					const cached = segmentsByRequiredLift.get(req)
					if (cached) return cached
					const segs = planStandardSegmentsForRequiredLiftIndex(req)
					segmentsByRequiredLift.set(req, segs)
					return segs
				}
				const oldRequiredForKey = (k: string) => Math.max(
					otherMaxRequiredLiftByKey.get(k) ?? 0,
					oldPlan.requiredStandardLiftIndex,
				)
				const nextRequiredForKey = (k: string) => Math.max(
					otherMaxRequiredLiftByKey.get(k) ?? 0,
					nextPlan.requiredStandardLiftIndex,
				)

				// Preserve manual edits:
				// - If a "managed" stack no longer exists at that key, treat it as suppressed (user deleted/moved it).
				// - If a "managed" stack no longer matches the per-key baseline (max-of-blocks), stop managing it.
			for (const k of Array.from(managedStacks)) {
				const s = stackByKey.get(k)
				if (!s) {
					managedStacks.delete(k)
					suppressedStacks.add(k)
					continue
				}
				const jackMatches = Number(s.jackExtensionIn) === Number(base.jackExtensionIn)
						const expectedOldSegments = segmentsForRequiredLiftIndex(oldRequiredForKey(k))
						// Treat stacks as baseline-managed if they match the expected segment plan exactly OR
						// are a *prefix* of it (e.g., a previously under-built/partially-extended stack).
						// If the stack is taller than expected (expected is a prefix of stack), we still treat
						// it as a manual edit and stop managing to avoid deleting user-added segments.
						const looksBaseline = jackMatches && segmentsPrefix(s, expectedOldSegments)
				if (!looksBaseline) {
					managedStacks.delete(k)
				}
			}

			// Clean up managed ledger keys: if an edge no longer exists, mark it suppressed.
			// (This complements runtime suppression when the user deletes a ledger.)
			const stacksNowByKey = () => {
				const map = new Map<string, string>()
				for (const s of scaffoldStacksRef.current) {
					map.set(posKey2(s.gridPosition.x, s.gridPosition.y), s.id)
				}
				return map
			}
			const stackIdByKey = stacksNowByKey()
			const hasConnection = (stackKeyA: string, stackKeyB: string, liftIndexA: number, liftIndexB = liftIndexA) => {
				const aId = stackIdByKey.get(stackKeyA)
				const bId = stackIdByKey.get(stackKeyB)
				if (!aId || !bId) return false
				return ledgerConnectionsRef.current.some(c => {
					const sa = c.startNode.stackId
					const sb = c.endNode.stackId
					const liA = c.startNode.liftIndex
					const liB = c.endNode.liftIndex
					const direct = sa === aId && sb === bId && liA === liftIndexA && liB === liftIndexB
					const reverse = sa === bId && sb === aId && liA === liftIndexB && liB === liftIndexA
					return direct || reverse
				})
			}
			for (const k of Array.from(managedLedgers)) {
				const parsed = parseLedgerConnectionKey(k)
				if (!parsed || !hasConnection(parsed.stackKeyA, parsed.stackKeyB, parsed.liftIndexA, parsed.liftIndexB)) {
					managedLedgers.delete(k)
					suppressedLedgers.add(k)
				}
			}

			// --- Adjacency detection & anchor logic for chain connectivity ---
			// Compute old block's world-space bounding box.
			const rotIsOdd = (((block.rotationSteps ?? 0) % 4) + 4) % 4 % 2 === 1
			const oldWorldW = rotIsOdd ? block.depthFt : block.widthFt
			const oldWorldD = rotIsOdd ? block.widthFt : block.depthFt
			const oldXMin = block.center.x - oldWorldW / 2
			const oldXMax = block.center.x + oldWorldW / 2
			const oldYMin = block.center.y - oldWorldD / 2
			const oldYMax = block.center.y + oldWorldD / 2

			const newWorldW = rotIsOdd ? nextDepthFt : nextWidthFt
			const newWorldD = rotIsOdd ? nextWidthFt : nextDepthFt
			const explicitCenter = params.center
			const hasExplicitCenter = !!explicitCenter
				&& Number.isFinite(Number(explicitCenter.x))
				&& Number.isFinite(Number(explicitCenter.y))

			// Check which edges of the old block are adjacent to other blocks.
			const edgeTol = 0.05 // ~0.6 inches tolerance
			let anchorLeft = false, anchorRight = false, anchorBottom = false, anchorTop = false
			if (!hasExplicitCenter) {
				for (const other of scaffoldBlocksRef.current) {
					if (other.id === blockId) continue
					const oRotOdd = (((other.rotationSteps ?? 0) % 4) + 4) % 4 % 2 === 1
					const oW = oRotOdd ? other.depthFt : other.widthFt
					const oD = oRotOdd ? other.widthFt : other.depthFt
					const oXMin = other.center.x - oW / 2
					const oXMax = other.center.x + oW / 2
					const oYMin = other.center.y - oD / 2
					const oYMax = other.center.y + oD / 2
					// Check Y overlap (perpendicular to X edges)
					const yOverlap = oldYMin < oYMax - edgeTol && oldYMax > oYMin + edgeTol
					// Check X overlap (perpendicular to Y edges)
					const xOverlap = oldXMin < oXMax - edgeTol && oldXMax > oXMin + edgeTol
					// Right edge of this block touches left edge of other
					if (yOverlap && Math.abs(oldXMax - oXMin) < edgeTol) anchorRight = true
					// Left edge of this block touches right edge of other
					if (yOverlap && Math.abs(oldXMin - oXMax) < edgeTol) anchorLeft = true
					// Top edge of this block touches bottom edge of other
					if (xOverlap && Math.abs(oldYMax - oYMin) < edgeTol) anchorTop = true
					// Bottom edge of this block touches top edge of other
					if (xOverlap && Math.abs(oldYMin - oYMax) < edgeTol) anchorBottom = true
				}
			}

			// Compute new center: anchor connected edges, adjust opposite side.
			let newCenterX = block.center.x
			let newCenterY = block.center.y
			if (hasExplicitCenter) {
				newCenterX = Number(explicitCenter!.x)
				newCenterY = Number(explicitCenter!.y)
			} else if (anchorRight && !anchorLeft) {
				// Keep right edge fixed: newXMax = oldXMax → newCenter = oldXMax - newWorldW/2
				newCenterX = oldXMax - newWorldW / 2
			} else if (anchorLeft && !anchorRight) {
				// Keep left edge fixed: newXMin = oldXMin → newCenter = oldXMin + newWorldW/2
				newCenterX = oldXMin + newWorldW / 2
			} else if (anchorLeft && anchorRight) {
				// Both sides connected: keep left edge anchored (professional default)
				newCenterX = oldXMin + newWorldW / 2
			}
			// else: no X adjacency, keep center (default)

			if (!hasExplicitCenter && anchorTop && !anchorBottom) {
				newCenterY = oldYMax - newWorldD / 2
			} else if (!hasExplicitCenter && anchorBottom && !anchorTop) {
				newCenterY = oldYMin + newWorldD / 2
			} else if (!hasExplicitCenter && anchorBottom && anchorTop) {
				newCenterY = oldYMin + newWorldD / 2
			}

			const newCenter = { x: newCenterX, y: newCenterY }

			// --- Desired stack keys for the resized block (using new center) ---
			const cx = nextWidthFt / 2
			const cy = nextDepthFt / 2
			const desiredKeys: string[][] = []
			for (let j = 0; j <= baysY; j++) {
				const row: string[] = []
				for (let i = 0; i <= baysX; i++) {
					const local = { x: i * spacingXFt - cx, y: j * spacingYFt - cy }
					const r = block.rotationSteps ? (() => {
						const s = ((block.rotationSteps % 4) + 4) % 4
						if (s === 0) return local
						if (s === 1) return { x: -local.y, y: local.x }
						if (s === 2) return { x: -local.x, y: -local.y }
						return { x: local.y, y: -local.x }
					})() : local
					const x = newCenter.x + r.x
					const y = newCenter.y + r.y
					row.push(posKey2(x, y))
				}
				desiredKeys.push(row)
			}

			// --- Remove obsolete managed members when block shrinks ---
			const desiredStackKeys = new Set<string>()
			for (const row of desiredKeys) {
				for (const k of row) desiredStackKeys.add(k)
			}

			// Build set of stack/ledger keys managed by OTHER blocks (shared members stay).
			const sharedStackKeys = new Set<string>()
			const sharedLedgerKeys = new Set<string>()
			for (const other of scaffoldBlocksRef.current) {
				if (other.id === blockId) continue
				for (const k of other.managedStackKeys ?? []) sharedStackKeys.add(k)
				for (const k of other.managedLedgerKeys ?? []) sharedLedgerKeys.add(k)
			}

			// Find managed stacks that are NOT in the new footprint.
			const obsoleteStackKeys = new Set<string>()
			for (const k of managedStacks) {
				if (!desiredStackKeys.has(k)) obsoleteStackKeys.add(k)
			}

			// Remove obsolete managed ledgers first (before removing stacks).
			// A managed ledger is obsolete if either endpoint is an obsolete stack key.
			const obsoleteLedgerKeys = new Set<string>()
			for (const k of managedLedgers) {
				const parsed = parseLedgerConnectionKey(k)
				if (!parsed) {
					obsoleteLedgerKeys.add(k)
					continue
				}
				if (obsoleteStackKeys.has(parsed.stackKeyA) || obsoleteStackKeys.has(parsed.stackKeyB)) {
					obsoleteLedgerKeys.add(k)
				}
			}
			// Also check: managed ledgers whose BOTH endpoints are in the desired set
			// but the ledger key itself is not part of the new grid (edges between old bays that
			// no longer exist). We'll compute desired ledger keys to check.
			const desiredLedgerKeys = new Set<string>()
			for (const liftIndex of nextPlan.ledgerLiftIndices) {
				for (let j = 0; j <= baysY; j++) {
					for (let i = 0; i < baysX; i++) {
						const ka = desiredKeys[j]?.[i]; const kb = desiredKeys[j]?.[i + 1]
						if (ka && kb) desiredLedgerKeys.add(makeLedgerKey(ka, kb, liftIndex))
					}
				}
				for (let j = 0; j < baysY; j++) {
					for (let i = 0; i <= baysX; i++) {
						const ka = desiredKeys[j]?.[i]; const kb = desiredKeys[j + 1]?.[i]
						if (ka && kb) desiredLedgerKeys.add(makeLedgerKey(ka, kb, liftIndex))
					}
				}
			}
			for (const k of managedLedgers) {
				if (!desiredLedgerKeys.has(k)) obsoleteLedgerKeys.add(k)
			}

			// Remove obsolete ledger connections.
			if (obsoleteLedgerKeys.size > 0) {
				const keyToConnId = new Map<string, string>()
				for (const c of ledgerConnectionsRef.current) {
					const sa = scaffoldStacksRef.current.find(s => s.id === c.startNode.stackId)
					const sb = scaffoldStacksRef.current.find(s => s.id === c.endNode.stackId)
					if (!sa || !sb) continue
					const ka = posKey2(sa.gridPosition.x, sa.gridPosition.y)
					const kb = posKey2(sb.gridPosition.x, sb.gridPosition.y)
					const lk = makeLedgerConnectionKey(ka, c.startNode.liftIndex, kb, c.endNode.liftIndex)
					keyToConnId.set(lk, c.id)
				}
				const connIdsToRemove = new Set<string>()
						for (const k of obsoleteLedgerKeys) {
							// Always drop this block's ownership of the ledger if it's no longer in its plan.
							managedLedgers.delete(k)
							if (sharedLedgerKeys.has(k)) continue // don't remove shared ledger connections
							const cid = keyToConnId.get(k)
							if (cid) connIdsToRemove.add(cid)
						}
				if (connIdsToRemove.size > 0) {
					setLedgerConnections(prev => prev.filter(c => !connIdsToRemove.has(c.id)))
				}
			}

			// Remove obsolete stacks (and their remaining ledger connections).
			if (obsoleteStackKeys.size > 0) {
				const stackIdsToRemove = new Set<string>()
					for (const k of obsoleteStackKeys) {
						// Always drop this block's ownership of the stack when it leaves the footprint.
						managedStacks.delete(k)
						if (sharedStackKeys.has(k)) continue // don't remove shared stacks from the model
						const s = stackByKey.get(k)
						if (s) {
							stackIdsToRemove.add(s.id)
							stackByKey.delete(k) // keep local map in sync
						}
					}
				if (stackIdsToRemove.size > 0) {
					setLedgerConnections(prev => prev.filter(c =>
						!stackIdsToRemove.has(c.startNode.stackId) && !stackIdsToRemove.has(c.endNode.stackId)
					))
					setScaffoldStacks(prev => prev.filter(s => !stackIdsToRemove.has(s.id)))
				}
			}

				// --- Add/adopt missing stacks and update baseline-managed stacks (extend or shorten) ---
			for (let j = 0; j < desiredKeys.length; j++) {
				for (let i = 0; i < desiredKeys[j].length; i++) {
					const k = desiredKeys[j][i]
					if (suppressedStacks.has(k)) continue
						const desiredSegments = segmentsForRequiredLiftIndex(nextRequiredForKey(k))
					const s = stackByKey.get(k)
					if (s) {
							// If this key is managed by this block, update to the per-key desired max-height plan.
						if (managedStacks.has(k)) {
									// If the stack still matches the old baseline plan, it's safe to fully replace the
									// segment list even when the new optimal plan has a different mix (not prefix-related).
									const expectedOldSegments = segmentsForRequiredLiftIndex(oldRequiredForKey(k))
									const isBaselineOld = segmentsEqual(s, expectedOldSegments)
									if (segmentsEqual(s, desiredSegments)) {
										// already correct
									}
									// Safe extend: current stack is a prefix of desired plan.
									else if (segmentsPrefix(s, desiredSegments)) {
										const segCount = s.standardSegments?.length ?? 0
										for (let idx = segCount; idx < desiredSegments.length; idx++) {
											appendStandardSegmentToStack(s.id, desiredSegments[idx])
										}
										stackByKey.set(k, { ...s, standardSegments: desiredSegments.map(partNumber => ({ partNumber })) } as any)
									}
									// Safe shorten: desired plan is a prefix of current stack.
									else if (planPrefixOfStack(s, desiredSegments)) {
										setStandardSegmentsForStack(s.id, desiredSegments)
										stackByKey.set(k, { ...s, standardSegments: desiredSegments.map(partNumber => ({ partNumber })) } as any)
									}
									// Full re-plan: old stack was auto/baseline, but new plan differs in composition.
									else if (isBaselineOld) {
										setStandardSegmentsForStack(s.id, desiredSegments)
										stackByKey.set(k, { ...s, standardSegments: desiredSegments.map(partNumber => ({ partNumber })) } as any)
									}
									// Otherwise treat as manual edit and stop managing.
									else {
										managedStacks.delete(k)
									}
						} else {
								// New footprint covers an existing stack. Only "adopt" it if it looks compatible.
							const jackMatches = Number(s.jackExtensionIn) === Number(base.jackExtensionIn)
								if (jackMatches && segmentsPrefix(s, desiredSegments)) {
								managedStacks.add(k)
									const segCount = s.standardSegments?.length ?? 0
									for (let idx = segCount; idx < desiredSegments.length; idx++) {
										appendStandardSegmentToStack(s.id, desiredSegments[idx])
									}
									stackByKey.set(k, { ...s, standardSegments: desiredSegments.map(partNumber => ({ partNumber })) } as any)
							}
						}
						continue
					}

					// Create new stack at this position.
					const [xStr, yStr] = k.split(':')
					const x = Number(xStr)
					const y = Number(yStr)
					if (!Number.isFinite(x) || !Number.isFinite(y)) continue
						const first = (desiredSegments[0] as any) ?? 'US66'
					const created = addScaffoldStack(new THREE.Vector3(x, y, 0), first, base.jackExtensionIn, { baseSupport: 'grid' })
						for (let idx = 1; idx < desiredSegments.length; idx++) {
							appendStandardSegmentToStack(created.id, desiredSegments[idx])
					}
						stackByKey.set(k, { ...created, standardSegments: desiredSegments.map(partNumber => ({ partNumber })) } as any)
					managedStacks.add(k)
				}
			}

			// Refresh stackId lookup (in case we created new stacks).
			// IMPORTANT: do not rely on scaffoldStacksRef here; state updates from addScaffoldStack()
			// won't have propagated within this synchronous callback.
			const stackIdByKeyAfter = new Map<string, string>()
			for (const [k, s] of stackByKey.entries()) {
				stackIdByKeyAfter.set(k, s.id)
			}

			// Create missing ledgers for the resized block.
			const nextManagedLedgers = new Set<string>(managedLedgers)
			for (const liftIndex of nextPlan.ledgerLiftIndices) {
				// X direction
				for (let j = 0; j <= baysY; j++) {
					for (let i = 0; i < baysX; i++) {
						const ka = desiredKeys[j]?.[i]
						const kb = desiredKeys[j]?.[i + 1]
						if (!ka || !kb) continue
						const ledgerKey = makeLedgerKey(ka, kb, liftIndex)
						if (suppressedLedgers.has(ledgerKey)) continue
						const aId = stackIdByKeyAfter.get(ka)
						const bId = stackIdByKeyAfter.get(kb)
						if (!aId || !bId) continue
						addLedgerConnection({ stackId: aId, liftIndex }, { stackId: bId, liftIndex }, ledgerPartNumberX)
						nextManagedLedgers.add(ledgerKey)
					}
				}

				// Y direction
				for (let j = 0; j < baysY; j++) {
					for (let i = 0; i <= baysX; i++) {
						const ka = desiredKeys[j]?.[i]
						const kb = desiredKeys[j + 1]?.[i]
						if (!ka || !kb) continue
						const ledgerKey = makeLedgerKey(ka, kb, liftIndex)
						if (suppressedLedgers.has(ledgerKey)) continue
						const aId = stackIdByKeyAfter.get(ka)
						const bId = stackIdByKeyAfter.get(kb)
						if (!aId || !bId) continue
						addLedgerConnection({ stackId: aId, liftIndex }, { stackId: bId, liftIndex }, ledgerPartNumberY)
						nextManagedLedgers.add(ledgerKey)
					}
				}
			}

			// Commit updated block metadata (including new center for chain connectivity).
			setScaffoldBlocks(prev => prev.map(b => {
				if (b.id !== blockId) return b
				return {
					...b,
					center: newCenter,
					widthFt: nextWidthFt,
					depthFt: nextDepthFt,
					heightFt: nextHeightFt,
						plankedLevelsCount: nextPlankedLevelsCount,
						includeBaseDeck: nextIncludeBaseDeck,
						...(block.liveLoadPsf !== undefined ? { liveLoadPsf: block.liveLoadPsf } : {}),
						...(nextLiveLoadDeckLiftIndices.length > 0 ? { liveLoadDeckLiftIndices: nextLiveLoadDeckLiftIndices } : { liveLoadDeckLiftIndices: undefined }),
						...(nextLiveLoadExcludedBayKeys.length > 0 ? { liveLoadExcludedBayKeys: nextLiveLoadExcludedBayKeys } : { liveLoadExcludedBayKeys: undefined }),
						braceFrontBack: nextBraceFrontBack,
						braceLeftRight: nextBraceLeftRight,
					ledgerEveryNRosettes: nextLedgerEveryN,
					managedStackKeys: Array.from(managedStacks),
					managedLedgerKeys: Array.from(nextManagedLedgers),
					...(suppressedStacks.size > 0 ? { suppressedStackKeys: Array.from(suppressedStacks) } : {}),
					...(suppressedLedgers.size > 0 ? { suppressedLedgerKeys: Array.from(suppressedLedgers) } : {}),
					...(Array.isArray(block.suppressedDiagonalKeys) && block.suppressedDiagonalKeys.length > 0
						? { suppressedDiagonalKeys: block.suppressedDiagonalKeys.slice() }
						: {}),
					updatedAt: Date.now(),
				}
			}))
			}, [addLedgerConnection, addScaffoldStack, appendStandardSegmentToStack, applySupportAwareScaffoldBlockEdits, makeLedgerKey, setStandardSegmentsForStack])

	const performMovedBlockArtifactCleanup = useCallback((params: {
		previousManagedStackKeys?: string[]
		previousManagedLedgerKeys?: string[]
	}) => {
		const normalizeStackKey = (key: string) => parseStackPositionKey(String(key))?.exactKey ?? String(key)
		const normalizeLedgerKey = (key: string) => {
			const parsed = parseLedgerConnectionKey(String(key))
			if (!parsed) return String(key)
			return makeLedgerConnectionKey(
				normalizeStackKey(parsed.stackKeyA),
				parsed.liftIndexA,
				normalizeStackKey(parsed.stackKeyB),
				parsed.liftIndexB,
			)
		}

		const candidateStackKeys = new Set(
			(params.previousManagedStackKeys ?? [])
				.map(value => normalizeStackKey(String(value)))
				.filter(Boolean),
		)
		const candidateLedgerKeys = new Set(
			(params.previousManagedLedgerKeys ?? [])
				.map(value => normalizeLedgerKey(String(value)))
				.filter(Boolean),
		)
		if (candidateStackKeys.size === 0 && candidateLedgerKeys.size === 0) return

		const activeManagedStackKeys = new Set<string>()
		const activeManagedLedgerKeys = new Set<string>()
		for (const block of scaffoldBlocksRef.current) {
			const suppressedStackKeys = new Set(
				(block.suppressedStackKeys ?? []).map(value => normalizeStackKey(String(value))),
			)
			for (const rawKey of block.managedStackKeys ?? []) {
				const key = normalizeStackKey(String(rawKey))
				if (!suppressedStackKeys.has(key)) activeManagedStackKeys.add(key)
			}

			const suppressedLedgerKeys = new Set(
				(block.suppressedLedgerKeys ?? []).map(value => normalizeLedgerKey(String(value))),
			)
			for (const rawKey of block.managedLedgerKeys ?? []) {
				const key = normalizeLedgerKey(String(rawKey))
				if (!suppressedLedgerKeys.has(key)) activeManagedLedgerKeys.add(key)
			}
		}

		let nextConnections = ledgerConnectionsRef.current
		const removedConnectionIds = new Set<string>()
		if (candidateLedgerKeys.size > 0) {
			const stackById = new Map(scaffoldStacksRef.current.map(stack => [stack.id, stack] as const))
			nextConnections = nextConnections.filter(connection => {
				const startStack = stackById.get(connection.startNode.stackId)
				const endStack = stackById.get(connection.endNode.stackId)
				if (!startStack || !endStack) return true
				const ledgerKey = normalizeLedgerKey(makeLedgerConnectionKey(
					makeStackPositionKey(startStack.gridPosition.x, startStack.gridPosition.y, startStack.gridPosition.z),
					connection.startNode.liftIndex,
					makeStackPositionKey(endStack.gridPosition.x, endStack.gridPosition.y, endStack.gridPosition.z),
					connection.endNode.liftIndex,
				))
				if (!candidateLedgerKeys.has(ledgerKey)) return true
				if (activeManagedLedgerKeys.has(ledgerKey)) return true
				removedConnectionIds.add(connection.id)
				return false
			})
			if (removedConnectionIds.size > 0) {
				ledgerConnectionsRef.current = nextConnections
				setLedgerConnections(nextConnections)
				setManualPlankPlacements(prev => prev.filter(placement => !removedConnectionIds.has(placement.supportLedgerId)))
				setManualLiveLoadPlacements(prev => prev.filter(placement => !removedConnectionIds.has(placement.supportLedgerId)))
				setSelectedObjectId(prev => (
					prev?.startsWith('ledger-') && removedConnectionIds.has(prev.slice('ledger-'.length))
						? null
						: prev
				))
			}
		}

		const removedStackIds = new Set<string>()
		if (candidateStackKeys.size > 0) {
			const nextStacks = scaffoldStacksRef.current.filter(stack => {
				const stackKey = normalizeStackKey(
					makeStackPositionKey(stack.gridPosition.x, stack.gridPosition.y, stack.gridPosition.z),
				)
				if (!candidateStackKeys.has(stackKey)) return true
				if (activeManagedStackKeys.has(stackKey)) return true
				removedStackIds.add(stack.id)
				return false
			})
			if (removedStackIds.size > 0) {
				const filteredConnections = nextConnections.filter(connection => (
					!removedStackIds.has(connection.startNode.stackId) && !removedStackIds.has(connection.endNode.stackId)
				))
				if (filteredConnections.length !== nextConnections.length) {
					const additionallyRemovedConnectionIds = new Set(
						nextConnections
							.filter(connection => (
								removedStackIds.has(connection.startNode.stackId) || removedStackIds.has(connection.endNode.stackId)
							))
							.map(connection => connection.id),
					)
					nextConnections = filteredConnections
					ledgerConnectionsRef.current = nextConnections
					setLedgerConnections(nextConnections)
					setManualPlankPlacements(prev => prev.filter(placement => !additionallyRemovedConnectionIds.has(placement.supportLedgerId)))
					setManualLiveLoadPlacements(prev => prev.filter(placement => !additionallyRemovedConnectionIds.has(placement.supportLedgerId)))
					setSelectedObjectId(prev => (
						prev?.startsWith('ledger-') && additionallyRemovedConnectionIds.has(prev.slice('ledger-'.length))
							? null
							: prev
					))
				}
				scaffoldStacksRef.current = nextStacks
				setScaffoldStacks(nextStacks)
				setSelectedStackIds(prev => prev.filter(id => !removedStackIds.has(id)))
				setSelectedObjectId(prev => {
					if (!prev) return prev
					if (prev.startsWith('standard-') && removedStackIds.has(prev.slice('standard-'.length).split('@')[0] ?? '')) return null
					if (prev.startsWith('wood-sill-') && removedStackIds.has(prev.slice('wood-sill-'.length).split('@')[0] ?? '')) return null
					if (prev.startsWith('screw-jack-') && removedStackIds.has(prev.slice('screw-jack-'.length).split('@')[0] ?? '')) return null
					if (prev.startsWith('base-collar-') && removedStackIds.has(prev.slice('base-collar-'.length).split('@')[0] ?? '')) return null
					return prev
				})
			}
		}
	}, [setSelectedObjectId])

	const cleanupMovedBlockArtifacts = useCallback((params: {
		previousManagedStackKeys?: string[]
		previousManagedLedgerKeys?: string[]
	}) => {
		const previousManagedStackKeys = Array.from(new Set(
			(params.previousManagedStackKeys ?? []).map(value => String(value)).filter(Boolean),
		))
		const previousManagedLedgerKeys = Array.from(new Set(
			(params.previousManagedLedgerKeys ?? []).map(value => String(value)).filter(Boolean),
		))
		if (previousManagedStackKeys.length === 0 && previousManagedLedgerKeys.length === 0) return
		setPendingMovedBlockArtifactCleanup({
			previousManagedStackKeys,
			previousManagedLedgerKeys,
		})
	}, [])

	  const removeLedgerConnection = useCallback((connectionId: string) => {
			// If this ledger was managed by any block, treat deletion as a suppression so updates won't re-add it.
			const conn = ledgerConnectionsRef.current.find(c => c.id === connectionId)
			if (conn) {
				const startStack = scaffoldStacksRef.current.find(s => s.id === conn.startNode.stackId)
				const endStack = scaffoldStacksRef.current.find(s => s.id === conn.endNode.stackId)
				if (startStack && endStack) {
					const ka = makeStackPositionKey(startStack.gridPosition.x, startStack.gridPosition.y, startStack.gridPosition.z)
					const kb = makeStackPositionKey(endStack.gridPosition.x, endStack.gridPosition.y, endStack.gridPosition.z)
					const k = makeLedgerConnectionKey(ka, conn.startNode.liftIndex, kb, conn.endNode.liftIndex)
					suppressLedgerKeyInBlocks(k)
				}
			}
	    setLedgerConnections(prev => prev.filter(c => c.id !== connectionId))
			setManualPlankPlacements(prev => prev.filter(p => p.supportLedgerId !== connectionId))
			setManualLiveLoadPlacements(prev => prev.filter(p => p.supportLedgerId !== connectionId))
	    if (selectedObjectId?.startsWith(`ledger-${connectionId}`)) {
	      setSelectedObjectId(null)
	    }
	  }, [selectedObjectId, makeLedgerKey, suppressLedgerKeyInBlocks])

	const removeManualPlankPlacement = useCallback((placementId: string) => {
		setManualPlankPlacements(prev => prev.filter(p => p.id !== placementId))
	}, [])

	const updateManualLiveLoadPlacement = useCallback((
		placementId: string,
		partial: Partial<Pick<ManualLiveLoadPlacement, 'magnitudePsf'>>,
	) => {
		setManualLiveLoadPlacements(prev => prev.map(placement => {
			if (placement.id !== placementId) return placement
			const nextMagnitudePsf = partial.magnitudePsf
			if (nextMagnitudePsf !== undefined) {
				if (!Number.isFinite(nextMagnitudePsf) || nextMagnitudePsf <= 0) return placement
				return { ...placement, magnitudePsf: nextMagnitudePsf }
			}
			return placement
		}))
	}, [])

	const removeManualLiveLoadPlacement = useCallback((placementId: string) => {
		setManualLiveLoadPlacements(prev => prev.filter(p => p.id !== placementId))
		setSelectedObjectId(prev => {
			if (prev === `live-load-${placementId}`) return null
			return prev
		})
	}, [setSelectedObjectId])

	useEffect(() => {
		const ledgerIds = new Set(ledgerConnections.map(conn => conn.id))
		setManualPlankPlacements(prev => {
			const next = prev.filter(p => ledgerIds.has(p.supportLedgerId))
			return next.length === prev.length ? prev : next
		})
		setManualLiveLoadPlacements(prev => {
			const next = prev.filter(p => ledgerIds.has(p.supportLedgerId))
			return next.length === prev.length ? prev : next
		})
	}, [ledgerConnections])

	useEffect(() => {
		if (!selectedObjectId?.startsWith('live-load-')) return
		const placementId = selectedObjectId.replace('live-load-', '')
		if (manualLiveLoadPlacements.some(placement => placement.id === placementId)) return
		setSelectedObjectId(null)
	}, [manualLiveLoadPlacements, selectedObjectId, setSelectedObjectId])

		// --- Combined-footprint perimeter guardrails (auto-managed) ---
		useEffect(() => {
			// Nothing to do if there are no blocks/stacks yet (or during transient placement updates).
			if (scaffoldBlocks.length === 0) return
			if (scaffoldStacks.length === 0) return

			const blocks = scaffoldBlocks
			const stacks = scaffoldStacks

			// Keep managedGuardrailLedgerKeys consolidated on the oldest block to reduce payload size.
			const owner = blocks
				.slice()
				.sort((a, b) => {
					const da = Number(a.createdAt ?? 0)
					const db = Number(b.createdAt ?? 0)
					if (da !== db) return da - db
					return String(a.id).localeCompare(String(b.id))
				})[0]
			if (!owner) return

			const suppressedLedgerKeys = new Set<string>()
			for (const b of blocks) for (const k of b.suppressedLedgerKeys ?? []) suppressedLedgerKeys.add(String(k))

			// Existing managed guardrails may live on any block (older data); we'll consolidate later.
			const existingManagedGuardrailKeys = new Set<string>()
			for (const b of blocks) for (const k of b.managedGuardrailLedgerKeys ?? []) existingManagedGuardrailKeys.add(String(k))

				// Build a map: design-deck lift -> rects that actually have a working deck at that lift.
				// Each stack still resolves its own local lift for that shared world-elevation deck.
				const rectForBlock = (b: ScaffoldBlockInstance) => {
					const rr = (((b.rotationSteps ?? 0) % 4) + 4) % 4
					const rotIsOdd = rr % 2 === 1
					const worldW = rotIsOdd ? b.depthFt : b.widthFt
					const worldD = rotIsOdd ? b.widthFt : b.depthFt
					return {
						xMin: b.center.x - worldW / 2,
						xMax: b.center.x + worldW / 2,
						yMin: b.center.y - worldD / 2,
						yMax: b.center.y + worldD / 2,
					}
				}
				const rectsByDeckLift = new Map<number, ReturnType<typeof rectForBlock>[]>()
				const preferredSupportSpecsByKey = new Map<string, SupportAwareStackSpec>()
				for (const b of blocks) {
					const layout = resolveSupportAwareBlockLayout({
						centerX: b.center.x,
						centerY: b.center.y,
						recipe: buildSupportAwareRecipeFromBlock(b),
						objects,
						supportSurfaces: buildingSupportSurfaces,
						cutVolumes: buildingCutVolumes,
					})
					const r = rectForBlock(b)
					const supportedDeckLifts = (layout.nominalPlan.workingDeckLiftIndices ?? []).filter((rawLift) => {
						const designLift = Number(rawLift)
						if (!Number.isFinite(designLift) || designLift < 0) return false
						for (const spec of layout.stackSpecsByKey.values()) {
							if (!spec.designLiftToLocalLift.has(designLift)) return false
						}
						return true
					})
					for (const rawLift of supportedDeckLifts) {
						const designLift = Number(rawLift)
						if (!Number.isFinite(designLift) || designLift < 0) continue
						const list = rectsByDeckLift.get(designLift) ?? []
						list.push(r)
						rectsByDeckLift.set(designLift, list)
					}
					for (const [stackKey, spec] of layout.stackSpecsByKey.entries()) {
						preferredSupportSpecsByKey.set(
							stackKey,
							choosePreferredSupportAwareStackSpec(preferredSupportSpecsByKey.get(stackKey), spec)!,
						)
					}
				}
				const designLiftLocalLiftByStackKey = new Map<string, Map<number, number>>()
				for (const [stackKey, spec] of preferredSupportSpecsByKey.entries()) {
					designLiftLocalLiftByStackKey.set(stackKey, new Map(spec.designLiftToLocalLift))
				}
				// If no working decks fit at all, we still continue so we can remove any previously-managed
				// guardrail connections (desired set will remain empty).

			const round = (v: number, precision = 1000) => Math.round(v * precision) / precision
			const lineTol = 1 / 1000 // 0.001 ft (~0.012")
			const maxSpanFt = 10.5 // UH100 is 10'

			type StackInfo = {
				id: string
				key: string
				x: number
				y: number
				maxLiftIndex: number
			}
			const getMaxLiftIndex = (s: ScaffoldStack): number => {
				const segs = Array.isArray((s as any).standardSegments) ? (s as any).standardSegments : []
				let total = 0
				for (const seg of segs) {
					const pn = String(seg?.partNumber ?? '') as UniversalRinglockStandardId
					const spec = UNIVERSAL_RINGLOCK_STANDARDS[pn]
					if (!spec) continue
					total += Number(spec.rosetteCount ?? 0)
				}
				return Math.max(0, Math.floor(total))
			}

			const stackInfos: StackInfo[] = stacks.map(s => {
				const x = Number(s.gridPosition.x)
				const y = Number(s.gridPosition.y)
				return {
					id: s.id,
					key: makeStackPositionKey(x, y, Number(s.gridPosition.z)),
					x,
					y,
					maxLiftIndex: getMaxLiftIndex(s),
				}
			})
			const stacksByY = new Map<number, StackInfo[]>()
			const stacksByX = new Map<number, StackInfo[]>()
			const stackKeyById = new Map<string, string>()
			for (const si of stackInfos) {
				stackKeyById.set(si.id, si.key)
				const yk = round(si.y)
				const xk = round(si.x)
				stacksByY.set(yk, [...(stacksByY.get(yk) ?? []), si])
				stacksByX.set(xk, [...(stacksByX.get(xk) ?? []), si])
			}

				const edgesFromBoundary = (boundarySegments: ReturnType<typeof computeRectUnionBoundarySegments>) => {
					const perimeterEdges = new Map<string, { a: StackInfo; b: StackInfo; distFt: number }>()
					const addEdge = (a: StackInfo, b: StackInfo, distFt: number) => {
						const lo = a.key < b.key ? a : b
						const hi = a.key < b.key ? b : a
						const edgeKey = `${lo.key}|${hi.key}`
						if (perimeterEdges.has(edgeKey)) return
						perimeterEdges.set(edgeKey, { a: lo, b: hi, distFt })
					}

					for (const seg of boundarySegments) {
						if (seg.kind === 'H') {
							const y = round(seg.y)
							const minX = Math.min(seg.x0, seg.x1) - lineTol
							const maxX = Math.max(seg.x0, seg.x1) + lineTol
							const candidates = (stacksByY.get(y) ?? []).filter(s => Math.abs(s.y - y) <= lineTol && s.x >= minX && s.x <= maxX)
							candidates.sort((a, b) => a.x - b.x)
							for (let i = 0; i + 1 < candidates.length; i++) {
								const a = candidates[i]!
								const b = candidates[i + 1]!
								const dist = Math.abs(b.x - a.x)
								if (dist <= 1e-6 || dist > maxSpanFt) continue
								addEdge(a, b, dist)
							}
						} else {
							const x = round(seg.x)
							const minY = Math.min(seg.y0, seg.y1) - lineTol
							const maxY = Math.max(seg.y0, seg.y1) + lineTol
							const candidates = (stacksByX.get(x) ?? []).filter(s => Math.abs(s.x - x) <= lineTol && s.y >= minY && s.y <= maxY)
							candidates.sort((a, b) => a.y - b.y)
							for (let i = 0; i + 1 < candidates.length; i++) {
								const a = candidates[i]!
								const b = candidates[i + 1]!
								const dist = Math.abs(b.y - a.y)
								if (dist <= 1e-6 || dist > maxSpanFt) continue
								addEdge(a, b, dist)
							}
						}
					}

					return perimeterEdges
				}

			// Lookup: ledgerKey -> connectionId for existing connections.
			const keyToConnId = new Map<string, string>()
			for (const c of ledgerConnectionsRef.current) {
				const ka = stackKeyById.get(c.startNode.stackId)
				const kb = stackKeyById.get(c.endNode.stackId)
				if (!ka || !kb) continue
				const lk = makeLedgerConnectionKey(ka, c.startNode.liftIndex, kb, c.endNode.liftIndex)
				keyToConnId.set(lk, c.id)
			}

			type DesiredConn = {
				a: StackInfo
				b: StackInfo
				liftIndexA: number
				liftIndexB: number
				ledgerPartNumber: string
			}
			const desired = new Map<string, DesiredConn>()
				for (const [deckLiftIndex, rects] of rectsByDeckLift.entries()) {
					const boundary = computeRectUnionBoundarySegments(rects)
					if (boundary.length === 0) continue
					const perimeterEdges = edgesFromBoundary(boundary)
					if (perimeterEdges.size === 0) continue
					for (const { a, b, distFt } of perimeterEdges.values()) {
						for (const designLiftIndex of [deckLiftIndex + 1, deckLiftIndex + 2]) {
							if (!Number.isFinite(designLiftIndex) || designLiftIndex < 1) continue
							const liftIndexA = designLiftLocalLiftByStackKey.get(a.key)?.get(designLiftIndex)
							const liftIndexB = designLiftLocalLiftByStackKey.get(b.key)?.get(designLiftIndex)
							if (liftIndexA === undefined || liftIndexB === undefined) continue
							if (a.maxLiftIndex < liftIndexA || b.maxLiftIndex < liftIndexB) continue
							const ledgerKey = makeLedgerConnectionKey(a.key, liftIndexA, b.key, liftIndexB)
							if (suppressedLedgerKeys.has(ledgerKey)) continue
							const part = findClosestLedger(distFt * 12, 12, false) ?? 'UH70'
							desired.set(ledgerKey, {
								a,
								b,
								liftIndexA,
								liftIndexB,
								ledgerPartNumber: part,
							})
						}
					}
				}

			// Remove obsolete managed guardrail connections.
			const connIdsToRemove = new Set<string>()
			for (const k of existingManagedGuardrailKeys) {
				if (suppressedLedgerKeys.has(k)) continue
				if (desired.has(k)) continue
				const cid = keyToConnId.get(k)
				if (cid) connIdsToRemove.add(cid)
			}
			if (connIdsToRemove.size > 0) {
				setLedgerConnections(prev => prev.filter(c => !connIdsToRemove.has(c.id)))
			}

			// Add missing desired connections.
			const newlyManaged = new Set<string>()
			for (const [k, d] of desired) {
				if (keyToConnId.has(k)) continue
				addLedgerConnection(
					{ stackId: d.a.id, liftIndex: d.liftIndexA },
					{ stackId: d.b.id, liftIndex: d.liftIndexB },
					d.ledgerPartNumber,
				)
				newlyManaged.add(k)
			}

			const nextManaged = new Set<string>()
			for (const k of existingManagedGuardrailKeys) {
				if (suppressedLedgerKeys.has(k)) continue
				if (desired.has(k)) nextManaged.add(k)
			}
			for (const k of newlyManaged) nextManaged.add(k)

			const nextOwnerKeys = Array.from(nextManaged).sort()
			const sameArray = (a: string[] | undefined, b: string[]) => {
				const aa = Array.isArray(a) ? a.slice().sort() : []
				if (aa.length !== b.length) return false
				for (let i = 0; i < aa.length; i++) if (aa[i] !== b[i]) return false
				return true
			}

			setScaffoldBlocks(prev => {
				if (prev.length === 0) return prev
				const ownerPrev = prev.find(b => b.id === owner.id)
				const needsOwnerUpdate = !sameArray(ownerPrev?.managedGuardrailLedgerKeys, nextOwnerKeys)
				const anyNonOwnerHasKeys = prev.some(b => b.id !== owner.id && Array.isArray(b.managedGuardrailLedgerKeys) && b.managedGuardrailLedgerKeys.length > 0)
				if (!needsOwnerUpdate && !anyNonOwnerHasKeys) return prev

				let changed = false
				const next = prev.map(b => {
					if (b.id === owner.id) {
						if (!needsOwnerUpdate) return b
						changed = true
						return {
							...b,
							...(nextOwnerKeys.length > 0 ? { managedGuardrailLedgerKeys: nextOwnerKeys } : { managedGuardrailLedgerKeys: undefined }),
							updatedAt: Date.now(),
						}
					}
					if (b.id !== owner.id && Array.isArray(b.managedGuardrailLedgerKeys) && b.managedGuardrailLedgerKeys.length > 0) {
						changed = true
						return { ...b, managedGuardrailLedgerKeys: undefined, updatedAt: Date.now() }
					}
					return b
				})
				return changed ? next : prev
			})
		}, [addLedgerConnection, buildingCutVolumes, buildingSupportSurfaces, objects, scaffoldBlocks, scaffoldStacks])

  const clearScaffoldGraph = useCallback(() => {
    setScaffoldStacks([])
    setLedgerConnections([])
		setManualPlankPlacements([])
		setManualLiveLoadPlacements([])
    setScaffoldObjects([])
			setScaffoldBlocks([])
			setSelectedBlockIdRaw(null)
			setSelectedBlockIdsRaw([])
    setSelectedObjectId(null)
  }, [])

  // Get selected object (either SceneObject or ScaffoldObject)
  const getSelectedObject = useCallback((): SceneObject | ScaffoldObject | null => {
    if (!selectedObjectId) return null
    // Check scene objects first
    const sceneObj = objects.find(o => o.id === selectedObjectId)
    if (sceneObj) return sceneObj
    const buildingEntity = buildingEntities.find(entity => entity.id === selectedObjectId)
    if (buildingEntity && isBaseMassEntity(buildingEntity)) return buildSceneObjectFromBaseMassEntity(buildingEntity)
    // Check scaffold objects
    const scaffoldObj = scaffoldObjects.find(o => o.id === selectedObjectId)
    if (scaffoldObj) return scaffoldObj
    return null
  }, [selectedObjectId, objects, buildingEntities, scaffoldObjects])

  // Toggle stack selection (for multi-select with Ctrl+click)
  const toggleStackSelection = useCallback((stackId: string, additive: boolean) => {
    if (!additive) {
      // Single select: clear multi-select and set single selection
      setSelectedStackIds([stackId])
      setSelectedObjectId(`standard-${stackId}`)
    } else {
      // Additive (Ctrl+click): toggle in multi-select list
      setSelectedStackIds(prev => {
        if (prev.includes(stackId)) {
          return prev.filter(id => id !== stackId)
        } else {
          return [...prev, stackId]
        }
      })
    }
  }, [])

  // Get the currently selected scaffold stacks
  const getSelectedStacks = useCallback((): ScaffoldStack[] => {
    return scaffoldStacks.filter(s => selectedStackIds.includes(s.id))
  }, [scaffoldStacks, selectedStackIds])

  const addBuildingEntity = useCallback((entity: BuildingEntity) => {
    setBuildingEntities(prev => [...prev, entity])
    if (isBaseMassEntity(entity)) {
      const mirroredObject = buildSceneObjectFromBaseMassEntity(entity)
      setObjects(prev => {
        const next = prev.filter(object => object.id !== mirroredObject.id)
        next.push(mirroredObject)
        return next
      })
    }
  }, [])

  const updateBuildingEntity = useCallback((id: string, partial: Partial<BuildingEntity>) => {
    const existing = buildingEntities.find(entity => entity.id === id)
    if (!existing) return

    let nextEntity: BuildingEntity
    if (isBaseMassEntity(existing)) {
      const nextBaseEntity: BaseMassEntity = {
        ...existing,
        ...(partial as Partial<BaseMassEntity>),
        host: partial.host !== undefined ? partial.host : existing.host,
        position: (partial as Partial<BaseMassEntity>).position !== undefined
          ? (partial as Partial<BaseMassEntity>).position!
          : existing.position,
        rotationZRad: (partial as Partial<BaseMassEntity>).rotationZRad !== undefined
          ? Number((partial as Partial<BaseMassEntity>).rotationZRad)
          : existing.rotationZRad,
        color: partial.color !== undefined ? partial.color : existing.color,
        analysis: partial.analysis !== undefined
          ? cloneBuildingAnalysisFlags(partial.analysis)
          : cloneBuildingAnalysisFlags(existing.analysis),
        children: partial.children !== undefined ? [...partial.children] : [...existing.children],
        params: (partial as Partial<BaseMassEntity>).params !== undefined
          ? (partial as Partial<BaseMassEntity>).params!
          : existing.params,
        updatedAt: Date.now(),
      }
      nextEntity = nextBaseEntity
    } else if (isRoofEntity(existing)) {
      const nextRoofEntity: HostedRoofEntity = {
        ...existing,
        ...(partial as Partial<HostedRoofEntity>),
        host: (partial as Partial<HostedRoofEntity>).host !== undefined
          ? (partial as Partial<HostedRoofEntity>).host!
          : existing.host,
        color: partial.color !== undefined ? partial.color : existing.color,
        analysis: partial.analysis !== undefined
          ? cloneBuildingAnalysisFlags(partial.analysis)
          : cloneBuildingAnalysisFlags(existing.analysis),
        children: partial.children !== undefined ? [...partial.children] : [...existing.children],
        params: (partial as Partial<HostedRoofEntity>).params !== undefined
          ? (partial as Partial<HostedRoofEntity>).params!
          : existing.params,
        updatedAt: Date.now(),
      }
      nextEntity = nextRoofEntity
    } else if (isParapetEntity(existing)) {
      const nextParapetEntity: HostedParapetEntity = {
        ...existing,
        ...(partial as Partial<HostedParapetEntity>),
        host: (partial as Partial<HostedParapetEntity>).host !== undefined
          ? (partial as Partial<HostedParapetEntity>).host!
          : existing.host,
        color: partial.color !== undefined ? partial.color : existing.color,
        analysis: partial.analysis !== undefined
          ? cloneBuildingAnalysisFlags(partial.analysis)
          : cloneBuildingAnalysisFlags(existing.analysis),
        children: partial.children !== undefined ? [...partial.children] : [...existing.children],
        params: (partial as Partial<HostedParapetEntity>).params !== undefined
          ? (partial as Partial<HostedParapetEntity>).params!
          : existing.params,
        updatedAt: Date.now(),
      }
      nextEntity = nextParapetEntity
    } else if (isFeatureEntity(existing)) {
      if (existing.kind === 'top-feature') {
        const nextTopFeatureEntity: HostedTopFeatureEntity = {
          ...existing,
          ...(partial as Partial<HostedTopFeatureEntity>),
          host: (partial as Partial<HostedTopFeatureEntity>).host !== undefined
            ? (partial as Partial<HostedTopFeatureEntity>).host!
            : existing.host,
          color: partial.color !== undefined ? partial.color : existing.color,
          analysis: partial.analysis !== undefined
            ? cloneBuildingAnalysisFlags(partial.analysis)
            : cloneBuildingAnalysisFlags(existing.analysis),
          children: partial.children !== undefined ? [...partial.children] : [...existing.children],
          params: (partial as Partial<HostedTopFeatureEntity>).params !== undefined
            ? (partial as Partial<HostedTopFeatureEntity>).params!
            : existing.params,
          updatedAt: Date.now(),
        }
        nextEntity = nextTopFeatureEntity
      } else {
        const nextSideFeatureEntity: HostedSideFeatureEntity = {
          ...existing,
          ...(partial as Partial<HostedSideFeatureEntity>),
          host: (partial as Partial<HostedSideFeatureEntity>).host !== undefined
            ? (partial as Partial<HostedSideFeatureEntity>).host!
            : existing.host,
          color: partial.color !== undefined ? partial.color : existing.color,
          analysis: partial.analysis !== undefined
            ? cloneBuildingAnalysisFlags(partial.analysis)
            : cloneBuildingAnalysisFlags(existing.analysis),
          children: partial.children !== undefined ? [...partial.children] : [...existing.children],
          params: (partial as Partial<HostedSideFeatureEntity>).params !== undefined
            ? (partial as Partial<HostedSideFeatureEntity>).params!
            : existing.params,
          updatedAt: Date.now(),
        }
        nextEntity = nextSideFeatureEntity
      }
    } else if (isProxyEntity(existing)) {
      const nextProxyEntity: HostedProxyEntity = {
        ...existing,
        ...(partial as Partial<HostedProxyEntity>),
        host: (partial as Partial<HostedProxyEntity>).host !== undefined
          ? (partial as Partial<HostedProxyEntity>).host!
          : existing.host,
        color: partial.color !== undefined ? partial.color : existing.color,
        analysis: partial.analysis !== undefined
          ? cloneBuildingAnalysisFlags(partial.analysis)
          : cloneBuildingAnalysisFlags(existing.analysis),
        children: partial.children !== undefined ? [...partial.children] : [...existing.children],
        params: (partial as Partial<HostedProxyEntity>).params !== undefined
          ? (partial as Partial<HostedProxyEntity>).params!
          : existing.params,
        updatedAt: Date.now(),
      }
      nextEntity = nextProxyEntity
    } else if (isPatternEntity(existing)) {
      const nextPatternEntity: HostedPatternEntity = {
        ...existing,
        ...(partial as Partial<HostedPatternEntity>),
        host: (partial as Partial<HostedPatternEntity>).host !== undefined
          ? (partial as Partial<HostedPatternEntity>).host!
          : existing.host,
        color: partial.color !== undefined ? partial.color : existing.color,
        analysis: partial.analysis !== undefined
          ? cloneBuildingAnalysisFlags(partial.analysis)
          : cloneBuildingAnalysisFlags(existing.analysis),
        children: partial.children !== undefined ? [...partial.children] : [...existing.children],
        skippedInstanceIds: (partial as Partial<HostedPatternEntity>).skippedInstanceIds !== undefined
          ? [...((partial as Partial<HostedPatternEntity>).skippedInstanceIds ?? [])]
          : [...existing.skippedInstanceIds],
        instanceOverrides: (partial as Partial<HostedPatternEntity>).instanceOverrides !== undefined
          ? { ...((partial as Partial<HostedPatternEntity>).instanceOverrides ?? {}) }
          : { ...existing.instanceOverrides },
        params: (partial as Partial<HostedPatternEntity>).params !== undefined
          ? (partial as Partial<HostedPatternEntity>).params!
          : existing.params,
        updatedAt: Date.now(),
      }
      nextEntity = nextPatternEntity
    } else {
      return
    }

    setBuildingEntities(prev => prev.map(entity => (entity.id === id ? nextEntity : entity)))
    if (isBaseMassEntity(nextEntity)) {
      setObjects(prev => {
        const mirroredObject = buildSceneObjectFromBaseMassEntity(nextEntity)
        if (prev.some(object => object.id === id)) {
          return prev.map(object => (object.id === id ? mirroredObject : object))
        }
        return [...prev, mirroredObject]
      })
    }
  }, [buildingEntities])

  const removeBuildingEntity = useCallback((id: string) => {
    const idsToRemove = new Set<string>([id])
    let expanded = true
    while (expanded) {
      expanded = false
      for (const entity of buildingEntities) {
        if (idsToRemove.has(entity.id)) continue
        if (entity.host && idsToRemove.has(entity.host.entityId)) {
          idsToRemove.add(entity.id)
          expanded = true
        }
      }
    }

    setBuildingEntities(prev => prev
      .filter(entity => !idsToRemove.has(entity.id))
      .map(entity => ({
        ...entity,
        children: entity.children.filter(childId => !idsToRemove.has(childId)),
      })))
    setObjects(prev => prev.filter(object => !idsToRemove.has(object.id)))
    setSelectedBuildingEntityIdRaw(prev => (prev && idsToRemove.has(prev) ? null : prev))
    setSelectedObjectId(prev => (prev && idsToRemove.has(prev) ? null : prev))
  }, [buildingEntities, setSelectedObjectId])

  const addObject = useCallback((obj: SceneObject) => {
    setObjects(prev => [...prev, obj])
  }, [])

  const removeObject = useCallback((id: string) => {
    // Safety: only allow deletion inside the active workspace.
    const activeOwner = workspaceToOwner(workspaceMode)
    const target = objects.find(object => object.id === id)
    if (!target || target.workspace !== activeOwner) return
    setObjects(prev => prev.filter(o => !(o.id === id && o.workspace === activeOwner)))
    if (target.workspace === 'building') {
      const idsToRemove = new Set<string>([id])
      let expanded = true
      while (expanded) {
        expanded = false
        for (const entity of buildingEntities) {
          if (idsToRemove.has(entity.id)) continue
          if (entity.host && idsToRemove.has(entity.host.entityId)) {
            idsToRemove.add(entity.id)
            expanded = true
          }
        }
      }
      setBuildingEntities(prev => prev
        .filter(entity => !idsToRemove.has(entity.id))
        .map(entity => ({
          ...entity,
          children: entity.children.filter(childId => !idsToRemove.has(childId)),
        })))
      setSelectedBuildingEntityIdRaw(prev => (prev && idsToRemove.has(prev) ? null : prev))
    }
    if (selectedObjectId === id) setSelectedObjectId(null)
  }, [buildingEntities, objects, selectedObjectId, workspaceMode])

	const purgeDuplicateNodes = useCallback(() => {
		const stacks = scaffoldStacksRef.current
		const connections = ledgerConnectionsRef.current

		const posKey = (v: THREE.Vector3) =>
			`${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`
		const nodeKey = (n: RosetteNodeRef) => `${n.stackId}:${n.liftIndex}`
		const edgeKey = (a: RosetteNodeRef, b: RosetteNodeRef) => {
			const ka = nodeKey(a)
			const kb = nodeKey(b)
			return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
		}

			// 1) Deduplicate stacks that occupy the exact same snapped position.
			// Prefer keeping the stack that is most "connected" (referenced by most ledgers),
			// then the tallest (most segments). This minimizes accidental data loss when
			// older projects contain overlapping duplicates.
			const degreeByStackId = new Map<string, number>()
			for (const c of connections) {
				degreeByStackId.set(c.startNode.stackId, (degreeByStackId.get(c.startNode.stackId) ?? 0) + 1)
				degreeByStackId.set(c.endNode.stackId, (degreeByStackId.get(c.endNode.stackId) ?? 0) + 1)
			}

			const indexByStackId = new Map<string, number>()
			const posToStacks = new Map<string, ScaffoldStack[]>()
			stacks.forEach((s, idx) => {
				indexByStackId.set(s.id, idx)
				const key = posKey(s.gridPosition)
				const arr = posToStacks.get(key)
				if (arr) arr.push(s)
				else posToStacks.set(key, [s])
			})

			const stackIdRemap = new Map<string, string>() // duplicateId -> primaryId
			const keptPrimaryIds = new Set<string>()

			const score = (s: ScaffoldStack) => {
				const degree = degreeByStackId.get(s.id) ?? 0
				const segments = s.standardSegments?.length ?? 0
				const baseFlags = (s.showWoodSill ? 1 : 0) + (s.showBaseCollar ? 1 : 0)
				const jack = typeof s.jackExtensionIn === 'number' ? s.jackExtensionIn : 0
				const idx = indexByStackId.get(s.id) ?? 0
				return { degree, segments, baseFlags, jack, idx }
			}

			for (const [, group] of posToStacks) {
				let best = group[0]
				let bestScore = score(best)
				for (let i = 1; i < group.length; i++) {
					const cand = group[i]
					const cs = score(cand)
					const better =
						cs.degree > bestScore.degree ||
						(cs.degree === bestScore.degree && cs.segments > bestScore.segments) ||
						(cs.degree === bestScore.degree && cs.segments === bestScore.segments && cs.baseFlags > bestScore.baseFlags) ||
						(cs.degree === bestScore.degree && cs.segments === bestScore.segments && cs.baseFlags === bestScore.baseFlags && cs.jack > bestScore.jack) ||
						(cs.degree === bestScore.degree && cs.segments === bestScore.segments && cs.baseFlags === bestScore.baseFlags && cs.jack === bestScore.jack && cs.idx < bestScore.idx)
					if (better) {
						best = cand
						bestScore = cs
					}
				}

				keptPrimaryIds.add(best.id)
				for (const s of group) {
					if (s.id === best.id) continue
					stackIdRemap.set(s.id, best.id)
				}
			}

			// Preserve stable ordering by keeping stacks in their original array order.
			const keptStacks: ScaffoldStack[] = stacks.filter(s => keptPrimaryIds.has(s.id))
			const keptStackIds = new Set(keptStacks.map(s => s.id))

		// 2) Normalize connections (apply stack ID remap), remove invalid/self-loop, and dedupe edges.
		const keptConnections: LedgerConnection[] = []
		const seenEdges = new Set<string>()
		for (const c of connections) {
			const startStackId = stackIdRemap.get(c.startNode.stackId) ?? c.startNode.stackId
			const endStackId = stackIdRemap.get(c.endNode.stackId) ?? c.endNode.stackId
			if (!keptStackIds.has(startStackId) || !keptStackIds.has(endStackId)) continue

			const startNode: RosetteNodeRef = { ...c.startNode, stackId: startStackId }
			const endNode: RosetteNodeRef = { ...c.endNode, stackId: endStackId }

			// Invalid edge: same node on both ends.
			if (startNode.stackId === endNode.stackId && startNode.liftIndex === endNode.liftIndex) continue

			const k = edgeKey(startNode, endNode)
			if (seenEdges.has(k)) continue
			seenEdges.add(k)
			keptConnections.push({ ...c, startNode, endNode })
		}
		const keptConnIds = new Set(keptConnections.map(c => c.id))

		// 3) Apply state updates.
		setScaffoldStacks(keptStacks)
		setLedgerConnections(keptConnections)

		// 4) Keep selection stable where possible.
		setSelectedStackIds(prev => {
			const mapped = prev
				.map(id => stackIdRemap.get(id) ?? id)
				.filter(id => keptStackIds.has(id))
			// Ensure uniqueness (remap can collapse two ids into one).
			return Array.from(new Set(mapped))
		})
		setSelectedObjectId(prev => {
			if (!prev) return prev

			const remapStackSelection = (prefix: string) => {
					const payload = prev.slice(prefix.length)
					// Preserve optional segment suffix (e.g. "stack-...@2") so per-segment selection survives.
					const at = payload.indexOf('@')
					const stackId = at >= 0 ? payload.slice(0, at) : payload
					const suffix = at >= 0 ? payload.slice(at) : ''
					const mapped = stackIdRemap.get(stackId) ?? stackId
				if (!keptStackIds.has(mapped)) return null
					return `${prefix}${mapped}${suffix}`
			}

			if (prev.startsWith('standard-')) return remapStackSelection('standard-')
			if (prev.startsWith('wood-sill-')) return remapStackSelection('wood-sill-')
			if (prev.startsWith('screw-jack-')) return remapStackSelection('screw-jack-')
			if (prev.startsWith('base-collar-')) return remapStackSelection('base-collar-')

			if (prev.startsWith('ledger-')) {
				const connId = prev.slice('ledger-'.length)
				return keptConnIds.has(connId) ? prev : null
			}

			return prev
		})

		const removedStacks = stacks.length - keptStacks.length
		const removedConnections = connections.length - keptConnections.length
		if (removedStacks > 0 || removedConnections > 0) {
			console.info('[Purge] Removed duplicates:', {
				removedStacks,
				removedConnections,
			})
		}
	}, [])

	useEffect(() => {
		if (!pendingMovedBlockArtifactCleanup) return
		const pending = pendingMovedBlockArtifactCleanup
		setPendingMovedBlockArtifactCleanup(null)
		performMovedBlockArtifactCleanup(pending)
		purgeDuplicateNodes()
	}, [pendingMovedBlockArtifactCleanup, performMovedBlockArtifactCleanup, purgeDuplicateNodes])

  const updateObject = useCallback((id: string, partial: SceneObjectUpdate) => {
    // Safety: only allow edits inside the active workspace.
    const activeOwner = workspaceToOwner(workspaceMode)
		const currentObject = objects.find(object => object.id === id)
		if (!currentObject || currentObject.workspace !== activeOwner) return

		const nextObject: SceneObject = {
			...currentObject,
			...partial,
			id: currentObject.id,
			type: currentObject.type,
			workspace: currentObject.workspace,
			layer: currentObject.layer,
		}

    setObjects(prev =>
      prev.map(o => {
        if (o.id !== id) return o
        if (o.workspace !== activeOwner) return o
        return nextObject
      })
    )

		if (currentObject.workspace === 'building') {
			const existingEntity = buildingEntities.find(entity => entity.id === id)
			const nextEntity = buildBaseMassEntityFromSceneObject(
				nextObject,
				existingEntity && isBaseMassEntity(existingEntity) ? existingEntity : null,
			)
			if (nextEntity) {
				setBuildingEntities(prev => {
					const hasExisting = prev.some(entity => entity.id === id)
					if (hasExisting) {
						return prev.map(entity => (entity.id === id ? nextEntity : entity))
					}
					return [...prev, nextEntity]
				})
			}
		}
  }, [buildingEntities, objects, workspaceMode])

  const startDrawing = useCallback((point: THREE.Vector3, override?: DrawingHostOverride) => {
    // Safety: never start drawing building geometry outside BUILDING_MODE.
    if (workspaceMode !== 'BUILDING_MODE') return
    if (override) {
      if (activeTool === 'polygon') {
        setDrawingState(prev => {
          if (!prev.isDrawing || prev.polygonPoints.length === 0 || !prev.startPoint) {
            return {
              isDrawing: true,
              startPoint: point.clone(),
              currentPoint: point.clone(),
              polygonPoints: [point.clone()],
              hostEntityId: override.hostEntityId,
              hostKind: override.hostKind,
              hostFaceId: override.hostFaceId,
            }
          }
          const lastPoint = prev.polygonPoints[prev.polygonPoints.length - 1]
          if (lastPoint && lastPoint.distanceToSquared(point) <= 0.0001) {
            return {
              ...prev,
              currentPoint: point.clone(),
            }
          }
          return {
            ...prev,
            currentPoint: point.clone(),
            polygonPoints: [...prev.polygonPoints, point.clone()],
            hostEntityId: prev.hostEntityId ?? override.hostEntityId,
            hostKind: prev.hostKind === 'world' ? override.hostKind : prev.hostKind,
            hostFaceId: prev.hostFaceId ?? override.hostFaceId,
          }
        })
        return
      }
      setDrawingState({
        isDrawing: true,
        startPoint: point.clone(),
        currentPoint: point.clone(),
        polygonPoints: [],
        hostEntityId: override.hostEntityId,
        hostKind: override.hostKind,
        hostFaceId: override.hostFaceId,
      })
      return
    }
    const drawHost = buildingHostedSketchIntent
      ? buildingEntities.find(entity => entity.id === buildingHostedSketchIntent.hostEntityId) ?? null
      : selectedBuildingEntityId
        ? buildingEntities.find(entity => entity.id === selectedBuildingEntityId) ?? null
      : null
    const baseHostEntity = drawHost && isBaseMassEntity(drawHost) ? drawHost : null
    const rectHostEntity = drawHost && isHostedRectEntity(drawHost) ? drawHost : null
    const activeHostFace = buildingHostedSketchIntent
      ? (
          baseHostEntity
            ? getBaseMassFaceInfo(baseHostEntity, buildingHostedSketchFaceId ?? buildingHostedSketchIntent.faceId)
            : (rectHostEntity && buildingHostedSketchIntent.hostKind === 'top-face'
                ? resolveHostedRectEntityTopFaceInfo(rectHostEntity, buildingEntities, roofBaseOffsetByHostId)
                : null)
        )
      : resolvePreferredDrawHostFace(baseHostEntity, activeTool, viewMode)
    const drawHostId = activeHostFace ? drawHost?.id ?? null : null
    const hostKind = activeHostFace?.hostKind ?? 'world'
    const hostFaceId = activeHostFace?.faceId ?? null
    if (activeTool === 'polygon') {
      setDrawingState(prev => {
        if (!prev.isDrawing || prev.polygonPoints.length === 0 || !prev.startPoint) {
          return {
            isDrawing: true,
            startPoint: point.clone(),
            currentPoint: point.clone(),
            polygonPoints: [point.clone()],
            hostEntityId: drawHostId,
            hostKind,
            hostFaceId,
          }
        }
        const lastPoint = prev.polygonPoints[prev.polygonPoints.length - 1]
        if (lastPoint && lastPoint.distanceToSquared(point) <= 0.0001) {
          return {
            ...prev,
            currentPoint: point.clone(),
          }
        }
        return {
          ...prev,
          currentPoint: point.clone(),
          polygonPoints: [...prev.polygonPoints, point.clone()],
          hostEntityId: prev.hostEntityId ?? drawHostId,
          hostKind: prev.hostKind === 'world' ? hostKind : prev.hostKind,
          hostFaceId: prev.hostFaceId ?? hostFaceId,
        }
      })
      return
    }
    setDrawingState({
      isDrawing: true,
      startPoint: point.clone(),
      currentPoint: point.clone(),
      polygonPoints: [],
      hostEntityId: drawHostId,
      hostKind,
      hostFaceId,
    })
  }, [workspaceMode, activeTool, buildingEntities, buildingHostedSketchIntent, buildingHostedSketchFaceId, roofBaseOffsetByHostId, selectedBuildingEntityId, viewMode])

  const updateDrawing = useCallback((point: THREE.Vector3) => {
    if (workspaceMode !== 'BUILDING_MODE') return
    setDrawingState(prev => {
      let nextPoint = point.clone()
      if (prev.hostEntityId && prev.hostFaceId) {
        const drawHost = buildingEntities.find(entity => entity.id === prev.hostEntityId) ?? null
        const hostEntity = drawHost && isBaseMassEntity(drawHost) ? drawHost : null
        const rectHostEntity = drawHost && isHostedRectEntity(drawHost) ? drawHost : null
        if (hostEntity) {
          if (activeTool === 'rectangle' && prev.startPoint) {
            const constrainedPoint = constrainFaceSketchPoint(hostEntity, prev.hostFaceId as BaseMassFaceId, prev.startPoint, point)
            nextPoint = new THREE.Vector3(constrainedPoint.x, constrainedPoint.y, constrainedPoint.z)
          } else {
            const clampedPoint = clampPointToBaseMassFace(hostEntity, prev.hostFaceId as BaseMassFaceId, point)
            nextPoint = new THREE.Vector3(clampedPoint.x, clampedPoint.y, clampedPoint.z)
          }
        } else if (rectHostEntity) {
          const faceInfo = resolveHostedRectEntityFaceInfo(rectHostEntity, prev.hostFaceId as BaseMassFaceId, buildingEntities, roofBaseOffsetByHostId)
          if (faceInfo) {
            if (activeTool === 'rectangle' && prev.startPoint) {
              const constrainedPoint = constrainRectFaceSketchPoint(faceInfo, prev.startPoint, point)
              nextPoint = new THREE.Vector3(constrainedPoint.x, constrainedPoint.y, constrainedPoint.z)
            } else {
              const clampedPoint = clampPointToRectFaceInfo(faceInfo, point)
              nextPoint = new THREE.Vector3(clampedPoint.x, clampedPoint.y, clampedPoint.z)
            }
          }
        }
      }
      return {
        ...prev,
        currentPoint: nextPoint,
      }
    })
  }, [activeTool, buildingEntities, roofBaseOffsetByHostId, workspaceMode])

  const finishDrawing = useCallback((): SceneObject | null => {
    // Safety: never commit building geometry outside BUILDING_MODE.
    if (workspaceMode !== 'BUILDING_MODE') {
      setDrawingState(createEmptyDrawingState())
      setBuildingHostedSketchIntent(null)
      setBuildingHostedSketchFaceIdRaw(null)
      setActiveToolRaw('select')
      return null
    }

    const { startPoint, currentPoint, polygonPoints, hostEntityId, hostKind, hostFaceId } = drawingState
    if (!startPoint || !currentPoint) return null

		const color = '#d7d7d7'
    const now = Date.now()
    const uid = `${now}-${Math.random().toString(36).slice(2, 11)}`
    const drawHost = hostEntityId
      ? buildingEntities.find(entity => entity.id === hostEntityId)
      : null
    const hostEntity = drawHost && isBaseMassEntity(drawHost) ? drawHost : null
    const rectHostEntity = drawHost && isHostedRectEntity(drawHost) ? drawHost : null
    const hostedRectFaceInfo = rectHostEntity && hostFaceId
      ? resolveHostedRectEntityFaceInfo(rectHostEntity, hostFaceId as BaseMassFaceId, buildingEntities, roofBaseOffsetByHostId)
      : null
    const constrainedCurrentPoint = hostEntity && hostFaceId
      ? (() => {
          if (activeTool === 'rectangle') {
            const constrainedPoint = constrainFaceSketchPoint(hostEntity, hostFaceId as BaseMassFaceId, startPoint, currentPoint)
            return new THREE.Vector3(constrainedPoint.x, constrainedPoint.y, constrainedPoint.z)
          }
          const clampedPoint = clampPointToBaseMassFace(hostEntity, hostFaceId as BaseMassFaceId, currentPoint)
          return new THREE.Vector3(clampedPoint.x, clampedPoint.y, clampedPoint.z)
        })()
      : (hostedRectFaceInfo
          ? (() => {
              if (activeTool === 'rectangle') {
                const constrainedPoint = constrainRectFaceSketchPoint(hostedRectFaceInfo, startPoint, currentPoint)
                return new THREE.Vector3(constrainedPoint.x, constrainedPoint.y, constrainedPoint.z)
              }
              const clampedPoint = clampPointToRectFaceInfo(hostedRectFaceInfo, currentPoint)
              return new THREE.Vector3(clampedPoint.x, clampedPoint.y, clampedPoint.z)
            })()
          : currentPoint)
    const hostRef = drawHost && hostKind !== 'world'
      ? {
          entityId: drawHost.id,
          hostKind,
          ...(hostFaceId ? { faceId: hostFaceId } : {}),
        }
      : null

    let newEntity: BuildingEntity | null = null

    if (activeTool === 'rectangle' && buildingHostedSketchIntent && drawHost && hostFaceId) {
      const sketchRect = hostEntity
        ? resolveFaceSketchRect(hostEntity, hostFaceId as BaseMassFaceId, startPoint, constrainedCurrentPoint)
        : (hostedRectFaceInfo
            ? resolveRectFaceSketchRect(hostedRectFaceInfo, startPoint, constrainedCurrentPoint)
            : null)
      if (!sketchRect) {
        setDrawingState(createEmptyDrawingState())
        return null
      }
      const sketchHostKind = hostFaceId === 'top' ? 'top-face' : 'side-face'
      const width = sketchRect.spanU
      const faceSpan = sketchRect.spanV
      if (buildingHostedSketchIntent.target === 'feature') {
        const preset = buildingHostedSketchIntent.preset ?? (sketchHostKind === 'side-face' ? 'balcony' : 'penthouse')
        if (sketchHostKind === 'top-face') {
          const depth = faceSpan
          const height = getHostedFeatureDefaultHeightFt(preset)
          if (width < 0.5 || depth < 0.5) {
            setDrawingState(createEmptyDrawingState())
            return null
          }
          newEntity = {
            id: `feature-top-${uid}`,
            category: 'feature',
            kind: 'top-feature',
            host: {
              entityId: drawHost.id,
              hostKind: 'top-face',
              faceId: 'top',
            },
            color: drawHost.color,
            params: {
              preset,
              widthFt: width,
              depthFt: depth,
              heightFt: height,
              offsetUFt: sketchRect.centerU,
              offsetVFt: sketchRect.centerV,
              balconyHandrailEnabled: getHostedFeatureDefaultHandrailEnabled(preset),
              balconyHandrailHeightFt: getHostedFeatureDefaultHandrailHeightFt(preset),
              balconyHandrailInsetFt: getHostedFeatureDefaultHandrailInsetFt(preset),
              balconyHandrailThicknessFt: getHostedFeatureDefaultHandrailThicknessFt(preset),
            },
            analysis: getHostedFeatureDefaultAnalysis(preset),
            children: [],
            createdAt: now,
            updatedAt: now,
          } satisfies HostedTopFeatureEntity
        } else {
          const depth = getHostedFeatureDefaultDepthFt(preset)
          const height = faceSpan
          if (width < 0.5 || height < 0.5) {
            setDrawingState(createEmptyDrawingState())
            return null
          }
          newEntity = {
            id: `feature-side-${uid}`,
            category: 'feature',
            kind: 'side-feature',
            host: {
              entityId: drawHost.id,
              hostKind: 'side-face',
              faceId: hostFaceId as HostedSideFeatureEntity['host']['faceId'],
            },
            color: drawHost.color,
            params: {
              preset,
              widthFt: width,
              depthFt: depth,
              heightFt: height,
              offsetUFt: sketchRect.centerU,
              offsetVFt: sketchRect.centerV,
              balconyHandrailEnabled: getHostedFeatureDefaultHandrailEnabled(preset),
              balconyHandrailHeightFt: getHostedFeatureDefaultHandrailHeightFt(preset),
              balconyHandrailInsetFt: getHostedFeatureDefaultHandrailInsetFt(preset),
              balconyHandrailThicknessFt: getHostedFeatureDefaultHandrailThicknessFt(preset),
            },
            analysis: getHostedFeatureDefaultAnalysis(preset),
            children: [],
            createdAt: now,
            updatedAt: now,
          } satisfies HostedSideFeatureEntity
        }
      } else {
        const proxyMode = buildingHostedSketchIntent.proxyMode ?? 'add'
        const depth = sketchHostKind === 'top-face'
          ? faceSpan
          : getProxyDefaultDepthFt(proxyMode)
        const height = sketchHostKind === 'top-face'
          ? getProxyDefaultHeightFt(proxyMode)
          : faceSpan
        if (width < 0.5 || depth < 0.5 || height < 0.5) {
          setDrawingState(createEmptyDrawingState())
          return null
        }
        newEntity = {
          id: `proxy-${proxyMode}-${uid}`,
          category: 'proxy',
          kind: 'proxy-feature',
          host: {
            entityId: drawHost.id,
            hostKind: sketchHostKind,
            faceId: hostFaceId as BaseMassFaceId,
          },
          color: getProxyDefaultColor(proxyMode),
          params: {
            mode: proxyMode,
            widthFt: width,
            depthFt: depth,
            heightFt: height,
            offsetUFt: sketchRect.centerU,
            offsetVFt: sketchRect.centerV,
          },
          analysis: {
            blocksScaffold: proxyMode === 'add',
            supportsScaffold: false,
            countsAsRoof: false,
            countsAsPerimeter: false,
          },
          children: [],
          createdAt: now,
          updatedAt: now,
        } satisfies HostedProxyEntity
      }
    }

    if (!newEntity && activeTool === 'polygon') {
      const footprint = dedupePolygonPoints(polygonPoints)
      if (footprint.length < 3) return null
      const worldPoints = footprint.map(point => ({ x: point.x, y: point.y }))
      const area = Math.abs(computePolygonArea(worldPoints))
      if (area < 0.25) return null
      const xs = worldPoints.map(point => point.x)
      const ys = worldPoints.map(point => point.y)
      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2
      const centerY = (Math.min(...ys) + Math.max(...ys)) / 2
      const height = 12
      const centerZ = startPoint.z + height / 2
      newEntity = {
        id: `polygon-${uid}`,
        category: 'base-mass',
        kind: 'polygon-mass',
        host: hostRef,
        position: { x: centerX, y: centerY, z: centerZ },
        rotationZRad: 0,
        color,
        params: {
          shape: 'polygon',
          points: worldPoints.map(point => ({
            x: point.x - centerX,
            y: point.y - centerY,
          })),
          heightFt: height,
        },
        analysis: cloneBuildingAnalysisFlags(),
        children: [],
        createdAt: now,
        updatedAt: now,
      }
    } else if (!newEntity && (activeTool === 'circle' || activeTool === 'ring')) {
      // Circle / Ring: drag from center → edge defines the radius
      const dx = constrainedCurrentPoint.x - startPoint.x
      const dy = constrainedCurrentPoint.y - startPoint.y
      const radius = Math.sqrt(dx * dx + dy * dy)
      if (radius < 0.5) {
        setDrawingState(createEmptyDrawingState())
        return null
      }
      const height = 12
      const centerZ = startPoint.z + height / 2

      if (activeTool === 'circle') {
        newEntity = {
          id: `circle-${uid}`,
          category: 'base-mass',
          kind: 'circle-mass',
          host: hostRef,
          position: { x: startPoint.x, y: startPoint.y, z: centerZ },
          rotationZRad: 0,
          color,
          params: {
            shape: 'circle',
            radiusFt: radius,
            heightFt: height,
          },
          analysis: cloneBuildingAnalysisFlags(),
          children: [],
          createdAt: now,
          updatedAt: now,
        }
      } else {
        const innerRadius = radius * 0.6
        newEntity = {
          id: `ring-${uid}`,
          category: 'base-mass',
          kind: 'ring-mass',
          host: hostRef,
          position: { x: startPoint.x, y: startPoint.y, z: centerZ },
          rotationZRad: 0,
          color,
          params: {
            shape: 'ring',
            radiusFt: radius,
            innerRadiusFt: innerRadius,
            heightFt: height,
          },
          analysis: cloneBuildingAnalysisFlags(),
          children: [],
          createdAt: now,
          updatedAt: now,
        }
      }
    } else if (!newEntity) {
      // Rectangle (box) — original behavior
      const height = 12
      if (hostKind === 'side-face' && hostEntity && hostFaceId) {
        const face = resolvePreferredDrawHostFace(hostEntity, 'rectangle', {
          front: 'ortho-front',
          back: 'ortho-back',
          left: 'ortho-left',
          right: 'ortho-right',
        }[hostFaceId] ?? viewMode)
        if (!face) {
          setDrawingState(createEmptyDrawingState())
          return null
        }

        const faceCenter = new THREE.Vector3(face.center.x, face.center.y, face.center.z)
        const faceAxisU = new THREE.Vector3(face.axisU.x, face.axisU.y, face.axisU.z)
        const faceAxisV = new THREE.Vector3(face.axisV.x, face.axisV.y, face.axisV.z)
        const faceNormal = new THREE.Vector3(face.normal.x, face.normal.y, face.normal.z)
        const startOffset = startPoint.clone().sub(faceCenter)
        const currentOffset = constrainedCurrentPoint.clone().sub(faceCenter)
        const startU = startOffset.dot(faceAxisU)
        const endU = currentOffset.dot(faceAxisU)
        const startV = startOffset.dot(faceAxisV)
        const endV = currentOffset.dot(faceAxisV)
        const width = Math.abs(endU - startU)
        const verticalHeight = Math.abs(endV - startV)
        const depth = 4
        if (width < 0.5 || verticalHeight < 0.5) {
          setDrawingState(createEmptyDrawingState())
          return null
        }
        const center = faceCenter
          .clone()
          .add(faceAxisU.multiplyScalar((startU + endU) / 2))
          .add(faceAxisV.multiplyScalar((startV + endV) / 2))
          .add(faceNormal.multiplyScalar(depth / 2))
        const rotationZRad = hostFaceId === 'front' || hostFaceId === 'back'
          ? (hostEntity.rotationZRad ?? 0)
          : (hostEntity.rotationZRad ?? 0) - Math.PI / 2

        newEntity = {
          id: `box-${uid}`,
          category: 'base-mass',
          kind: 'rect-mass',
          host: hostRef,
          position: { x: center.x, y: center.y, z: center.z },
          rotationZRad,
          color,
          params: {
            shape: 'rect',
            widthFt: width,
            depthFt: depth,
            heightFt: verticalHeight,
          },
          analysis: cloneBuildingAnalysisFlags(),
          children: [],
          createdAt: now,
          updatedAt: now,
        }
      } else {
        const width = Math.abs(constrainedCurrentPoint.x - startPoint.x)
        const depth = Math.abs(constrainedCurrentPoint.y - startPoint.y)
        if (width < 0.5 || depth < 0.5) {
          setDrawingState(createEmptyDrawingState())
          return null
        }
        const centerX = (startPoint.x + constrainedCurrentPoint.x) / 2
        const centerY = (startPoint.y + constrainedCurrentPoint.y) / 2
        const centerZ = startPoint.z + height / 2

        newEntity = {
          id: `box-${uid}`,
          category: 'base-mass',
          kind: 'rect-mass',
          host: hostRef,
          position: { x: centerX, y: centerY, z: centerZ },
          rotationZRad: 0,
          color,
          params: {
            shape: 'rect',
            widthFt: width,
            depthFt: depth,
            heightFt: height,
          },
          analysis: cloneBuildingAnalysisFlags(),
          children: [],
          createdAt: now,
          updatedAt: now,
        }
      }
    }

    let newObject: SceneObject | null = null
    if (newEntity) {
      addBuildingEntity(newEntity)
      if (drawHost && !drawHost.children.includes(newEntity.id)) {
        updateBuildingEntity(drawHost.id, {
          children: [...drawHost.children, newEntity.id],
        })
      }
      setSelectedBuildingEntityIdRaw(newEntity.id)
      setSelectedObjectIdRaw(newEntity.id)
      if (isBaseMassEntity(newEntity)) {
        newObject = buildSceneObjectFromBaseMassEntity(newEntity)
      }
    }
    setDrawingState(createEmptyDrawingState())
    setBuildingHostedSketchIntent(null)
    setBuildingHostedSketchFaceIdRaw(null)
    setActiveToolRaw('select')
    return newObject
  }, [drawingState, buildingEntities, addBuildingEntity, updateBuildingEntity, workspaceMode, activeTool, viewMode, buildingHostedSketchIntent, roofBaseOffsetByHostId])

  const cancelDrawing = useCallback(() => {
    setDrawingState(createEmptyDrawingState())
  }, [])

	useEffect(() => {
		if (workspaceMode !== 'BUILDING_MODE') return
		const isBuildingShapeTool = activeTool === 'rectangle' || activeTool === 'circle' || activeTool === 'ring' || activeTool === 'polygon'
		if (!isBuildingShapeTool && !drawingState.isDrawing && !buildingHostedSketchIntent) return
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return
			if (document.querySelector('[data-scaffxiq-modal]')) return
			if (e.key === 'Enter' && activeTool === 'polygon' && drawingState.polygonPoints.length >= 3) {
				e.preventDefault()
				finishDrawing()
				return
			}
			if (e.key !== 'Escape' && e.key !== 'Esc') return
			e.preventDefault()
			cancelDrawing()
      setBuildingHostedSketchIntent(null)
      setBuildingHostedSketchFaceIdRaw(null)
			if (isBuildingShapeTool) setActiveToolRaw('select')
		}
		window.addEventListener('keydown', onKeyDown, true)
		return () => window.removeEventListener('keydown', onKeyDown, true)
	}, [activeTool, buildingHostedSketchIntent, cancelDrawing, drawingState.isDrawing, drawingState.polygonPoints.length, finishDrawing, workspaceMode])

  const setWorkspaceMode = useCallback((mode: WorkspaceMode) => {
    dispatchWorkspace({ type: mode === 'BUILDING_MODE' ? 'ENTER_BUILDING' : 'ENTER_SCAFFOLD' })
    // Clear selection when switching workspaces (prevents selecting a now-locked object)
    setSelectedObjectId(null)
			setDxfPreviewEnabled(false)
    // Also cancel any active drawing to avoid cross-mode confusion.
    setDrawingState(prev => (prev.isDrawing ? createEmptyDrawingState() : prev))
    setBuildingHostedSketchIntent(null)
    setBuildingHostedSketchFaceIdRaw(null)
    setActiveTool('select')
  }, [])

  const toggleWorkspaceMode = useCallback(() => {
    dispatchWorkspace({ type: 'TOGGLE' })
    setSelectedObjectId(null)
			setDxfPreviewEnabled(false)
    setDrawingState(prev => (prev.isDrawing ? createEmptyDrawingState() : prev))
    setBuildingHostedSketchIntent(null)
    setBuildingHostedSketchFaceIdRaw(null)
    setActiveTool('select')
  }, [])

		const buildProjectDataSnapshot = useCallback((): ProjectDataV1 => {
			return createProjectDataSnapshot({
				workspaceMode,
				objects,
				buildingEntities,
				scaffoldStacks,
				ledgerConnections,
				manualPlankPlacements,
				manualLiveLoadPlacements,
				scaffoldBlocks,
					drawingPackage,
			})
			}, [objects, buildingEntities, scaffoldStacks, ledgerConnections, manualPlankPlacements, manualLiveLoadPlacements, workspaceMode, scaffoldBlocks, drawingPackage])

		const clearPendingHistoryCommit = useCallback(() => {
			if (historyCommitTimerRef.current !== null) {
				window.clearTimeout(historyCommitTimerRef.current)
				historyCommitTimerRef.current = null
			}
			pendingHistorySnapshotRef.current = null
			pendingHistorySignatureRef.current = ''
		}, [])

		const commitHistorySnapshot = useCallback((snapshot: ProjectDataV1, signature?: string) => {
			const snapshotClone = cloneProjectDataSnapshot(snapshot)
			const snapshotSignature = signature ?? getProjectDataSignature(snapshotClone)
			const current = historyStateRef.current
			if (snapshotSignature === lastCommittedHistorySignatureRef.current && current.index >= 0) {
				clearPendingHistoryCommit()
				return current
			}

			const nextEntries = [...current.entries.slice(0, current.index + 1), snapshotClone].slice(-HISTORY_LIMIT)
			const nextState: HistoryState = {
				entries: nextEntries,
				index: nextEntries.length - 1,
			}

			lastCommittedHistorySignatureRef.current = snapshotSignature
			historyStateRef.current = nextState
			setHistoryState(nextState)
			clearPendingHistoryCommit()
			return nextState
		}, [clearPendingHistoryCommit])

		const resetHistoryToSnapshot = useCallback((snapshot: ProjectDataV1) => {
			const snapshotClone = cloneProjectDataSnapshot(snapshot)
			const snapshotSignature = getProjectDataSignature(snapshotClone)
			const nextState: HistoryState = {
				entries: [snapshotClone],
				index: 0,
			}

			lastCommittedHistorySignatureRef.current = snapshotSignature
			historyStateRef.current = nextState
			setHistoryState(nextState)
			clearPendingHistoryCommit()
			return nextState
		}, [clearPendingHistoryCommit])

		const flushPendingHistoryCommit = useCallback(() => {
			const snapshot = pendingHistorySnapshotRef.current
			if (!snapshot) return historyStateRef.current
			const signature = pendingHistorySignatureRef.current || getProjectDataSignature(snapshot)
			return commitHistorySnapshot(snapshot, signature)
		}, [commitHistorySnapshot])

  const exportProjectData = useCallback((): ProjectDataV1 => {
			return buildProjectDataSnapshot()
		}, [buildProjectDataSnapshot])

		const applyProjectData = useCallback((data: ProjectDataV1, options?: { resetHistory?: boolean }) => {
    // Reset transient UI state
    setActiveTool('select')
    setSelectedObjectId(null)
    setSelectedBuildingEntityIdRaw(null)
    setSelectedStackIds([])
			setSelectedBlockIdRaw(null)
			setSelectedBlockIdsRaw([])
    setDrawingState(createEmptyDrawingState())
    setViewMode('perspective')
    setOrthoDirection(null)
			publishLiveCameraState(null)
			clearDrawingViewApplyRequest()
			storeSetActiveSectionId(null)
		setDxfPreviewEnabled(false)

    // Workspace mode
    dispatchWorkspace({ type: data.workspaceMode === 'SCAFFOLD_MODE' ? 'ENTER_SCAFFOLD' : 'ENTER_BUILDING' })

    // Scene objects
    const loadedObjects: SceneObject[] = (data.objects ?? []).map(o => ({
      ...o,
      position: deserializeVector3((o as any).position),
      dimensions: deserializeVector3((o as any).dimensions),
      rotation: deserializeEuler((o as any).rotation),
    }))
		const persistedBuildingEntities = Array.isArray((data as any)?.buildingEntities)
			? ((data as any).buildingEntities as BuildingEntity[])
			: []
		const nextBuildingEntities: BuildingEntity[] = persistedBuildingEntities.length > 0
			? persistedBuildingEntities.map(entity => normalizeBuildingEntity(entity))
			: loadedObjects
				.map(object => buildBaseMassEntityFromSceneObject(object))
				.filter(Boolean) as BuildingEntity[]
		const nextEntityObjects = nextBuildingEntities
			.filter(isBaseMassEntity)
			.map(entity => buildSceneObjectFromBaseMassEntity(entity))
		const nextObjects: SceneObject[] = [
			...loadedObjects.filter(object => object.workspace !== 'building' || !nextEntityObjects.some(entityObject => entityObject.id === object.id)),
			...nextEntityObjects,
		]
    setObjects(nextObjects)
		setBuildingEntities(nextBuildingEntities)

			// Scaffold stacks / connections
			const rawStacks: ScaffoldStack[] = (data.scaffoldStacks ?? []).map((s: any) => {
				// Back-compat migration:
				// - v0: { standardPartNumber }
				// - v1+: { standardSegments: [{partNumber}] }
				let standardSegments: Array<{ partNumber: string }> = []
				if (Array.isArray(s?.standardSegments)) {
					standardSegments = s.standardSegments
						.map((seg: any) => ({ partNumber: String(seg?.partNumber ?? '') }))
						.filter((seg: any) => typeof seg.partNumber === 'string' && seg.partNumber.length > 0)
				} else if (typeof s?.standardPartNumber === 'string' && s.standardPartNumber.length > 0) {
					standardSegments = [{ partNumber: s.standardPartNumber }]
				}
				if (standardSegments.length === 0) {
					console.warn('Loaded scaffold stack with no standard segment; defaulting to US66 for safety.', s)
					standardSegments = [{ partNumber: 'US66' }]
				}
				return {
					...s,
					gridPosition: deserializeVector3(s?.gridPosition),
					standardSegments,
					// Back-compat: older projects won't have this field.
					baseSupport: s?.baseSupport ?? 'grid',
				} as ScaffoldStack
			})
			const rawConnections: LedgerConnection[] = (data.ledgerConnections ?? []) as LedgerConnection[]

			// Defensive migration: ensure unique, well-formed IDs so selection & deletion are stable.
			const usedStackIds = new Set<string>()
			const stackIdMap = new Map<string, string>() // oldId -> newId (first occurrence)
			const nextStacks: ScaffoldStack[] = rawStacks.map(s => {
				const oldId = String((s as any)?.id ?? '')
				let id = oldId
				const looksValid = typeof id === 'string' && id.startsWith('stack-')
				if (!looksValid || usedStackIds.has(id)) {
					do {
						id = generateStackId()
					} while (usedStackIds.has(id))
				}
				usedStackIds.add(id)
				if (oldId && !stackIdMap.has(oldId)) stackIdMap.set(oldId, id)
				return { ...s, id }
			})

			const usedConnIds = new Set<string>()
			const nextConnections: LedgerConnection[] = rawConnections.map(c => {
				const oldConnId = String((c as any)?.id ?? '')
				let id = oldConnId
				const looksValid = typeof id === 'string' && id.startsWith('ledger-')
				if (!looksValid || usedConnIds.has(id)) {
					do {
						id = generateLedgerId()
					} while (usedConnIds.has(id))
				}
				usedConnIds.add(id)

				const startStackId = stackIdMap.get(c.startNode.stackId) ?? c.startNode.stackId
				const endStackId = stackIdMap.get(c.endNode.stackId) ?? c.endNode.stackId
				return {
					...c,
					id,
					startNode: { ...c.startNode, stackId: startStackId },
					endNode: { ...c.endNode, stackId: endStackId },
				}
			})

	    setScaffoldStacks(nextStacks)
	    setLedgerConnections(nextConnections)

				const rawManualPlankPlacements = Array.isArray((data as any)?.manualPlankPlacements)
					? ((data as any).manualPlankPlacements as any[])
					: []
				const validConnectionIds = new Set(nextConnections.map(c => c.id))
				const nextManualPlankPlacements: ManualPlankPlacement[] = rawManualPlankPlacements
					.map((p: any) => {
						const id = String(p?.id ?? '')
						const supportLedgerId = String(p?.supportLedgerId ?? '')
						const sideSign = p?.sideSign === -1 ? -1 : p?.sideSign === 1 ? 1 : null
						if (!id || !supportLedgerId || sideSign === null) return null
						if (!validConnectionIds.has(supportLedgerId)) return null
						return { id, supportLedgerId, sideSign } as ManualPlankPlacement
					})
					.filter(Boolean) as ManualPlankPlacement[]
				setManualPlankPlacements(nextManualPlankPlacements)

				const rawManualLiveLoadPlacements = Array.isArray((data as any)?.manualLiveLoadPlacements)
					? ((data as any).manualLiveLoadPlacements as any[])
					: []
				const nextManualLiveLoadPlacements: ManualLiveLoadPlacement[] = rawManualLiveLoadPlacements
					.map((p: any) => {
						const id = String(p?.id ?? '')
						const supportLedgerId = String(p?.supportLedgerId ?? '')
						const sideSign = p?.sideSign === -1 ? -1 : p?.sideSign === 1 ? 1 : null
						const magnitudePsf = Number(p?.magnitudePsf)
						if (!id || !supportLedgerId || sideSign === null) return null
						if (!validConnectionIds.has(supportLedgerId)) return null
						return {
							id,
							supportLedgerId,
							sideSign,
							magnitudePsf: Number.isFinite(magnitudePsf) && magnitudePsf > 0
								? magnitudePsf
								: DEFAULT_MANUAL_LIVE_LOAD_PSF,
						} as ManualLiveLoadPlacement
					})
					.filter(Boolean) as ManualLiveLoadPlacement[]
				setManualLiveLoadPlacements(nextManualLiveLoadPlacements)

				// Scaffold blocks (optional back-compat)
				const rawBlocks = Array.isArray((data as any)?.scaffoldBlocks) ? ((data as any).scaffoldBlocks as any[]) : []
				const nextBlocks: ScaffoldBlockInstance[] = rawBlocks
					.map((b: any) => {
						const id = String(b?.id ?? '')
						if (!id) return null
						const cx = Number(b?.center?.x)
						const cy = Number(b?.center?.y)
						if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null
						return {
							id,
							center: { x: cx, y: cy },
							rotationSteps: ((Number(b?.rotationSteps) % 4) + 4) % 4,
							widthFt: Math.max(0.1, Number(b?.widthFt ?? 7)),
							depthFt: Math.max(0.1, Number(b?.depthFt ?? 3)),
							heightFt: Math.max(0.1, Number(b?.heightFt ?? 10)),
									...(b?.plankedLevelsCount !== undefined ? { plankedLevelsCount: Math.max(1, Math.round(Number(b.plankedLevelsCount))) } : {}),
									...(b?.includeBaseDeck !== undefined ? { includeBaseDeck: Boolean(b.includeBaseDeck) } : {}),
									...(Number.isFinite(Number(b?.liveLoadPsf)) && Number(b.liveLoadPsf) > 0 ? { liveLoadPsf: Number(b.liveLoadPsf) } : {}),
									...(Array.isArray(b?.liveLoadDeckLiftIndices) && b.liveLoadDeckLiftIndices.length > 0
										? {
											liveLoadDeckLiftIndices: Array.from<number>(
												new Set(
													b.liveLoadDeckLiftIndices
														.map((value: any) => Math.round(Number(value)))
														.filter((value: number) => Number.isFinite(value) && value >= 0)
												)
											).sort((a, b) => a - b),
										}
										: {}),
									...(Array.isArray(b?.liveLoadExcludedBayKeys) && b.liveLoadExcludedBayKeys.length > 0
										? {
											liveLoadExcludedBayKeys: Array.from(new Set(
												b.liveLoadExcludedBayKeys
													.map((value: any) => String(value))
													.filter((value: string) => value.length > 0)
											)).sort(),
										}
										: {}),
								braceFrontBack: normalizeBlockBraceDirection(b?.braceFrontBack),
								braceLeftRight: normalizeBlockBraceDirection(b?.braceLeftRight),
										...(b?.guardrailsIncludeBuildingSide !== undefined ? { guardrailsIncludeBuildingSide: Boolean(b.guardrailsIncludeBuildingSide) } : {}),
							ledgerEveryNRosettes: Math.max(1, Math.round(Number(b?.ledgerEveryNRosettes ?? 4))),
							baseSettings: {
								jackExtensionIn: Math.max(0, Number(b?.baseSettings?.jackExtensionIn ?? 0)),
								showWoodSill: Boolean(b?.baseSettings?.showWoodSill ?? false),
								showBaseCollar: Boolean(b?.baseSettings?.showBaseCollar ?? false),
							},
							managedStackKeys: Array.isArray(b?.managedStackKeys) ? b.managedStackKeys.map((x: any) => String(x)) : [],
							managedLedgerKeys: Array.isArray(b?.managedLedgerKeys) ? b.managedLedgerKeys.map((x: any) => String(x)) : [],
								...(Array.isArray(b?.managedGuardrailLedgerKeys) && b.managedGuardrailLedgerKeys.length > 0 ? { managedGuardrailLedgerKeys: b.managedGuardrailLedgerKeys.map((x: any) => String(x)) } : {}),
							...(b?.autoGeneratedMode === 'around-building' ? { autoGeneratedMode: 'around-building' as const } : {}),
							...(typeof b?.autoGeneratedTargetId === 'string' && b.autoGeneratedTargetId.length > 0 ? { autoGeneratedTargetId: b.autoGeneratedTargetId } : {}),
							...(typeof b?.autoGeneratedSide === 'string' && b.autoGeneratedSide.length > 0
								? { autoGeneratedSide: b.autoGeneratedSide }
								: {}),
							...(b?.autoGeneratedTargetShape === 'rect'
								|| b?.autoGeneratedTargetShape === 'circle'
								|| b?.autoGeneratedTargetShape === 'ring'
								|| b?.autoGeneratedTargetShape === 'polygon'
								? { autoGeneratedTargetShape: b.autoGeneratedTargetShape }
								: {}),
							...(Number.isFinite(Number(b?.autoGeneratedRoundInnerLedgerFt))
								? { autoGeneratedRoundInnerLedgerFt: Math.max(0.1, Number(b.autoGeneratedRoundInnerLedgerFt)) }
								: {}),
							...(Number.isFinite(Number(b?.autoGeneratedRoundOuterLedgerFt))
								? { autoGeneratedRoundOuterLedgerFt: Math.max(0.1, Number(b.autoGeneratedRoundOuterLedgerFt)) }
								: {}),
							...(Number.isFinite(Number(b?.autoGeneratedRoundBayIndex))
								? { autoGeneratedRoundBayIndex: Math.max(0, Math.round(Number(b.autoGeneratedRoundBayIndex))) }
								: {}),
							...(Number.isFinite(Number(b?.autoGeneratedRoundBayCount))
								? { autoGeneratedRoundBayCount: Math.max(1, Math.round(Number(b.autoGeneratedRoundBayCount))) }
								: {}),
							...(b?.autoGeneratedRoundClosure !== undefined ? { autoGeneratedRoundClosure: Boolean(b.autoGeneratedRoundClosure) } : {}),
							...(Array.isArray(b?.suppressedStackKeys) && b.suppressedStackKeys.length > 0 ? { suppressedStackKeys: b.suppressedStackKeys.map((x: any) => String(x)) } : {}),
							...(Array.isArray(b?.suppressedLedgerKeys) && b.suppressedLedgerKeys.length > 0 ? { suppressedLedgerKeys: b.suppressedLedgerKeys.map((x: any) => String(x)) } : {}),
							...(Array.isArray(b?.suppressedDiagonalKeys) && b.suppressedDiagonalKeys.length > 0 ? { suppressedDiagonalKeys: b.suppressedDiagonalKeys.map((x: any) => String(x)) } : {}),
							createdAt: Number(b?.createdAt ?? Date.now()),
							...(b?.updatedAt !== undefined ? { updatedAt: Number(b.updatedAt) } : {}),
						} as ScaffoldBlockInstance
					})
					.filter(Boolean) as ScaffoldBlockInstance[]
				setScaffoldBlocks(nextBlocks)

    // Scaffold objects
    const nextScaffoldObjects: ScaffoldObject[] = (data.scaffoldObjects ?? []).map(o => {
      const next: any = {
        ...o,
        position: deserializeVector3((o as any).position),
      }
      if ((o as any).rotation) next.rotation = deserializeEuler((o as any).rotation)
      if ((o as any).componentType === 'ledger') {
        next.startPosition = deserializeVector3((o as any).startPosition)
        next.endPosition = deserializeVector3((o as any).endPosition)
      }
      return next as ScaffoldObject
    })
    setScaffoldObjects(nextScaffoldObjects)

			let nextDrawingPackage = normalizeDrawingPackageDocument((data as any)?.drawingPackage)
			// One-time legacy migration: fit overflowing viewport compositions into the content area.
			// Only runs on fresh project load (resetHistory true), never on undo/redo.
			if (options?.resetHistory ?? true) {
				nextDrawingPackage = {
					...nextDrawingPackage,
					sheets: nextDrawingPackage.sheets.map(sheet => fitSheetCompositionToPage(sheet)),
				}
			}
			setDrawingPackageRaw(nextDrawingPackage)

			const normalizedSnapshot = createProjectDataSnapshot({
				workspaceMode: data.workspaceMode === 'SCAFFOLD_MODE' ? 'SCAFFOLD_MODE' : 'BUILDING_MODE',
				objects: nextObjects,
				buildingEntities: nextBuildingEntities,
				scaffoldStacks: nextStacks,
				ledgerConnections: nextConnections,
				manualPlankPlacements: nextManualPlankPlacements,
				manualLiveLoadPlacements: nextManualLiveLoadPlacements,
				scaffoldBlocks: nextBlocks,
				drawingPackage: nextDrawingPackage,
			})

			if (options?.resetHistory ?? true) {
				resetHistoryToSnapshot(normalizedSnapshot)
			} else {
				lastCommittedHistorySignatureRef.current = getProjectDataSignature(normalizedSnapshot)
				clearPendingHistoryCommit()
			}
		}, [clearPendingHistoryCommit, resetHistoryToSnapshot, setActiveTool])

		const loadProjectData = useCallback((data: ProjectDataV1) => {
			applyProjectData(data, { resetHistory: true })
		}, [applyProjectData])

		useEffect(() => {
			const snapshot = buildProjectDataSnapshot()
			const signature = getProjectDataSignature(snapshot)

			if (historyStateRef.current.index < 0) {
				resetHistoryToSnapshot(snapshot)
				return
			}

			if (signature === lastCommittedHistorySignatureRef.current) {
				clearPendingHistoryCommit()
				return
			}

			pendingHistorySnapshotRef.current = snapshot
			pendingHistorySignatureRef.current = signature

			if (historyCommitTimerRef.current !== null) {
				window.clearTimeout(historyCommitTimerRef.current)
			}

			historyCommitTimerRef.current = window.setTimeout(() => {
				historyCommitTimerRef.current = null
				const pendingSnapshot = pendingHistorySnapshotRef.current
				if (!pendingSnapshot) return
				const pendingSignature = pendingHistorySignatureRef.current || getProjectDataSignature(pendingSnapshot)
				commitHistorySnapshot(pendingSnapshot, pendingSignature)
			}, HISTORY_COMMIT_DEBOUNCE_MS)
		}, [buildProjectDataSnapshot, clearPendingHistoryCommit, commitHistorySnapshot, resetHistoryToSnapshot])

		const undo = useCallback(() => {
			const current = flushPendingHistoryCommit()
			if (current.index <= 0) return

			const nextIndex = current.index - 1
			const targetSnapshot = cloneProjectDataSnapshot(current.entries[nextIndex]!)
			const nextState: HistoryState = {
				entries: current.entries,
				index: nextIndex,
			}

			lastCommittedHistorySignatureRef.current = getProjectDataSignature(targetSnapshot)
			historyStateRef.current = nextState
			setHistoryState(nextState)
			applyProjectData(targetSnapshot, { resetHistory: false })
		}, [applyProjectData, flushPendingHistoryCommit])

		const redo = useCallback(() => {
			const current = flushPendingHistoryCommit()
			if (current.index < 0 || current.index >= current.entries.length - 1) return

			const nextIndex = current.index + 1
			const targetSnapshot = cloneProjectDataSnapshot(current.entries[nextIndex]!)
			const nextState: HistoryState = {
				entries: current.entries,
				index: nextIndex,
			}

			lastCommittedHistorySignatureRef.current = getProjectDataSignature(targetSnapshot)
			historyStateRef.current = nextState
			setHistoryState(nextState)
			applyProjectData(targetSnapshot, { resetHistory: false })
		}, [applyProjectData, flushPendingHistoryCommit])

		const canUndo = historyState.index > 0
		const canRedo = historyState.index >= 0 && historyState.index < historyState.entries.length - 1

  return (
    <ToolContext.Provider value={{
      activeTool,
      setActiveTool,
				blockToolSettings,
				updateBlockToolSettings,
				blockPlacementWarning,
				showBlockPlacementWarning,
				clearBlockPlacementWarning,
					blockEditMode,
					setBlockEditMode,
					blockEditActionMode,
					setBlockEditActionMode,
      workspaceMode,
      setWorkspaceMode,
      toggleWorkspaceMode,
			dxfPreviewEnabled,
			setDxfPreviewEnabled,
			liveLoadPlacementPsf: liveLoadPlacementPsfRaw,
			setLiveLoadPlacementPsf,
			activeLiveLoadLevelNumber,
			setActiveLiveLoadLevelNumber,
			hoveredLiveLoadDeckTargets,
			setHoveredLiveLoadDeckTargets,
			selectedLiveLoadDeckTargets: selectedLiveLoadDeckTargetsRaw,
			setSelectedLiveLoadDeckTargets,
			selectedLiveLoadDeckTarget,
			setSelectedLiveLoadDeckTarget,
			autoScaffoldRequest,
			requestAutoScaffoldAroundBuilding,
			clearAutoScaffoldRequest,
      objects,
      buildingEntities,
      addObject,
      removeObject,
      updateObject,
      addBuildingEntity,
      updateBuildingEntity,
      removeBuildingEntity,
      scaffoldObjects,
      addScaffoldObject,
      removeScaffoldObject,
      clearScaffoldObjects,
      updateScaffoldObject,
      scaffoldStacks,
      ledgerConnections,
				manualPlankPlacements,
				manualLiveLoadPlacements,
				scaffoldBlocks,
				selectedBlockId: selectedBlockIdRaw,
				selectedBlockIds: selectedBlockIdsRaw,
				blockDragPreviewIds: blockDragPreviewIdsRaw,
				blockDragHiddenStackIds: blockDragHiddenStackIdsRaw,
				setSelectedBlockId,
				setSelectedBlockIds,
				setBlockDragPreviewIds: setBlockDragPreviewIdsRaw,
				setBlockDragHiddenStackIds: setBlockDragHiddenStackIdsRaw,
				clearBlockSelection,
				toggleBlockSelection,
				isEditingBlock,
				setIsEditingBlock,
				addScaffoldBlock,
				removeScaffoldBlock,
				updateScaffoldBlockLiveLoad,
				applyScaffoldBlockEdits,
				cleanupMovedBlockArtifacts,
      addScaffoldStack,
			appendStandardSegmentToStack,
				setStandardSegmentsForStack,
      removeScaffoldStack,
      updateScaffoldStack,
      updateAllScaffoldStacks,
			suppressDiagonalMemberInBlock,
      addLedgerConnection,
      removeLedgerConnection,
				addManualPlankPlacement,
				removeManualPlankPlacement,
				addManualLiveLoadPlacement,
				updateManualLiveLoadPlacement,
				removeManualLiveLoadPlacement,
      clearScaffoldGraph,
			purgeDuplicateNodes,
      selectedObjectId,
      setSelectedObjectId,
      selectedBuildingEntityId,
      setSelectedBuildingEntityId,
      selectedHostedPatternInstance,
      setSelectedHostedPatternInstance,
      buildingHostedPatternPreview,
      setBuildingHostedPatternPreview,
      getSelectedObject,
      selectedStackIds,
      setSelectedStackIds,
      toggleStackSelection,
      getSelectedStacks,
	      drawingPackage,
	      setDrawingPackage,
      drawingState,
      buildingHostedSketchIntent,
      buildingHostedSketchFaceId,
      beginBuildingHostedSketch,
      setBuildingHostedSketchFaceId,
      clearBuildingHostedSketch,
      startDrawing,
      updateDrawing,
      finishDrawing,
      cancelDrawing,
      viewMode,
      setViewMode,
      orthoDirection,
      setOrthoDirection,
      saveCameraStateRef,
      requestHomeViewRef,
      cameraTransitioning,
      setCameraTransitioning,
			cameraNavigationActive,
			setCameraNavigationActive,
			liveCameraState,
			publishLiveCameraState,
			captureCurrentModelAsDrawingView,
				createDrawingViewFromLiveModel,
				createLinkedDrawingViewFromActiveSection,
			drawingViewApplyRequest,
			requestApplyDrawingView,
			clearDrawingViewApplyRequest,
			activeDrawingSectionId,
			setActiveDrawingSectionId,
      exportProjectData,
      loadProjectData,
				undo,
				redo,
				canUndo,
				canRedo,
		    }}>
      {children}
    </ToolContext.Provider>
  )
}

export function useTool() {
  const ctx = useContext(ToolContext)
  if (!ctx) throw new Error('useTool must be used within ToolProvider')
  return ctx
}
