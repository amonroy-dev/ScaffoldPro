import { useRef, forwardRef, useImperativeHandle } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useSettings } from '../contexts/SettingsContext'

/**
 * GridCursor - High-performance visual cursor for CAD grid snapping
 * 
 * COORDINATE SYSTEM: Z-UP (CAD Standard)
 * - X = Right
 * - Y = Back/Front  
 * - Z = Vertical Height (UP)
 * 
 * PERFORMANCE STRATEGY:
 * - Uses refs instead of state to avoid React re-renders
 * - Updates position directly in useFrame for 60fps
 * - Raycasts against infinite XY plane (Z=0)
 * - Grid snapping uses Math.round(pos/step)*step
 */

export interface GridCursorHandle {
  /** Get the current snapped grid position */
  getPosition: () => THREE.Vector3
  /** Check if cursor is currently over the grid */
  isOnGrid: () => boolean
  /** Update cursor visibility */
  setVisible: (visible: boolean) => void
}

interface GridCursorProps {
  /** Size of the cursor indicator */
  size?: number
  /** Color of the cursor */
  color?: string
  /** Whether cursor is active (visible and tracking) */
  active?: boolean
  /** Active drawing plane elevation in feet */
  planeZ?: number
  /** Optional drawing plane origin */
  planeOrigin?: THREE.Vector3
  /** Optional drawing plane normal */
  planeNormal?: THREE.Vector3
  /** Optional drawing plane horizontal axis */
  axisU?: THREE.Vector3
  /** Optional drawing plane vertical axis */
  axisV?: THREE.Vector3
  /** Optional host-aware point resolver. Return null to hide the cursor. */
  resolvePoint?: (point: THREE.Vector3) => THREE.Vector3 | null
}

// Reusable objects to avoid GC pressure (allocated once)
const _raycaster = new THREE.Raycaster()
const _intersectPoint = new THREE.Vector3()
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0) // XY plane at Z=0 (Z-UP)

export const GridCursor = forwardRef<GridCursorHandle, GridCursorProps>(
  ({
    size = 0.15,
    color = '#00ff88',
    active = true,
    planeZ = 0,
    planeOrigin,
    planeNormal,
    axisU,
    axisV,
    resolvePoint,
  }, ref) => {
    const { settings } = useSettings()
    const { camera } = useThree()
    
    // Refs for high-performance updates (no React re-renders)
    const groupRef = useRef<THREE.Group>(null)
    const positionRef = useRef(new THREE.Vector3())
    const isOnGridRef = useRef(false)
    // Visibility gate that is independent from the `active` prop.
    // NOTE: This must NOT be initialized from `active`, otherwise:
    // - component mounts while inactive (Select tool)
    // - later becomes active (Rectangle tool)
    // - but visibleRef stays false forever (cursor never appears)
    const visibleRef = useRef(true)

    // Expose imperative handle for parent components
    useImperativeHandle(ref, () => ({
      getPosition: () => positionRef.current.clone(),
      isOnGrid: () => isOnGridRef.current,
      setVisible: (visible: boolean) => {
        visibleRef.current = visible
        if (groupRef.current) {
          groupRef.current.visible = visible && isOnGridRef.current
        }
      },
    }), [])

    // Grid snap helper - snaps to nearest grid intersection
    const snapToGrid = (value: number, step: number): number => {
      return Math.round(value / step) * step
    }

    // High-performance update loop - runs every frame
    useFrame((state) => {
      if (!groupRef.current || !active || !visibleRef.current) {
        if (groupRef.current) groupRef.current.visible = false
        return
      }

      // Cast ray from camera through mouse position
      // Use r3f's internal pointer (NDC) instead of DOM mouse listeners:
      // - works for mouse, pen, touch
      // - avoids extra event listeners and coordinate bugs
      _raycaster.setFromCamera(state.pointer, camera)

      const origin = planeOrigin ?? new THREE.Vector3(0, 0, planeZ)
      const normal = (planeNormal ?? new THREE.Vector3(0, 0, 1)).clone().normalize()
      const uAxis = (axisU ?? new THREE.Vector3(1, 0, 0)).clone().normalize()
      const vAxis = (axisV ?? new THREE.Vector3(0, 1, 0)).clone().normalize()

      // Intersect with active drawing plane
      _groundPlane.setFromNormalAndCoplanarPoint(normal, origin)
      const intersects = _raycaster.ray.intersectPlane(_groundPlane, _intersectPoint)

      if (intersects) {
        // Snap to grid
        const gridStep = settings.snapToGrid ? settings.gridSize : 0.001
        const local = _intersectPoint.clone().sub(origin)
        const snappedU = snapToGrid(local.dot(uAxis), gridStep)
        const snappedV = snapToGrid(local.dot(vAxis), gridStep)
        const snappedPoint = origin.clone()
          .add(uAxis.multiplyScalar(snappedU))
          .add(vAxis.multiplyScalar(snappedV))
        const resolvedPoint = resolvePoint ? resolvePoint(snappedPoint.clone()) : snappedPoint

        if (!resolvedPoint) {
          groupRef.current.visible = false
          isOnGridRef.current = false
          return
        }

        // Update position ref (for external access)
        positionRef.current.copy(resolvedPoint)

        // Update visual cursor position directly (no state update)
        groupRef.current.position.copy(resolvedPoint).addScaledVector(normal, 0.01)
        groupRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
        groupRef.current.visible = true
        isOnGridRef.current = true
      } else {
        groupRef.current.visible = false
        isOnGridRef.current = false
      }
    })

    return (
      <group ref={groupRef} visible={false}>
        {/* Cross-hair cursor */}
        <mesh rotation={[0, 0, 0]}>
          <ringGeometry args={[size * 0.6, size * 0.8, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.8} side={THREE.DoubleSide} />
        </mesh>
        
        {/* Center dot */}
        <mesh>
          <circleGeometry args={[size * 0.15, 16]} />
          <meshBasicMaterial color={color} side={THREE.DoubleSide} />
        </mesh>

        {/* Cross lines */}
        <mesh rotation={[0, 0, 0]}>
          <planeGeometry args={[size * 2, size * 0.08]} />
          <meshBasicMaterial color={color} transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <planeGeometry args={[size * 2, size * 0.08]} />
          <meshBasicMaterial color={color} transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      </group>
    )
  }
)

GridCursor.displayName = 'GridCursor'
