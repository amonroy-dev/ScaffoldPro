import * as THREE from 'three'

/**
 * Scaffold component types for the ringlock system.
 */
export type ScaffoldComponentType =
  | 'standard'
  | 'ledger'
  | 'base-wood-sill'
  | 'base-screw-jack'
  | 'base-collar'

/**
 * Base interface for all scaffold objects.
 */
export interface ScaffoldObjectBase {
  id: string
  componentType: ScaffoldComponentType
  /** Position in world coordinates (feet) */
  position: THREE.Vector3
  /** Optional rotation */
  rotation?: THREE.Euler
  /** Catalog ID (e.g., 'US99' for a 9'9" standard) */
  catalogId?: string
  /** Display name for the component */
  displayName: string
  /** Length/height in feet */
  lengthFt: number
  /** Weight in pounds */
  weightLbs: number
  /** Parent standard ID (for base components attached to a standard) */
  parentStandardId?: string
}

/**
 * Ringlock standard (vertical tube with rosettes).
 */
export interface StandardObject extends ScaffoldObjectBase {
  componentType: 'standard'
  /** Number of rosettes on this standard */
  rosetteCount: number
  /** Height of the standard in feet */
  heightFt: number
}

/**
 * Ringlock ledger (horizontal tube connecting two standards).
 */
export interface LedgerObject extends ScaffoldObjectBase {
  componentType: 'ledger'
  /** Start position (rosette center) */
  startPosition: THREE.Vector3
  /** End position (rosette center) */
  endPosition: THREE.Vector3
  /** Bay length in feet */
  bayLengthFt: number
}

/**
 * Wood sill (base component).
 */
export interface WoodSillObject extends ScaffoldObjectBase {
  componentType: 'base-wood-sill'
  /** Width in inches */
  widthIn: number
  /** Depth in inches */
  depthIn: number
  /** Thickness in inches */
  thicknessIn: number
}

/**
 * Screw jack (base component).
 */
export interface ScrewJackObject extends ScaffoldObjectBase {
  componentType: 'base-screw-jack'
  /** Current extension in inches (0-12) */
  extensionIn: number
  /** Base plate dimensions */
  basePlateWidthIn: number
  basePlateDepthIn: number
}

/**
 * Base collar (base component).
 */
export interface BaseCollarObject extends ScaffoldObjectBase {
  componentType: 'base-collar'
  /** Has rosette */
  hasRosette: boolean
}

/**
 * Union type for all scaffold objects.
 */
export type ScaffoldObject =
  | StandardObject
  | LedgerObject
  | WoodSillObject
  | ScrewJackObject
  | BaseCollarObject

/**
 * Weight constants for scaffold components (in pounds).
 * These are approximate values for Universal ringlock components.
 */
export const SCAFFOLD_WEIGHTS: Record<string, number> = {
  // Standards (per foot, approximately)
  'standard-per-ft': 2.5,
  // Ledgers (per foot, approximately)
  'ledger-per-ft': 1.8,
  // Base components
  'wood-sill-9x9': 3.5,
  'screw-jack': 13.8,
  'base-collar': 3.5,
}

/**
 * Calculate weight for a standard based on height.
 */
export function calculateStandardWeight(heightFt: number): number {
  return heightFt * SCAFFOLD_WEIGHTS['standard-per-ft']
}

/**
 * Calculate weight for a ledger based on length.
 * Uses per-foot approximation as fallback.
 */
export function calculateLedgerWeight(lengthFt: number): number {
  return lengthFt * SCAFFOLD_WEIGHTS['ledger-per-ft']
}

/**
 * Generate a unique ID for a scaffold object.
 */
export function generateScaffoldId(componentType: ScaffoldComponentType): string {
  return `${componentType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

