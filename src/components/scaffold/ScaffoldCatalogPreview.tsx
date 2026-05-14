import { useEffect, useMemo, useCallback } from 'react'
import * as THREE from 'three'
import { RinglockStandards, type RinglockStandardInstance } from './RinglockStandards'
import { RinglockLedgers, type RinglockLedgerInstance } from './RinglockLedgers'
import { RinglockBases, type RinglockBaseInstance, getStandardBaseOffsetFt } from './RinglockBases'
import { FIRST_ROSETTE_OFFSET_IN, ROSETTE_SPACING_IN } from './scaffoldGeometry'
import { useScaffoldBaseSettings } from '../../contexts/ScaffoldBaseSettings'
import { useTool } from '../../contexts/ToolContext'
import { UNIVERSAL_RINGLOCK_STANDARD_ORDER, UNIVERSAL_RINGLOCK_STANDARDS } from './ringlockCatalog'
import { inchesToFeet } from './units'
import type { StandardObject, LedgerObject, WoodSillObject, ScrewJackObject, BaseCollarObject } from '../../types/scaffoldObjects'
import { calculateStandardWeight, calculateLedgerWeight, SCAFFOLD_WEIGHTS } from '../../types/scaffoldObjects'

/**
 * Temporary on-scene preview: render the Universal catalog ringlock standards as a quick visual check.
 * (This is meant to be replaced by your real scaffold block generator later.)
 */
export function ScaffoldCatalogPreview() {
  const { baseSettings } = useScaffoldBaseSettings()
  const { showWoodSill, showBaseCollar, defaultJackExtensionIn } = baseSettings
  const { selectedObjectId, setSelectedObjectId, addScaffoldObject, scaffoldObjects, activeTool } = useTool()

  // Calculate the Z offset for standards (so they sit on top of the base assembly)
  const baseOffsetFt = getStandardBaseOffsetFt(defaultJackExtensionIn, showWoodSill, showBaseCollar)

  // Catalog preview standards (laid out along +X)
  const standards = useMemo<RinglockStandardInstance[]>(() => {
    const startX = 0
    const spacingX = 2.5 // ft
    const y = 0

    return UNIVERSAL_RINGLOCK_STANDARD_ORDER.map((id, idx) => {
      const spec = UNIVERSAL_RINGLOCK_STANDARDS[id]
      return {
	      id,
				stackId: String(id),
				segmentIndex: 0,
				partNumber: String(id),
        basePosition: new THREE.Vector3(startX + idx * spacingX, y, baseOffsetFt),
        heightFt: spec.heightFt,
        rosetteCount: spec.rosetteCount,
      }
    })
  }, [baseOffsetFt])

  // Base instances for the catalog preview standards
  const catalogBases = useMemo<RinglockBaseInstance[]>(() => {
    const startX = 0
    const spacingX = 2.5 // ft
    const y = 0

	    return UNIVERSAL_RINGLOCK_STANDARD_ORDER.map((id, idx) => ({
      id: `base-${id}`,
      groundPosition: new THREE.Vector3(startX + idx * spacingX, y, 0),
      jackExtensionIn: defaultJackExtensionIn,
			showWoodSill,
			showBaseCollar,
    }))
	  }, [defaultJackExtensionIn, showWoodSill, showBaseCollar])

  // Simple ledger preview: connect between two 9'9" standards at rosette centers.
  const ledgerStandards = useMemo<RinglockStandardInstance[]>(() => {
    const x0 = 0
    const x1 = 7 // 7ft bay for preview
    const y = -6
    const spec = UNIVERSAL_RINGLOCK_STANDARDS.US99
    return [
	    { id: 'LHS', stackId: 'LHS', segmentIndex: 0, partNumber: 'US99', basePosition: new THREE.Vector3(x0, y, baseOffsetFt), heightFt: spec.heightFt, rosetteCount: spec.rosetteCount },
	    { id: 'RHS', stackId: 'RHS', segmentIndex: 0, partNumber: 'US99', basePosition: new THREE.Vector3(x1, y, baseOffsetFt), heightFt: spec.heightFt, rosetteCount: spec.rosetteCount },
    ]
  }, [baseOffsetFt])

  // Base instances for the ledger preview standards
  const ledgerBases = useMemo<RinglockBaseInstance[]>(() => {
    const x0 = 0
    const x1 = 7
    const y = -6
    return [
	      { id: 'base-LHS', groundPosition: new THREE.Vector3(x0, y, 0), jackExtensionIn: defaultJackExtensionIn, showWoodSill, showBaseCollar },
	      { id: 'base-RHS', groundPosition: new THREE.Vector3(x1, y, 0), jackExtensionIn: defaultJackExtensionIn, showWoodSill, showBaseCollar },
    ]
	  }, [defaultJackExtensionIn, showWoodSill, showBaseCollar])

  const ledgers = useMemo<RinglockLedgerInstance[]>(() => {
    const firstRosetteOffsetFt = inchesToFeet(FIRST_ROSETTE_OFFSET_IN)
    const rosetteSpacingFt = inchesToFeet(ROSETTE_SPACING_IN)
    const left = ledgerStandards[0].basePosition
    const right = ledgerStandards[1].basePosition

    // Show first two ledger lifts.
    const zs = [
      left.z + firstRosetteOffsetFt + 0 * rosetteSpacingFt,
      left.z + firstRosetteOffsetFt + 1 * rosetteSpacingFt,
    ]

    return zs.map((z, idx) => ({
      id: `ledger-${idx}`,
      start: new THREE.Vector3(left.x, left.y, z),
      end: new THREE.Vector3(right.x, right.y, z),
    }))
  }, [ledgerStandards])

  // Combine all bases for rendering
  const allBases = useMemo(() => [...catalogBases, ...ledgerBases], [catalogBases, ledgerBases])

  // Combine all standards
  const allStandards = useMemo(() => [...standards, ...ledgerStandards], [standards, ledgerStandards])

  // Register scaffold objects on mount (simplified - in real app would be more sophisticated)
  useEffect(() => {
    // Only register if we don't have any scaffold objects yet (prevent duplicates)
    if (scaffoldObjects.length > 0) return

    // Register standards
    for (const s of allStandards) {
      const obj: StandardObject = {
        id: `standard-${s.id}`,
        componentType: 'standard',
        position: s.basePosition.clone(),
        displayName: `Standard ${s.id}`,
        lengthFt: s.heightFt,
        heightFt: s.heightFt,
        weightLbs: calculateStandardWeight(s.heightFt),
        catalogId: s.id,
        rosetteCount: s.rosetteCount,
      }
      addScaffoldObject(obj)
    }

    // Register ledgers
    for (const l of ledgers) {
      const length = new THREE.Vector3().subVectors(l.end, l.start).length()
      const obj: LedgerObject = {
        id: `ledger-obj-${l.id}`,
        componentType: 'ledger',
        position: new THREE.Vector3().addVectors(l.start, l.end).multiplyScalar(0.5),
        displayName: `Ledger ${Math.round(length * 12)}"`,
        lengthFt: length,
        weightLbs: calculateLedgerWeight(length),
        startPosition: l.start.clone(),
        endPosition: l.end.clone(),
        bayLengthFt: length,
      }
      addScaffoldObject(obj)
    }

    // Register base components
    for (const b of allBases) {
      // Wood sill
      if (showWoodSill) {
        const woodSillObj: WoodSillObject = {
          id: `wood-sill-${b.id}`,
          componentType: 'base-wood-sill',
          position: b.groundPosition.clone(),
          displayName: 'Wood Sill 9"x9"',
          lengthFt: inchesToFeet(9),
          weightLbs: SCAFFOLD_WEIGHTS['wood-sill-9x9'],
          widthIn: 9,
          depthIn: 9,
          thicknessIn: 0.5,
        }
        addScaffoldObject(woodSillObj)
      }

      // Screw jack
      const screwJackObj: ScrewJackObject = {
        id: `screw-jack-${b.id}`,
        componentType: 'base-screw-jack',
        position: b.groundPosition.clone(),
        displayName: `Screw Jack (${b.jackExtensionIn}" ext)`,
        lengthFt: inchesToFeet(b.jackExtensionIn + 2), // base + extension
        weightLbs: SCAFFOLD_WEIGHTS['screw-jack'],
        extensionIn: b.jackExtensionIn,
        basePlateWidthIn: 6,
        basePlateDepthIn: 6,
      }
      addScaffoldObject(screwJackObj)

      // Base collar
      if (showBaseCollar) {
        const baseCollarObj: BaseCollarObject = {
          id: `base-collar-${b.id}`,
          componentType: 'base-collar',
          position: b.groundPosition.clone(),
          displayName: 'Base Collar',
          lengthFt: inchesToFeet(9.437), // total height
          weightLbs: SCAFFOLD_WEIGHTS['base-collar'],
          hasRosette: true,
        }
        addScaffoldObject(baseCollarObj)
      }
    }
  }, []) // Only run once on mount

  // Selection handlers
  const handleStandardSelect = useCallback((standard: RinglockStandardInstance) => {
    if (activeTool !== 'select') return
    setSelectedObjectId(`standard-${standard.id}`)
  }, [activeTool, setSelectedObjectId])

  const handleLedgerSelect = useCallback((ledger: RinglockLedgerInstance) => {
    if (activeTool !== 'select') return
    setSelectedObjectId(`ledger-obj-${ledger.id}`)
  }, [activeTool, setSelectedObjectId])

  const handleBaseSelect = useCallback((base: RinglockBaseInstance, componentType: 'wood-sill' | 'screw-jack' | 'base-collar') => {
    if (activeTool !== 'select') return
    setSelectedObjectId(`${componentType}-${base.id}`)
  }, [activeTool, setSelectedObjectId])

  return (
    <group>
      {/* Render all bases */}
      <RinglockBases
        bases={allBases}
        selectedId={selectedObjectId}
        onSelect={handleBaseSelect}
      />

      {/* All standards with selection support */}
      <RinglockStandards
        standards={allStandards}
        selectedId={selectedObjectId?.replace('standard-', '')}
        onSelect={handleStandardSelect}
      />

      {/* Ledgers with selection support */}
      <RinglockLedgers
        ledgers={ledgers}
        selectedId={selectedObjectId?.replace('ledger-obj-', '')}
        onSelect={handleLedgerSelect}
      />
    </group>
  )
}
