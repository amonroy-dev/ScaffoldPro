import * as THREE from 'three'

import { inchesToFeet } from './units'
import { UNIVERSAL_RINGLOCK_STANDARDS, type UniversalRinglockStandardId } from './ringlockCatalog'

// Constants for rosette positioning
export const FIRST_ROSETTE_OFFSET_IN = 15.75
export const ROSETTE_SPACING_IN = 19.6875
// Keep the base-collar rosette exactly one typical bay spacing below the first
// standard rosette center: 7" lower sleeve + 15.75" first offset - 19.6875" spacing.
export const COLLAR_ROSETTE_CENTER_OFFSET_IN = 3.0625

// NOTE: These values must match the visual base geometry in RinglockBases.tsx.
const WOOD_SILL_THICKNESS_IN = 0.5
const JACK_PLATE_THICKNESS_IN = 0.375
const JACK_STEM_BASE_HEIGHT_IN = 2
const COLLAR_LOWER_HEIGHT_IN = 7.0

/**
 * Calculate the Z offset from ground to where the standard's base should be.
 * This accounts for wood sill, screw jack, and base collar heights.
 */
export function getStandardBaseOffsetFt(
  jackExtensionIn: number,
  showWoodSill: boolean,
  showBaseCollar: boolean,
): number {
  let offset = 0
  if (showWoodSill) offset += inchesToFeet(WOOD_SILL_THICKNESS_IN)
  offset += inchesToFeet(JACK_PLATE_THICKNESS_IN)
  offset += inchesToFeet(JACK_STEM_BASE_HEIGHT_IN + jackExtensionIn)
  if (showBaseCollar) offset += inchesToFeet(COLLAR_LOWER_HEIGHT_IN)
  return offset
}

/**
 * Calculate all rosette world positions for a stack.
 * Returns array of { liftIndex, position } from bottom to top.
 */
export function computeRosettePositions(
  gridPosition: THREE.Vector3,
  standardSegments: Array<{ partNumber: string }>,
  jackExtensionIn: number,
  showWoodSill: boolean,
  showBaseCollar: boolean,
): Array<{ liftIndex: number; position: THREE.Vector3 }> {
  const nodes: Array<{ liftIndex: number; position: THREE.Vector3 }> = []
  if (!Array.isArray(standardSegments) || standardSegments.length === 0) return nodes

  // Calculate base heights for the collar rosette reference.
  let currentZ = gridPosition.z
  if (showWoodSill) currentZ += inchesToFeet(WOOD_SILL_THICKNESS_IN)
  currentZ += inchesToFeet(JACK_PLATE_THICKNESS_IN)
  currentZ += inchesToFeet(JACK_STEM_BASE_HEIGHT_IN + jackExtensionIn)

  // Base collar rosette (liftIndex 0) - positioned at center of rosette.
  if (showBaseCollar) {
    const collarRosetteZ = currentZ + inchesToFeet(COLLAR_ROSETTE_CENTER_OFFSET_IN)
    nodes.push({
      liftIndex: 0,
      position: new THREE.Vector3(gridPosition.x, gridPosition.y, collarRosetteZ),
    })
  }

  const standardBaseFt = getStandardBaseOffsetFt(jackExtensionIn, showWoodSill, showBaseCollar)
  const standardBaseWorldZ = gridPosition.z + standardBaseFt

  // Standard rosettes (liftIndex 1+ always), across all stacked segments.
  let cumulativeHeightFt = 0
  let nextLiftIndex = 1
  for (const seg of standardSegments) {
    const pn = String(seg?.partNumber ?? '')
    const spec = UNIVERSAL_RINGLOCK_STANDARDS[pn as UniversalRinglockStandardId]
    if (!spec) continue

    const segBaseZ = standardBaseWorldZ + cumulativeHeightFt
    const segTopZ = segBaseZ + spec.heightFt
    for (let i = 0; i < spec.rosetteCount; i++) {
      const rosetteZ = segBaseZ + inchesToFeet(FIRST_ROSETTE_OFFSET_IN + i * ROSETTE_SPACING_IN)
      if (rosetteZ > segTopZ + 1e-6) break
      nodes.push({
        liftIndex: nextLiftIndex,
        position: new THREE.Vector3(gridPosition.x, gridPosition.y, rosetteZ),
      })
      nextLiftIndex++
    }
    cumulativeHeightFt += spec.heightFt
  }

  return nodes
}
