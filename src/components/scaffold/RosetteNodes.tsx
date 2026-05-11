import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { ThreeEvent, useFrame } from '@react-three/fiber'
import { WORKSPACE_LAYERS } from '../../contexts/ToolContext'
import { inchesToFeet } from './units'

// Pre-allocate so R3F never recreates the InstancedMesh when node count changes.
const NODE_POOL = 2000

export type RosetteNode = {
  stackId: string
  liftIndex: number // 0 = base collar rosette, 1+ = standard rosettes
  position: THREE.Vector3
}

/**
 * High-end rosette connection point markers.
 *
 * Uses emissive materials with glow effects for a professional CAD appearance.
 * - Default: Soft cyan/teal glow
 * - Hover: Bright orange/gold glow
 * - Selected/Start: Bright green glow
 * - Invalid: Muted gray
 */
export function RosetteNodes({
  nodes,
  start,
  hoveredIndex,
  isValidTarget,
  onNodePointerDown,
  onHoverIndex,
}: {
  nodes: RosetteNode[]
  start: { stackId: string; liftIndex: number } | null
  hoveredIndex: number | null
  isValidTarget: (node: RosetteNode) => boolean
  onNodePointerDown: (node: RosetteNode, e: ThreeEvent<PointerEvent>) => void
  onHoverIndex: (index: number | null) => void
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const glowMeshRef = useRef<THREE.InstancedMesh>(null)

  // Main marker geometry - slightly smaller than before for refinement
  const geom = useMemo(() => {
    return new THREE.SphereGeometry(inchesToFeet(4) / 2, 24, 16)
  }, [])

  // Outer glow ring geometry
  const glowGeom = useMemo(() => {
    return new THREE.RingGeometry(inchesToFeet(3) / 2, inchesToFeet(5) / 2, 32)
  }, [])

  useEffect(() => {
    return () => {
      geom.dispose()
      glowGeom.dispose()
    }
  }, [geom, glowGeom])

  useEffect(() => {
    if (meshRef.current) meshRef.current.layers.set(WORKSPACE_LAYERS.INTERACTION)
    if (glowMeshRef.current) glowMeshRef.current.layers.set(WORKSPACE_LAYERS.INTERACTION)
  }, [])

  // Animate glow pulse for selected/hovered markers
  const pulseRef = useRef(0)
  useFrame((_, delta) => {
    pulseRef.current += delta * 3
  })

  useLayoutEffect(() => {
    if (!meshRef.current) return
    const mesh = meshRef.current
    const glowMesh = glowMeshRef.current

		// Keep instance counts in sync when nodes shrink/grow.
		// Without this, removed nodes can remain visible as stale instances.
		mesh.count = nodes.length
		if (glowMesh) glowMesh.count = nodes.length

    const tmpQuat = new THREE.Quaternion()
    const tmpScale = new THREE.Vector3(1, 1, 1)
    const tmpMatrix = new THREE.Matrix4()
    const tmpColor = new THREE.Color()

    tmpQuat.identity()

    for (let i = 0; i < nodes.length; i++) {
      tmpMatrix.compose(nodes[i].position, tmpQuat, tmpScale)
      mesh.setMatrixAt(i, tmpMatrix)

      const node = nodes[i]
      const isStart = !!start && start.stackId === node.stackId && start.liftIndex === node.liftIndex
      const isHover = hoveredIndex === i
      const valid = isValidTarget(node)

      // High-end color palette with emissive glow effect
      // Using HDR colors (values > 1) for bloom-like brightness
      if (isStart) {
        // Selected/start: Bright emerald green
        tmpColor.setRGB(0.2, 1.5, 0.5)
      } else if (isHover) {
        if (valid) {
          // Valid hover: Bright warm orange/gold
          tmpColor.setRGB(1.5, 0.8, 0.1)
        } else {
          // Invalid hover: Muted gray
          tmpColor.setRGB(0.35, 0.38, 0.42)
        }
      } else if (valid) {
        // Default valid: Soft cyan/teal - professional and visible
        tmpColor.setRGB(0.3, 0.85, 1.0)
      } else {
        // Default invalid: Subtle gray
        tmpColor.setRGB(0.4, 0.42, 0.45)
      }

      mesh.setColorAt(i, tmpColor)

      // Update glow ring if present
      if (glowMesh) {
        // Position glow ring at same location but facing camera (billboard later)
        glowMesh.setMatrixAt(i, tmpMatrix)
        // Glow uses same color but more transparent
        glowMesh.setColorAt(i, tmpColor)
      }
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

    if (glowMesh) {
      glowMesh.instanceMatrix.needsUpdate = true
      if (glowMesh.instanceColor) glowMesh.instanceColor.needsUpdate = true
    }

    mesh.computeBoundingSphere()
  }, [nodes, start, hoveredIndex, isValidTarget])

  if (nodes.length === 0) return null

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.buttons !== 0) return
    const id = e.instanceId
    if (typeof id === 'number') onHoverIndex(id)
  }

  const handlePointerOut = () => onHoverIndex(null)

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const id = e.instanceId
    if (typeof id !== 'number') return
    if (id < 0 || id >= nodes.length) return
    onNodePointerDown(nodes[id], e)
  }

  return (
    <group>
      {/* Main marker spheres */}
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, NODE_POOL]}
        frustumCulled={false}
        renderOrder={998}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onPointerDown={handlePointerDown}
      >
        <primitive object={geom} attach="geometry" />
        <meshStandardMaterial
          vertexColors
          emissive="#ffffff"
          emissiveIntensity={0.4}
          metalness={0.3}
          roughness={0.2}
          transparent
          opacity={0.92}
          depthTest={false}
          depthWrite={false}
        />
      </instancedMesh>

      {/* Outer glow halo effect */}
      <instancedMesh
        ref={glowMeshRef}
        args={[undefined, undefined, NODE_POOL]}
        frustumCulled={false}
        renderOrder={997}
      >
        <primitive object={glowGeom} attach="geometry" />
        <meshBasicMaterial
          vertexColors
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
          depthTest={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>
    </group>
  )
}
