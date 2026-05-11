import * as THREE from 'three'

/**
 * Scaffold graph model for the lego-like placement system.
 * 
 * A ScaffoldStack represents a standard + base assembly placed on the grid.
 * A LedgerConnection represents a ledger connecting two rosette nodes.
 */

/**
 * A scaffold stack: standard + base assembly at a grid position.
 */
export interface ScaffoldStack {
  id: string
  /** Grid position at ground level (snapped to grid) */
  gridPosition: THREE.Vector3

	/**
	 * Vertical standard segments for this stack, bottom → top.
	 * Allows mixing any standard types and stacking indefinitely.
	 */
	standardSegments: Array<{
		/** Standard part number from catalog (e.g., 'US99') */
		partNumber: string
	}>
  /** Screw jack extension in inches (0-12) */
  jackExtensionIn: number

	/**
	 * Where this standard is supported.
	 * - grid: base-level on the grid/ground (base assembly available)
	 * - shape: base-level on top of a shape (future enhancement; base assembly available)
	 * - stacked: stacked on another standard (no base assembly)
	 */
	baseSupport?: 'grid' | 'shape' | 'stacked'

	/**
	 * Optional per-stack overrides for base assembly visibility.
	 * `undefined` means "inherit workspace defaults".
	 */
	showWoodSill?: boolean
	showBaseCollar?: boolean
}

/**
 * Reference to a rosette node on a stack.
 * liftIndex 0 = base collar rosette (if present), 1+ = standard rosettes
 */
export interface RosetteNodeRef {
  stackId: string
  /** 0 = base collar rosette, 1+ = standard rosettes (counting from bottom) */
  liftIndex: number
}

/**
 * A ledger connection between two rosette nodes.
 */
export interface LedgerConnection {
  id: string
  /** Start node reference */
  startNode: RosetteNodeRef
  /** End node reference */
  endNode: RosetteNodeRef
  /** Ledger part number from catalog (e.g., 'UH100'), auto-selected or explicit */
  ledgerPartNumber: string
}

/**
 * A manual plank placement anchored from a specific support ledger.
 *
 * The actual rendered plank members are derived from the current scaffold graph,
 * using the referenced ledger plus the nearest parallel support ledger on the
 * chosen side.
 */
export interface ManualPlankPlacement {
	id: string
	/** Support ledger the user clicked. */
	supportLedgerId: string
	/** Which side of the support ledger to deck: +1 = left, -1 = right in ledger local XY frame. */
	sideSign: 1 | -1
}

export const DEFAULT_MANUAL_LIVE_LOAD_PSF = 50

/**
 * A manual live-load bay placement anchored from a specific support ledger.
 *
 * Like manual plank placement, the actual loaded bay is derived from the current
 * scaffold graph using the clicked ledger plus the nearest opposite parallel
 * support ledger on the chosen side.
 */
export interface ManualLiveLoadPlacement {
	id: string
	/** Support ledger the user clicked. */
	supportLedgerId: string
	/** Which side of the support ledger to load: +1 = left, -1 = right in ledger local XY frame. */
	sideSign: 1 | -1
	/** Uniform live load magnitude applied to the bay footprint. */
	magnitudePsf: number
}

export type BlockBraceDirection = 'off' | 'slash' | 'backslash'

export function normalizeBlockBraceDirection(value: unknown): BlockBraceDirection {
	return value === 'slash' || value === 'backslash' ? value : 'off'
}

/**
 * A placed scaffold "Block" instance.
 *
 * This is metadata to support CAD-like selection and parametric updates.
 * The actual scaffold members (stacks/ledgers) remain the source of truth.
 */
export interface ScaffoldBlockInstance {
	id: string
	/** Block center (XY plane, feet). */
	center: { x: number; y: number }
	/** Rotation in quarter-turn units. Integer values are 90-degree steps; fractional values support perimeter-aligned auto placement. */
	rotationSteps: number

	widthFt: number
	depthFt: number
	heightFt: number
	ledgerEveryNRosettes: number

	/**
	 * Working decks (planked levels) requested for this block.
	 * Interpreted top-down and clamped to what fits under `heightFt`.
	 *
	 * Optional for back-compat (older projects).
	 */
	plankedLevelsCount?: number
	/** When true, allow a working deck at liftIndex=0 (base collar rosette). */
	includeBaseDeck?: boolean
	/** Uniform live load magnitude assigned to this block's chosen working-deck levels. */
	liveLoadPsf?: number
	/** Exact working-deck lift indices on which the block carries live load. */
	liveLoadDeckLiftIndices?: number[]
	/** Optional bay keys excluded from the checked live-load working decks. */
	liveLoadExcludedBayKeys?: string[]
	/** Full-height perimeter braces on the front/back faces. */
	braceFrontBack?: BlockBraceDirection
	/** Full-height perimeter braces on the left/right faces. */
	braceLeftRight?: BlockBraceDirection
	/** When false, guardrail generation may omit building-side perimeter edges (future/optional). */
	guardrailsIncludeBuildingSide?: boolean

	/** Snapshot of base settings used when the block was created/updated. */
	baseSettings: {
		jackExtensionIn: number
		showWoodSill: boolean
		showBaseCollar: boolean
	}

	/**
	 * Members the block considers "managed" by position/edge keys.
	 * We store keys (not IDs) so overlapping blocks and stack de-duplication stay robust.
	 */
	managedStackKeys: string[]
	managedLedgerKeys: string[]
	/** Guardrail ledgers managed by this block (perimeter-only; derived from combined footprint). */
	managedGuardrailLedgerKeys?: string[]

	/** Keys the user deleted/suppressed so updates won’t re-add them. */
	suppressedStackKeys?: string[]
	suppressedLedgerKeys?: string[]
	suppressedDiagonalKeys?: string[]

	/** Optional provenance for auto-generated block workflows. */
	autoGeneratedMode?: 'around-building'
	autoGeneratedTargetId?: string
	autoGeneratedSide?: string
	autoGeneratedTargetShape?: 'rect' | 'circle' | 'ring' | 'polygon'
	autoGeneratedRoundInnerLedgerFt?: number
	autoGeneratedRoundOuterLedgerFt?: number
	autoGeneratedRoundBayIndex?: number
	autoGeneratedRoundBayCount?: number
	autoGeneratedRoundClosure?: boolean

	createdAt: number
	updatedAt?: number
}

/**
 * Universal ringlock horizontal (ledger) specs.
 *
 * Load Bearing horizontals:
 *   UH20 (Blank) = 2', UH30 (Yellow) = 3', UH36 (Blank) = 3'6", UH40 (Black) = 4',
 *   UH50 (Orange) = 5', UH60 (Brown) = 6'
 *
 * Non-Load Bearing horizontals:
 *   UH60 (Blue) = 6', UH70 (Blank) = 7', UH80 (Green) = 8',
 *   UH100 (Red) = 10'
 *
 * Note: UH60 appears in both load-bearing and non-load-bearing lists (same 6' length).
 * We store it once; the load-bearing distinction is structural, not dimensional.
 */
export type UniversalRinglockHorizontalId =
  | 'UH20' | 'UH30' | 'UH36' | 'UH40' | 'UH50' | 'UH60'
  | 'UH70' | 'UH80' | 'UH100'

export const UNIVERSAL_RINGLOCK_HORIZONTALS: Record<UniversalRinglockHorizontalId, {
  lengthIn: number
  weightLbs: number
  loadBearing: boolean
  color: string
}> = {
  // Load Bearing
  UH20:  { lengthIn: 24,  weightLbs: 6.0,  loadBearing: true,  color: 'Blank' },
  UH30:  { lengthIn: 36,  weightLbs: 8.3,  loadBearing: true,  color: 'Yellow' },
  UH36:  { lengthIn: 42,  weightLbs: 8.9,  loadBearing: true,  color: 'Blank' },
  UH40:  { lengthIn: 48,  weightLbs: 9.4,  loadBearing: true,  color: 'Black' },
  UH50:  { lengthIn: 60,  weightLbs: 10.5, loadBearing: true,  color: 'Orange' },
  UH60:  { lengthIn: 72,  weightLbs: 12.8, loadBearing: true,  color: 'Brown' },
  // Non-Load Bearing
  UH70:  { lengthIn: 84,  weightLbs: 17.3, loadBearing: false, color: 'Blank' },
  UH80:  { lengthIn: 96,  weightLbs: 19.5, loadBearing: false, color: 'Green' },
  UH100: { lengthIn: 120, weightLbs: 24.0, loadBearing: false, color: 'Red' },
}

/**
 * Universal ringlock horizontal truss specs.
 *
 * From spec sheet (weights in lbs):
 *  - UHT50 (Brown) = 5'
 *  - UHT60 (Blue) = 6'
 *  - UHT70 (Blank) = 7'
 *  - UHT80 (Green) = 8'
 *  - UHT100 (Red) = 10'
 */
export type UniversalRinglockTrussId = 'UHT50' | 'UHT60' | 'UHT70' | 'UHT80' | 'UHT100'

export const UNIVERSAL_RINGLOCK_TRUSSES: Record<UniversalRinglockTrussId, {
	lengthIn: number
	weightLbs: number
	/** Trusses are load-bearing by design (for now we treat all UHT as load-bearing). */
	loadBearing: boolean
	color: string
}> = {
	UHT50: { lengthIn: 60, weightLbs: 15.6, loadBearing: true, color: 'Brown' },
	UHT60: { lengthIn: 72, weightLbs: 18.5, loadBearing: true, color: 'Blue' },
	UHT70: { lengthIn: 84, weightLbs: 24.5, loadBearing: true, color: 'Blank' },
	UHT80: { lengthIn: 96, weightLbs: 36.8, loadBearing: true, color: 'Green' },
	UHT100: { lengthIn: 120, weightLbs: 39.6, loadBearing: true, color: 'Red' },
}

export const UNIVERSAL_TRUSS_LENGTHS: Record<string, number> = Object.fromEntries(
	Object.entries(UNIVERSAL_RINGLOCK_TRUSSES).map(([k, v]) => [k, v.lengthIn]),
)

export function getTrussLengthFt(partNumber: string): number {
	const spec = UNIVERSAL_RINGLOCK_TRUSSES[partNumber as UniversalRinglockTrussId]
	if (!spec) {
		console.warn(`Unknown truss part number: ${partNumber}`)
		return 0
	}
	return spec.lengthIn / 12
}

export function findClosestTruss(
	distanceInches: number,
	toleranceInches = 6,
	requireTolerance = true,
): string | null {
	const entries = Object.entries(UNIVERSAL_TRUSS_LENGTHS)
	let closest: string | null = null
	let minDiff = Infinity

	for (const [partNumber, lengthIn] of entries) {
		const diff = Math.abs(lengthIn - distanceInches)
		if (diff < minDiff) {
			minDiff = diff
			closest = partNumber
		}
	}

	if (!closest) return null
	if (!requireTolerance) return closest
	return minDiff <= toleranceInches ? closest : null
}

/**
 * Universal ringlock diagonal (brace) specs.
 *
 * From spec sheet (weights in lbs):
 *  - UD20 (Blank) = 2' bay / 16.9 lbs
 *  - UD30 (Yellow) = 3' bay / 16.9 lbs
 *  - UD36 (Black) = 3'6" bay / 17.3 lbs
 *  - UD40 (Orange) = 4' bay / 17.6 lbs
 *  - UD50 (Brown) = 5' bay / 18.6 lbs
 *  - UD60 (Blue) = 6' bay / 19.7 lbs
 *  - UD70 (Blank) = 7' bay / 21.5 lbs
 *  - UD80 (Green) = 8' bay / 22.2 lbs
 *  - UD100 (Red) = 10' bay / 25.0 lbs
 */
export type UniversalRinglockDiagonalId =
  | 'UD20' | 'UD30' | 'UD36' | 'UD40' | 'UD50'
  | 'UD60' | 'UD70' | 'UD80' | 'UD100'

export const UNIVERSAL_RINGLOCK_DIAGONALS: Record<UniversalRinglockDiagonalId, {
  /** Bay size the diagonal spans, in inches */
  baySizeIn: number
  weightLbs: number
  color: string
}> = {
  UD20:  { baySizeIn: 24,  weightLbs: 16.9, color: 'Blank' },
  UD30:  { baySizeIn: 36,  weightLbs: 16.9, color: 'Yellow' },
  UD36:  { baySizeIn: 42,  weightLbs: 17.3, color: 'Black' },
  UD40:  { baySizeIn: 48,  weightLbs: 17.6, color: 'Orange' },
  UD50:  { baySizeIn: 60,  weightLbs: 18.6, color: 'Brown' },
  UD60:  { baySizeIn: 72,  weightLbs: 19.7, color: 'Blue' },
  UD70:  { baySizeIn: 84,  weightLbs: 21.5, color: 'Blank' },
  UD80:  { baySizeIn: 96,  weightLbs: 22.2, color: 'Green' },
  UD100: { baySizeIn: 120, weightLbs: 25.0, color: 'Red' },
}

/**
 * Universal ringlock side bracket specs.
 *
 * From spec sheet (weights in lbs):
 *  - USB20 = 2' / 14.0 lbs
 *  - USB30 = 3' / 21.0 lbs
 *  - USB36 = 3'6" / 31.0 lbs
 */
export type UniversalRinglockSideBracketId = 'USB20' | 'USB30' | 'USB36'

export const UNIVERSAL_RINGLOCK_SIDE_BRACKETS: Record<UniversalRinglockSideBracketId, {
  lengthIn: number
  weightLbs: number
}> = {
  USB20: { lengthIn: 24,  weightLbs: 14.0 },
  USB30: { lengthIn: 36,  weightLbs: 21.0 },
  USB36: { lengthIn: 42,  weightLbs: 31.0 },
}

/**
 * Universal ringlock board bracket specs.
 *
 * From spec sheet (weights in lbs):
 *  - UBB010 = 10" / 3.1 lbs
 *  - UBB010CO = 10" / 3.1 lbs
 *  - UBB18 = 1'8" / 8.0 lbs
 *  - UBB27 = 2'7" / 12.5 lbs
 */
export type UniversalRinglockBoardBracketId = 'UBB010' | 'UBB010CO' | 'UBB18' | 'UBB27'

export const UNIVERSAL_RINGLOCK_BOARD_BRACKETS: Record<UniversalRinglockBoardBracketId, {
  lengthIn: number
  weightLbs: number
}> = {
  UBB010:   { lengthIn: 10, weightLbs: 3.1 },
  UBB010CO: { lengthIn: 10, weightLbs: 3.1 },
  UBB18:    { lengthIn: 20, weightLbs: 8.0 },
  UBB27:    { lengthIn: 31, weightLbs: 12.5 },
}

/**
 * Backward-compatible map: part number → length in inches.
 * Derived from UNIVERSAL_RINGLOCK_HORIZONTALS.
 */
export const UNIVERSAL_LEDGER_LENGTHS: Record<string, number> = Object.fromEntries(
  Object.entries(UNIVERSAL_RINGLOCK_HORIZONTALS).map(([k, v]) => [k, v.lengthIn])
)

/**
 * Get ledger length in feet from part number.
 */
export function getLedgerLengthFt(partNumber: string): number {
  const spec = UNIVERSAL_RINGLOCK_HORIZONTALS[partNumber as UniversalRinglockHorizontalId]
  if (!spec) {
    console.warn(`Unknown ledger part number: ${partNumber}`)
    return 0
  }
  return spec.lengthIn / 12
}

/**
 * Find the closest matching ledger part number for a given distance.
 *
 * By default (legacy behavior), returns null if no ledger is close enough (within 6" tolerance).
 * Pass `requireTolerance=false` to always return the closest available ledger.
 */
export function findClosestLedger(
	distanceInches: number,
	toleranceInches = 6,
	requireTolerance = true,
): string | null {
  const entries = Object.entries(UNIVERSAL_LEDGER_LENGTHS)
  let closest: string | null = null
  let minDiff = Infinity

  for (const [partNumber, lengthIn] of entries) {
    const diff = Math.abs(lengthIn - distanceInches)
    if (diff < minDiff) {
      minDiff = diff
      closest = partNumber
    }
  }

	if (!closest) return null
	if (!requireTolerance) return closest

	// Only return if within tolerance (allows for slight misalignment)
	return minDiff <= toleranceInches ? closest : null
}

/**
 * Find the closest matching diagonal part number for a given bay size.
 *
 * Diagonals are selected by bay width, not by the full sloped member length.
 */
export function findClosestDiagonal(
	distanceInches: number,
	toleranceInches = 6,
	requireTolerance = false,
): UniversalRinglockDiagonalId | null {
	const entries = Object.entries(UNIVERSAL_RINGLOCK_DIAGONALS) as Array<[
		UniversalRinglockDiagonalId,
		{ baySizeIn: number }
	]>
	let closest: UniversalRinglockDiagonalId | null = null
	let minDiff = Infinity

	for (const [partNumber, spec] of entries) {
		const diff = Math.abs(spec.baySizeIn - distanceInches)
		if (diff < minDiff) {
			minDiff = diff
			closest = partNumber
		}
	}

	if (!closest) return null
	if (!requireTolerance) return closest
	return minDiff <= toleranceInches ? closest : null
}

/**
 * Generate a unique stack ID.
 */
export function generateStackId(): string {
	// Prefer cryptographically-strong UUIDs when available (prevents rare collisions
	// and makes saved projects more robust across sessions).
	const uuid = (globalThis as any)?.crypto?.randomUUID?.()
	if (typeof uuid === 'string' && uuid.length > 0) return `stack-${uuid}`
	// Fallback for older environments
	return `stack-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Generate a unique ledger connection ID.
 */
export function generateLedgerId(): string {
	const uuid = (globalThis as any)?.crypto?.randomUUID?.()
	if (typeof uuid === 'string' && uuid.length > 0) return `ledger-${uuid}`
	return `ledger-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/** Generate a unique manual plank placement ID. */
export function generatePlankPlacementId(): string {
	const uuid = (globalThis as any)?.crypto?.randomUUID?.()
	if (typeof uuid === 'string' && uuid.length > 0) return `plank-${uuid}`
	return `plank-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/** Generate a unique manual live-load placement ID. */
export function generateLiveLoadPlacementId(): string {
	const uuid = (globalThis as any)?.crypto?.randomUUID?.()
	if (typeof uuid === 'string' && uuid.length > 0) return `live-load-${uuid}`
	return `live-load-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/** Generate a unique block instance ID. */
export function generateBlockId(): string {
	const uuid = (globalThis as any)?.crypto?.randomUUID?.()
	if (typeof uuid === 'string' && uuid.length > 0) return `block-${uuid}`
	return `block-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}
