import { useMemo, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useTool } from '../contexts/ToolContext'
import {
  clampPointToRectFaceInfo,
  clampPointToBaseMassFace,
  constrainRectFaceSketchPoint,
  constrainFaceSketchPoint,
  getBaseMassFaceInfo,
  isBaseMassEntity,
  isHostedRectEntity,
  isRoofEntity,
  isPointInsideRectFaceInfo,
  isPointInsideBaseMassFace,
  raycastBaseMassFaces,
  raycastRectFaceInfo,
  resolvePreferredDrawHostFace,
  resolveHostedRectEntityFaceInfo,
  resolveHostedRectEntityTopFaceInfo,
  type BaseMassFaceId,
} from '../types/buildingEntities'
import { useSettings } from '../contexts/SettingsContext'
import { GridCursor, type GridCursorHandle } from './GridCursor'

/**
 * DrawingPlane - Invisible plane for capturing mouse events during drawing
 *
 * COORDINATE SYSTEM: Z-UP (CAD Standard)
 * - X = Right
 * - Y = Back/Front (depth)
 * - Z = Vertical Height (UP)
 *
 * PERFORMANCE STRATEGY:
 * - Uses raycaster to intersect XY plane at Z=0
 * - Grid snapping: Math.round(pos/step)*step
 * - Cursor position updated via refs (no React re-renders)
 * - Drawing state only updates on pointer events (not every frame)
 */

// Reusable objects to avoid GC pressure during raycasting
const _raycaster = new THREE.Raycaster()
const _intersectPoint = new THREE.Vector3()
const _drawingPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0) // XY plane at active elevation

export function DrawingPlane() {
  const {
    activeTool,
    workspaceMode,
    buildingEntities,
    selectedBuildingEntityId,
    buildingHostedSketchIntent,
    buildingHostedSketchFaceId,
    setBuildingHostedSketchFaceId,
    startDrawing,
    updateDrawing,
    finishDrawing,
    cancelDrawing,
    setSelectedObjectId,
    setSelectedStackIds,
    drawingState,
    cameraNavigationActive,
    viewMode,
  } = useTool()
  const { settings } = useSettings()
  const { camera } = useThree()

  // Refs for high-performance cursor tracking
  const cursorRef = useRef<GridCursorHandle>(null)
  const lastGridPosRef = useRef(new THREE.Vector3())
  const lastHostedHoverFaceIdRef = useRef<BaseMassFaceId | null>(null)
  const isShapeDrawTool = activeTool === 'rectangle' || activeTool === 'circle' || activeTool === 'ring' || activeTool === 'polygon'

  const activeHostEntity = buildingHostedSketchIntent
    ? buildingEntities.find(entity => entity.id === buildingHostedSketchIntent.hostEntityId) ?? null
    : selectedBuildingEntityId
      ? buildingEntities.find(entity => entity.id === selectedBuildingEntityId) ?? null
    : null
  const hostedBaseMass = activeHostEntity && isBaseMassEntity(activeHostEntity) ? activeHostEntity : null
  const hostedRectHost = activeHostEntity && isHostedRectEntity(activeHostEntity) ? activeHostEntity : null
  const roofBaseOffsetByHostId = useMemo(() => {
    const map = new Map<string, number>()
    for (const entity of buildingEntities) {
      if (!isRoofEntity(entity)) continue
      const current = map.get(entity.host.entityId) ?? 0
      map.set(entity.host.entityId, Math.max(current, Number(entity.params.thicknessFt ?? 0)))
    }
    return map
  }, [buildingEntities])
  const activeHostFace = useMemo(
    () => {
      if (workspaceMode !== 'BUILDING_MODE' || !isShapeDrawTool) return null
      if (buildingHostedSketchIntent && hostedBaseMass) {
        if (drawingState.isDrawing && drawingState.hostFaceId) {
          return getBaseMassFaceInfo(hostedBaseMass, drawingState.hostFaceId as BaseMassFaceId)
        }
        if (buildingHostedSketchIntent.hostKind !== 'top-face' && !buildingHostedSketchFaceId) {
          return null
        }
        const nextFaceId = buildingHostedSketchFaceId ?? buildingHostedSketchIntent.faceId
        return getBaseMassFaceInfo(hostedBaseMass, nextFaceId)
      }
      if (buildingHostedSketchIntent && hostedRectHost) {
        return resolveHostedRectEntityFaceInfo(
          hostedRectHost,
          buildingHostedSketchFaceId ?? buildingHostedSketchIntent.faceId,
          buildingEntities,
          roofBaseOffsetByHostId,
        )
      }
      return resolvePreferredDrawHostFace(hostedBaseMass, activeTool, viewMode)
    },
    [hostedBaseMass, hostedRectHost, activeTool, buildingEntities, buildingHostedSketchIntent, buildingHostedSketchFaceId, drawingState.hostFaceId, drawingState.isDrawing, roofBaseOffsetByHostId, viewMode, workspaceMode, isShapeDrawTool],
  )
  const planeOrigin = useMemo(
    () => activeHostFace
      ? new THREE.Vector3(activeHostFace.center.x, activeHostFace.center.y, activeHostFace.center.z)
      : new THREE.Vector3(0, 0, 0),
    [activeHostFace],
  )
  const planeNormal = useMemo(
    () => activeHostFace
      ? new THREE.Vector3(activeHostFace.normal.x, activeHostFace.normal.y, activeHostFace.normal.z).normalize()
      : new THREE.Vector3(0, 0, 1),
    [activeHostFace],
  )
  const planeAxisU = useMemo(
    () => activeHostFace
      ? new THREE.Vector3(activeHostFace.axisU.x, activeHostFace.axisU.y, activeHostFace.axisU.z).normalize()
      : new THREE.Vector3(1, 0, 0),
    [activeHostFace],
  )
  const planeAxisV = useMemo(
    () => activeHostFace
      ? new THREE.Vector3(activeHostFace.axisV.x, activeHostFace.axisV.y, activeHostFace.axisV.z).normalize()
      : new THREE.Vector3(0, 1, 0),
    [activeHostFace],
  )
  const interactionPlaneQuaternion = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), planeNormal),
    [planeNormal],
  )

  const resolveHostedSketchCandidateFaces = useCallback((): BaseMassFaceId[] => {
    if (!buildingHostedSketchIntent) return []
    if (hostedRectHost) {
      if (buildingHostedSketchIntent.hostKind === 'top-face') return ['top']
      if (buildingHostedSketchIntent.hostKind === 'side-face') return ['front', 'back', 'left', 'right']
      return ['top', 'front', 'back', 'left', 'right']
    }
    if (!hostedBaseMass) return []
    if (buildingHostedSketchIntent.hostKind === 'top-face') return ['top']
    if (hostedBaseMass.params.shape !== 'rect') {
      return buildingHostedSketchIntent.hostKind === 'auto-face' ? ['top'] : []
    }
    if (buildingHostedSketchIntent.hostKind === 'side-face') {
      return ['front', 'back', 'left', 'right']
    }
    return ['top', 'front', 'back', 'left', 'right']
  }, [buildingHostedSketchIntent, hostedBaseMass, hostedRectHost])

  const snapPointToFaceGrid = useCallback((
    faceId: BaseMassFaceId,
    point: THREE.Vector3,
  ): THREE.Vector3 => {
    const faceInfo = hostedBaseMass
      ? getBaseMassFaceInfo(hostedBaseMass, faceId)
      : (hostedRectHost
          ? resolveHostedRectEntityFaceInfo(hostedRectHost, faceId, buildingEntities, roofBaseOffsetByHostId)
          : null)
    if (!faceInfo) return point.clone()
    const step = settings.snapToGrid ? settings.gridSize : 0.001
    const origin = new THREE.Vector3(faceInfo.center.x, faceInfo.center.y, faceInfo.center.z)
    const axisU = new THREE.Vector3(faceInfo.axisU.x, faceInfo.axisU.y, faceInfo.axisU.z).normalize()
    const axisV = new THREE.Vector3(faceInfo.axisV.x, faceInfo.axisV.y, faceInfo.axisV.z).normalize()
    const local = point.clone().sub(origin)
    const snappedU = Math.round(local.dot(axisU) / step) * step
    const snappedV = Math.round(local.dot(axisV) / step) * step
    const snappedPoint = origin
      .clone()
      .addScaledVector(axisU, snappedU)
      .addScaledVector(axisV, snappedV)
    const clamped = hostedBaseMass
      ? clampPointToBaseMassFace(hostedBaseMass, faceId, snappedPoint)
      : clampPointToRectFaceInfo(faceInfo, snappedPoint)
    return new THREE.Vector3(clamped.x, clamped.y, clamped.z)
  }, [buildingEntities, hostedBaseMass, hostedRectHost, roofBaseOffsetByHostId, settings.gridSize, settings.snapToGrid])

  const raycastHostedSurface = useCallback((pointer: THREE.Vector2) => {
    if (!buildingHostedSketchIntent) return null
    const candidateFaces = resolveHostedSketchCandidateFaces()
    if (candidateFaces.length === 0) return null
    _raycaster.setFromCamera(pointer, camera)
    if (hostedRectHost) {
      const nextFaceId = buildingHostedSketchFaceId ?? buildingHostedSketchIntent.faceId
      const faceInfo = resolveHostedRectEntityFaceInfo(hostedRectHost, nextFaceId, buildingEntities, roofBaseOffsetByHostId)
      if (!faceInfo) return null
      const hit = raycastRectFaceInfo(
        faceInfo,
        _raycaster.ray.origin,
        _raycaster.ray.direction,
      )
      if (!hit) return null
      return {
        ...hit,
        point: snapPointToFaceGrid(hit.faceId, new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z)),
      }
    }
    if (!hostedBaseMass) return null
    const hit = raycastBaseMassFaces(
      hostedBaseMass,
      candidateFaces,
      _raycaster.ray.origin,
      _raycaster.ray.direction,
    )
    if (!hit) return null
    return {
      ...hit,
      point: snapPointToFaceGrid(hit.faceId, new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z)),
    }
  }, [buildingEntities, buildingHostedSketchIntent, camera, hostedBaseMass, hostedRectHost, resolveHostedSketchCandidateFaces, roofBaseOffsetByHostId, snapPointToFaceGrid])

  /**
   * Raycast from camera through mouse position to XY plane (Z=0)
   * Returns snapped grid position or null if no intersection
   */
  const raycastToGrid = useCallback((pointer: THREE.Vector2): THREE.Vector3 | null => {
    if (buildingHostedSketchIntent && (hostedBaseMass || hostedRectHost) && !drawingState.isDrawing) {
      const hostedHit = raycastHostedSurface(pointer)
      if (!hostedHit) return null
      return hostedHit.point.clone()
    }
    _raycaster.setFromCamera(pointer, camera)
    _drawingPlane.setFromNormalAndCoplanarPoint(planeNormal, planeOrigin)
    const intersects = _raycaster.ray.intersectPlane(_drawingPlane, _intersectPoint)

    if (intersects) {
      const step = settings.snapToGrid ? settings.gridSize : 0.001
      const local = _intersectPoint.clone().sub(planeOrigin)
      const snappedU = Math.round(local.dot(planeAxisU) / step) * step
      const snappedV = Math.round(local.dot(planeAxisV) / step) * step
      return planeOrigin.clone()
        .addScaledVector(planeAxisU, snappedU)
        .addScaledVector(planeAxisV, snappedV)
    }
    return null
  }, [buildingHostedSketchIntent, camera, drawingState.isDrawing, hostedBaseMass, hostedRectHost, planeNormal, planeOrigin, planeAxisU, planeAxisV, raycastHostedSurface, settings.snapToGrid, settings.gridSize])

  const resolveDrawingPoint = useCallback((point: THREE.Vector3): THREE.Vector3 => {
    if (buildingHostedSketchIntent && !activeHostFace) return point.clone()
    if (!activeHostFace) return point.clone()

    if (hostedBaseMass) {
      if (activeTool === 'rectangle' && drawingState.isDrawing && drawingState.startPoint) {
        const constrainedPoint = constrainFaceSketchPoint(hostedBaseMass, activeHostFace.faceId, drawingState.startPoint, point)
        return new THREE.Vector3(constrainedPoint.x, constrainedPoint.y, constrainedPoint.z)
      }
      const clampedPoint = clampPointToBaseMassFace(hostedBaseMass, activeHostFace.faceId, point)
      return new THREE.Vector3(clampedPoint.x, clampedPoint.y, clampedPoint.z)
    }
    if (hostedRectHost) {
      if (activeTool === 'rectangle' && drawingState.isDrawing && drawingState.startPoint) {
        const constrainedPoint = constrainRectFaceSketchPoint(activeHostFace, drawingState.startPoint, point)
        return new THREE.Vector3(constrainedPoint.x, constrainedPoint.y, constrainedPoint.z)
      }
      const clampedPoint = clampPointToRectFaceInfo(activeHostFace, point)
      return new THREE.Vector3(clampedPoint.x, clampedPoint.y, clampedPoint.z)
    }
    return point.clone()
  }, [activeHostFace, activeTool, buildingHostedSketchIntent, drawingState.isDrawing, drawingState.startPoint, hostedBaseMass, hostedRectHost])

  const resolveCursorPoint = useCallback((point: THREE.Vector3): THREE.Vector3 | null => {
    if (buildingHostedSketchIntent && !activeHostFace) return null
    if (!activeHostFace) return point.clone()
    if (drawingState.isDrawing) return resolveDrawingPoint(point)
    if (hostedBaseMass && !isPointInsideBaseMassFace(hostedBaseMass, activeHostFace.faceId, point)) return null
    if (hostedRectHost && !isPointInsideRectFaceInfo(activeHostFace, point)) return null
    return resolveDrawingPoint(point)
  }, [activeHostFace, buildingHostedSketchIntent, drawingState.isDrawing, hostedBaseMass, hostedRectHost, resolveDrawingPoint])

  // High-performance frame update for drawing preview
  useFrame((state) => {
    if (workspaceMode !== 'BUILDING_MODE') return
    if (buildingHostedSketchIntent && (hostedBaseMass || hostedRectHost) && !drawingState.isDrawing) {
      const hoverHit = raycastHostedSurface(state.pointer)
      const nextFaceId = hoverHit?.faceId ?? (buildingHostedSketchIntent.hostKind === 'top-face' ? 'top' : null)
      if (nextFaceId !== lastHostedHoverFaceIdRef.current) {
        lastHostedHoverFaceIdRef.current = nextFaceId
        setBuildingHostedSketchFaceId(nextFaceId)
      }
    }
    if (!isShapeDrawTool || !drawingState.isDrawing) return

    const gridPos = raycastToGrid(state.pointer)
    if (!gridPos) return
    const nextPoint = resolveDrawingPoint(gridPos)
    if (!nextPoint.equals(lastGridPosRef.current)) {
      lastGridPosRef.current.copy(nextPoint)
      updateDrawing(nextPoint)
    }
  })

  // Pointer event handlers - use ThreeEvent for r3f mesh events
  const handlePointerDown = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!isShapeDrawTool) return
    if (event.button !== 0) return
    if (cameraNavigationActive) return

    // Safety: drawing tool is only valid in BUILDING_MODE.
    if (workspaceMode !== 'BUILDING_MODE') return

    event.stopPropagation()
    const hostedHit = buildingHostedSketchIntent && hostedBaseMass && !drawingState.isDrawing
      ? raycastHostedSurface(event.pointer)
      : null
    const gridPos = hostedHit ? hostedHit.point.clone() : raycastToGrid(event.pointer)
    if (gridPos) {
      if (!hostedHit && hostedBaseMass && activeHostFace && !isPointInsideBaseMassFace(hostedBaseMass, activeHostFace.faceId, gridPos)) return
      const startPoint = hostedHit
        ? gridPos
        : hostedBaseMass && activeHostFace
          ? resolveDrawingPoint(gridPos)
          : gridPos
      lastGridPosRef.current.copy(startPoint)
      startDrawing(startPoint, hostedHit ? {
        hostEntityId: hostedBaseMass?.id ?? null,
        hostKind: hostedHit.hostKind,
        hostFaceId: hostedHit.faceId,
      } : undefined)
    }
  }, [activeHostFace, buildingHostedSketchIntent, cameraNavigationActive, drawingState.isDrawing, hostedBaseMass, hostedRectHost, isShapeDrawTool, raycastHostedSurface, raycastToGrid, resolveDrawingPoint, startDrawing, workspaceMode])

  const handleClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    if (activeTool !== 'select') return
    if (cameraNavigationActive) return

    // High-end UX: only clear selection when the user actually clicks empty space.
    // Because this plane is huge and always intersected, it can receive events even
    // when the pointer is over another object that lacks a handler for this event.
    // We only clear when the *closest* intersection is this plane.
    const closest = event.intersections?.[0]
    if (!closest) return
    if (closest.object !== event.object) return

    setSelectedObjectId(null)
    setSelectedStackIds([])
  }, [activeTool, cameraNavigationActive, setSelectedObjectId, setSelectedStackIds])

  const handlePointerUp = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (activeTool === 'polygon') return
    if (!isShapeDrawTool) return
    if (event.button !== 0) return
    if (workspaceMode !== 'BUILDING_MODE') return
    event.stopPropagation()
    finishDrawing()
  }, [activeTool, isShapeDrawTool, workspaceMode, finishDrawing])

  const handleDoubleClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    if (activeTool !== 'polygon') return
    if (workspaceMode !== 'BUILDING_MODE') return
    event.stopPropagation()
    finishDrawing()
  }, [activeTool, workspaceMode, finishDrawing])

  const handleContextMenu = useCallback((event: ThreeEvent<MouseEvent>) => {
    if (activeTool !== 'polygon') return
    if (workspaceMode !== 'BUILDING_MODE') return
    event.stopPropagation()
    event.nativeEvent.preventDefault()
    finishDrawing()
  }, [activeTool, workspaceMode, finishDrawing])

  const handlePointerLeave = useCallback(() => {
    if (drawingState.isDrawing && activeTool !== 'polygon') {
      cancelDrawing()
    }
  }, [activeTool, drawingState.isDrawing, cancelDrawing])

  // IMPORTANT: Only attach pointer handlers when needed.
  // In R3F, *having* an event handler makes this huge plane part of the picking
  // event pipeline. Leaving handlers attached for unrelated tools can interfere
  // with scaffold selection (especially for click sequences that start on pointer-down).
  const enableDrawingHandlers = workspaceMode === 'BUILDING_MODE' && isShapeDrawTool
  const enableClearHandlers = activeTool === 'select'

  // Determine if cursor should be active - only for drawing tools (not select)
  // This will include rectangle and any future shape tools
  const isDrawingTool = activeTool === 'rectangle' || activeTool === 'circle' || activeTool === 'ring' || activeTool === 'polygon'
  const cursorActive = isDrawingTool && workspaceMode === 'BUILDING_MODE'

  return (
    <group>
      {/* Smart Grid Cursor - only visible when a drawing/shape tool is active */}
      <GridCursor
        ref={cursorRef}
        active={cursorActive}
        color="#00ff88"
        size={0.2}
        planeOrigin={planeOrigin}
        planeNormal={planeNormal}
        axisU={planeAxisU}
        axisV={planeAxisV}
        resolvePoint={resolveCursorPoint}
      />

      {/* Invisible interaction plane - captures pointer events */}
      {/* Positioned on XY plane at Z=0 (no rotation needed for Z-UP) */}
      <mesh
        position={planeOrigin}
        quaternion={interactionPlaneQuaternion}
        onPointerDown={enableDrawingHandlers ? handlePointerDown : undefined}
        onPointerUp={enableDrawingHandlers ? handlePointerUp : undefined}
        onPointerLeave={enableDrawingHandlers ? handlePointerLeave : undefined}
        onDoubleClick={enableDrawingHandlers ? handleDoubleClick : undefined}
        onContextMenu={enableDrawingHandlers ? handleContextMenu : undefined}
        onClick={enableClearHandlers ? handleClick : undefined}
      >
        <planeGeometry args={[2000, 2000]} />
        <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}
