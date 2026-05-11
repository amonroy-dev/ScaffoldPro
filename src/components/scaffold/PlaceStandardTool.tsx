import { useCallback, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { ThreeEvent, useThree, useFrame } from '@react-three/fiber'
import { RinglockStandards, type RinglockStandardInstance } from './RinglockStandards'
import { RinglockBases, type RinglockBaseInstance, getStandardBaseOffsetFt } from './RinglockBases'
import { useScaffoldBaseSettings } from '../../contexts/ScaffoldBaseSettings'
import { useTool } from '../../contexts/ToolContext'
import { useCatalogSelection } from '../../contexts/CatalogContext'
import { UNIVERSAL_RINGLOCK_STANDARDS, type UniversalRinglockStandardId } from './ringlockCatalog'
import { useSettings } from '../../contexts/SettingsContext'

// Reusable objects to avoid GC
const _raycaster = new THREE.Raycaster()
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0) // Z-up plane at Z=0
const _intersectPoint = new THREE.Vector3()

/**
 * Snap a value to the nearest grid step.
 */
function snapToGrid(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

/**
 * PlaceStandardTool - Ghost preview and click-to-place for standards.
 * 
 * Shows a semi-transparent preview of the selected standard that follows the cursor.
 * Clicking places the standard at the snapped grid position.
 */
export function PlaceStandardTool() {
  const { baseSettings } = useScaffoldBaseSettings()
  const { showWoodSill, showBaseCollar, defaultJackExtensionIn } = baseSettings
  const { addScaffoldStack, workspaceMode } = useTool()
  const { categoryKey, selectedPart } = useCatalogSelection()
  const { settings } = useSettings()
  const { camera } = useThree()

  // Ghost preview refs
  const ghostGroupRef = useRef<THREE.Group>(null)
  const ghostPositionRef = useRef(new THREE.Vector3())
  const isVisibleRef = useRef(false)

  // Determine if we're in "place standard" mode
  const isPlacingStandard = useMemo(() => {
    return workspaceMode === 'SCAFFOLD_MODE' && categoryKey === 'standards' && selectedPart !== null
  }, [workspaceMode, categoryKey, selectedPart])

  // Get the part number (e.g., 'US99')
  const partNumber = selectedPart?.partNumber ?? ''

  // Get spec for the selected standard
  const spec = useMemo(() => {
    if (!partNumber) return null
    return UNIVERSAL_RINGLOCK_STANDARDS[partNumber as UniversalRinglockStandardId] ?? null
  }, [partNumber])

  // Calculate base offset for ghost preview
  const baseOffsetFt = useMemo(() => {
    return getStandardBaseOffsetFt(defaultJackExtensionIn, showWoodSill, showBaseCollar)
  }, [defaultJackExtensionIn, showWoodSill, showBaseCollar])

  // Ghost instances for preview
  const ghostStandard = useMemo<RinglockStandardInstance | null>(() => {
    if (!spec) return null
    return {
	    id: 'ghost-standard',
			stackId: 'ghost-standard',
			segmentIndex: 0,
			partNumber: partNumber || 'UNKNOWN',
      basePosition: new THREE.Vector3(0, 0, baseOffsetFt),
      heightFt: spec.heightFt,
      rosetteCount: spec.rosetteCount,
    }
	}, [spec, baseOffsetFt, partNumber])

  const ghostBase = useMemo<RinglockBaseInstance | null>(() => {
    if (!spec) return null
    return {
      id: 'ghost-base',
      groundPosition: new THREE.Vector3(0, 0, 0),
      jackExtensionIn: defaultJackExtensionIn,
			showWoodSill,
			showBaseCollar,
    }
	}, [spec, defaultJackExtensionIn, showWoodSill, showBaseCollar])

  // Update ghost position every frame
  useFrame((state) => {
    if (!ghostGroupRef.current || !isPlacingStandard) {
      if (ghostGroupRef.current) ghostGroupRef.current.visible = false
      isVisibleRef.current = false
      return
    }

    // Raycast to ground plane
    _raycaster.setFromCamera(state.pointer, camera)
    const hit = _raycaster.ray.intersectPlane(_groundPlane, _intersectPoint)

    if (hit) {
      // Snap to grid
      const gridStep = settings.snapToGrid ? settings.gridSize : 0.5
      const snappedX = snapToGrid(_intersectPoint.x, gridStep)
      const snappedY = snapToGrid(_intersectPoint.y, gridStep)

      ghostPositionRef.current.set(snappedX, snappedY, 0)
      ghostGroupRef.current.position.set(snappedX, snappedY, 0)
      ghostGroupRef.current.visible = true
      isVisibleRef.current = true
    } else {
      ghostGroupRef.current.visible = false
      isVisibleRef.current = false
    }
  })

	// Use pointer-down (not click) so placement is reliable even if the mouse moves slightly
	// (e.g., OrbitControls jitter).
	const handlePointerDown = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!isPlacingStandard || !isVisibleRef.current || !partNumber) return
    if (event.button !== 0) return

	  event.stopPropagation()

    // Place the stack at the ghost position
    addScaffoldStack(
      ghostPositionRef.current.clone(),
      partNumber,
	      defaultJackExtensionIn,
				{ baseSupport: 'grid' }
    )
	}, [isPlacingStandard, partNumber, addScaffoldStack, defaultJackExtensionIn])

  // Don't render if not placing
  if (!isPlacingStandard || !ghostStandard || !ghostBase) {
    return null
  }

  return (
    <group ref={ghostGroupRef} visible={false}>
      {/* Semi-transparent ghost preview */}
      <RinglockBases
        bases={[ghostBase]}
      />
      <RinglockStandards standards={[ghostStandard]} />

	  	{/*
	  	  Invisible interaction plane to capture pointer events.
	  	  NOTE: Must remain `visible` so Three/R3F raycasting can hit it.
	  	*/}
	  	<mesh visible onPointerDown={handlePointerDown}>
        <planeGeometry args={[1000, 1000]} />
	  	  <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  )
}
