import { useMemo } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { useTool } from '../contexts/ToolContext'
import {
  getBaseMassFaceInfo,
  getHostedFeatureDefaultColor,
  getHostedFeatureDefaultDepthFt,
  getHostedFeatureDefaultHeightFt,
  getProxyDefaultColor,
  getProxyDefaultDepthFt,
  getProxyDefaultHeightFt,
  isBaseMassEntity,
  isRoofEntity,
  resolveFaceSketchRect,
  type BaseMassFaceId,
} from '../types/buildingEntities'

const CIRCLE_SEGMENTS = 64

function buildFaceOutlinePoints(
  hostedFace: NonNullable<ReturnType<typeof getBaseMassFaceInfo>>,
  sketchRect: ReturnType<typeof resolveFaceSketchRect>,
): [number, number, number][] {
  if (!sketchRect) return []
  const outlineOffset = new THREE.Vector3(hostedFace.normal.x, hostedFace.normal.y, hostedFace.normal.z)
    .normalize()
    .multiplyScalar(0.02)
  return [
    new THREE.Vector3(
      hostedFace.center.x + hostedFace.axisU.x * sketchRect.minU + hostedFace.axisV.x * sketchRect.minV,
      hostedFace.center.y + hostedFace.axisU.y * sketchRect.minU + hostedFace.axisV.y * sketchRect.minV,
      hostedFace.center.z + hostedFace.axisU.z * sketchRect.minU + hostedFace.axisV.z * sketchRect.minV,
    ).add(outlineOffset),
    new THREE.Vector3(
      hostedFace.center.x + hostedFace.axisU.x * sketchRect.maxU + hostedFace.axisV.x * sketchRect.minV,
      hostedFace.center.y + hostedFace.axisU.y * sketchRect.maxU + hostedFace.axisV.y * sketchRect.minV,
      hostedFace.center.z + hostedFace.axisU.z * sketchRect.maxU + hostedFace.axisV.z * sketchRect.minV,
    ).add(outlineOffset),
    new THREE.Vector3(
      hostedFace.center.x + hostedFace.axisU.x * sketchRect.maxU + hostedFace.axisV.x * sketchRect.maxV,
      hostedFace.center.y + hostedFace.axisU.y * sketchRect.maxU + hostedFace.axisV.y * sketchRect.maxV,
      hostedFace.center.z + hostedFace.axisU.z * sketchRect.maxU + hostedFace.axisV.z * sketchRect.maxV,
    ).add(outlineOffset),
    new THREE.Vector3(
      hostedFace.center.x + hostedFace.axisU.x * sketchRect.minU + hostedFace.axisV.x * sketchRect.maxV,
      hostedFace.center.y + hostedFace.axisU.y * sketchRect.minU + hostedFace.axisV.y * sketchRect.maxV,
      hostedFace.center.z + hostedFace.axisU.z * sketchRect.minU + hostedFace.axisV.z * sketchRect.maxV,
    ).add(outlineOffset),
    new THREE.Vector3(
      hostedFace.center.x + hostedFace.axisU.x * sketchRect.minU + hostedFace.axisV.x * sketchRect.minV,
      hostedFace.center.y + hostedFace.axisU.y * sketchRect.minU + hostedFace.axisV.y * sketchRect.minV,
      hostedFace.center.z + hostedFace.axisU.z * sketchRect.minU + hostedFace.axisV.z * sketchRect.minV,
    ).add(outlineOffset),
  ].map(point => [point.x, point.y, point.z] as [number, number, number])
}

/**
 * DrawingPreview - Renders a preview of the shape being drawn
 *
 * COORDINATE SYSTEM: Z-UP (CAD Standard)
 * - X = Right (width)
 * - Y = Back/Front (depth)
 * - Z = Vertical Height (UP)
 *
 * Drawing happens on XY plane at Z=0
 * Preview shapes are extruded upward in +Z direction
 */
export function DrawingPreview() {
  const { drawingState, activeTool, workspaceMode, buildingEntities, buildingHostedSketchIntent } = useTool()
  const { isDrawing, startPoint, currentPoint, polygonPoints, hostEntityId, hostKind, hostFaceId } = drawingState

  const previewColor = buildingHostedSketchIntent
    ? (buildingHostedSketchIntent.target === 'feature'
        ? getHostedFeatureDefaultColor(buildingHostedSketchIntent.preset ?? (buildingHostedSketchIntent.hostKind === 'side-face' ? 'balcony' : 'penthouse'))
        : getProxyDefaultColor(buildingHostedSketchIntent.proxyMode ?? 'add'))
    : '#d7d7d7'
  const isShapeTool = activeTool === 'rectangle' || activeTool === 'circle' || activeTool === 'ring' || activeTool === 'polygon'
  const hostEntity = hostEntityId
    ? buildingEntities.find(entity => entity.id === hostEntityId) ?? null
    : null
  const hostBaseMass = hostEntity && isBaseMassEntity(hostEntity) ? hostEntity : null
  const hostedFace = useMemo(
    () => hostBaseMass && hostFaceId ? getBaseMassFaceInfo(hostBaseMass, hostFaceId as BaseMassFaceId) : null,
    [hostBaseMass, hostFaceId],
  )
  const roofBaseOffsetFt = useMemo(() => {
    if (!hostEntityId) return 0
    return buildingEntities.reduce((maxThickness, entity) => {
      if (!isRoofEntity(entity)) return maxThickness
      if (entity.host.entityId !== hostEntityId) return maxThickness
      return Math.max(maxThickness, Number(entity.params.thicknessFt ?? 0))
    }, 0)
  }, [buildingEntities, hostEntityId])

  // Rectangle preview
  const rectPreview = useMemo(() => {
    if (workspaceMode !== 'BUILDING_MODE') return null
    if (!isDrawing || !startPoint || !currentPoint || activeTool !== 'rectangle') return null
    if (buildingHostedSketchIntent && hostBaseMass && hostedFace && hostFaceId) {
      const sketchRect = resolveFaceSketchRect(hostBaseMass, hostFaceId as BaseMassFaceId, startPoint, currentPoint)
      if (!sketchRect || sketchRect.spanU < 0.1 || sketchRect.spanV < 0.1) return null
      const axisU = new THREE.Vector3(hostedFace.axisU.x, hostedFace.axisU.y, hostedFace.axisU.z).normalize()
      const axisV = new THREE.Vector3(hostedFace.axisV.x, hostedFace.axisV.y, hostedFace.axisV.z).normalize()
      const normal = new THREE.Vector3(hostedFace.normal.x, hostedFace.normal.y, hostedFace.normal.z).normalize()
      const basis = new THREE.Matrix4()
      let dimensions: [number, number, number]
      let normalOffsetFt = 0

      if (buildingHostedSketchIntent.target === 'feature') {
        const preset = buildingHostedSketchIntent.preset ?? (hostKind === 'side-face' ? 'balcony' : 'penthouse')
        if (hostKind === 'top-face') {
          const height = getHostedFeatureDefaultHeightFt(preset)
          dimensions = [sketchRect.spanU, sketchRect.spanV, height]
          normalOffsetFt = roofBaseOffsetFt + height / 2
          basis.makeBasis(axisU, axisV, normal)
        } else {
          const depth = getHostedFeatureDefaultDepthFt(preset)
          dimensions = [sketchRect.spanU, depth, sketchRect.spanV]
          normalOffsetFt = depth / 2
          basis.makeBasis(axisU, normal, axisV)
        }
      } else {
        const proxyMode = buildingHostedSketchIntent.proxyMode ?? 'add'
        if (hostKind === 'top-face') {
          const height = getProxyDefaultHeightFt(proxyMode)
          dimensions = [sketchRect.spanU, sketchRect.spanV, height]
          normalOffsetFt = roofBaseOffsetFt + height / 2
          basis.makeBasis(axisU, axisV, normal)
        } else {
          const depth = getProxyDefaultDepthFt(proxyMode)
          dimensions = [sketchRect.spanU, depth, sketchRect.spanV]
          normalOffsetFt = depth / 2
          basis.makeBasis(axisU, normal, axisV)
        }
      }

      return {
        position: new THREE.Vector3(sketchRect.center.x, sketchRect.center.y, sketchRect.center.z).addScaledVector(normal, normalOffsetFt),
        dimensions: new THREE.Vector3(...dimensions),
        quaternion: new THREE.Quaternion().setFromRotationMatrix(basis),
        outlinePoints: buildFaceOutlinePoints(hostedFace, sketchRect),
      }
    }
    if (hostKind === 'side-face' && hostedFace) {
      const faceCenter = new THREE.Vector3(hostedFace.center.x, hostedFace.center.y, hostedFace.center.z)
      const faceAxisU = new THREE.Vector3(hostedFace.axisU.x, hostedFace.axisU.y, hostedFace.axisU.z)
      const faceAxisV = new THREE.Vector3(hostedFace.axisV.x, hostedFace.axisV.y, hostedFace.axisV.z)
      const faceNormal = new THREE.Vector3(hostedFace.normal.x, hostedFace.normal.y, hostedFace.normal.z)
      const startOffset = startPoint.clone().sub(faceCenter)
      const currentOffset = currentPoint.clone().sub(faceCenter)
      const startU = startOffset.dot(faceAxisU)
      const endU = currentOffset.dot(faceAxisU)
      const startV = startOffset.dot(faceAxisV)
      const endV = currentOffset.dot(faceAxisV)
      const width = Math.abs(endU - startU)
      const verticalHeight = Math.abs(endV - startV)
      const depth = 4
      if (width < 0.1 || verticalHeight < 0.1) return null
      const center = faceCenter
        .clone()
        .add(faceAxisU.multiplyScalar((startU + endU) / 2))
        .add(faceAxisV.multiplyScalar((startV + endV) / 2))
        .add(faceNormal.multiplyScalar(depth / 2))
      const rotationZRad = hostFaceId === 'front' || hostFaceId === 'back'
        ? (hostBaseMass?.rotationZRad ?? 0)
        : (hostBaseMass?.rotationZRad ?? 0) - Math.PI / 2
      const minU = Math.min(startU, endU)
      const maxU = Math.max(startU, endU)
      const minV = Math.min(startV, endV)
      const maxV = Math.max(startV, endV)
      const outlineOffset = faceNormal.clone().multiplyScalar(0.02)
      const outlinePoints: [number, number, number][] = [
        faceCenter.clone().addScaledVector(faceAxisU, minU).addScaledVector(faceAxisV, minV).add(outlineOffset),
        faceCenter.clone().addScaledVector(faceAxisU, maxU).addScaledVector(faceAxisV, minV).add(outlineOffset),
        faceCenter.clone().addScaledVector(faceAxisU, maxU).addScaledVector(faceAxisV, maxV).add(outlineOffset),
        faceCenter.clone().addScaledVector(faceAxisU, minU).addScaledVector(faceAxisV, maxV).add(outlineOffset),
        faceCenter.clone().addScaledVector(faceAxisU, minU).addScaledVector(faceAxisV, minV).add(outlineOffset),
      ].map(point => [point.x, point.y, point.z] as [number, number, number])

      return {
        position: center,
        dimensions: new THREE.Vector3(width, depth, verticalHeight),
        quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rotationZRad)),
        outlinePoints,
      }
    }

    const width = Math.abs(currentPoint.x - startPoint.x)
    const depth = Math.abs(currentPoint.y - startPoint.y)
    const height = 12
    if (width < 0.1 || depth < 0.1) return null
    return {
      position: new THREE.Vector3((startPoint.x + currentPoint.x) / 2, (startPoint.y + currentPoint.y) / 2, startPoint.z + height / 2),
      dimensions: new THREE.Vector3(width, depth, height),
      quaternion: new THREE.Quaternion(),
      outlinePoints: [
        [startPoint.x, startPoint.y, startPoint.z + 0.01],
        [currentPoint.x, startPoint.y, startPoint.z + 0.01],
        [currentPoint.x, currentPoint.y, startPoint.z + 0.01],
        [startPoint.x, currentPoint.y, startPoint.z + 0.01],
        [startPoint.x, startPoint.y, startPoint.z + 0.01],
      ] as [number, number, number][],
    }
  }, [workspaceMode, isDrawing, startPoint, currentPoint, activeTool, buildingHostedSketchIntent, hostKind, hostedFace, hostFaceId, hostBaseMass, roofBaseOffsetFt])

  // Circle / Ring preview
  const circlePreview = useMemo(() => {
    if (workspaceMode !== 'BUILDING_MODE') return null
    if (!isDrawing || !startPoint || !currentPoint) return null
    if (activeTool !== 'circle' && activeTool !== 'ring') return null
    const dx = currentPoint.x - startPoint.x
    const dy = currentPoint.y - startPoint.y
    const radius = Math.sqrt(dx * dx + dy * dy)
    if (radius < 0.2) return null
    const height = 12
    const innerRadius = activeTool === 'ring' ? radius * 0.6 : 0
    return { center: startPoint.clone(), radius, innerRadius, height, isRing: activeTool === 'ring', baseZ: startPoint.z }
  }, [workspaceMode, isDrawing, startPoint, currentPoint, activeTool])

  // Generate circle outline points on the XY plane
  const circleOutlinePoints = useMemo(() => {
    if (!circlePreview) return null
    const { center, radius } = circlePreview
    const pts: [number, number, number][] = []
    for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
      const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2
      pts.push([center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius, center.z + 0.01])
    }
    return pts
  }, [circlePreview])

  const innerOutlinePoints = useMemo(() => {
    if (!circlePreview?.isRing) return null
    const { center, innerRadius } = circlePreview
    const pts: [number, number, number][] = []
    for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
      const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2
      pts.push([center.x + Math.cos(a) * innerRadius, center.y + Math.sin(a) * innerRadius, center.z + 0.01])
    }
    return pts
  }, [circlePreview])

  const polygonPreview = useMemo(() => {
    if (workspaceMode !== 'BUILDING_MODE') return null
    if (!isDrawing || activeTool !== 'polygon') return null
    const committed = polygonPoints.map(point => point.clone())
    if (committed.length === 0) return null
    const livePoints = [...committed]
    const lastPoint = livePoints[livePoints.length - 1] ?? null
    if (currentPoint && (!lastPoint || lastPoint.distanceToSquared(currentPoint) > 0.0001)) {
      livePoints.push(currentPoint.clone())
    }
    return {
      committed,
      livePoints,
      height: 12,
      baseZ: committed[0]?.z ?? 0,
    }
  }, [workspaceMode, isDrawing, activeTool, polygonPoints, currentPoint])

  const polygonMeshGeometry = useMemo(() => {
    if (!polygonPreview) return null
    if (polygonPreview.livePoints.length < 3) return null
    const shape = new THREE.Shape(
      polygonPreview.livePoints.map(point => new THREE.Vector2(point.x, point.y)),
    )
    return new THREE.ExtrudeGeometry(shape, {
      depth: polygonPreview.height,
      bevelEnabled: false,
      steps: 1,
    })
  }, [polygonPreview])

  const polygonOutlinePoints = useMemo(() => {
    if (!polygonPreview) return null
    const outline = polygonPreview.livePoints.map(point => [point.x, point.y, polygonPreview.baseZ + 0.01] as [number, number, number])
    if (polygonPreview.livePoints.length >= 3) {
      const first = polygonPreview.livePoints[0]!
      outline.push([first.x, first.y, polygonPreview.baseZ + 0.01])
    }
    return outline
  }, [polygonPreview])

  // 3D cylinder geometry for circle preview (Z-UP: rotate from Y-up to Z-up)
  const cylinderGeo = useMemo(() => {
    if (!circlePreview) return null
    const { radius, innerRadius, height, isRing } = circlePreview
    if (isRing) {
      // Ring: LatheGeometry centered on y=0, then rotated -π/2 on X → Z-UP
      const shape = new THREE.Shape()
      shape.absarc(0, 0, radius, 0, Math.PI * 2, false)
      const hole = new THREE.Path()
      hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true)
      shape.holes.push(hole)
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: false,
        curveSegments: CIRCLE_SEGMENTS,
        steps: 1,
      })
      geometry.translate(0, 0, -height / 2)
      return geometry
    }
    // Solid cylinder: CylinderGeometry is Y-up, we rotate the mesh
    return new THREE.CylinderGeometry(radius, radius, height, CIRCLE_SEGMENTS)
  }, [circlePreview])

  if (!isShapeTool) return null

  return (
    <group>
      {/* ── Rectangle preview ── */}
      {rectPreview && (
        <>
          <mesh position={rectPreview.position} quaternion={rectPreview.quaternion}>
            <boxGeometry args={[rectPreview.dimensions.x, rectPreview.dimensions.y, rectPreview.dimensions.z]} />
            <meshStandardMaterial color={previewColor} transparent opacity={0.4} depthWrite={false} />
          </mesh>
          <lineSegments position={rectPreview.position} quaternion={rectPreview.quaternion}>
            <edgesGeometry args={[new THREE.BoxGeometry(rectPreview.dimensions.x, rectPreview.dimensions.y, rectPreview.dimensions.z)]} />
            <lineBasicMaterial color={previewColor} linewidth={2} />
          </lineSegments>
          <Line
            points={rectPreview.outlinePoints}
            color="#00ff88"
            lineWidth={2}
          />
        </>
      )}

      {/* Legacy rectangle preview kept for top/world hosted shapes */}
      {false && (
        <></>
      )}

      {/* ── Circle / Ring preview ── */}
      {circlePreview && cylinderGeo && (
        <>
          {circlePreview.isRing ? (
            // LatheGeometry revolves around Y — rotate +π/2 on X so ring stands upright (Z-UP)
            <mesh
              position={[circlePreview.center.x, circlePreview.center.y, circlePreview.baseZ + circlePreview.height / 2]}
            >
              <primitive object={cylinderGeo} attach="geometry" />
              <meshStandardMaterial color={previewColor} transparent opacity={0.4} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
          ) : (
            // CylinderGeometry is Y-up → rotate X +90° to make Z-up
            <mesh
              position={[circlePreview.center.x, circlePreview.center.y, circlePreview.baseZ + circlePreview.height / 2]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <primitive object={cylinderGeo} attach="geometry" />
              <meshStandardMaterial color={previewColor} transparent opacity={0.4} depthWrite={false} />
            </mesh>
          )}

          {/* Base outline */}
          {circleOutlinePoints && <Line points={circleOutlinePoints} color="#00ff88" lineWidth={2} />}
          {innerOutlinePoints && <Line points={innerOutlinePoints} color="#00ff88" lineWidth={2} />}
        </>
      )}

      {polygonPreview && (
        <>
          {polygonMeshGeometry && (
            <mesh position={[0, 0, polygonPreview.baseZ]}>
              <primitive object={polygonMeshGeometry} attach="geometry" />
              <meshStandardMaterial color={previewColor} transparent opacity={0.4} depthWrite={false} />
            </mesh>
          )}
          {polygonOutlinePoints && polygonOutlinePoints.length >= 2 && (
            <Line points={polygonOutlinePoints} color="#00ff88" lineWidth={2} />
          )}
        </>
      )}
    </group>
  )
}
