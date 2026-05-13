import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { ThreeEvent } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { WORKSPACE_LAYERS } from '../../contexts/ToolContext'
import { inchesToFeet } from './units'

// Base materials (restore original look)
const TUBE_COLOR = '#b8bcc0' // Galvanized steel
const ROSETTE_COLOR = '#6a6f75' // Darker hardware

// Selection highlight (overlay so we don't break instancing/materials)
const SELECTED_OVERLAY_COLOR = '#a855f7' // Purple

// Pre-allocate instance buffer pools so R3F never recreates the InstancedMesh
// objects when the visible count changes.  Changing the `args` count triggers a
// full destroy/create cycle inside R3F's reconciler which can leave meshes in a
// broken rendering state (all tubes vanish while rosettes linger).  By using a
// fixed pool size the mesh is created once and we control how many instances are
// drawn via `.count` in our layout effects.
const STANDARD_POOL = 500
const ROSETTE_POOL = 2000
const FEET_PER_METER = 3.280839895013123

export type RinglockStandardInstance = {
  /** Unique ID for this standard *segment* instance (used for picking/selection cycling). */
  id: string
  /** Owning stack id (all stacked segments share the same stackId). */
  stackId: string
  /** Index within the stack (bottom=0). */
  segmentIndex: number
  /** Catalog part number (e.g. US99). */
  partNumber: string
  /** Base position at ground (bottom of tube). */
  basePosition: THREE.Vector3
  /** Overall tube height in feet. */
  heightFt: number
  /** How many rosettes to place (starting at bottom offset, then spaced). */
  rosetteCount: number
}

export type RinglockStandardVisualSpec = {
  tubeOuterDiameterIn?: number
  tubeRadialSegments?: number
  rosetteDiameterIn?: number
  rosetteThicknessIn?: number
  rosetteRadialSegments?: number
  /** First rosette center height above ground. */
  firstRosetteOffsetIn?: number
  /** Spacing between rosette centerlines. */
  rosetteSpacingIn?: number
}

const DEFAULT_VISUAL: Required<RinglockStandardVisualSpec> = {
  tubeOuterDiameterIn: 1.9,
  tubeRadialSegments: 12,
  rosetteDiameterIn: 4.84,
  rosetteThicknessIn: 0.36,
  rosetteRadialSegments: 24,
  firstRosetteOffsetIn: 15,
  rosetteSpacingIn: 19.688,
}

/**
 * Instanced rendering for Ringlock standards (tube + rosettes) in feet world units.
 *
 * Notes:
 * - Uses a unit-height cylinder geometry rotated to Z-up, then scales Z per instance.
 * - Rosettes are simple disks for now (no hole cutouts yet).
 */
export function RinglockStandards({
  standards,
  layer = WORKSPACE_LAYERS.SCAFFOLD,
  visual = {},
  selectedId,
  selectedIds,
  onSelect,
	clippingPlanes,
	ghostColor,
}: {
  standards: RinglockStandardInstance[]
  layer?: number
  visual?: RinglockStandardVisualSpec
  /** Currently selected standard ID (for visual feedback) */
  selectedId?: string | null
  /** Additional selected standard IDs, either segment ids or owning stack ids */
  selectedIds?: string[] | null
  /** Callback when a standard is clicked */
  onSelect?: (standard: RinglockStandardInstance, e: ThreeEvent<PointerEvent>) => void
	clippingPlanes?: THREE.Plane[]
  /** When set, renders as a semi-transparent ghost preview tinted with this color */
  ghostColor?: string
}) {
  const v = { ...DEFAULT_VISUAL, ...visual }
	const clipShadows = Boolean(clippingPlanes?.length)

  const tubeRef = useRef<THREE.InstancedMesh>(null)
	const tubePickRef = useRef<THREE.InstancedMesh>(null)
  const rosetteRef = useRef<THREE.InstancedMesh>(null)
  const rosetteAsset = useGLTF('/Rosette.glb')

  const tubeRadiusFt = inchesToFeet(v.tubeOuterDiameterIn) / 2
		// Selection tolerance: make the click target larger than the visual tube.
		// In plan/top view the tube cap is extremely hard to hit otherwise.
		// Keep this reasonably sized so ledgers/bases remain selectable; selection cycling
		// can still be used when multiple items overlap.
		const tubePickRadiusFt = Math.max(tubeRadiusFt, inchesToFeet(10) / 2)
  const rosetteRadiusFt = inchesToFeet(v.rosetteDiameterIn) / 2
  const rosetteThicknessFt = inchesToFeet(v.rosetteThicknessIn)
  const firstRosetteOffsetFt = inchesToFeet(v.firstRosetteOffsetIn)
  const rosetteSpacingFt = inchesToFeet(v.rosetteSpacingIn)

  const tubeGeometry = useMemo(() => {
    // CylinderGeometry is Y-up by default; rotate to Z-up.
    return new THREE.CylinderGeometry(
      tubeRadiusFt,
      tubeRadiusFt,
      1,
      v.tubeRadialSegments,
      1,
      false
    ).rotateX(Math.PI / 2)
  }, [tubeRadiusFt, v.tubeRadialSegments])

	const tubePickGeometry = useMemo(() => {
		// Invisible pick proxy (same orientation/scale as tube)
		return new THREE.CylinderGeometry(
			tubePickRadiusFt,
			tubePickRadiusFt,
			1,
			Math.max(8, Math.min(16, v.tubeRadialSegments)),
			1,
			false
		).rotateX(Math.PI / 2)
	}, [tubePickRadiusFt, v.tubeRadialSegments])

  const rosetteGeometry = useMemo(() => {
    const geoms: THREE.BufferGeometry[] = []
    rosetteAsset.scene.updateMatrixWorld(true)
    rosetteAsset.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.geometry) return
      const geometry = object.geometry.clone()
      geometry.applyMatrix4(object.matrixWorld)
      geoms.push(geometry)
    })

    const merged = mergeGeometries(geoms, false) ?? new THREE.BufferGeometry()
    for (const geom of geoms) geom.dispose()

    const positionAttr = merged.getAttribute('position')
    if (!positionAttr) return merged

    merged.applyMatrix4(new THREE.Matrix4().makeScale(FEET_PER_METER, FEET_PER_METER, FEET_PER_METER))
    merged.computeVertexNormals()

    const initialBounds = new THREE.Box3().setFromBufferAttribute(positionAttr as THREE.BufferAttribute)
    const initialSize = initialBounds.getSize(new THREE.Vector3())
    const radialSpanFt = Math.max(initialSize.x, initialSize.y)
    const targetDiameterFt = rosetteRadiusFt * 2
    if (radialSpanFt > 1e-6) {
      const scale = targetDiameterFt / radialSpanFt
      merged.applyMatrix4(new THREE.Matrix4().makeScale(scale, scale, scale))
      merged.computeVertexNormals()
    }

    const bounds = new THREE.Box3().setFromBufferAttribute(merged.getAttribute('position') as THREE.BufferAttribute)
    const center = bounds.getCenter(new THREE.Vector3())
    const thicknessFt = bounds.max.z - bounds.min.z
    merged.applyMatrix4(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))

    // If the imported model is noticeably thicker/thinner than expected, normalize it
    // along Z without disturbing its fitted outer diameter.
    if (thicknessFt > 1e-6 && Math.abs(thicknessFt - rosetteThicknessFt) > 1e-4) {
      merged.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, rosetteThicknessFt / thicknessFt))
      merged.computeVertexNormals()
    }

    return merged
  }, [rosetteAsset.scene, rosetteRadiusFt, rosetteThicknessFt])

  // Ensure we release GPU buffers if this component unmounts/remounts.
  useEffect(() => {
    return () => {
      tubeGeometry.dispose()
			tubePickGeometry.dispose()
      rosetteGeometry.dispose()
    }
	}, [tubeGeometry, tubePickGeometry, rosetteGeometry])

  // Build rosette instances with parent standard index for selection coloring
  const rosetteInstances = useMemo(() => {
    const out: Array<{ pos: THREE.Vector3; standardIndex: number }> = []
    for (let si = 0; si < standards.length; si++) {
      const s = standards[si]
      const maxZ = s.basePosition.z + s.heightFt
      for (let i = 0; i < s.rosetteCount; i++) {
        const z = s.basePosition.z + firstRosetteOffsetFt + i * rosetteSpacingFt
        if (z > maxZ) break
        out.push({ pos: new THREE.Vector3(s.basePosition.x, s.basePosition.y, z), standardIndex: si })
      }
    }
    return out
  }, [standards, firstRosetteOffsetFt, rosetteSpacingFt])

  useEffect(() => {
    if (tubeRef.current) tubeRef.current.layers.set(layer)
		if (tubePickRef.current) tubePickRef.current.layers.set(layer)
    if (rosetteRef.current) rosetteRef.current.layers.set(layer)
  }, [layer])

	// Tag the standard pick proxy so selection cycling can identify standards from
	// event.intersections even when they are not the closest hit.
	useEffect(() => {
		if (!tubePickRef.current) return
		tubePickRef.current.userData.scaffPickKind = 'standard'
		tubePickRef.current.userData.scaffItems = standards
	}, [standards])

  useLayoutEffect(() => {
    if (!tubeRef.current) return
		const mesh = tubeRef.current
		const pickMesh = tubePickRef.current

		// IMPORTANT: In R3F, changing the constructor `args` count does not reliably
		// update the underlying InstancedMesh capacity/count across renders.
		// Explicitly set `.count` so removed standards don’t leave “ghost” instances.
		mesh.count = standards.length
		if (pickMesh) pickMesh.count = standards.length

    const tmpPos = new THREE.Vector3()
    const tmpQuat = new THREE.Quaternion()
    const tmpScale = new THREE.Vector3()
    const tmpMatrix = new THREE.Matrix4()

    tmpQuat.identity()
    for (let i = 0; i < standards.length; i++) {
      const s = standards[i]
      tmpPos.set(s.basePosition.x, s.basePosition.y, s.basePosition.z + s.heightFt / 2)
      tmpScale.set(1, 1, s.heightFt)
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
      mesh.setMatrixAt(i, tmpMatrix)
			pickMesh?.setMatrixAt(i, tmpMatrix)
    }
    mesh.instanceMatrix.needsUpdate = true
		if (pickMesh) pickMesh.instanceMatrix.needsUpdate = true
  }, [standards])

  useLayoutEffect(() => {
    if (!rosetteRef.current) return
    const mesh = rosetteRef.current

		// See note above: keep `.count` in sync to avoid lingering rosettes after deletions.
		mesh.count = rosetteInstances.length

    const tmpQuat = new THREE.Quaternion()
    const tmpScale = new THREE.Vector3(1, 1, 1)
    const tmpMatrix = new THREE.Matrix4()

    tmpQuat.identity()
    for (let i = 0; i < rosetteInstances.length; i++) {
      tmpMatrix.compose(rosetteInstances[i].pos, tmpQuat, tmpScale)
      mesh.setMatrixAt(i, tmpMatrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [rosetteInstances])

	// Find selected segment(s) for visual feedback.
	// Supports selecting either:
	// - a specific segment: selectedId === "<stackId>@<segmentIndex>"
	// - a whole stack (legacy / multi-select helpers): selectedId === "<stackId>"
	const selectedStandards = useMemo(() => {
		const payloads = new Set<string>()
		if (selectedId) payloads.add(String(selectedId))
		for (const id of selectedIds ?? []) {
			if (id) payloads.add(String(id))
		}
		if (payloads.size === 0) return [] as RinglockStandardInstance[]
		return standards.filter(s => payloads.has(s.id) || payloads.has(s.stackId))
	}, [selectedId, selectedIds, standards])

	// Select on pointer-down (more reliable than onClick when orbit controls are active)
	const handleTubePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
		e.nativeEvent.stopImmediatePropagation?.()
    if (!onSelect) return
    const instanceId = e.instanceId
    if (instanceId !== undefined && instanceId < standards.length) {
	      onSelect(standards[instanceId], e)
    }
  }

	// Handle click on rosette (map back to parent standard)
	const handleRosettePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
		e.nativeEvent.stopImmediatePropagation?.()
    if (!onSelect) return
    const instanceId = e.instanceId
    if (instanceId === undefined) return
    if (instanceId < 0 || instanceId >= rosetteInstances.length) return
    const standardIndex = rosetteInstances[instanceId].standardIndex
    if (standardIndex < 0 || standardIndex >= standards.length) return
	    onSelect(standards[standardIndex], e)
  }

  return (
    <group>
			{/* Invisible pick proxy — skipped in ghost mode */}
			{!ghostColor && (
				<instancedMesh
					ref={tubePickRef}
					args={[undefined, undefined, STANDARD_POOL]}
					frustumCulled={false}
					onPointerDown={onSelect ? handleTubePointerDown : undefined}
				>
					<primitive object={tubePickGeometry} attach="geometry" />
					<meshBasicMaterial transparent opacity={0} depthWrite={false} />
				</instancedMesh>
			)}

      <instancedMesh
        ref={tubeRef}
        args={[undefined, undefined, STANDARD_POOL]}
        frustumCulled={false}
        castShadow={!ghostColor}
        receiveShadow={!ghostColor}
      >
        <primitive object={tubeGeometry} attach="geometry" />
        {ghostColor
          ? <meshStandardMaterial color={ghostColor} emissive={ghostColor} emissiveIntensity={0.3} transparent opacity={0.5} depthWrite={false} />
          : <meshStandardMaterial color={TUBE_COLOR} metalness={0.32} roughness={0.28} clippingPlanes={clippingPlanes} clipShadows={clipShadows} />
        }
      </instancedMesh>

      <instancedMesh
        ref={rosetteRef}
        args={[undefined, undefined, ROSETTE_POOL]}
        frustumCulled={false}
        castShadow={!ghostColor}
				onPointerDown={(!ghostColor && onSelect) ? handleRosettePointerDown : undefined}
      >
        <primitive object={rosetteGeometry} attach="geometry" />
        {ghostColor
          ? <meshStandardMaterial color={ghostColor} emissive={ghostColor} emissiveIntensity={0.25} transparent opacity={0.6} depthWrite={false} />
          : <meshStandardMaterial color={ROSETTE_COLOR} metalness={0.22} roughness={0.55} clippingPlanes={clippingPlanes} clipShadows={clipShadows} />
        }
      </instancedMesh>

			{/* Selected overlay (skipped in ghost mode) */}
			{!ghostColor && selectedStandards.map((s, idx) => (
				<mesh
					key={`selected-${s.id}-${idx}`}
					raycast={() => null}
					renderOrder={10}
					position={[s.basePosition.x, s.basePosition.y, s.basePosition.z + s.heightFt / 2]}
					quaternion={new THREE.Quaternion()}
					scale={[1.05, 1.05, s.heightFt]}
				>
					<primitive object={tubeGeometry} attach="geometry" />
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
			))}
    </group>
  )
}
