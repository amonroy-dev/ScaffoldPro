import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { ThreeEvent } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { WORKSPACE_LAYERS } from '../../contexts/ToolContext'
import { inchesToFeet } from './units'

// Base material (restore original look)
const LEDGER_COLOR = '#b8bcc0' // Galvanized steel

// Selection highlight overlay
const SELECTED_OVERLAY_COLOR = '#a855f7' // Purple

// Pre-allocate instance buffer pools so R3F never recreates the InstancedMesh
// when the visible count changes (see RinglockStandards.tsx for full explanation).
const LEDGER_POOL = 1000
const TRUSS_POOL = 200
const MOUTHPIECE_POOL = LEDGER_POOL * 2
const FEET_PER_METER = 3.280839895013123
const MOUTHPIECE_SEAT_DEPTH_IN = 3.2
const MOUTHPIECE_STANDARD_CENTER_OFFSET_IN = 1
const MOUTHPIECE_VERTICAL_DROP_IN = 0.35

export type RinglockLedgerInstance = {
  id: string
  /** Part number (e.g. UH80 for ledger, UHT60 for truss). Optional for legacy callers. */
  partNumber?: string
  start: THREE.Vector3
  end: THREE.Vector3
}

export type RinglockLedgerVisualSpec = {
  tubeOuterDiameterIn?: number
  tubeRadialSegments?: number
}

const DEFAULT_VISUAL: Required<RinglockLedgerVisualSpec> = {
  tubeOuterDiameterIn: 1.9,
  tubeRadialSegments: 12,
}

/**
 * Instanced rendering for ringlock ledgers.
 * Each ledger is a tube connecting exactly between rosette center points.
 */
export function RinglockLedgers({
  ledgers,
  layer = WORKSPACE_LAYERS.SCAFFOLD,
  visual = {},
  selectedId,
  onSelect,
  onHover,
  onHoverOut,
  showVisuals = true,
	clippingPlanes,
}: {
  ledgers: RinglockLedgerInstance[]
  layer?: number
  visual?: RinglockLedgerVisualSpec
  /** Currently selected ledger ID (for visual feedback) */
  selectedId?: string | null
  /** Callback when a ledger is clicked */
  onSelect?: (ledger: RinglockLedgerInstance, e?: ThreeEvent<PointerEvent>) => void
  /** Callback while hovering a ledger pick proxy */
  onHover?: (ledger: RinglockLedgerInstance, e?: ThreeEvent<PointerEvent>) => void
  /** Callback when leaving ledger pick proxies */
  onHoverOut?: (e?: ThreeEvent<PointerEvent>) => void
  /** When false, only render pick proxies (no visible geometry). */
  showVisuals?: boolean
	clippingPlanes?: THREE.Plane[]
}) {
  const v = { ...DEFAULT_VISUAL, ...visual }
	const clipShadows = Boolean(clippingPlanes?.length)
  const ledgerMeshRef = useRef<THREE.InstancedMesh>(null)
  const ledgerPickRef = useRef<THREE.InstancedMesh>(null)
  const trussMeshRef = useRef<THREE.InstancedMesh>(null)
  const trussPickRef = useRef<THREE.InstancedMesh>(null)
  const mouthpieceMeshRef = useRef<THREE.InstancedMesh>(null)

  const tubeRadiusFt = inchesToFeet(v.tubeOuterDiameterIn) / 2
  const mouthpieceAsset = useGLTF('/Mouthpiece.gltf')
  // Selection tolerance: make click target significantly thicker than the visual tube.
  // Ledgers are horizontal and often partially occluded by vertical standard pick proxies
  // when viewed from an angle, so we use a generous radius to ensure they remain clickable
  // without needing to zoom in or rotate the camera.
  const tubePickRadiusFt = Math.max(tubeRadiusFt, inchesToFeet(8) / 2)

  const tubeGeometry = useMemo(() => {
    // Default CylinderGeometry is Y-axis oriented; we will align Y to the ledger direction.
    return new THREE.CylinderGeometry(
      tubeRadiusFt,
      tubeRadiusFt,
      1,
      v.tubeRadialSegments,
      1,
      false
    )
  }, [tubeRadiusFt, v.tubeRadialSegments])

  const trussGeometry = useMemo(() => {
		// Build a simple *triangular* truss in local X/Y/Z.
		// Local +Y is along the connection direction.
		const chordRadius = tubeRadiusFt
		const braceRadius = chordRadius * 0.75
		const braceSegs = Math.max(8, Math.min(12, v.tubeRadialSegments))
		const webHeightFt = Math.max(inchesToFeet(8), chordRadius * 8)
		const baseWidthFt = Math.max(inchesToFeet(10), webHeightFt * 0.9)

		const unitChord = new THREE.CylinderGeometry(
			chordRadius,
			chordRadius,
			1,
			v.tubeRadialSegments,
			1,
			false,
		)
		const unitBrace = new THREE.CylinderGeometry(braceRadius, braceRadius, 1, braceSegs, 1, false)

		const yAxis = new THREE.Vector3(0, 1, 0)
		const tmpMid = new THREE.Vector3()
		const tmpDir = new THREE.Vector3()
		const tmpQuat = new THREE.Quaternion()
		const tmpScale = new THREE.Vector3()
		const tmpMatrix = new THREE.Matrix4()

		const makeMember = (a: THREE.Vector3, b: THREE.Vector3, base: THREE.BufferGeometry) => {
			tmpMid.addVectors(a, b).multiplyScalar(0.5)
			tmpDir.subVectors(b, a)
			const len = tmpDir.length()
			if (len < 1e-6) return null
			tmpDir.divideScalar(len)
			tmpQuat.setFromUnitVectors(yAxis, tmpDir)
			tmpScale.set(1, len, 1)
			tmpMatrix.compose(tmpMid, tmpQuat, tmpScale)
			const g = base.clone()
			g.applyMatrix4(tmpMatrix)
			return g
		}

		const geoms: THREE.BufferGeometry[] = []
		const topZ = webHeightFt / 2
		const bottomZ = -webHeightFt / 2
		const leftX = -baseWidthFt / 2
		const rightX = baseWidthFt / 2

		// 3 chords: top, bottom-left, bottom-right
		const topChord = unitChord.clone()
		topChord.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, topZ))
		geoms.push(topChord)

		const bottomLeftChord = unitChord.clone()
		bottomLeftChord.applyMatrix4(new THREE.Matrix4().makeTranslation(leftX, 0, bottomZ))
		geoms.push(bottomLeftChord)

		const bottomRightChord = unitChord.clone()
		bottomRightChord.applyMatrix4(new THREE.Matrix4().makeTranslation(rightX, 0, bottomZ))
		geoms.push(bottomRightChord)

		// Web members
		const panelCount = 5
		const step = 1 / panelCount

		for (let i = 0; i <= panelCount; i++) {
			const y = -0.5 + i * step
			// "A-frame" posts on both sides
			const postL = makeMember(new THREE.Vector3(0, y, topZ), new THREE.Vector3(leftX, y, bottomZ), unitBrace)
			if (postL) geoms.push(postL)
			const postR = makeMember(new THREE.Vector3(0, y, topZ), new THREE.Vector3(rightX, y, bottomZ), unitBrace)
			if (postR) geoms.push(postR)

			// Bottom cross tie
			const tie = makeMember(new THREE.Vector3(leftX, y, bottomZ), new THREE.Vector3(rightX, y, bottomZ), unitBrace)
			if (tie) geoms.push(tie)
		}

		for (let i = 0; i < panelCount; i++) {
			const y0 = -0.5 + i * step
			const y1 = y0 + step
			const fromTop = i % 2 === 0

			// Alternating diagonals on left and right side planes
			const diagL = fromTop
				? makeMember(new THREE.Vector3(0, y0, topZ), new THREE.Vector3(leftX, y1, bottomZ), unitBrace)
				: makeMember(new THREE.Vector3(leftX, y0, bottomZ), new THREE.Vector3(0, y1, topZ), unitBrace)
			if (diagL) geoms.push(diagL)

			const diagR = fromTop
				? makeMember(new THREE.Vector3(0, y0, topZ), new THREE.Vector3(rightX, y1, bottomZ), unitBrace)
				: makeMember(new THREE.Vector3(rightX, y0, bottomZ), new THREE.Vector3(0, y1, topZ), unitBrace)
			if (diagR) geoms.push(diagR)
		}

		const merged = mergeGeometries(geoms, false)
		for (const g of geoms) g.dispose()
		unitChord.dispose()
		unitBrace.dispose()

		// mergeGeometries can return null if empty (shouldn't happen, but be safe)
		if (!merged) return new THREE.BufferGeometry()
		merged.computeVertexNormals()
		return merged
  }, [tubeRadiusFt, v.tubeRadialSegments])

  const tubePickGeometry = useMemo(() => {
    return new THREE.CylinderGeometry(
      tubePickRadiusFt,
      tubePickRadiusFt,
      1,
      Math.max(8, Math.min(16, v.tubeRadialSegments)),
      1,
      false
    )
  }, [tubePickRadiusFt, v.tubeRadialSegments])

  const { mouthpieceGeometry, mouthpieceSeatDepthFt } = useMemo(() => {
    const geoms: THREE.BufferGeometry[] = []
    mouthpieceAsset.scene.updateMatrixWorld(true)
    mouthpieceAsset.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.geometry) return
      const geometry = object.geometry.clone()
      geometry.applyMatrix4(object.matrixWorld)
      geoms.push(geometry)
    })

    const merged = mergeGeometries(geoms, false) ?? new THREE.BufferGeometry()
    for (const geom of geoms) geom.dispose()
    const positionAttr = merged.getAttribute('position')
    if (!positionAttr) {
      return {
        mouthpieceGeometry: merged,
        mouthpieceSeatDepthFt: inchesToFeet(1),
      }
    }

    merged.applyMatrix4(new THREE.Matrix4().makeScale(FEET_PER_METER, FEET_PER_METER, FEET_PER_METER))
    merged.computeVertexNormals()
    let bounds = new THREE.Box3().setFromBufferAttribute(merged.getAttribute('position') as THREE.BufferAttribute)
    const size = bounds.getSize(new THREE.Vector3())
    if (size.y > inchesToFeet(7)) {
      const scale = inchesToFeet(4.5) / size.y
      merged.applyMatrix4(new THREE.Matrix4().makeScale(scale, scale, scale))
      merged.computeVertexNormals()
      bounds = new THREE.Box3().setFromBufferAttribute(merged.getAttribute('position') as THREE.BufferAttribute)
    }

    const anchorY = Math.max(bounds.min.y, Math.min(bounds.max.y, -inchesToFeet(MOUTHPIECE_STANDARD_CENTER_OFFSET_IN)))
    const centerX = (bounds.min.x + bounds.max.x) / 2
    const centerZ = (bounds.min.z + bounds.max.z) / 2
    merged.applyMatrix4(
      new THREE.Matrix4().makeTranslation(
        -centerX,
        -anchorY,
        -centerZ - inchesToFeet(MOUTHPIECE_VERTICAL_DROP_IN),
      ),
    )

    return {
      mouthpieceGeometry: merged,
      mouthpieceSeatDepthFt: inchesToFeet(MOUTHPIECE_SEAT_DEPTH_IN),
    }
  }, [mouthpieceAsset.scene])

  useEffect(() => {
    return () => {
      tubeGeometry.dispose()
      tubePickGeometry.dispose()
			trussGeometry.dispose()
      mouthpieceGeometry.dispose()
    }
  }, [tubeGeometry, tubePickGeometry, trussGeometry, mouthpieceGeometry])

  useEffect(() => {
    if (ledgerMeshRef.current) ledgerMeshRef.current.layers.set(layer)
    if (ledgerPickRef.current) ledgerPickRef.current.layers.set(layer)
    if (trussMeshRef.current) trussMeshRef.current.layers.set(layer)
    if (trussPickRef.current) trussPickRef.current.layers.set(layer)
    if (mouthpieceMeshRef.current) mouthpieceMeshRef.current.layers.set(layer)
  }, [layer])

  const { plainLedgers, trusses } = useMemo(() => {
    const plainLedgers = ledgers.filter(l => !l.partNumber || !l.partNumber.startsWith('UHT'))
    const trusses = ledgers.filter(l => (l.partNumber ?? '').startsWith('UHT'))
    return { plainLedgers, trusses }
  }, [ledgers])

  // Tag pick meshes with metadata so higher-level selection code can implement
  // professional CAD-style selection cycling (select-through) using event.intersections.
  useEffect(() => {
    if (ledgerPickRef.current) {
      ledgerPickRef.current.userData.scaffPickKind = 'ledger'
      ledgerPickRef.current.userData.scaffItems = plainLedgers
    }
    if (trussPickRef.current) {
      trussPickRef.current.userData.scaffPickKind = 'ledger'
      trussPickRef.current.userData.scaffItems = trusses
    }
  }, [plainLedgers, trusses])

  useLayoutEffect(() => {
    const yAxis = new THREE.Vector3(0, 1, 0)
    const negativeZAxis = new THREE.Vector3(0, 0, -1)
    const worldDown = new THREE.Vector3(0, 0, -1)
    const tmpMid = new THREE.Vector3()
    const tmpDir = new THREE.Vector3()
    const tmpQuat = new THREE.Quaternion()
    const tmpRollQuat = new THREE.Quaternion()
    const tmpScale = new THREE.Vector3()
    const tmpMatrix = new THREE.Matrix4()
    const tmpReverseDir = new THREE.Vector3()
    const tmpDownAfter = new THREE.Vector3()
    const tmpDesiredDown = new THREE.Vector3()
    const tmpProjectedDown = new THREE.Vector3()
    const tmpCross = new THREE.Vector3()

    const setMouthpieceQuaternion = (targetDir: THREE.Vector3) => {
      tmpQuat.setFromUnitVectors(yAxis, targetDir)
      tmpDownAfter.copy(negativeZAxis).applyQuaternion(tmpQuat)
      tmpDesiredDown.copy(worldDown).addScaledVector(targetDir, -worldDown.dot(targetDir))
      if (tmpDesiredDown.lengthSq() < 1e-6) {
        tmpDesiredDown.set(0, 1, 0).addScaledVector(targetDir, -targetDir.y)
      }
      tmpDesiredDown.normalize()
      tmpProjectedDown.copy(tmpDownAfter).addScaledVector(targetDir, -tmpDownAfter.dot(targetDir))
      if (tmpProjectedDown.lengthSq() < 1e-6) {
        return
      }
      tmpProjectedDown.normalize()
      tmpCross.crossVectors(tmpProjectedDown, tmpDesiredDown)
      const rollAngle = Math.atan2(tmpCross.dot(targetDir), tmpProjectedDown.dot(tmpDesiredDown))
      tmpRollQuat.setFromAxisAngle(targetDir, rollAngle)
      tmpQuat.premultiply(tmpRollQuat)
    }

    const updateInstances = (
      list: RinglockLedgerInstance[],
      mesh: THREE.InstancedMesh | null,
      pick: THREE.InstancedMesh | null,
      visibleEndTrimFt: number,
    ) => {
      if (!mesh && !pick) return
      // Keep .count in sync so removed ledgers/trusses don't linger as ghosts.
      if (mesh) mesh.count = list.length
      if (pick) pick.count = list.length
      for (let i = 0; i < list.length; i++) {
        const l = list[i]
        tmpMid.addVectors(l.start, l.end).multiplyScalar(0.5)
        tmpDir.subVectors(l.end, l.start)
        const length = tmpDir.length()

        if (length < 1e-6) {
          tmpQuat.identity()
          tmpScale.set(1, 0, 1)
          tmpMatrix.compose(tmpMid, tmpQuat, tmpScale)
          mesh?.setMatrixAt(i, tmpMatrix)
          pick?.setMatrixAt(i, tmpMatrix)
          continue
        }

        tmpDir.divideScalar(length)
        tmpQuat.setFromUnitVectors(yAxis, tmpDir)
        tmpScale.set(1, Math.max(0, length - visibleEndTrimFt * 2), 1)
        tmpMatrix.compose(tmpMid, tmpQuat, tmpScale)
        mesh?.setMatrixAt(i, tmpMatrix)
        tmpScale.set(1, length, 1)
        tmpMatrix.compose(tmpMid, tmpQuat, tmpScale)
        pick?.setMatrixAt(i, tmpMatrix)
      }
      if (mesh) mesh.instanceMatrix.needsUpdate = true
      if (pick) pick.instanceMatrix.needsUpdate = true
    }

    const updateMouthpieces = (list: RinglockLedgerInstance[], startIndex: number) => {
      const mouthpieceMesh = mouthpieceMeshRef.current
      if (!mouthpieceMesh) return startIndex
      let index = startIndex
      const mouthpieceOffsetFt = mouthpieceSeatDepthFt
      for (const ledger of list) {
        tmpDir.subVectors(ledger.end, ledger.start)
        const length = tmpDir.length()
        if (length < 1e-6) continue
        tmpDir.divideScalar(length)
        tmpScale.set(1, 1, 1)

        setMouthpieceQuaternion(tmpDir)
        tmpMid.copy(ledger.start).addScaledVector(tmpDir, mouthpieceOffsetFt)
        tmpMatrix.compose(tmpMid, tmpQuat, tmpScale)
        mouthpieceMesh.setMatrixAt(index, tmpMatrix)
        index += 1

        tmpReverseDir.copy(tmpDir).multiplyScalar(-1)
        setMouthpieceQuaternion(tmpReverseDir)
        tmpMid.copy(ledger.end).addScaledVector(tmpReverseDir, mouthpieceOffsetFt)
        tmpMatrix.compose(tmpMid, tmpQuat, tmpScale)
        mouthpieceMesh.setMatrixAt(index, tmpMatrix)
        index += 1
      }
      return index
    }

    updateInstances(plainLedgers, ledgerMeshRef.current, ledgerPickRef.current, mouthpieceSeatDepthFt)
    updateInstances(trusses, trussMeshRef.current, trussPickRef.current, 0)
    if (mouthpieceMeshRef.current) {
      mouthpieceMeshRef.current.count = Math.min(plainLedgers.length * 2, MOUTHPIECE_POOL)
      let mouthpieceIndex = 0
      mouthpieceIndex = updateMouthpieces(plainLedgers, mouthpieceIndex)
      mouthpieceMeshRef.current.count = mouthpieceIndex
      mouthpieceMeshRef.current.instanceMatrix.needsUpdate = true
    }
  }, [mouthpieceSeatDepthFt, plainLedgers, trusses])

  // Find selected index for visual feedback
  const selectedIndex = selectedId ? ledgers.findIndex(l => l.id === selectedId) : -1

  // Select on pointer-down (more reliable than onClick with orbit controls)
  const handleLedgerPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
    if (!onSelect) return
    const instanceId = e.instanceId
    if (instanceId !== undefined && instanceId < plainLedgers.length) {
      onSelect(plainLedgers[instanceId], e)
    }
  }

  const handleTrussPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
    if (!onSelect) return
    const instanceId = e.instanceId
    if (instanceId !== undefined && instanceId < trusses.length) {
      onSelect(trusses[instanceId], e)
    }
  }

  const handleLedgerPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.buttons !== 0) return
    e.stopPropagation()
    if (!onHover) return
    const instanceId = e.instanceId
    if (instanceId !== undefined && instanceId < plainLedgers.length) {
      onHover(plainLedgers[instanceId], e)
    }
  }

  const handleTrussPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.buttons !== 0) return
    e.stopPropagation()
    if (!onHover) return
    const instanceId = e.instanceId
    if (instanceId !== undefined && instanceId < trusses.length) {
      onHover(trusses[instanceId], e)
    }
  }

  const handlePointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    onHoverOut?.(e)
  }

  return (
    <group>
      {/* Plain ledgers (UH*) */}
      <instancedMesh
        ref={ledgerPickRef}
        args={[undefined, undefined, LEDGER_POOL]}
        frustumCulled={false}
        onPointerDown={onSelect ? handleLedgerPointerDown : undefined}
        onPointerMove={onHover ? handleLedgerPointerMove : undefined}
        onPointerOut={onHoverOut ? handlePointerOut : undefined}
      >
        <primitive object={tubePickGeometry} attach="geometry" />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </instancedMesh>

      {showVisuals && (
        <instancedMesh
          ref={ledgerMeshRef}
          args={[undefined, undefined, LEDGER_POOL]}
          frustumCulled={false}
          castShadow
          receiveShadow
        >
          <primitive object={tubeGeometry} attach="geometry" />
	          <meshStandardMaterial color={LEDGER_COLOR} metalness={0.32} roughness={0.28} clippingPlanes={clippingPlanes} clipShadows={clipShadows} />
        </instancedMesh>
      )}

      {/* Trusses (UHT*) */}
      <instancedMesh
        ref={trussPickRef}
        args={[undefined, undefined, TRUSS_POOL]}
        frustumCulled={false}
        onPointerDown={onSelect ? handleTrussPointerDown : undefined}
        onPointerMove={onHover ? handleTrussPointerMove : undefined}
        onPointerOut={onHoverOut ? handlePointerOut : undefined}
      >
        <primitive object={tubePickGeometry} attach="geometry" />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </instancedMesh>

      {showVisuals && (
        <instancedMesh
          ref={trussMeshRef}
          args={[undefined, undefined, TRUSS_POOL]}
          frustumCulled={false}
          castShadow
          receiveShadow
        >
          <primitive object={trussGeometry} attach="geometry" />
	          <meshStandardMaterial color={LEDGER_COLOR} metalness={0.32} roughness={0.28} clippingPlanes={clippingPlanes} clipShadows={clipShadows} />
        </instancedMesh>
      )}

      {showVisuals && (
        <instancedMesh
          ref={mouthpieceMeshRef}
          args={[undefined, undefined, MOUTHPIECE_POOL]}
          frustumCulled={false}
          castShadow
          receiveShadow
        >
          <primitive object={mouthpieceGeometry} attach="geometry" />
          <meshStandardMaterial
            color="#bcc1c7"
            metalness={0.65}
            roughness={0.28}
            clippingPlanes={clippingPlanes}
            clipShadows={clipShadows}
          />
        </instancedMesh>
      )}

      {/* Selected overlay */}
      {showVisuals && selectedIndex >= 0 && selectedIndex < ledgers.length && (() => {
        const l = ledgers[selectedIndex]
        const mid = new THREE.Vector3().addVectors(l.start, l.end).multiplyScalar(0.5)
        const dir = new THREE.Vector3().subVectors(l.end, l.start)
        const length = dir.length()
        if (length < 1e-6) return null
        dir.divideScalar(length)
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
	        const isTruss = (l.partNumber ?? '').startsWith('UHT')
	        const overlayGeometry = isTruss ? trussGeometry : tubeGeometry
        const overlayLength = isTruss ? length : Math.max(0, length - mouthpieceSeatDepthFt * 2)
        return (
          <mesh
            raycast={() => null}
            renderOrder={10}
            position={[mid.x, mid.y, mid.z]}
            quaternion={quat}
            scale={[1.05, overlayLength, 1.05]}
          >
	            <primitive object={overlayGeometry} attach="geometry" />
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
        )
      })()}
    </group>
  )
}
