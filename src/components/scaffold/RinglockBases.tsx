import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { ThreeEvent } from '@react-three/fiber'
import { WORKSPACE_LAYERS } from '../../contexts/ToolContext'
import { inchesToFeet } from './units'

/**
 * Base assembly instance data.
 * Each standard that sits on ground/shape gets one of these.
 */
export type RinglockBaseInstance = {
  id: string
  /** Position at ground level (bottom of wood sill or base plate if no sill) */
  groundPosition: THREE.Vector3
  /** Screw jack extension in inches (0–12) */
  jackExtensionIn: number
	/** Per-instance visibility (effective values) */
	showWoodSill: boolean
	showBaseCollar: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Dimensions (all in inches, converted to feet at render time)
// ─────────────────────────────────────────────────────────────────────────────

// Wood sill: 9" x 9" x 0.5" thick
const WOOD_SILL = {
  widthIn: 9,
  depthIn: 9,
  thicknessIn: 0.5,
}

// Screw jack base plate: 6" x 6" x 3/8" thick
const JACK_PLATE = {
  widthIn: 6,
  depthIn: 6,
  thicknessIn: 0.375,
}

// Screw jack stem: 1.57" diameter (solid cylinder visually)
const JACK_STEM = {
  diameterIn: 1.57,
  // Base height before extension (the fixed portion below the nut)
  baseHeightIn: 2,
}

// Screw jack wing nut assembly (from reference image):
// - Central collar ring around the stem
// - Two long handles extending outward (butterfly/wing style)
const JACK_NUT_COLLAR = {
  outerDiameterIn: 2.0,   // Collar ring around stem
  thicknessIn: 0.75,      // Height of the collar
}

const JACK_NUT_HANDLE = {
  lengthIn: 8,            // Total length of each handle (extends from center)
  widthIn: 1.0,           // Width of the handle bar
  thicknessIn: 0.5,       // Thickness of the handle bar
}

// Base collar dimensions (from user's annotated drawing)
// Lower sleeve: 1.9" OD x 0.120" wall x 7" tall (3.563" below rosette top + 3.437" above rosette top)
const COLLAR_LOWER = {
  outerDiameterIn: 1.9,
  wallIn: 0.12,
  heightIn: 7.0, // 3.563 + 3.437 = 6.999 ≈ 7"
}

// Upper socket: 2.25" OD x 0.120" wall x 6" tall (where standard inserts)
// Sits on top of the lower sleeve
const COLLAR_UPPER = {
  outerDiameterIn: 2.25,
  wallIn: 0.12,
  heightIn: 6,
}

// Rosette on base collar: same as standard rosettes
const COLLAR_ROSETTE = {
  diameterIn: 4.84,
  thicknessIn: 0.36,
}

// Distance from bottom of lower sleeve to CENTER of rosette
// (3.563" to top of rosette + 0.18" half thickness = 3.743" to center)
const COLLAR_ROSETTE_CENTER_FROM_BOTTOM_IN = 3.743

// Pre-allocate instance buffer pools so R3F never recreates the InstancedMesh
// when the visible count changes (see RinglockStandards.tsx for full explanation).
const BASE_POOL = 500       // screw-jack parts (one per stack)
const WOOD_SILL_POOL = 500  // wood sills (optional per stack)
const COLLAR_POOL = 500     // base collar parts (optional per stack)

// ─────────────────────────────────────────────────────────────────────────────
// Materials (shared across instances)
// ─────────────────────────────────────────────────────────────────────────────

const STEEL_COLOR = '#b8bcc0'
const STEEL_METALNESS = 0.32
const STEEL_ROUGHNESS = 0.28

const ROSETTE_COLOR = '#6a6f75'
const ROSETTE_METALNESS = 0.22
const ROSETTE_ROUGHNESS = 0.55

const WOOD_COLOR = '#c4a574'
const WOOD_METALNESS = 0
const WOOD_ROUGHNESS = 0.85

// Selection highlight overlay (keeps original base colors intact)
const SELECTED_OVERLAY_COLOR = '#a855f7'

// ─────────────────────────────────────────────────────────────────────────────
// Component Props
// ─────────────────────────────────────────────────────────────────────────────

export type RinglockBasesProps = {
  bases: RinglockBaseInstance[]
  layer?: number
  /** Currently selected base ID (for visual feedback) */
  selectedId?: string | null
  /** Callback when a base component is clicked */
  onSelect?: (
		base: RinglockBaseInstance,
		componentType: 'wood-sill' | 'screw-jack' | 'base-collar',
		e?: ThreeEvent<PointerEvent>
	) => void
	clippingPlanes?: THREE.Plane[]
}

/**
 * Instanced rendering for Ringlock base assemblies.
 *
 * Stack (bottom to top):
 * 1. Wood sill (optional)
 * 2. Screw jack: base plate + stem + nut
 * 3. Base collar (optional): lower sleeve + rosette + upper socket
 *
	 * The standard's basePosition should be at the *bottom of the upper socket*
	 * (standard inserts ~6" into the collar).
 */
export function RinglockBases({
  bases,
  layer = WORKSPACE_LAYERS.SCAFFOLD,
  selectedId,
  onSelect,
	clippingPlanes,
}: RinglockBasesProps) {
	const woodSillBases = useMemo(() => bases.filter(b => b.showWoodSill), [bases])
	const baseCollarBases = useMemo(() => bases.filter(b => b.showBaseCollar), [bases])
	const clipShadows = Boolean(clippingPlanes?.length)

  // Refs for instanced meshes
  const woodSillRef = useRef<THREE.InstancedMesh>(null)
  const jackPlateRef = useRef<THREE.InstancedMesh>(null)
  const jackStemRef = useRef<THREE.InstancedMesh>(null)
  const jackNutCollarRef = useRef<THREE.InstancedMesh>(null)
  const jackNutHandleRef = useRef<THREE.InstancedMesh>(null)
  const collarLowerRef = useRef<THREE.InstancedMesh>(null)
  const collarRosetteRef = useRef<THREE.InstancedMesh>(null)
  const collarUpperRef = useRef<THREE.InstancedMesh>(null)

	// Tag interactive meshes with metadata so ScaffoldWorkspace can implement
	// CAD-style selection cycling/select-through using event.intersections.
	useEffect(() => {
		if (woodSillRef.current) {
			woodSillRef.current.userData.scaffPickKind = 'base'
			woodSillRef.current.userData.scaffBaseComponentType = 'wood-sill'
			woodSillRef.current.userData.scaffItems = woodSillBases
		}

		for (const r of [jackPlateRef, jackStemRef, jackNutCollarRef, jackNutHandleRef]) {
			if (!r.current) continue
			r.current.userData.scaffPickKind = 'base'
			r.current.userData.scaffBaseComponentType = 'screw-jack'
			r.current.userData.scaffItems = bases
		}

		for (const r of [collarLowerRef, collarRosetteRef, collarUpperRef]) {
			if (!r.current) continue
			r.current.userData.scaffPickKind = 'base'
			r.current.userData.scaffBaseComponentType = 'base-collar'
			r.current.userData.scaffItems = baseCollarBases
		}
	}, [bases, woodSillBases, baseCollarBases])

  // Overlay highlight meshes (non-interactive)
  const woodHighlightRef = useRef<THREE.Mesh>(null)
	const jackPlateHighlightRef = useRef<THREE.Mesh>(null)
	const jackStemHighlightRef = useRef<THREE.Mesh>(null)
	const jackNutCollarHighlightRef = useRef<THREE.Mesh>(null)
	const jackNutHandleHighlightRef = useRef<THREE.Mesh>(null)
	const collarLowerHighlightRef = useRef<THREE.Mesh>(null)
	const collarRosetteHighlightRef = useRef<THREE.Mesh>(null)
	const collarUpperHighlightRef = useRef<THREE.Mesh>(null)

  // Convert dimensions to feet
  const woodSillWidthFt = inchesToFeet(WOOD_SILL.widthIn)
  const woodSillDepthFt = inchesToFeet(WOOD_SILL.depthIn)
  const woodSillThickFt = inchesToFeet(WOOD_SILL.thicknessIn)

  const jackPlateWidthFt = inchesToFeet(JACK_PLATE.widthIn)
  const jackPlateDepthFt = inchesToFeet(JACK_PLATE.depthIn)
  const jackPlateThickFt = inchesToFeet(JACK_PLATE.thicknessIn)

  const jackStemRadiusFt = inchesToFeet(JACK_STEM.diameterIn) / 2
  const jackStemBaseHeightFt = inchesToFeet(JACK_STEM.baseHeightIn)

  // Wing nut dimensions
  const jackNutCollarRadiusFt = inchesToFeet(JACK_NUT_COLLAR.outerDiameterIn) / 2
  const jackNutCollarThickFt = inchesToFeet(JACK_NUT_COLLAR.thicknessIn)
  const jackNutHandleLengthFt = inchesToFeet(JACK_NUT_HANDLE.lengthIn)
  const jackNutHandleWidthFt = inchesToFeet(JACK_NUT_HANDLE.widthIn)
  const jackNutHandleThickFt = inchesToFeet(JACK_NUT_HANDLE.thicknessIn)

  const collarLowerRadiusFt = inchesToFeet(COLLAR_LOWER.outerDiameterIn) / 2
  const collarLowerHeightFt = inchesToFeet(COLLAR_LOWER.heightIn)

  const collarUpperRadiusFt = inchesToFeet(COLLAR_UPPER.outerDiameterIn) / 2
  const collarUpperHeightFt = inchesToFeet(COLLAR_UPPER.heightIn)

  const collarRosetteRadiusFt = inchesToFeet(COLLAR_ROSETTE.diameterIn) / 2
  const collarRosetteThickFt = inchesToFeet(COLLAR_ROSETTE.thicknessIn)

  const collarRosetteCenterFromBottomFt = inchesToFeet(COLLAR_ROSETTE_CENTER_FROM_BOTTOM_IN)

  // ─────────────────────────────────────────────────────────────────────────
  // Geometries (memoized)
  // ─────────────────────────────────────────────────────────────────────────

  const woodSillGeom = useMemo(() => {
    return new THREE.BoxGeometry(woodSillWidthFt, woodSillDepthFt, woodSillThickFt)
  }, [woodSillWidthFt, woodSillDepthFt, woodSillThickFt])

  const jackPlateGeom = useMemo(() => {
    return new THREE.BoxGeometry(jackPlateWidthFt, jackPlateDepthFt, jackPlateThickFt)
  }, [jackPlateWidthFt, jackPlateDepthFt, jackPlateThickFt])

  // Unit-height cylinder for stem (will be scaled per instance)
  const jackStemGeom = useMemo(() => {
    return new THREE.CylinderGeometry(jackStemRadiusFt, jackStemRadiusFt, 1, 16, 1, false)
      .rotateX(Math.PI / 2)
  }, [jackStemRadiusFt])

  // Wing nut: central collar (cylinder around stem)
  const jackNutCollarGeom = useMemo(() => {
    return new THREE.CylinderGeometry(jackNutCollarRadiusFt, jackNutCollarRadiusFt, jackNutCollarThickFt, 16, 1, false)
      .rotateX(Math.PI / 2)
  }, [jackNutCollarRadiusFt, jackNutCollarThickFt])

  // Wing nut: handle bar (long box extending through center)
  // The handle extends the full length (both wings as one piece)
  const jackNutHandleGeom = useMemo(() => {
    return new THREE.BoxGeometry(jackNutHandleLengthFt, jackNutHandleWidthFt, jackNutHandleThickFt)
  }, [jackNutHandleLengthFt, jackNutHandleWidthFt, jackNutHandleThickFt])

  const collarLowerGeom = useMemo(() => {
    return new THREE.CylinderGeometry(collarLowerRadiusFt, collarLowerRadiusFt, collarLowerHeightFt, 16, 1, false)
      .rotateX(Math.PI / 2)
  }, [collarLowerRadiusFt, collarLowerHeightFt])

  const collarRosetteGeom = useMemo(() => {
    return new THREE.CylinderGeometry(collarRosetteRadiusFt, collarRosetteRadiusFt, collarRosetteThickFt, 24, 1, false)
      .rotateX(Math.PI / 2)
  }, [collarRosetteRadiusFt, collarRosetteThickFt])

  const collarUpperGeom = useMemo(() => {
    return new THREE.CylinderGeometry(collarUpperRadiusFt, collarUpperRadiusFt, collarUpperHeightFt, 16, 1, false)
      .rotateX(Math.PI / 2)
  }, [collarUpperRadiusFt, collarUpperHeightFt])

  // Cleanup geometries on unmount
  useEffect(() => {
    return () => {
      woodSillGeom.dispose()
      jackPlateGeom.dispose()
      jackStemGeom.dispose()
      jackNutCollarGeom.dispose()
      jackNutHandleGeom.dispose()
      collarLowerGeom.dispose()
      collarRosetteGeom.dispose()
      collarUpperGeom.dispose()
    }
  }, [woodSillGeom, jackPlateGeom, jackStemGeom, jackNutCollarGeom, jackNutHandleGeom, collarLowerGeom, collarRosetteGeom, collarUpperGeom])

  // Set layers on all meshes
  useEffect(() => {
    const meshes = [
      woodSillRef.current,
      jackPlateRef.current,
      jackStemRef.current,
      jackNutCollarRef.current,
      jackNutHandleRef.current,
      collarLowerRef.current,
      collarRosetteRef.current,
      collarUpperRef.current,
    ]
    meshes.forEach(m => m?.layers.set(layer))
  }, [layer])

  // ─────────────────────────────────────────────────────────────────────────
  // Instance matrix updates
  // ─────────────────────────────────────────────────────────────────────────

  useLayoutEffect(() => {
    const tmpPos = new THREE.Vector3()
    const tmpQuat = new THREE.Quaternion()
    const tmpScale = new THREE.Vector3(1, 1, 1)
    const tmpMatrix = new THREE.Matrix4()
    tmpQuat.identity()

		// IMPORTANT: Explicitly keep InstancedMesh `.count` in sync with the current
		// instance totals. This prevents removed bases/rosettes from lingering as
		// stale instances (a common InstancedMesh pitfall with dynamic lists).
		const jackCount = bases.length
		const woodCount = woodSillBases.length
		const collarCount = baseCollarBases.length
		if (woodSillRef.current) woodSillRef.current.count = woodCount
		if (jackPlateRef.current) jackPlateRef.current.count = jackCount
		if (jackStemRef.current) jackStemRef.current.count = jackCount
		if (jackNutCollarRef.current) jackNutCollarRef.current.count = jackCount
		if (jackNutHandleRef.current) jackNutHandleRef.current.count = jackCount
		if (collarLowerRef.current) collarLowerRef.current.count = collarCount
		if (collarRosetteRef.current) collarRosetteRef.current.count = collarCount
		if (collarUpperRef.current) collarUpperRef.current.count = collarCount

		if (bases.length === 0) return

		let woodIdx = 0
		let collarIdx = 0
		for (let i = 0; i < bases.length; i++) {
      const b = bases[i]
      const gx = b.groundPosition.x
      const gy = b.groundPosition.y
      let gz = b.groundPosition.z

      const extensionFt = inchesToFeet(b.jackExtensionIn)

      // 1. Wood sill (if shown)
			if (b.showWoodSill && woodSillRef.current) {
        tmpPos.set(gx, gy, gz + woodSillThickFt / 2)
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
				woodSillRef.current.setMatrixAt(woodIdx, tmpMatrix)
				woodIdx++
        gz += woodSillThickFt
      }

      // 2. Jack base plate
      if (jackPlateRef.current) {
        tmpPos.set(gx, gy, gz + jackPlateThickFt / 2)
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
        jackPlateRef.current.setMatrixAt(i, tmpMatrix)
      }
      const plateTopZ = gz + jackPlateThickFt

      // 3. Jack stem (variable height based on extension)
      const stemTotalHeightFt = jackStemBaseHeightFt + extensionFt
      if (jackStemRef.current) {
        tmpPos.set(gx, gy, plateTopZ + stemTotalHeightFt / 2)
        tmpScale.set(1, 1, stemTotalHeightFt)
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
        jackStemRef.current.setMatrixAt(i, tmpMatrix)
        tmpScale.set(1, 1, 1)
      }

      // 4. Wing nut (at top of stem)
      // The nut sits at the top of the stem - collar and handle share same Z center
      const nutCenterZ = plateTopZ + stemTotalHeightFt - jackNutCollarThickFt / 2

      // Wing nut collar (cylinder around stem)
      if (jackNutCollarRef.current) {
        tmpPos.set(gx, gy, nutCenterZ)
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
        jackNutCollarRef.current.setMatrixAt(i, tmpMatrix)
      }

      // Wing nut handle (long bar through center)
      if (jackNutHandleRef.current) {
        tmpPos.set(gx, gy, nutCenterZ)
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
        jackNutHandleRef.current.setMatrixAt(i, tmpMatrix)
      }

      // 5. Base collar (if shown) - sits on top of nut
			if (b.showBaseCollar) {
        const collarBaseZ = plateTopZ + stemTotalHeightFt

        // Lower sleeve (1.9" tube, 7" tall - rosette is embedded in the middle)
        if (collarLowerRef.current) {
          tmpPos.set(gx, gy, collarBaseZ + collarLowerHeightFt / 2)
          tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
					collarLowerRef.current.setMatrixAt(collarIdx, tmpMatrix)
        }

        // Rosette center is at collarRosetteCenterFromBottomFt from bottom of collar
        const rosetteZ = collarBaseZ + collarRosetteCenterFromBottomFt
        if (collarRosetteRef.current) {
          tmpPos.set(gx, gy, rosetteZ)
          tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
					collarRosetteRef.current.setMatrixAt(collarIdx, tmpMatrix)
        }

        // Upper socket (2.25" tube) sits on TOP of the lower sleeve
        const upperStartZ = collarBaseZ + collarLowerHeightFt
        if (collarUpperRef.current) {
          tmpPos.set(gx, gy, upperStartZ + collarUpperHeightFt / 2)
          tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
					collarUpperRef.current.setMatrixAt(collarIdx, tmpMatrix)
        }

				collarIdx++
      }
    }

    // Mark all instance matrices as needing update
    woodSillRef.current?.instanceMatrix && (woodSillRef.current.instanceMatrix.needsUpdate = true)
    jackPlateRef.current?.instanceMatrix && (jackPlateRef.current.instanceMatrix.needsUpdate = true)
    jackStemRef.current?.instanceMatrix && (jackStemRef.current.instanceMatrix.needsUpdate = true)
    jackNutCollarRef.current?.instanceMatrix && (jackNutCollarRef.current.instanceMatrix.needsUpdate = true)
    jackNutHandleRef.current?.instanceMatrix && (jackNutHandleRef.current.instanceMatrix.needsUpdate = true)
    collarLowerRef.current?.instanceMatrix && (collarLowerRef.current.instanceMatrix.needsUpdate = true)
    collarRosetteRef.current?.instanceMatrix && (collarRosetteRef.current.instanceMatrix.needsUpdate = true)
    collarUpperRef.current?.instanceMatrix && (collarUpperRef.current.instanceMatrix.needsUpdate = true)
	}, [bases, woodSillBases, baseCollarBases, woodSillThickFt, jackPlateThickFt, jackStemBaseHeightFt, jackNutCollarThickFt, collarLowerHeightFt, collarRosetteThickFt, collarUpperHeightFt, collarRosetteCenterFromBottomFt])

  // Parse selectedId to determine which base and component type is selected
  // Format: "wood-sill-{baseId}", "screw-jack-{baseId}", or "base-collar-{baseId}"
  const selectedBaseId = selectedId?.split('-').slice(2).join('-') || null
  const selectedType = selectedId?.startsWith('wood-sill-') ? 'wood-sill'
    : selectedId?.startsWith('screw-jack-') ? 'screw-jack'
    : selectedId?.startsWith('base-collar-') ? 'base-collar'
    : null
  const selectedIndex = selectedBaseId ? bases.findIndex(b => b.id === selectedBaseId) : -1
	const selectedWoodIndex = selectedBaseId ? woodSillBases.findIndex(b => b.id === selectedBaseId) : -1
	const selectedCollarIndex = selectedBaseId ? baseCollarBases.findIndex(b => b.id === selectedBaseId) : -1

  // Update overlay highlight transforms based on selection
  useLayoutEffect(() => {
    const tmp = new THREE.Matrix4()

    const hideAll = () => {
      if (woodHighlightRef.current) woodHighlightRef.current.visible = false
			if (jackPlateHighlightRef.current) jackPlateHighlightRef.current.visible = false
			if (jackStemHighlightRef.current) jackStemHighlightRef.current.visible = false
			if (jackNutCollarHighlightRef.current) jackNutCollarHighlightRef.current.visible = false
			if (jackNutHandleHighlightRef.current) jackNutHandleHighlightRef.current.visible = false
			if (collarLowerHighlightRef.current) collarLowerHighlightRef.current.visible = false
			if (collarRosetteHighlightRef.current) collarRosetteHighlightRef.current.visible = false
			if (collarUpperHighlightRef.current) collarUpperHighlightRef.current.visible = false
    }

    hideAll()

    if (selectedIndex < 0 || selectedIndex >= bases.length) return

		if (selectedType === 'wood-sill' && selectedWoodIndex >= 0 && woodSillRef.current && woodHighlightRef.current) {
			woodSillRef.current.getMatrixAt(selectedWoodIndex, tmp)
      woodHighlightRef.current.matrix.copy(tmp)
      woodHighlightRef.current.visible = true
      return
    }

		if (selectedType === 'screw-jack') {
			// Highlight the full screw jack assembly: plate + stem + nut collar + handle
			if (jackPlateRef.current && jackPlateHighlightRef.current) {
				jackPlateRef.current.getMatrixAt(selectedIndex, tmp)
				jackPlateHighlightRef.current.matrix.copy(tmp)
				jackPlateHighlightRef.current.visible = true
			}
			if (jackStemRef.current && jackStemHighlightRef.current) {
				jackStemRef.current.getMatrixAt(selectedIndex, tmp)
				jackStemHighlightRef.current.matrix.copy(tmp)
				jackStemHighlightRef.current.visible = true
			}
			if (jackNutCollarRef.current && jackNutCollarHighlightRef.current) {
				jackNutCollarRef.current.getMatrixAt(selectedIndex, tmp)
				jackNutCollarHighlightRef.current.matrix.copy(tmp)
				jackNutCollarHighlightRef.current.visible = true
			}
			if (jackNutHandleRef.current && jackNutHandleHighlightRef.current) {
				jackNutHandleRef.current.getMatrixAt(selectedIndex, tmp)
				jackNutHandleHighlightRef.current.matrix.copy(tmp)
				jackNutHandleHighlightRef.current.visible = true
			}
			return
		}

		if (selectedType === 'base-collar' && selectedCollarIndex >= 0) {
			// Highlight the full base collar assembly: lower sleeve + rosette + upper socket
			if (collarLowerRef.current && collarLowerHighlightRef.current) {
				collarLowerRef.current.getMatrixAt(selectedCollarIndex, tmp)
				collarLowerHighlightRef.current.matrix.copy(tmp)
				collarLowerHighlightRef.current.visible = true
			}
			if (collarRosetteRef.current && collarRosetteHighlightRef.current) {
				collarRosetteRef.current.getMatrixAt(selectedCollarIndex, tmp)
				collarRosetteHighlightRef.current.matrix.copy(tmp)
				collarRosetteHighlightRef.current.visible = true
			}
			if (collarUpperRef.current && collarUpperHighlightRef.current) {
				collarUpperRef.current.getMatrixAt(selectedCollarIndex, tmp)
				collarUpperHighlightRef.current.matrix.copy(tmp)
				collarUpperHighlightRef.current.visible = true
			}
			return
		}
	}, [bases, selectedIndex, selectedWoodIndex, selectedCollarIndex, selectedType])

  // Select on pointer-down (more reliable than onClick with orbit controls)
  const handleWoodSillPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
    if (!onSelect) return
		const instanceId = e.instanceId
		if (instanceId !== undefined && instanceId < woodSillBases.length) {
				onSelect(woodSillBases[instanceId], 'wood-sill', e)
		}
  }

  const handleScrewJackPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
    if (!onSelect) return
    const instanceId = e.instanceId
    if (instanceId !== undefined && instanceId < bases.length) {
	      onSelect(bases[instanceId], 'screw-jack', e)
    }
  }

  const handleBaseCollarPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
    if (!onSelect) return
		const instanceId = e.instanceId
		if (instanceId !== undefined && instanceId < baseCollarBases.length) {
				onSelect(baseCollarBases[instanceId], 'base-collar', e)
		}
  }

  return (
    <group>
      {/* Wood Sill */}
      <instancedMesh
        ref={woodSillRef}
        args={[undefined, undefined, WOOD_SILL_POOL]}
        frustumCulled={false}
        castShadow
        receiveShadow
        onPointerDown={onSelect ? handleWoodSillPointerDown : undefined}
      >
        <primitive object={woodSillGeom} attach="geometry" />
        <meshStandardMaterial color={WOOD_COLOR} metalness={WOOD_METALNESS} roughness={WOOD_ROUGHNESS} clippingPlanes={clippingPlanes} clipShadows={clipShadows} />
      </instancedMesh>

      {/* Jack Base Plate */}
      <instancedMesh
        ref={jackPlateRef}
        args={[undefined, undefined, BASE_POOL]}
        frustumCulled={false}
        castShadow
        receiveShadow
	      onPointerDown={onSelect ? handleScrewJackPointerDown : undefined}
      >
        <primitive object={jackPlateGeom} attach="geometry" />
        <meshStandardMaterial color={STEEL_COLOR} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} clippingPlanes={clippingPlanes} clipShadows={clipShadows} />
      </instancedMesh>

      {/* Jack Stem */}
      <instancedMesh
        ref={jackStemRef}
        args={[undefined, undefined, BASE_POOL]}
        frustumCulled={false}
        castShadow
	      onPointerDown={onSelect ? handleScrewJackPointerDown : undefined}
      >
        <primitive object={jackStemGeom} attach="geometry" />
        <meshStandardMaterial color={STEEL_COLOR} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} clippingPlanes={clippingPlanes} clipShadows={clipShadows} />
      </instancedMesh>

      {/* Wing Nut - Collar */}
      <instancedMesh
        ref={jackNutCollarRef}
        args={[undefined, undefined, BASE_POOL]}
        frustumCulled={false}
        castShadow
	      onPointerDown={onSelect ? handleScrewJackPointerDown : undefined}
      >
        <primitive object={jackNutCollarGeom} attach="geometry" />
        <meshStandardMaterial color={ROSETTE_COLOR} metalness={ROSETTE_METALNESS} roughness={ROSETTE_ROUGHNESS} clippingPlanes={clippingPlanes} clipShadows={clipShadows} />
      </instancedMesh>

      {/* Wing Nut - Handle */}
      <instancedMesh
        ref={jackNutHandleRef}
        args={[undefined, undefined, BASE_POOL]}
        frustumCulled={false}
        castShadow
	      onPointerDown={onSelect ? handleScrewJackPointerDown : undefined}
      >
        <primitive object={jackNutHandleGeom} attach="geometry" />
        <meshStandardMaterial color={ROSETTE_COLOR} metalness={ROSETTE_METALNESS} roughness={ROSETTE_ROUGHNESS} clippingPlanes={clippingPlanes} clipShadows={clipShadows} />
      </instancedMesh>

      {/* Base Collar - Lower Sleeve */}
      <instancedMesh
        ref={collarLowerRef}
        args={[undefined, undefined, COLLAR_POOL]}
        frustumCulled={false}
        castShadow
        onPointerDown={onSelect ? handleBaseCollarPointerDown : undefined}
      >
        <primitive object={collarLowerGeom} attach="geometry" />
        <meshStandardMaterial color={STEEL_COLOR} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} clippingPlanes={clippingPlanes} clipShadows={clipShadows} />
      </instancedMesh>

      {/* Base Collar - Rosette */}
      <instancedMesh
        ref={collarRosetteRef}
        args={[undefined, undefined, COLLAR_POOL]}
        frustumCulled={false}
        castShadow
        onPointerDown={onSelect ? handleBaseCollarPointerDown : undefined}
      >
        <primitive object={collarRosetteGeom} attach="geometry" />
        <meshStandardMaterial color={ROSETTE_COLOR} metalness={ROSETTE_METALNESS} roughness={ROSETTE_ROUGHNESS} clippingPlanes={clippingPlanes} clipShadows={clipShadows} />
      </instancedMesh>

      {/* Base Collar - Upper Socket */}
      <instancedMesh
        ref={collarUpperRef}
        args={[undefined, undefined, COLLAR_POOL]}
        frustumCulled={false}
        castShadow
        onPointerDown={onSelect ? handleBaseCollarPointerDown : undefined}
      >
        <primitive object={collarUpperGeom} attach="geometry" />
        <meshStandardMaterial color={STEEL_COLOR} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} clippingPlanes={clippingPlanes} clipShadows={clipShadows} />
      </instancedMesh>

      {/* Overlay highlights (non-interactive) */}
      <mesh ref={woodHighlightRef} visible={false} matrixAutoUpdate={false} raycast={() => null} renderOrder={10}>
        <primitive object={woodSillGeom} attach="geometry" />
        <meshStandardMaterial
          color={SELECTED_OVERLAY_COLOR}
          emissive={SELECTED_OVERLAY_COLOR}
          emissiveIntensity={0.35}
          transparent
          opacity={0.32}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
					clippingPlanes={clippingPlanes}
        />
      </mesh>

		{/* Screw jack overlay pieces */}
		<mesh ref={jackPlateHighlightRef} visible={false} matrixAutoUpdate={false} raycast={() => null} renderOrder={10}>
			<primitive object={jackPlateGeom} attach="geometry" />
				<meshStandardMaterial color={SELECTED_OVERLAY_COLOR} emissive={SELECTED_OVERLAY_COLOR} emissiveIntensity={0.35} transparent opacity={0.32} depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} clippingPlanes={clippingPlanes} />
		</mesh>
		<mesh ref={jackStemHighlightRef} visible={false} matrixAutoUpdate={false} raycast={() => null} renderOrder={10}>
			<primitive object={jackStemGeom} attach="geometry" />
				<meshStandardMaterial color={SELECTED_OVERLAY_COLOR} emissive={SELECTED_OVERLAY_COLOR} emissiveIntensity={0.35} transparent opacity={0.32} depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} clippingPlanes={clippingPlanes} />
		</mesh>
		<mesh ref={jackNutCollarHighlightRef} visible={false} matrixAutoUpdate={false} raycast={() => null} renderOrder={10}>
			<primitive object={jackNutCollarGeom} attach="geometry" />
				<meshStandardMaterial color={SELECTED_OVERLAY_COLOR} emissive={SELECTED_OVERLAY_COLOR} emissiveIntensity={0.35} transparent opacity={0.32} depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} clippingPlanes={clippingPlanes} />
		</mesh>
		<mesh ref={jackNutHandleHighlightRef} visible={false} matrixAutoUpdate={false} raycast={() => null} renderOrder={10}>
			<primitive object={jackNutHandleGeom} attach="geometry" />
				<meshStandardMaterial color={SELECTED_OVERLAY_COLOR} emissive={SELECTED_OVERLAY_COLOR} emissiveIntensity={0.35} transparent opacity={0.32} depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} clippingPlanes={clippingPlanes} />
		</mesh>

		{/* Base collar overlay pieces */}
		<mesh ref={collarLowerHighlightRef} visible={false} matrixAutoUpdate={false} raycast={() => null} renderOrder={10}>
			<primitive object={collarLowerGeom} attach="geometry" />
				<meshStandardMaterial color={SELECTED_OVERLAY_COLOR} emissive={SELECTED_OVERLAY_COLOR} emissiveIntensity={0.35} transparent opacity={0.32} depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} clippingPlanes={clippingPlanes} />
		</mesh>
		<mesh ref={collarRosetteHighlightRef} visible={false} matrixAutoUpdate={false} raycast={() => null} renderOrder={10}>
			<primitive object={collarRosetteGeom} attach="geometry" />
				<meshStandardMaterial color={SELECTED_OVERLAY_COLOR} emissive={SELECTED_OVERLAY_COLOR} emissiveIntensity={0.35} transparent opacity={0.32} depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} clippingPlanes={clippingPlanes} />
		</mesh>
		<mesh ref={collarUpperHighlightRef} visible={false} matrixAutoUpdate={false} raycast={() => null} renderOrder={10}>
			<primitive object={collarUpperGeom} attach="geometry" />
				<meshStandardMaterial color={SELECTED_OVERLAY_COLOR} emissive={SELECTED_OVERLAY_COLOR} emissiveIntensity={0.35} transparent opacity={0.32} depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} clippingPlanes={clippingPlanes} />
		</mesh>
    </group>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Calculate standard base Z offset
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate the Z offset from ground to where the standard's base should be.
 * This accounts for wood sill, screw jack, and base collar heights.
 */
export function getStandardBaseOffsetFt(
  jackExtensionIn: number,
  showWoodSill: boolean,
  showBaseCollar: boolean
): number {
  let offset = 0

  // Wood sill
  if (showWoodSill) {
    offset += inchesToFeet(WOOD_SILL.thicknessIn)
  }

  // Jack plate
  offset += inchesToFeet(JACK_PLATE.thicknessIn)

  // Jack stem (base + extension)
  offset += inchesToFeet(JACK_STEM.baseHeightIn + jackExtensionIn)

  // Base collar (if shown)
  if (showBaseCollar) {
	  // Standard inserts into the upper socket (6" tall).
	  // So the *bottom* of the standard should sit at the start of the upper socket,
	  // i.e. at the top of the lower sleeve.
	  offset += inchesToFeet(COLLAR_LOWER.heightIn)
  }

  return offset
}
