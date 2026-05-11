import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { WORKSPACE_LAYERS } from '../../contexts/ToolContext'
import { inchesToFeet } from './units'

const PLANK_POOL = 12000
const PLANK_COLOR = '#c5c9ce'
const SELECTED_OVERLAY_COLOR = '#a855f7'

export const RINGLOCK_PLANK_WIDTH_IN = 9
export const RINGLOCK_PLANK_PROFILE_DEPTH_IN = 2.25

export type RinglockPlankInstance = {
  id: string
  center: THREE.Vector3
  rotationZ: number
  lengthFt: number
  widthIn: 6 | 9
  partNumber?: string
}

export function RinglockPlanks({
  planks,
  layer = WORKSPACE_LAYERS.SCAFFOLD,
  selectedId,
  onSelect,
	clippingPlanes,
}: {
  planks: RinglockPlankInstance[]
  layer?: number
  selectedId?: string | null
  onSelect?: (plank: RinglockPlankInstance, e?: ThreeEvent<PointerEvent>) => void
	clippingPlanes?: THREE.Plane[]
}) {
  const bodyMeshRef = useRef<THREE.InstancedMesh>(null)
  const deckMeshRef = useRef<THREE.InstancedMesh>(null)
  const pickMeshRef = useRef<THREE.InstancedMesh>(null)
	const clipShadows = Boolean(clippingPlanes?.length)
  const plankDepthFt = inchesToFeet(RINGLOCK_PLANK_PROFILE_DEPTH_IN)

  const bodyGeometry = useMemo(() => {
    const geoms: THREE.BufferGeometry[] = []
    const pushBox = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
      const g = new THREE.BoxGeometry(sx, sy, sz)
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z))
      geoms.push(g)
    }

    pushBox(0.98, 0.96, 0.08, 0, 0, 0.4)
    pushBox(0.06, 0.96, 0.56, -0.47, 0, 0.12)
    pushBox(0.06, 0.96, 0.56, 0.47, 0, 0.12)
    pushBox(0.76, 0.06, 0.16, 0, -0.31, -0.27)
    pushBox(0.76, 0.06, 0.16, 0, 0, -0.27)
    pushBox(0.76, 0.06, 0.16, 0, 0.31, -0.27)

    const merged = mergeGeometries(geoms, false) ?? new THREE.BufferGeometry()
    for (const geom of geoms) geom.dispose()
    merged.computeVertexNormals()
    return merged
  }, [])

  const deckGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(0.96, 0.96, 1, 1)
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, 0.5))
    return g
  }, [])

  // Pick proxy: thin box shifted upward so it covers the plank top surface
  // without extending down into the ledger zone below.
  // This ensures ledgers (horizontals) underneath remain clickable.
  const pickGeometry = useMemo(() => {
    const targetPickHeightFt = inchesToFeet(4)
    const h = Math.max(1.2, targetPickHeightFt / Math.max(plankDepthFt, 1e-6))
    const g = new THREE.BoxGeometry(1.08, 1.02, h)
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, h * 0.38))
    return g
  }, [plankDepthFt])

  // Separate overlay geometry for selection highlight — centered on the plank body.
  const overlayGeometry = useMemo(() => {
    return new THREE.BoxGeometry(1, 1, 1)
  }, [])

  const deckTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 1536
    const ctx = canvas.getContext('2d')
    if (!ctx) return new THREE.CanvasTexture(canvas)

    const w = canvas.width
    const h = canvas.height
    const gradient = ctx.createLinearGradient(0, 0, w, 0)
    gradient.addColorStop(0, '#c6cbd1')
    gradient.addColorStop(0.18, '#dde1e6')
    gradient.addColorStop(0.5, '#eef1f4')
    gradient.addColorStop(0.82, '#dde1e6')
    gradient.addColorStop(1, '#c6cbd1')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, w, h)

    ctx.fillStyle = 'rgba(110, 118, 127, 0.18)'
    ctx.fillRect(w * 0.08, 0, w * 0.06, h)
    ctx.fillRect(w * 0.86, 0, w * 0.06, h)

    ctx.strokeStyle = 'rgba(85, 92, 100, 0.55)'
    ctx.lineWidth = 3
    ctx.strokeRect(w * 0.04, h * 0.02, w * 0.92, h * 0.96)

    const rows = 30
    const cols = 8
    const left = w * 0.12
    const usableW = w * 0.76
    const top = h * 0.08
    const usableH = h * 0.84
    const stepY = usableH / (rows - 1)
    const stepX = usableW / (cols - 1)
    const holeRadius = Math.max(3, Math.round(w * 0.011))

    ctx.fillStyle = '#505861'
    for (let row = 0; row < rows; row++) {
      const offset = row % 2 === 0 ? 0 : stepX / 2
      const y = top + row * stepY
      for (let col = 0; col < cols; col++) {
        const x = left + col * stepX + offset
        if (x > w * 0.9) continue
        ctx.beginPath()
        ctx.arc(x, y, holeRadius, 0, Math.PI * 2)
        ctx.fill()
      }
      if (row < rows - 1) {
        const midY = y + stepY * 0.5
        for (let col = 0; col < cols - 1; col++) {
          const x = left + col * stepX + stepX * 0.5
          ctx.beginPath()
          ctx.arc(x, midY, holeRadius * 0.8, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }, [])

  useEffect(() => {
    return () => {
      bodyGeometry.dispose()
      deckGeometry.dispose()
      pickGeometry.dispose()
      overlayGeometry.dispose()
      deckTexture.dispose()
    }
  }, [bodyGeometry, deckGeometry, pickGeometry, overlayGeometry, deckTexture])

  useEffect(() => {
    if (bodyMeshRef.current) bodyMeshRef.current.layers.set(layer)
    if (deckMeshRef.current) deckMeshRef.current.layers.set(layer)
    if (pickMeshRef.current) pickMeshRef.current.layers.set(layer)
  }, [layer])

  useEffect(() => {
    if (!pickMeshRef.current) return
    pickMeshRef.current.userData.scaffPickKind = 'plank'
    pickMeshRef.current.userData.scaffItems = planks
  }, [planks])

  useLayoutEffect(() => {
    const tmpMatrix = new THREE.Matrix4()
    const tmpQuat = new THREE.Quaternion()
    const tmpScale = new THREE.Vector3()
    const zAxis = new THREE.Vector3(0, 0, 1)
    const visibleCount = Math.min(planks.length, PLANK_POOL)

    const updateMesh = (mesh: THREE.InstancedMesh | null) => {
      if (!mesh) return
      mesh.count = visibleCount
      for (let i = 0; i < visibleCount; i++) {
        const plank = planks[i]
        tmpQuat.setFromAxisAngle(zAxis, plank.rotationZ)
        tmpScale.set(inchesToFeet(plank.widthIn), plank.lengthFt, plankDepthFt)
        tmpMatrix.compose(plank.center, tmpQuat, tmpScale)
        mesh.setMatrixAt(i, tmpMatrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    }

    updateMesh(bodyMeshRef.current)
    updateMesh(deckMeshRef.current)
    updateMesh(pickMeshRef.current)
  }, [planks, plankDepthFt])

  const selectedIndex = selectedId ? planks.findIndex((plank) => plank.id === selectedId) : -1

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
    if (!onSelect) return
    const instanceId = e.instanceId
    if (instanceId === undefined || instanceId < 0 || instanceId >= planks.length) return
    onSelect(planks[instanceId], e)
  }

  return (
    <group>
      <instancedMesh
        ref={pickMeshRef}
        args={[undefined, undefined, PLANK_POOL]}
        frustumCulled={false}
        onPointerDown={onSelect ? handlePointerDown : undefined}
      >
        <primitive object={pickGeometry} attach="geometry" />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </instancedMesh>

      <instancedMesh ref={bodyMeshRef} args={[undefined, undefined, PLANK_POOL]} frustumCulled={false} castShadow receiveShadow>
        <primitive object={bodyGeometry} attach="geometry" />
        <meshStandardMaterial
          color={PLANK_COLOR}
          metalness={0.8}
          roughness={0.31}
          emissive="#808993"
          emissiveIntensity={0.03}
					clippingPlanes={clippingPlanes}
					clipShadows={clipShadows}
        />
      </instancedMesh>

      <instancedMesh ref={deckMeshRef} args={[undefined, undefined, PLANK_POOL]} frustumCulled={false} receiveShadow>
        <primitive object={deckGeometry} attach="geometry" />
        <meshStandardMaterial
          map={deckTexture}
          color="#d7dce1"
          metalness={0.58}
          roughness={0.48}
          side={THREE.DoubleSide}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
					clippingPlanes={clippingPlanes}
					clipShadows={clipShadows}
        />
      </instancedMesh>
      {selectedIndex >= 0 && selectedIndex < planks.length && (() => {
        const plank = planks[selectedIndex]
        const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), plank.rotationZ)
        return (
          <mesh
            raycast={() => null}
            renderOrder={10}
            position={[plank.center.x, plank.center.y, plank.center.z]}
            quaternion={quat}
            scale={[
              inchesToFeet(plank.widthIn) * 1.04,
              plank.lengthFt * 1.01,
              plankDepthFt * 1.15,
            ]}
          >
            <primitive object={overlayGeometry} attach="geometry" />
            <meshStandardMaterial
              color={SELECTED_OVERLAY_COLOR}
              emissive={SELECTED_OVERLAY_COLOR}
              emissiveIntensity={0.35}
              transparent
              opacity={0.28}
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
