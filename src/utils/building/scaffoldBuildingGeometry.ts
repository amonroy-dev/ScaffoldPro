import * as THREE from 'three'

import type { SceneObject } from '../../contexts/ToolContext'
import type {
  BaseMassEntity,
  BuildingEntity,
  BuildingPoint2,
  HostedFeatureEntity,
  HostedPatternEntity,
  HostedParapetEntity,
  HostedProxyEntity,
  ResolvedHostedPatternInstance,
  HostedRoofEntity,
  ParapetEdgeId,
} from '../../types/buildingEntities'
import {
  CIRCULAR_PARAPET_EDGE_OPTIONS,
  getBaseMassFaceInfo,
  getBaseMassTopZ,
  getResolvedParapetEdgeIdsForHost,
  isBaseMassEntity,
  isFeatureEntity,
  isHostedRectEntity,
  isPatternEntity,
  isParapetEntity,
  isProxyEntity,
  isRoofEntity,
  resolveHostedRectEntityTopFaceInfo,
  resolveHostedRectEntityTransform,
  resolveHostedPatternInstances,
} from '../../types/buildingEntities'

export type ResolvedBuildingSupportSurface =
  | {
      kind: 'rect'
      sourceId: string
      centerX: number
      centerY: number
      rotationZRad: number
      widthFt: number
      depthFt: number
      topZ: number
    }
  | {
      kind: 'circle'
      sourceId: string
      centerX: number
      centerY: number
      radiusFt: number
      topZ: number
    }
  | {
      kind: 'ring'
      sourceId: string
      centerX: number
      centerY: number
      radiusFt: number
      innerRadiusFt: number
      topZ: number
    }
  | {
      kind: 'polygon'
      sourceId: string
      centerX: number
      centerY: number
      rotationZRad: number
      points: BuildingPoint2[]
      topZ: number
    }
  | {
      kind: 'rect-roof'
      sourceId: string
      centerX: number
      centerY: number
      rotationZRad: number
      widthFt: number
      depthFt: number
      baseZ: number
      thicknessFt: number
      riseFt: number
      roofKind: HostedRoofEntity['kind']
      ridgeDirection: HostedRoofEntity['params']['ridgeDirection']
    }
  | {
      kind: 'radial-roof'
      sourceId: string
      centerX: number
      centerY: number
      radiusFt: number
      baseZ: number
      thicknessFt: number
      riseFt: number
      roofKind: Extract<HostedRoofEntity['kind'], 'cone-roof' | 'dome-roof'>
    }

export type ResolvedBuildingBoxObstacle = {
  sourceId: string
  center: { x: number; y: number; z: number }
  dimensions: { x: number; y: number; z: number }
  rotationZRad: number
}

export type ResolvedBuildingCutVolume = ResolvedBuildingBoxObstacle

export type ResolvedAutoScaffoldTarget = {
  id: string
  shape: 'rect' | 'circle' | 'ring' | 'polygon'
  position: { x: number; y: number; z: number }
  dimensions: { x: number; y: number; z: number }
  rotation: { z: number }
  radiusFt?: number
  innerRadiusFt?: number
  points?: BuildingPoint2[]
}

export type ResolvedScaffoldBuildingGeometry = {
  supportSurfaces: ResolvedBuildingSupportSurface[]
  boxObstacles: ResolvedBuildingBoxObstacle[]
  cutVolumes: ResolvedBuildingCutVolume[]
  autoScaffoldTargets: ResolvedAutoScaffoldTarget[]
}

function pointInPolygon(points: BuildingPoint2[], point: BuildingPoint2): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!
    const b = points[j]!
    const intersects = ((a.y > point.y) !== (b.y > point.y))
      && (point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x)
    if (intersects) inside = !inside
  }
  return inside
}

function buildRotationVectors(rotationZRad: number) {
  const cos = Math.cos(rotationZRad)
  const sin = Math.sin(rotationZRad)
  return {
    right: { x: cos, y: sin },
    forward: { x: sin, y: -cos },
  }
}

function worldToLocalRect(point: { x: number; y: number }, centerX: number, centerY: number, rotationZRad: number) {
  const dx = point.x - centerX
  const dy = point.y - centerY
  const angle = -rotationZRad
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  }
}

function addBoxObstacle(
  out: ResolvedBuildingBoxObstacle[],
  sourceId: string,
  center: { x: number; y: number; z: number },
  dimensions: { x: number; y: number; z: number },
  rotationZRad: number,
) {
  if (!(dimensions.x > 1e-6 && dimensions.y > 1e-6 && dimensions.z > 1e-6)) return
  out.push({
    sourceId,
    center,
    dimensions,
    rotationZRad,
  })
}

function getRoofBaseOffsetByHostId(buildingEntities: BuildingEntity[]) {
  const map = new Map<string, number>()
  for (const entity of buildingEntities) {
    if (!isRoofEntity(entity)) continue
    const current = map.get(entity.host.entityId) ?? 0
    map.set(entity.host.entityId, Math.max(current, Number(entity.params.thicknessFt ?? 0)))
  }
  return map
}

function getParapetOffsetDistance(mode: HostedParapetEntity['params']['offsetMode'], thickness: number): number {
  switch (mode) {
    case 'inside':
      return -thickness / 2
    case 'outside':
      return thickness / 2
    case 'centered':
    default:
      return 0
  }
}

function buildHostedRectObstacleFromTransform(
  sourceId: string,
  transform: NonNullable<ReturnType<typeof resolveHostedRectEntityTransform>>,
  dimensions: { x: number; y: number; z: number },
): ResolvedBuildingBoxObstacle {
  const quaternion = new THREE.Quaternion(
    transform.quaternion.x,
    transform.quaternion.y,
    transform.quaternion.z,
    transform.quaternion.w,
  )
  const xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion).normalize()
  return {
    sourceId,
    center: transform.position,
    dimensions,
    rotationZRad: Math.atan2(xAxis.y, xAxis.x),
  }
}

function buildFeatureBoxObstacle(
  feature: HostedFeatureEntity,
  lookup: Map<string, BuildingEntity>,
  roofBaseOffsetByHostId: Map<string, number>,
): ResolvedBuildingBoxObstacle | null {
  const transform = resolveHostedRectEntityTransform(feature, lookup, roofBaseOffsetByHostId)
  if (!transform) return null
  return buildHostedRectObstacleFromTransform(feature.id, transform, {
    x: Math.max(0.1, Number(feature.params.widthFt ?? 0) || 0.1),
    y: Math.max(0.1, Number(feature.params.depthFt ?? 0) || 0.1),
    z: Math.max(0.1, Number(feature.params.heightFt ?? 0) || 0.1),
  })
}

function buildProxyBoxVolume(
  proxy: HostedProxyEntity,
  lookup: Map<string, BuildingEntity>,
  roofBaseOffsetByHostId: Map<string, number>,
): ResolvedBuildingBoxObstacle | null {
  const transform = resolveHostedRectEntityTransform(proxy, lookup, roofBaseOffsetByHostId)
  if (!transform) return null
  return buildHostedRectObstacleFromTransform(proxy.id, transform, {
    x: Math.max(0.1, Number(proxy.params.widthFt ?? 0) || 0.1),
    y: Math.max(0.1, Number(proxy.params.depthFt ?? 0) || 0.1),
    z: Math.max(0.1, Number(proxy.params.heightFt ?? 0) || 0.1),
  })
}

function buildHostedPatternInstanceBoxVolume(
  instance: ResolvedHostedPatternInstance,
  host: BaseMassEntity,
  roofBaseOffsetFt: number,
): ResolvedBuildingBoxObstacle | null {
  const heightFt = Math.max(0.1, Number(instance.heightFt ?? 0))
  const depthFt = Math.max(0.1, Number(instance.depthFt ?? 0))
  const topHost = instance.faceId === 'top'
  return buildHostedBoxVolume({
    host,
    faceId: instance.faceId,
    widthFt: instance.widthFt,
    depthFt: instance.depthFt,
    heightFt: instance.heightFt,
    offsetUFt: instance.offsetUFt,
    offsetVFt: instance.offsetVFt,
    normalOffsetFt: topHost
      ? (instance.contentType === 'cut-volume' ? roofBaseOffsetFt - heightFt / 2 : roofBaseOffsetFt + heightFt / 2)
      : (instance.contentType === 'cut-volume' ? -depthFt / 2 : depthFt / 2),
    sourceId: instance.instanceId,
  })
}

function buildHostedBoxVolume(params: {
  host: BaseMassEntity
  faceId?: string
  widthFt: number
  depthFt: number
  heightFt: number
  offsetUFt: number
  offsetVFt: number
  normalOffsetFt: number
  sourceId: string
}): ResolvedBuildingBoxObstacle | null {
  const {
    host,
    faceId: requestedFaceId,
    widthFt,
    depthFt,
    heightFt,
    offsetUFt,
    offsetVFt,
    normalOffsetFt,
    sourceId,
  } = params
  if (!requestedFaceId) return null
  const face = getBaseMassFaceInfo(host, requestedFaceId as any)
  if (!face) return null
  const safeWidthFt = Math.max(0.1, Number(widthFt ?? 0))
  const safeDepthFt = Math.max(0.1, Number(depthFt ?? 0))
  const safeHeightFt = Math.max(0.1, Number(heightFt ?? 0))
  const safeOffsetUFt = Number(offsetUFt ?? 0)
  const safeOffsetVFt = Number(offsetVFt ?? 0)
  const axisU = new THREE.Vector3(face.axisU.x, face.axisU.y, face.axisU.z).normalize()
  const axisV = new THREE.Vector3(face.axisV.x, face.axisV.y, face.axisV.z).normalize()
  const normal = new THREE.Vector3(face.normal.x, face.normal.y, face.normal.z).normalize()
  const position = new THREE.Vector3(face.center.x, face.center.y, face.center.z)
    .addScaledVector(axisU, safeOffsetUFt)
    .addScaledVector(axisV, safeOffsetVFt)
    .addScaledVector(normal, normalOffsetFt)

  return {
    sourceId,
    center: { x: position.x, y: position.y, z: position.z },
    dimensions: { x: safeWidthFt, y: safeDepthFt, z: safeHeightFt },
    rotationZRad: Math.atan2(axisU.y, axisU.x),
  }
}

function pushBaseMassGeometry(
  entity: BaseMassEntity,
  supportSurfaces: ResolvedBuildingSupportSurface[],
  boxObstacles: ResolvedBuildingBoxObstacle[],
  autoScaffoldTargets: ResolvedAutoScaffoldTarget[],
) {
  const topZ = getBaseMassTopZ(entity)
  switch (entity.params.shape) {
    case 'rect':
      supportSurfaces.push({
        kind: 'rect',
        sourceId: entity.id,
        centerX: entity.position.x,
        centerY: entity.position.y,
        rotationZRad: entity.rotationZRad ?? 0,
        widthFt: entity.params.widthFt,
        depthFt: entity.params.depthFt,
        topZ,
      })
      if (entity.analysis.blocksScaffold) {
        addBoxObstacle(
          boxObstacles,
          entity.id,
          { x: entity.position.x, y: entity.position.y, z: entity.position.z },
          { x: entity.params.widthFt, y: entity.params.depthFt, z: entity.params.heightFt },
          entity.rotationZRad ?? 0,
        )
      }
      autoScaffoldTargets.push({
        id: entity.id,
        shape: 'rect',
        position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
        dimensions: { x: entity.params.widthFt, y: entity.params.depthFt, z: entity.params.heightFt },
        rotation: { z: entity.rotationZRad ?? 0 },
      })
      break
    case 'circle':
      supportSurfaces.push({
        kind: 'circle',
        sourceId: entity.id,
        centerX: entity.position.x,
        centerY: entity.position.y,
        radiusFt: entity.params.radiusFt,
        topZ,
      })
      if (entity.analysis.blocksScaffold) {
        addBoxObstacle(
          boxObstacles,
          entity.id,
          { x: entity.position.x, y: entity.position.y, z: entity.position.z },
          { x: entity.params.radiusFt * 2, y: entity.params.radiusFt * 2, z: entity.params.heightFt },
          0,
        )
      }
      autoScaffoldTargets.push({
        id: entity.id,
        shape: 'circle',
        position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
        dimensions: { x: entity.params.radiusFt * 2, y: entity.params.radiusFt * 2, z: entity.params.heightFt },
        rotation: { z: 0 },
        radiusFt: entity.params.radiusFt,
      })
      break
    case 'ring':
      supportSurfaces.push({
        kind: 'ring',
        sourceId: entity.id,
        centerX: entity.position.x,
        centerY: entity.position.y,
        radiusFt: entity.params.radiusFt,
        innerRadiusFt: entity.params.innerRadiusFt,
        topZ,
      })
      if (entity.analysis.blocksScaffold) {
        addBoxObstacle(
          boxObstacles,
          entity.id,
          { x: entity.position.x, y: entity.position.y, z: entity.position.z },
          { x: entity.params.radiusFt * 2, y: entity.params.radiusFt * 2, z: entity.params.heightFt },
          0,
        )
      }
      autoScaffoldTargets.push({
        id: entity.id,
        shape: 'ring',
        position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
        dimensions: { x: entity.params.radiusFt * 2, y: entity.params.radiusFt * 2, z: entity.params.heightFt },
        rotation: { z: 0 },
        radiusFt: entity.params.radiusFt,
        innerRadiusFt: entity.params.innerRadiusFt,
      })
      break
    case 'polygon': {
      supportSurfaces.push({
        kind: 'polygon',
        sourceId: entity.id,
        centerX: entity.position.x,
        centerY: entity.position.y,
        rotationZRad: entity.rotationZRad ?? 0,
        points: entity.params.points.map(point => ({ x: point.x, y: point.y })),
        topZ,
      })
      const xs = entity.params.points.map(point => point.x)
      const ys = entity.params.points.map(point => point.y)
      const minX = xs.length > 0 ? Math.min(...xs) : 0
      const maxX = xs.length > 0 ? Math.max(...xs) : 0
      const minY = ys.length > 0 ? Math.min(...ys) : 0
      const maxY = ys.length > 0 ? Math.max(...ys) : 0
      if (entity.analysis.blocksScaffold) {
        addBoxObstacle(
          boxObstacles,
          entity.id,
          { x: entity.position.x, y: entity.position.y, z: entity.position.z },
          { x: Math.max(0.1, maxX - minX), y: Math.max(0.1, maxY - minY), z: entity.params.heightFt },
          entity.rotationZRad ?? 0,
        )
      }
      autoScaffoldTargets.push({
        id: entity.id,
        shape: 'polygon',
        position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
        dimensions: {
          x: Math.max(0.1, maxX - minX),
          y: Math.max(0.1, maxY - minY),
          z: entity.params.heightFt,
        },
        rotation: { z: entity.rotationZRad ?? 0 },
        points: entity.params.points.map(point => ({ x: point.x, y: point.y })),
      })
      break
    }
  }
}

function pushRoofGeometry(
  roof: HostedRoofEntity,
  host: BaseMassEntity | HostedFeatureEntity | HostedProxyEntity,
  lookup: Map<string, BuildingEntity>,
  roofBaseOffsetByHostId: Map<string, number>,
  supportSurfaces: ResolvedBuildingSupportSurface[],
  boxObstacles: ResolvedBuildingBoxObstacle[],
) {
  const thicknessFt = Math.max(0.1, Number(roof.params.thicknessFt ?? 1))
  const overhangFt = Math.max(0, Number(roof.params.overhangFt ?? 0))
  const riseFt = Math.max(0, Number(roof.params.riseFt ?? 0))
  const topHeightFt = roof.kind === 'flat-roof' ? thicknessFt : thicknessFt + riseFt

  if (isHostedRectEntity(host)) {
    const ancestorRoofOffsets = new Map(roofBaseOffsetByHostId)
    ancestorRoofOffsets.delete(host.id)
    const faceInfo = resolveHostedRectEntityTopFaceInfo(host, lookup, ancestorRoofOffsets)
    if (!faceInfo) return
    const widthFt = faceInfo.spanU + overhangFt * 2
    const depthFt = faceInfo.spanV + overhangFt * 2
    const baseZ = faceInfo.center.z
    const rotationZRad = Math.atan2(faceInfo.axisU.y, faceInfo.axisU.x)
    if (roof.kind === 'flat-roof') {
      supportSurfaces.push({
        kind: 'rect',
        sourceId: roof.id,
        centerX: faceInfo.center.x,
        centerY: faceInfo.center.y,
        rotationZRad,
        widthFt,
        depthFt,
        topZ: baseZ + thicknessFt,
      })
    } else {
      supportSurfaces.push({
        kind: 'rect-roof',
        sourceId: roof.id,
        centerX: faceInfo.center.x,
        centerY: faceInfo.center.y,
        rotationZRad,
        widthFt,
        depthFt,
        baseZ,
        thicknessFt,
        riseFt,
        roofKind: roof.kind,
        ridgeDirection: roof.params.ridgeDirection,
      })
    }
    if (roof.analysis.blocksScaffold) {
      addBoxObstacle(
        boxObstacles,
        roof.id,
        { x: faceInfo.center.x, y: faceInfo.center.y, z: baseZ + topHeightFt / 2 },
        { x: widthFt, y: depthFt, z: topHeightFt },
        rotationZRad,
      )
    }
    return
  }

  const baseZ = getBaseMassTopZ(host)

  if (host.params.shape === 'rect') {
    const widthFt = host.params.widthFt + overhangFt * 2
    const depthFt = host.params.depthFt + overhangFt * 2
    if (roof.kind === 'flat-roof') {
      supportSurfaces.push({
        kind: 'rect',
        sourceId: roof.id,
        centerX: host.position.x,
        centerY: host.position.y,
        rotationZRad: host.rotationZRad ?? 0,
        widthFt,
        depthFt,
        topZ: baseZ + thicknessFt,
      })
    } else {
      supportSurfaces.push({
        kind: 'rect-roof',
        sourceId: roof.id,
        centerX: host.position.x,
        centerY: host.position.y,
        rotationZRad: host.rotationZRad ?? 0,
        widthFt,
        depthFt,
        baseZ,
        thicknessFt,
        riseFt,
        roofKind: roof.kind,
        ridgeDirection: roof.params.ridgeDirection,
      })
    }
    if (roof.analysis.blocksScaffold) {
      addBoxObstacle(
        boxObstacles,
        roof.id,
        { x: host.position.x, y: host.position.y, z: baseZ + topHeightFt / 2 },
        { x: widthFt, y: depthFt, z: topHeightFt },
        host.rotationZRad ?? 0,
      )
    }
    return
  }

  if (host.params.shape === 'circle') {
    const radiusFt = host.params.radiusFt + overhangFt
    if (roof.kind === 'cone-roof' || roof.kind === 'dome-roof') {
      supportSurfaces.push({
        kind: 'radial-roof',
        sourceId: roof.id,
        centerX: host.position.x,
        centerY: host.position.y,
        radiusFt,
        baseZ,
        thicknessFt,
        riseFt,
        roofKind: roof.kind,
      })
    } else {
      supportSurfaces.push({
        kind: 'circle',
        sourceId: roof.id,
        centerX: host.position.x,
        centerY: host.position.y,
        radiusFt,
        topZ: baseZ + thicknessFt,
      })
    }
    if (roof.analysis.blocksScaffold) {
      addBoxObstacle(
        boxObstacles,
        roof.id,
        { x: host.position.x, y: host.position.y, z: baseZ + topHeightFt / 2 },
        { x: radiusFt * 2, y: radiusFt * 2, z: topHeightFt },
        0,
      )
    }
    return
  }

  if (host.params.shape === 'ring') {
    const radiusFt = host.params.radiusFt + overhangFt
    if (roof.kind === 'cone-roof' || roof.kind === 'dome-roof') {
      supportSurfaces.push({
        kind: 'radial-roof',
        sourceId: roof.id,
        centerX: host.position.x,
        centerY: host.position.y,
        radiusFt,
        baseZ,
        thicknessFt,
        riseFt,
        roofKind: roof.kind,
      })
    } else {
      supportSurfaces.push({
        kind: 'circle',
        sourceId: roof.id,
        centerX: host.position.x,
        centerY: host.position.y,
        radiusFt,
        topZ: baseZ + thicknessFt,
      })
    }
    if (roof.analysis.blocksScaffold) {
      addBoxObstacle(
        boxObstacles,
        roof.id,
        { x: host.position.x, y: host.position.y, z: baseZ + topHeightFt / 2 },
        { x: radiusFt * 2, y: radiusFt * 2, z: topHeightFt },
        0,
      )
    }
    return
  }

  if (host.params.shape === 'polygon') {
    supportSurfaces.push({
      kind: 'polygon',
      sourceId: roof.id,
      centerX: host.position.x,
      centerY: host.position.y,
      rotationZRad: host.rotationZRad ?? 0,
      points: host.params.points.map(point => ({ x: point.x, y: point.y })),
      topZ: baseZ + thicknessFt,
    })
    const xs = host.params.points.map(point => point.x)
    const ys = host.params.points.map(point => point.y)
    const minX = xs.length > 0 ? Math.min(...xs) : 0
    const maxX = xs.length > 0 ? Math.max(...xs) : 0
    const minY = ys.length > 0 ? Math.min(...ys) : 0
    const maxY = ys.length > 0 ? Math.max(...ys) : 0
    if (roof.analysis.blocksScaffold) {
      addBoxObstacle(
        boxObstacles,
        roof.id,
        { x: host.position.x, y: host.position.y, z: baseZ + thicknessFt / 2 },
        { x: Math.max(0.1, maxX - minX), y: Math.max(0.1, maxY - minY), z: thicknessFt },
        host.rotationZRad ?? 0,
      )
    }
  }
}

function pushParapetGeometry(
  parapet: HostedParapetEntity,
  host: BaseMassEntity,
  roofBaseOffsetFt: number,
  boxObstacles: ResolvedBuildingBoxObstacle[],
) {
  const heightFt = Math.max(0.1, Number(parapet.params.heightFt ?? 0))
  const thicknessFt = Math.max(0.1, Number(parapet.params.thicknessFt ?? 0))
  const z = getBaseMassTopZ(host) + roofBaseOffsetFt + heightFt / 2
  const selectedEdges = getResolvedParapetEdgeIdsForHost(host, parapet.params.edgeIds)

  if (host.params.shape === 'rect') {
    const offsetDistance = getParapetOffsetDistance(parapet.params.offsetMode, thicknessFt)
    if (selectedEdges.includes('front')) {
      addBoxObstacle(
        boxObstacles,
        `${parapet.id}:front`,
        { x: host.position.x + Math.sin(host.rotationZRad ?? 0) * 0, y: host.position.y + Math.cos(host.rotationZRad ?? 0) * 0, z },
        { x: host.params.widthFt, y: thicknessFt, z: heightFt },
        host.rotationZRad ?? 0,
      )
      const { forward } = buildRotationVectors(host.rotationZRad ?? 0)
      boxObstacles[boxObstacles.length - 1]!.center.x = host.position.x + forward.x * (host.params.depthFt / 2 + offsetDistance)
      boxObstacles[boxObstacles.length - 1]!.center.y = host.position.y + forward.y * (host.params.depthFt / 2 + offsetDistance)
    }
    if (selectedEdges.includes('back')) {
      addBoxObstacle(
        boxObstacles,
        `${parapet.id}:back`,
        { x: host.position.x, y: host.position.y, z },
        { x: host.params.widthFt, y: thicknessFt, z: heightFt },
        host.rotationZRad ?? 0,
      )
      const { forward } = buildRotationVectors(host.rotationZRad ?? 0)
      boxObstacles[boxObstacles.length - 1]!.center.x = host.position.x - forward.x * (host.params.depthFt / 2 + offsetDistance)
      boxObstacles[boxObstacles.length - 1]!.center.y = host.position.y - forward.y * (host.params.depthFt / 2 + offsetDistance)
    }
    if (selectedEdges.includes('right')) {
      addBoxObstacle(
        boxObstacles,
        `${parapet.id}:right`,
        { x: host.position.x, y: host.position.y, z },
        { x: host.params.depthFt, y: thicknessFt, z: heightFt },
        (host.rotationZRad ?? 0) + Math.PI / 2,
      )
      const { right } = buildRotationVectors(host.rotationZRad ?? 0)
      boxObstacles[boxObstacles.length - 1]!.center.x = host.position.x + right.x * (host.params.widthFt / 2 + offsetDistance)
      boxObstacles[boxObstacles.length - 1]!.center.y = host.position.y + right.y * (host.params.widthFt / 2 + offsetDistance)
    }
    if (selectedEdges.includes('left')) {
      addBoxObstacle(
        boxObstacles,
        `${parapet.id}:left`,
        { x: host.position.x, y: host.position.y, z },
        { x: host.params.depthFt, y: thicknessFt, z: heightFt },
        (host.rotationZRad ?? 0) + Math.PI / 2,
      )
      const { right } = buildRotationVectors(host.rotationZRad ?? 0)
      boxObstacles[boxObstacles.length - 1]!.center.x = host.position.x - right.x * (host.params.widthFt / 2 + offsetDistance)
      boxObstacles[boxObstacles.length - 1]!.center.y = host.position.y - right.y * (host.params.widthFt / 2 + offsetDistance)
    }
    return
  }

  if (host.params.shape === 'polygon' && host.params.points.length >= 2) {
    const points = host.params.points
    let signedArea = 0
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!
      const b = points[(i + 1) % points.length]!
      signedArea += a.x * b.y - b.x * a.y
    }
    const sign = signedArea >= 0 ? 1 : -1
    for (let index = 0; index < points.length; index++) {
      const start = points[index]!
      const end = points[(index + 1) % points.length]!
      const edgeId = `poly-${index}` as ParapetEdgeId
      if (!selectedEdges.includes(edgeId)) continue
      const dx = end.x - start.x
      const dy = end.y - start.y
      const length = Math.sqrt(dx * dx + dy * dy)
      if (length <= 0.001) continue
      const outwardX = (dy / length) * sign
      const outwardY = (-dx / length) * sign
      const offsetDistance = getParapetOffsetDistance(parapet.params.offsetMode, thicknessFt)
      const localCenterX = (start.x + end.x) / 2 + outwardX * offsetDistance
      const localCenterY = (start.y + end.y) / 2 + outwardY * offsetDistance
      const angle = host.rotationZRad ?? 0
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const worldX = host.position.x + localCenterX * cos - localCenterY * sin
      const worldY = host.position.y + localCenterX * sin + localCenterY * cos
      addBoxObstacle(
        boxObstacles,
        `${parapet.id}:${edgeId}`,
        { x: worldX, y: worldY, z },
        { x: length, y: thicknessFt, z: heightFt },
        angle + Math.atan2(dy, dx),
      )
    }
    return
  }

  if (host.params.shape === 'circle' || host.params.shape === 'ring') {
    const centerRadiusFt = Math.max(0.1, host.params.radiusFt + getParapetOffsetDistance(parapet.params.offsetMode, thicknessFt))
    const baseRotation = host.rotationZRad ?? 0
    for (const option of CIRCULAR_PARAPET_EDGE_OPTIONS) {
      if (!selectedEdges.includes(option.value)) continue
      const midAngleRad = (option.startAngleRad + option.endAngleRad) / 2
      const spanAngleRad = option.endAngleRad - option.startAngleRad
      const worldMidAngleRad = baseRotation + midAngleRad
      const chordLengthFt = Math.max(
        thicknessFt,
        2 * centerRadiusFt * Math.sin(Math.abs(spanAngleRad) / 2),
      )
      addBoxObstacle(
        boxObstacles,
        `${parapet.id}:${option.value}`,
        {
          x: host.position.x + Math.cos(worldMidAngleRad) * centerRadiusFt,
          y: host.position.y + Math.sin(worldMidAngleRad) * centerRadiusFt,
          z,
        },
        { x: chordLengthFt, y: thicknessFt, z: heightFt },
        worldMidAngleRad + Math.PI / 2,
      )
    }
  }
}

function pushLegacySceneObjectGeometry(
  object: SceneObject,
  supportSurfaces: ResolvedBuildingSupportSurface[],
  boxObstacles: ResolvedBuildingBoxObstacle[],
  autoScaffoldTargets: ResolvedAutoScaffoldTarget[],
) {
  if (object.workspace !== 'building') return
  if (object.type === 'box') {
    supportSurfaces.push({
      kind: 'rect',
      sourceId: object.id,
      centerX: object.position.x,
      centerY: object.position.y,
      rotationZRad: object.rotation.z ?? 0,
      widthFt: object.dimensions.x,
      depthFt: object.dimensions.y,
      topZ: object.position.z + object.dimensions.z / 2,
    })
    addBoxObstacle(
      boxObstacles,
      object.id,
      { x: object.position.x, y: object.position.y, z: object.position.z },
      { x: object.dimensions.x, y: object.dimensions.y, z: object.dimensions.z },
      object.rotation.z ?? 0,
    )
    autoScaffoldTargets.push({
      id: object.id,
      shape: 'rect',
      position: { x: object.position.x, y: object.position.y, z: object.position.z },
      dimensions: { x: object.dimensions.x, y: object.dimensions.y, z: object.dimensions.z },
      rotation: { z: object.rotation.z ?? 0 },
    })
    return
  }

  if (object.type === 'circle') {
    const radiusFt = Number(object.radius ?? object.dimensions.x / 2)
    supportSurfaces.push({
      kind: 'circle',
      sourceId: object.id,
      centerX: object.position.x,
      centerY: object.position.y,
      radiusFt,
      topZ: object.position.z + object.dimensions.z / 2,
    })
    addBoxObstacle(
      boxObstacles,
      object.id,
      { x: object.position.x, y: object.position.y, z: object.position.z },
      { x: radiusFt * 2, y: radiusFt * 2, z: object.dimensions.z },
      0,
    )
    autoScaffoldTargets.push({
      id: object.id,
      shape: 'circle',
      position: { x: object.position.x, y: object.position.y, z: object.position.z },
      dimensions: { x: radiusFt * 2, y: radiusFt * 2, z: object.dimensions.z },
      rotation: { z: 0 },
      radiusFt,
    })
    return
  }

  if (object.type === 'ring') {
    const radiusFt = Number(object.radius ?? object.dimensions.x / 2)
    const innerRadiusFt = Number(object.innerRadius ?? radiusFt * 0.6)
    supportSurfaces.push({
      kind: 'ring',
      sourceId: object.id,
      centerX: object.position.x,
      centerY: object.position.y,
      radiusFt,
      innerRadiusFt,
      topZ: object.position.z + object.dimensions.z / 2,
    })
    addBoxObstacle(
      boxObstacles,
      object.id,
      { x: object.position.x, y: object.position.y, z: object.position.z },
      { x: radiusFt * 2, y: radiusFt * 2, z: object.dimensions.z },
      0,
    )
    autoScaffoldTargets.push({
      id: object.id,
      shape: 'ring',
      position: { x: object.position.x, y: object.position.y, z: object.position.z },
      dimensions: { x: radiusFt * 2, y: radiusFt * 2, z: object.dimensions.z },
      rotation: { z: 0 },
      radiusFt,
      innerRadiusFt,
    })
  }
}

export function resolveScaffoldBuildingGeometry(params: {
  buildingEntities: BuildingEntity[]
  objects: SceneObject[]
}): ResolvedScaffoldBuildingGeometry {
  const { buildingEntities, objects } = params
  const supportSurfaces: ResolvedBuildingSupportSurface[] = []
  const boxObstacles: ResolvedBuildingBoxObstacle[] = []
  const cutVolumes: ResolvedBuildingCutVolume[] = []
  const autoScaffoldTargets: ResolvedAutoScaffoldTarget[] = []
  const entityIds = new Set(buildingEntities.map(entity => entity.id))
  const baseMassById = new Map(
    buildingEntities
      .filter((entity): entity is BaseMassEntity => isBaseMassEntity(entity))
      .map(entity => [entity.id, entity] as const),
  )
  const buildingEntityById = new Map(buildingEntities.map((entity) => [entity.id, entity] as const))
  const roofBaseOffsetByHostId = getRoofBaseOffsetByHostId(buildingEntities)

  for (const entity of buildingEntities) {
    if (isBaseMassEntity(entity)) {
      pushBaseMassGeometry(entity, supportSurfaces, boxObstacles, autoScaffoldTargets)
      continue
    }

    if (isRoofEntity(entity)) {
      const host = buildingEntityById.get(entity.host.entityId)
      if (!host || (!isBaseMassEntity(host) && !isHostedRectEntity(host))) continue
      pushRoofGeometry(entity, host, buildingEntityById, roofBaseOffsetByHostId, supportSurfaces, boxObstacles)
      continue
    }

    if (isParapetEntity(entity)) {
      const host = baseMassById.get(entity.host.entityId)
      if (!host) continue
      if (!entity.analysis.blocksScaffold) continue
      pushParapetGeometry(entity, host, roofBaseOffsetByHostId.get(host.id) ?? 0, boxObstacles)
      continue
    }

    if (isFeatureEntity(entity)) {
      const host = buildingEntityById.get(entity.host.entityId)
      if (!host || (!isBaseMassEntity(host) && !isHostedRectEntity(host))) continue
      const box = buildFeatureBoxObstacle(entity, buildingEntityById, roofBaseOffsetByHostId)
      if (!box) continue
      if (entity.analysis.blocksScaffold) boxObstacles.push(box)
      if (entity.analysis.supportsScaffold) {
        supportSurfaces.push({
          kind: 'rect',
          sourceId: entity.id,
          centerX: box.center.x,
          centerY: box.center.y,
          rotationZRad: box.rotationZRad,
          widthFt: box.dimensions.x,
          depthFt: box.dimensions.y,
          topZ: box.center.z + box.dimensions.z / 2,
        })
      }
      continue
    }

    if (isProxyEntity(entity)) {
      const host = buildingEntityById.get(entity.host.entityId)
      if (!host || (!isBaseMassEntity(host) && !isHostedRectEntity(host))) continue
      const box = buildProxyBoxVolume(entity, buildingEntityById, roofBaseOffsetByHostId)
      if (!box) continue
      if (entity.params.mode === 'cut') {
        cutVolumes.push(box)
        continue
      }
      if (entity.analysis.blocksScaffold) boxObstacles.push(box)
      if (entity.analysis.supportsScaffold) {
        supportSurfaces.push({
          kind: 'rect',
          sourceId: entity.id,
          centerX: box.center.x,
          centerY: box.center.y,
          rotationZRad: box.rotationZRad,
          widthFt: box.dimensions.x,
          depthFt: box.dimensions.y,
          topZ: box.center.z + box.dimensions.z / 2,
        })
      }
      continue
    }

    if (isPatternEntity(entity)) {
      const host = baseMassById.get(entity.host.entityId)
      if (!host) continue
      const roofBaseOffsetFt = entity.host.faceId === 'top' ? (roofBaseOffsetByHostId.get(host.id) ?? 0) : 0
      const instances = resolveHostedPatternInstances(entity, host)
      for (const instance of instances) {
        if (instance.hidden) continue
        const box = buildHostedPatternInstanceBoxVolume(instance, host, roofBaseOffsetFt)
        if (!box) continue
        if (instance.contentType === 'cut-volume') {
          cutVolumes.push(box)
          continue
        }
        if (instance.analysis.blocksScaffold) boxObstacles.push(box)
        if (instance.analysis.supportsScaffold) {
          supportSurfaces.push({
            kind: 'rect',
            sourceId: instance.instanceId,
            centerX: box.center.x,
            centerY: box.center.y,
            rotationZRad: box.rotationZRad,
            widthFt: box.dimensions.x,
            depthFt: box.dimensions.y,
            topZ: box.center.z + box.dimensions.z / 2,
          })
        }
      }
    }
  }

  for (const object of objects) {
    if (entityIds.has(object.id)) continue
    pushLegacySceneObjectGeometry(object, supportSurfaces, boxObstacles, autoScaffoldTargets)
  }

  return {
    supportSurfaces,
    boxObstacles,
    cutVolumes,
    autoScaffoldTargets,
  }
}

function getRectRoofTopZAtPoint(surface: Extract<ResolvedBuildingSupportSurface, { kind: 'rect-roof' }>, x: number, y: number) {
  const local = worldToLocalRect({ x, y }, surface.centerX, surface.centerY, surface.rotationZRad)
  const halfW = surface.widthFt / 2
  const halfD = surface.depthFt / 2
  if (Math.abs(local.x) > halfW + 1e-6 || Math.abs(local.y) > halfD + 1e-6) return null

  const normalizedX = halfW <= 1e-6 ? 0 : Math.abs(local.x) / halfW
  const normalizedY = halfD <= 1e-6 ? 0 : Math.abs(local.y) / halfD
  let riseContribution = 0

  if (surface.roofKind === 'shed-roof') {
    riseContribution = surface.ridgeDirection === 'x'
      ? ((local.y + halfD) / Math.max(1e-6, surface.depthFt)) * surface.riseFt
      : ((local.x + halfW) / Math.max(1e-6, surface.widthFt)) * surface.riseFt
  } else if (surface.roofKind === 'gable-roof') {
    riseContribution = surface.ridgeDirection === 'x'
      ? (1 - normalizedY) * surface.riseFt
      : (1 - normalizedX) * surface.riseFt
  } else if (surface.roofKind === 'hip-roof') {
    riseContribution = (1 - Math.max(normalizedX, normalizedY)) * surface.riseFt
  }

  return surface.baseZ + surface.thicknessFt + Math.max(0, riseContribution)
}

function getRadialRoofTopZAtPoint(surface: Extract<ResolvedBuildingSupportSurface, { kind: 'radial-roof' }>, x: number, y: number) {
  const dx = x - surface.centerX
  const dy = y - surface.centerY
  const radius = Math.sqrt(dx * dx + dy * dy)
  if (radius > surface.radiusFt + 1e-6) return null

  const normalizedRadius = surface.radiusFt <= 1e-6 ? 0 : radius / surface.radiusFt
  const riseContribution = surface.roofKind === 'cone-roof'
    ? (1 - normalizedRadius) * surface.riseFt
    : Math.cos(Math.min(1, normalizedRadius) * Math.PI / 2) * surface.riseFt

  return surface.baseZ + surface.thicknessFt + Math.max(0, riseContribution)
}

function pointInsideOrientedBoxXY(box: ResolvedBuildingBoxObstacle, x: number, y: number) {
  const local = worldToLocalRect({ x, y }, box.center.x, box.center.y, box.rotationZRad)
  return Math.abs(local.x) <= box.dimensions.x / 2 + 1e-6
    && Math.abs(local.y) <= box.dimensions.y / 2 + 1e-6
}

function isSupportCutAwayAtPoint(
  cutVolumes: ResolvedBuildingCutVolume[],
  x: number,
  y: number,
  topZ: number,
) {
  return cutVolumes.some((box) => (
    pointInsideOrientedBoxXY(box, x, y)
    && topZ >= box.center.z - box.dimensions.z / 2 - 1e-6
    && topZ <= box.center.z + box.dimensions.z / 2 + 1e-6
  ))
}

export function resolveSupportSurfaceAtPoint(
  surfaces: ResolvedBuildingSupportSurface[],
  x: number,
  y: number,
  cutVolumes: ResolvedBuildingCutVolume[] = [],
): { z: number; baseSupport: 'grid' | 'shape' } {
  let z = 0
  let baseSupport: 'grid' | 'shape' = 'grid'

  for (const surface of surfaces) {
    let topZ: number | null = null
    switch (surface.kind) {
      case 'rect': {
        const local = worldToLocalRect({ x, y }, surface.centerX, surface.centerY, surface.rotationZRad)
        if (Math.abs(local.x) <= surface.widthFt / 2 + 1e-6 && Math.abs(local.y) <= surface.depthFt / 2 + 1e-6) {
          topZ = surface.topZ
        }
        break
      }
      case 'circle': {
        const dx = x - surface.centerX
        const dy = y - surface.centerY
        if (dx * dx + dy * dy <= surface.radiusFt * surface.radiusFt + 1e-6) topZ = surface.topZ
        break
      }
      case 'ring': {
        const dx = x - surface.centerX
        const dy = y - surface.centerY
        const radiusSq = dx * dx + dy * dy
        if (radiusSq <= surface.radiusFt * surface.radiusFt + 1e-6 && radiusSq >= surface.innerRadiusFt * surface.innerRadiusFt - 1e-6) {
          topZ = surface.topZ
        }
        break
      }
      case 'polygon': {
        const local = worldToLocalRect({ x, y }, surface.centerX, surface.centerY, surface.rotationZRad)
        if (pointInPolygon(surface.points, local)) topZ = surface.topZ
        break
      }
      case 'rect-roof':
        topZ = getRectRoofTopZAtPoint(surface, x, y)
        break
      case 'radial-roof':
        topZ = getRadialRoofTopZAtPoint(surface, x, y)
        break
    }

    if (topZ === null) continue
    if (isSupportCutAwayAtPoint(cutVolumes, x, y, topZ)) continue
    if (topZ > z + 1e-6) {
      z = topZ
      baseSupport = 'shape'
    }
  }

  return { z, baseSupport }
}
