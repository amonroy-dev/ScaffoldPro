import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { ThreeEvent, useThree } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { useTool, SceneObject, WORKSPACE_LAYERS } from '../contexts/ToolContext'
import { useSettings } from '../contexts/SettingsContext'
import {
  baseMassLocalXYZToWorld,
  CIRCULAR_PARAPET_EDGE_OPTIONS,
  getBaseMassFaceInfo,
  getBaseMassLocalFootprintBounds,
  getBaseMassTopZ,
  getResolvedParapetEdgeIdsForHost,
  isBaseMassEntity,
  isHostedRectEntity,
  isTopHostedBoxWithinHost,
  isFeatureEntity,
  isPatternEntity,
  isParapetEntity,
  resolveTopHostSetbackDistance,
  isProxyEntity,
  isRoofEntity,
  resolveHostedRectEntityFaceInfo,
  resolveHostedRectEntityTopFaceInfo,
  resolveHostedRectEntityTransform,
  resolveHostedPatternFaceIds,
  resolveHostedPatternInstances,
  resolvePreferredDrawHostFace,
  type BaseMassEntity,
  type BaseMassFaceInfo,
  type BaseMassFaceId,
  type BuildingEntity,
  type BuildingPoint2,
  type HostedFeatureEntity,
  type HostedPatternEntity,
  type HostedParapetEntity,
  type HostedProxyEntity,
  type ResolvedHostedPatternInstance,
  type HostedRoofEntity,
  type ParapetEdgeId,
  type TopHostedSetbackId,
} from '../types/buildingEntities'

// High-end selection highlight (no wireframe boxes)
const SELECTED_OVERLAY_COLOR = '#a855f7'
const SELECTED_OVERLAY_OPACITY = 0.16
const CIRCLE_SEGMENTS = 64
const HOSTED_HANDLE_MOVE_COLOR = '#f8fafc'
const HOSTED_HANDLE_RESIZE_COLOR = '#c084fc'
const HOSTED_HANDLE_MIN_SPAN_FT = 0.5
const HOSTED_HANDLE_LIFT_FT = 0.3
const HOST_OVERLAY_COLOR = '#22c7b8'
const HOST_FACE_TARGET_IDLE_OPACITY = 0.08
const HOST_FACE_TARGET_HOVER_OPACITY = 0.18
const HOST_FACE_TARGET_ACTIVE_OPACITY = 0.28
const TOP_SETBACK_LINE_COLOR = '#f97316'
const TOP_SETBACK_LINE_LIFT_FT = 0.08

interface ShapeObjectProps {
  object: SceneObject
  isSelected: boolean
  onSelect?: () => void
  clippingPlanes?: THREE.Plane[]
}

interface PolygonObjectProps {
  entity: BaseMassEntity
  isSelected: boolean
  onSelect?: () => void
  clippingPlanes?: THREE.Plane[]
}

type TopHostedSetbackGuide = {
  id: TopHostedSetbackId
  distanceFt: number
  linePoints: [number, number, number][]
  labelPosition: [number, number, number]
}

type HostedPatternEnvelope = {
  minU: number
  maxU: number
  minV: number
  maxV: number
  centerU: number
  centerV: number
  spanU: number
  spanV: number
}

type HostedPatternFaceSegment = {
  faceInfo: BaseMassFaceInfo
  start: number
  end: number
  center: number
}

type HostedPatternRowBand = {
  centerV: number
  minV: number
  maxV: number
}

function resolveFaceWorldPoint(
  faceInfo: BaseMassFaceInfo,
  u: number,
  v: number,
  normalLiftFt = 0,
): [number, number, number] {
  return [
    faceInfo.center.x + faceInfo.axisU.x * u + faceInfo.axisV.x * v + faceInfo.normal.x * normalLiftFt,
    faceInfo.center.y + faceInfo.axisU.y * u + faceInfo.axisV.y * v + faceInfo.normal.y * normalLiftFt,
    faceInfo.center.z + faceInfo.axisU.z * u + faceInfo.axisV.z * v + faceInfo.normal.z * normalLiftFt,
  ]
}

function lerp(start: number, end: number, t: number) {
  return start + (end - start) * t
}

function clampValue(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getTopHostedCornerLocal(
  centerU: number,
  centerV: number,
  widthFt: number,
  depthFt: number,
  setbackId: TopHostedSetbackId,
): BuildingPoint2 {
  const halfWidth = widthFt / 2
  const halfDepth = depthFt / 2
  switch (setbackId) {
    case 'left':
    case 'bottom':
      return { x: centerU - halfWidth, y: centerV - halfDepth }
    case 'right':
    case 'top':
    default:
      return { x: centerU + halfWidth, y: centerV + halfDepth }
  }
}

function getTopHostedSetbackLabelOffset(setbackId: TopHostedSetbackId): BuildingPoint2 {
  switch (setbackId) {
    case 'left':
      return { x: 0, y: -0.7 }
    case 'bottom':
      return { x: -0.7, y: 0 }
    case 'right':
      return { x: 0, y: 0.7 }
    case 'top':
    default:
      return { x: 0.7, y: 0 }
  }
}

function resolveTopHostedSetbackGuides(params: {
  host: BaseMassEntity
  widthFt: number
  depthFt: number
  offsetUFt: number
  offsetVFt: number
  localZ: number
}): TopHostedSetbackGuide[] {
  const {
    host,
    widthFt,
    depthFt,
    offsetUFt,
    offsetVFt,
    localZ,
  } = params

  return (['left', 'bottom', 'right', 'top'] as TopHostedSetbackId[])
    .map((setbackId) => {
      const cornerLocal = getTopHostedCornerLocal(offsetUFt, offsetVFt, widthFt, depthFt, setbackId)
      const distanceFt = resolveTopHostSetbackDistance(host, cornerLocal, setbackId)
      if (distanceFt == null) return null

      const edgeLocal = setbackId === 'left'
        ? { x: cornerLocal.x - distanceFt, y: cornerLocal.y }
        : setbackId === 'right'
          ? { x: cornerLocal.x + distanceFt, y: cornerLocal.y }
          : setbackId === 'bottom'
            ? { x: cornerLocal.x, y: cornerLocal.y - distanceFt }
            : { x: cornerLocal.x, y: cornerLocal.y + distanceFt }
      const labelOffset = getTopHostedSetbackLabelOffset(setbackId)
      const labelLocal = {
        x: (cornerLocal.x + edgeLocal.x) / 2 + labelOffset.x,
        y: (cornerLocal.y + edgeLocal.y) / 2 + labelOffset.y,
      }
      const edgePoint = baseMassLocalXYZToWorld(host, { x: edgeLocal.x, y: edgeLocal.y, z: localZ })
      const cornerPoint = baseMassLocalXYZToWorld(host, { x: cornerLocal.x, y: cornerLocal.y, z: localZ })
      const labelPoint = baseMassLocalXYZToWorld(host, { x: labelLocal.x, y: labelLocal.y, z: localZ })
      return {
        id: setbackId,
        distanceFt,
        linePoints: [
          [edgePoint.x, edgePoint.y, edgePoint.z],
          [cornerPoint.x, cornerPoint.y, cornerPoint.z],
        ],
        labelPosition: [labelPoint.x, labelPoint.y, labelPoint.z],
      } satisfies TopHostedSetbackGuide
    })
    .filter(Boolean) as TopHostedSetbackGuide[]
}

function resolveRectFaceHostedSetbackGuides(params: {
  faceInfo: BaseMassFaceInfo
  widthFt: number
  spanVFt: number
  offsetUFt: number
  offsetVFt: number
  normalLiftFt: number
}): TopHostedSetbackGuide[] {
  const {
    faceInfo,
    widthFt,
    spanVFt,
    offsetUFt,
    offsetVFt,
    normalLiftFt,
  } = params

  const halfWidth = Math.max(0.05, widthFt / 2)
  const halfSpanV = Math.max(0.05, spanVFt / 2)
  const hostHalfU = faceInfo.spanU / 2
  const hostHalfV = faceInfo.spanV / 2

  return (['left', 'bottom', 'right', 'top'] as TopHostedSetbackId[])
    .map((setbackId) => {
      const cornerU = setbackId === 'left' || setbackId === 'bottom'
        ? offsetUFt - halfWidth
        : offsetUFt + halfWidth
      const cornerV = setbackId === 'left' || setbackId === 'bottom'
        ? offsetVFt - halfSpanV
        : offsetVFt + halfSpanV
      const distanceFt = setbackId === 'left'
        ? cornerU + hostHalfU
        : setbackId === 'right'
          ? hostHalfU - cornerU
          : setbackId === 'bottom'
            ? cornerV + hostHalfV
            : hostHalfV - cornerV

      if (!Number.isFinite(distanceFt) || distanceFt < -1e-6) return null

      const edgeU = setbackId === 'left'
        ? -hostHalfU
        : setbackId === 'right'
          ? hostHalfU
          : cornerU
      const edgeV = setbackId === 'bottom'
        ? -hostHalfV
        : setbackId === 'top'
          ? hostHalfV
          : cornerV

      const labelOffset = getTopHostedSetbackLabelOffset(setbackId)
      const labelU = (cornerU + edgeU) / 2 + labelOffset.x
      const labelV = (cornerV + edgeV) / 2 + labelOffset.y

      return {
        id: setbackId,
        distanceFt: Math.max(0, distanceFt),
        linePoints: [
          resolveFaceWorldPoint(faceInfo, edgeU, edgeV, normalLiftFt),
          resolveFaceWorldPoint(faceInfo, cornerU, cornerV, normalLiftFt),
        ],
        labelPosition: resolveFaceWorldPoint(faceInfo, labelU, labelV, normalLiftFt),
      } satisfies TopHostedSetbackGuide
    })
    .filter(Boolean) as TopHostedSetbackGuide[]
}

function resolveHostedPatternEnvelope(instances: ResolvedHostedPatternInstance[]): HostedPatternEnvelope | null {
  if (instances.length === 0) return null

  let minU = Number.POSITIVE_INFINITY
  let maxU = Number.NEGATIVE_INFINITY
  let minV = Number.POSITIVE_INFINITY
  let maxV = Number.NEGATIVE_INFINITY

  for (const instance of instances) {
    const spanVFt = instance.faceId === 'top' ? instance.depthFt : instance.heightFt
    const halfWidth = Math.max(0.05, instance.widthFt / 2)
    const halfSpanV = Math.max(0.05, spanVFt / 2)
    minU = Math.min(minU, Number.isFinite(instance.globalMinUFt) ? instance.globalMinUFt : instance.offsetUFt - halfWidth)
    maxU = Math.max(maxU, Number.isFinite(instance.globalMaxUFt) ? instance.globalMaxUFt : instance.offsetUFt + halfWidth)
    minV = Math.min(minV, instance.offsetVFt - halfSpanV)
    maxV = Math.max(maxV, instance.offsetVFt + halfSpanV)
  }

  if (!Number.isFinite(minU) || !Number.isFinite(maxU) || !Number.isFinite(minV) || !Number.isFinite(maxV)) {
    return null
  }

  return {
    minU,
    maxU,
    minV,
    maxV,
    centerU: (minU + maxU) / 2,
    centerV: (minV + maxV) / 2,
    spanU: maxU - minU,
    spanV: maxV - minV,
  }
}

function resolveHostedPatternFaceSegments(
  pattern: HostedPatternEntity,
  host: BaseMassEntity,
): HostedPatternFaceSegment[] {
  const faceIds = resolveHostedPatternFaceIds(pattern, host)
  const faceInfos = faceIds
    .map((faceId) => getBaseMassFaceInfo(host, faceId))
    .filter((faceInfo): faceInfo is BaseMassFaceInfo => Boolean(faceInfo))

  if (faceInfos.length === 0) return []

  let runningStart = -faceInfos.reduce((sum, faceInfo) => sum + faceInfo.spanU, 0) / 2
  return faceInfos.map((faceInfo) => {
    const start = runningStart
    const end = start + faceInfo.spanU
    runningStart = end
    return {
      faceInfo,
      start,
      end,
      center: start + faceInfo.spanU / 2,
    }
  })
}

function resolveHostedPatternGlobalPoint(
  segments: HostedPatternFaceSegment[],
  globalU: number,
  localV: number,
  normalLiftFt: number,
): [number, number, number] | null {
  if (segments.length === 0) return null
  const segment = segments.find((candidate, index) => (
    globalU >= candidate.start - 1e-6
    && (globalU <= candidate.end + 1e-6 || index === segments.length - 1)
  )) ?? segments[segments.length - 1]
  if (!segment) return null
  const localU = clampValue(globalU - segment.center, -segment.faceInfo.spanU / 2, segment.faceInfo.spanU / 2)
  return resolveFaceWorldPoint(segment.faceInfo, localU, localV, normalLiftFt)
}

function resolveHostedPatternGlobalPath(params: {
  segments: HostedPatternFaceSegment[]
  startGlobalU: number
  endGlobalU: number
  localV: number
  normalLiftFt: number
}): [number, number, number][] {
  const {
    segments,
    startGlobalU,
    endGlobalU,
    localV,
    normalLiftFt,
  } = params

  if (segments.length === 0) return []
  const pathStart = Math.min(startGlobalU, endGlobalU)
  const pathEnd = Math.max(startGlobalU, endGlobalU)
  const points: [number, number, number][] = []

  for (const segment of segments) {
    const overlapStart = Math.max(pathStart, segment.start)
    const overlapEnd = Math.min(pathEnd, segment.end)
    if (overlapEnd < overlapStart - 1e-6) continue

    const startPoint = resolveHostedPatternGlobalPoint(segments, overlapStart, localV, normalLiftFt)
    if (startPoint && (points.length === 0 || points[points.length - 1]!.some((value, index) => Math.abs(value - startPoint[index]!) > 1e-6))) {
      points.push(startPoint)
    }
    const endPoint = resolveHostedPatternGlobalPoint(segments, overlapEnd, localV, normalLiftFt)
    if (endPoint && (points.length === 0 || points[points.length - 1]!.some((value, index) => Math.abs(value - endPoint[index]!) > 1e-6))) {
      points.push(endPoint)
    }
  }

  return points
}

function resolveWrappedHostedPatternSetbackGuides(params: {
  pattern: HostedPatternEntity
  host: BaseMassEntity
  envelope: HostedPatternEnvelope
}): TopHostedSetbackGuide[] {
  const {
    pattern,
    host,
    envelope,
  } = params

  const segments = resolveHostedPatternFaceSegments(pattern, host)
  if (segments.length === 0) return []
  const totalSpanU = segments.reduce((sum, segment) => sum + segment.faceInfo.spanU, 0)
  const firstFace = segments[0]!.faceInfo
  const leftLabelOffset = getTopHostedSetbackLabelOffset('left')
  const rightLabelOffset = getTopHostedSetbackLabelOffset('right')
  const bottomLabelOffset = getTopHostedSetbackLabelOffset('bottom')
  const topLabelOffset = getTopHostedSetbackLabelOffset('top')

  const leftPath = resolveHostedPatternGlobalPath({
    segments,
    startGlobalU: -totalSpanU / 2,
    endGlobalU: envelope.minU,
    localV: envelope.minV,
    normalLiftFt: TOP_SETBACK_LINE_LIFT_FT,
  })
  const rightPath = resolveHostedPatternGlobalPath({
    segments,
    startGlobalU: envelope.maxU,
    endGlobalU: totalSpanU / 2,
    localV: envelope.maxV,
    normalLiftFt: TOP_SETBACK_LINE_LIFT_FT,
  })
  const bottomAnchorU = clampValue(envelope.centerU, -totalSpanU / 2, totalSpanU / 2)
  const topAnchorU = clampValue(envelope.centerU, -totalSpanU / 2, totalSpanU / 2)
  const bottomEdgePoint = resolveHostedPatternGlobalPoint(segments, bottomAnchorU, -firstFace.spanV / 2, TOP_SETBACK_LINE_LIFT_FT)
  const bottomCornerPoint = resolveHostedPatternGlobalPoint(segments, bottomAnchorU, envelope.minV, TOP_SETBACK_LINE_LIFT_FT)
  const topEdgePoint = resolveHostedPatternGlobalPoint(segments, topAnchorU, firstFace.spanV / 2, TOP_SETBACK_LINE_LIFT_FT)
  const topCornerPoint = resolveHostedPatternGlobalPoint(segments, topAnchorU, envelope.maxV, TOP_SETBACK_LINE_LIFT_FT)

  const guides: TopHostedSetbackGuide[] = []

  const leftLabelPoint = resolveHostedPatternGlobalPoint(
    segments,
    lerp(-totalSpanU / 2, envelope.minU, 0.5),
    envelope.minV + leftLabelOffset.y,
    TOP_SETBACK_LINE_LIFT_FT,
  )
  if (leftPath.length >= 2 && leftLabelPoint) {
    guides.push({
      id: 'left',
      distanceFt: Math.max(0, envelope.minU + totalSpanU / 2),
      linePoints: leftPath,
      labelPosition: leftLabelPoint,
    })
  }

  const rightLabelPoint = resolveHostedPatternGlobalPoint(
    segments,
    lerp(envelope.maxU, totalSpanU / 2, 0.5),
    envelope.maxV + rightLabelOffset.y,
    TOP_SETBACK_LINE_LIFT_FT,
  )
  if (rightPath.length >= 2 && rightLabelPoint) {
    guides.push({
      id: 'right',
      distanceFt: Math.max(0, totalSpanU / 2 - envelope.maxU),
      linePoints: rightPath,
      labelPosition: rightLabelPoint,
    })
  }

  const bottomLabelPoint = resolveHostedPatternGlobalPoint(
    segments,
    clampValue(bottomAnchorU + bottomLabelOffset.x, -totalSpanU / 2, totalSpanU / 2),
    lerp(-firstFace.spanV / 2, envelope.minV, 0.5),
    TOP_SETBACK_LINE_LIFT_FT,
  )
  if (bottomEdgePoint && bottomCornerPoint && bottomLabelPoint) {
    guides.push({
      id: 'bottom',
      distanceFt: Math.max(0, envelope.minV + firstFace.spanV / 2),
      linePoints: [bottomEdgePoint, bottomCornerPoint],
      labelPosition: bottomLabelPoint,
    })
  }

  const topLabelPoint = resolveHostedPatternGlobalPoint(
    segments,
    clampValue(topAnchorU + topLabelOffset.x, -totalSpanU / 2, totalSpanU / 2),
    lerp(envelope.maxV, firstFace.spanV / 2, 0.5),
    TOP_SETBACK_LINE_LIFT_FT,
  )
  if (topEdgePoint && topCornerPoint && topLabelPoint) {
    guides.push({
      id: 'top',
      distanceFt: Math.max(0, firstFace.spanV / 2 - envelope.maxV),
      linePoints: [topEdgePoint, topCornerPoint],
      labelPosition: topLabelPoint,
    })
  }

  return guides
}

function resolveHostedPatternRowBands(instances: ResolvedHostedPatternInstance[]): HostedPatternRowBand[] {
  const rowMap = new Map<string, HostedPatternRowBand>()
  for (const instance of instances) {
    const spanVFt = instance.faceId === 'top' ? instance.depthFt : instance.heightFt
    const halfSpanV = Math.max(0.05, spanVFt / 2)
    const key = instance.offsetVFt.toFixed(4)
    const current = rowMap.get(key)
    const minV = instance.offsetVFt - halfSpanV
    const maxV = instance.offsetVFt + halfSpanV
    if (current) {
      current.minV = Math.min(current.minV, minV)
      current.maxV = Math.max(current.maxV, maxV)
    } else {
      rowMap.set(key, {
        centerV: instance.offsetVFt,
        minV,
        maxV,
      })
    }
  }
  return Array.from(rowMap.values()).sort((a, b) => a.centerV - b.centerV)
}

function resolveHostedPatternDisplayedSetbackDistance(params: {
  pattern: HostedPatternEntity
  host: BaseMassEntity
  faceId: BaseMassFaceId
  envelope: HostedPatternEnvelope
  setbackId: TopHostedSetbackId
}): number | null {
  const {
    pattern,
    host,
    faceId,
    envelope,
    setbackId,
  } = params

  if (faceId === 'top') {
    const cornerLocal = getTopHostedCornerLocal(
      envelope.centerU,
      envelope.centerV,
      envelope.spanU,
      envelope.spanV,
      setbackId,
    )
    return resolveTopHostSetbackDistance(host, cornerLocal, setbackId)
  }

  if (pattern.params.wrapMode !== 'single-face') {
    const faceSegments = resolveHostedPatternFaceSegments(pattern, host)
    const totalSpanU = faceSegments.reduce((sum, segment) => sum + segment.faceInfo.spanU, 0)
    const primaryFaceInfo = faceSegments[0]?.faceInfo
    if (!primaryFaceInfo || totalSpanU <= 0) return null
    if (setbackId === 'left') return Math.max(0, envelope.minU + totalSpanU / 2)
    if (setbackId === 'right') return Math.max(0, totalSpanU / 2 - envelope.maxU)
    if (setbackId === 'bottom') return Math.max(0, envelope.minV + primaryFaceInfo.spanV / 2)
    return Math.max(0, primaryFaceInfo.spanV / 2 - envelope.maxV)
  }

  const faceInfo = getBaseMassFaceInfo(host, faceId)
  if (!faceInfo) return null
  if (setbackId === 'left') return Math.max(0, envelope.minU + faceInfo.spanU / 2)
  if (setbackId === 'right') return Math.max(0, faceInfo.spanU / 2 - envelope.maxU)
  if (setbackId === 'bottom') return Math.max(0, envelope.minV + faceInfo.spanV / 2)
  return Math.max(0, faceInfo.spanV / 2 - envelope.maxV)
}

function solveHostedPatternDistributionSetback(params: {
  pattern: HostedPatternEntity
  host: BaseMassEntity
  setbackId: TopHostedSetbackId
  targetDistanceFt: number
}): number | null {
  const {
    pattern,
    host,
    setbackId,
    targetDistanceFt,
  } = params

  const faceInfo = getBaseMassFaceInfo(host, pattern.host.faceId)
  if (!faceInfo) return null
  const faceSegments = pattern.host.faceId === 'top' ? [] : resolveHostedPatternFaceSegments(pattern, host)
  const wrappedSpanU = faceSegments.reduce((sum, segment) => sum + segment.faceInfo.spanU, 0)

  const axisKey = setbackId === 'left' || setbackId === 'right' ? 'distributionU' : 'distributionV'
  const fieldKey = setbackId === 'left' || setbackId === 'bottom' ? 'startSetbackFt' : 'endSetbackFt'
  const axisFaceSpan = axisKey === 'distributionU'
    ? (
        pattern.host.faceId !== 'top' && pattern.params.wrapMode !== 'single-face'
          ? wrappedSpanU
          : faceInfo.spanU
      )
    : faceInfo.spanV
  const currentValue = pattern.params[axisKey][fieldKey]
  const target = Math.max(0, targetDistanceFt)
  let searchMin = 0
  let searchMax = Math.max(axisFaceSpan, currentValue, target)
  let bestValue = currentValue
  let bestError = Number.POSITIVE_INFINITY

  for (let pass = 0; pass < 3; pass += 1) {
    const stepCount = pass === 0 ? 180 : 90
    for (let index = 0; index <= stepCount; index += 1) {
      const candidate = lerp(searchMin, searchMax, index / stepCount)
      const testPattern: HostedPatternEntity = {
        ...pattern,
        params: {
          ...pattern.params,
          [axisKey]: {
            ...pattern.params[axisKey],
            [fieldKey]: candidate,
          },
        },
      }
      const visibleInstances = resolveHostedPatternInstances(testPattern, host).filter((instance) => !instance.hidden)
      const envelope = resolveHostedPatternEnvelope(visibleInstances)
      if (!envelope) continue
      const distanceFt = resolveHostedPatternDisplayedSetbackDistance({
        pattern: testPattern,
        host,
        faceId: pattern.host.faceId,
        envelope,
        setbackId,
      })
      if (distanceFt == null) continue
      const error = Math.abs(distanceFt - target)
      if (error < bestError) {
        bestError = error
        bestValue = candidate
      }
    }

    if (!Number.isFinite(bestError)) return null
    const span = Math.max((searchMax - searchMin) / Math.max(1, stepCount), 0.05)
    searchMin = Math.max(0, bestValue - span)
    searchMax = Math.min(axisFaceSpan, bestValue + span)
  }

  return bestValue
}

function solveTopHostedPlacementForSetback(params: {
  host: BaseMassEntity
  widthFt: number
  depthFt: number
  offsetUFt: number
  offsetVFt: number
  setbackId: TopHostedSetbackId
  targetDistanceFt: number
}): { offsetUFt: number; offsetVFt: number } | null {
  const {
    host,
    widthFt,
    depthFt,
    offsetUFt,
    offsetVFt,
    setbackId,
    targetDistanceFt,
  } = params
  const width = Math.max(0.1, Number(widthFt ?? 0))
  const depth = Math.max(0.1, Number(depthFt ?? 0))
  const bounds = getBaseMassLocalFootprintBounds(host)
  const movingAxis = setbackId === 'left' || setbackId === 'right' ? 'u' : 'v'
  const minCenter = movingAxis === 'u'
    ? bounds.minX + width / 2
    : bounds.minY + depth / 2
  const maxCenter = movingAxis === 'u'
    ? bounds.maxX - width / 2
    : bounds.maxY - depth / 2
  if (maxCenter < minCenter) return null

  let searchMin = minCenter
  let searchMax = maxCenter
  let bestValue = movingAxis === 'u' ? offsetUFt : offsetVFt
  let bestError = Number.POSITIVE_INFINITY

  for (let pass = 0; pass < 3; pass += 1) {
    const stepCount = pass === 0 ? 180 : 90
    for (let index = 0; index <= stepCount; index += 1) {
      const candidate = lerp(searchMin, searchMax, index / stepCount)
      const nextOffsetU = movingAxis === 'u' ? candidate : offsetUFt
      const nextOffsetV = movingAxis === 'v' ? candidate : offsetVFt
      if (!isTopHostedBoxWithinHost(host, nextOffsetU, nextOffsetV, width, depth)) continue
      const cornerLocal = getTopHostedCornerLocal(nextOffsetU, nextOffsetV, width, depth, setbackId)
      const distanceFt = resolveTopHostSetbackDistance(host, cornerLocal, setbackId)
      if (distanceFt == null) continue
      const error = Math.abs(distanceFt - targetDistanceFt)
      if (error < bestError) {
        bestError = error
        bestValue = candidate
      }
    }

    if (!Number.isFinite(bestError)) return null
    const span = Math.max((searchMax - searchMin) / Math.max(1, stepCount), 0.02)
    searchMin = Math.max(minCenter, bestValue - span)
    searchMax = Math.min(maxCenter, bestValue + span)
  }

  return movingAxis === 'u'
    ? { offsetUFt: bestValue, offsetVFt }
    : { offsetUFt, offsetVFt: bestValue }
}

function solveRectFaceHostedPlacementForSetback(params: {
  faceInfo: BaseMassFaceInfo
  widthFt: number
  spanVFt: number
  offsetUFt: number
  offsetVFt: number
  setbackId: TopHostedSetbackId
  targetDistanceFt: number
}): { offsetUFt: number; offsetVFt: number } | null {
  const {
    faceInfo,
    widthFt,
    spanVFt,
    offsetUFt,
    offsetVFt,
    setbackId,
    targetDistanceFt,
  } = params
  const width = Math.max(0.1, Number(widthFt ?? 0))
  const spanV = Math.max(0.1, Number(spanVFt ?? 0))
  const halfWidth = width / 2
  const halfSpanV = spanV / 2
  const minCenterU = -faceInfo.spanU / 2 + halfWidth
  const maxCenterU = faceInfo.spanU / 2 - halfWidth
  const minCenterV = -faceInfo.spanV / 2 + halfSpanV
  const maxCenterV = faceInfo.spanV / 2 - halfSpanV
  if (maxCenterU < minCenterU || maxCenterV < minCenterV) return null

  const clampedDistance = Math.max(0, targetDistanceFt)
  if (setbackId === 'left') {
    return {
      offsetUFt: clampValue(-faceInfo.spanU / 2 + clampedDistance + halfWidth, minCenterU, maxCenterU),
      offsetVFt,
    }
  }
  if (setbackId === 'right') {
    return {
      offsetUFt: clampValue(faceInfo.spanU / 2 - clampedDistance - halfWidth, minCenterU, maxCenterU),
      offsetVFt,
    }
  }
  if (setbackId === 'bottom') {
    return {
      offsetUFt,
      offsetVFt: clampValue(-faceInfo.spanV / 2 + clampedDistance + halfSpanV, minCenterV, maxCenterV),
    }
  }
  return {
    offsetUFt,
    offsetVFt: clampValue(faceInfo.spanV / 2 - clampedDistance - halfSpanV, minCenterV, maxCenterV),
  }
}

function formatFeetLabel(value: number, decimalPrecision: number) {
  return `${Number(value.toFixed(decimalPrecision))} ft`
}

function resolveFaceQuaternion(faceInfo: BaseMassFaceInfo) {
  const axisU = new THREE.Vector3(faceInfo.axisU.x, faceInfo.axisU.y, faceInfo.axisU.z).normalize()
  const axisV = new THREE.Vector3(faceInfo.axisV.x, faceInfo.axisV.y, faceInfo.axisV.z).normalize()
  const normal = new THREE.Vector3(faceInfo.normal.x, faceInfo.normal.y, faceInfo.normal.z).normalize()
  const basis = new THREE.Matrix4().makeBasis(axisU, axisV, normal)
  return new THREE.Quaternion().setFromRotationMatrix(basis)
}

function HostedSketchFaceTargets({
  host,
  activeFaceId,
  onFaceChange,
  clippingPlanes,
}: {
  host: BaseMassEntity
  activeFaceId: BaseMassFaceId
  onFaceChange: (faceId: BaseMassFaceId) => void
  clippingPlanes?: THREE.Plane[]
}) {
  const [hoveredFaceId, setHoveredFaceId] = useState<BaseMassFaceId | null>(null)
  const faceTargets = useMemo(() => (
    (['front', 'back', 'left', 'right'] as BaseMassFaceId[])
      .map((faceId) => {
        const faceInfo = getBaseMassFaceInfo(host, faceId)
        if (!faceInfo) return null
        return {
          faceId,
          faceInfo,
          quaternion: resolveFaceQuaternion(faceInfo),
          position: [
            faceInfo.center.x + faceInfo.normal.x * 0.03,
            faceInfo.center.y + faceInfo.normal.y * 0.03,
            faceInfo.center.z + faceInfo.normal.z * 0.03,
          ] as [number, number, number],
          outlinePoints: [
            [-faceInfo.spanU / 2, -faceInfo.spanV / 2, 0],
            [faceInfo.spanU / 2, -faceInfo.spanV / 2, 0],
            [faceInfo.spanU / 2, faceInfo.spanV / 2, 0],
            [-faceInfo.spanU / 2, faceInfo.spanV / 2, 0],
            [-faceInfo.spanU / 2, -faceInfo.spanV / 2, 0],
          ] as [number, number, number][],
        }
      })
      .filter(Boolean) as Array<{
        faceId: BaseMassFaceId
        faceInfo: BaseMassFaceInfo
        quaternion: THREE.Quaternion
        position: [number, number, number]
        outlinePoints: [number, number, number][]
      }>
  ), [host])

  return (
    <group>
      {faceTargets.map((target) => {
        const isActive = target.faceId === activeFaceId
        const isHovered = target.faceId === hoveredFaceId
        const opacity = isActive
          ? HOST_FACE_TARGET_ACTIVE_OPACITY
          : isHovered
            ? HOST_FACE_TARGET_HOVER_OPACITY
            : HOST_FACE_TARGET_IDLE_OPACITY

        return (
          <group
            key={target.faceId}
            position={target.position}
            quaternion={target.quaternion}
          >
            <mesh
              renderOrder={27}
              onPointerOver={() => {
                setHoveredFaceId(target.faceId)
                onFaceChange(target.faceId)
              }}
              onPointerMove={() => {
                setHoveredFaceId(target.faceId)
                onFaceChange(target.faceId)
              }}
              onPointerLeave={() => {
                setHoveredFaceId((current) => (current === target.faceId ? null : current))
              }}
            >
              <planeGeometry args={[target.faceInfo.spanU, target.faceInfo.spanV]} />
              <meshBasicMaterial
                color={HOST_OVERLAY_COLOR}
                transparent
                opacity={opacity}
                depthWrite={false}
                side={THREE.DoubleSide}
                clippingPlanes={clippingPlanes}
              />
            </mesh>
            <Line
              points={target.outlinePoints}
              color={isActive || isHovered ? '#99f6e4' : '#2dd4bf'}
              lineWidth={1.4}
              transparent
              opacity={isActive ? 0.98 : 0.74}
              depthWrite={false}
            />
          </group>
        )
      })}
    </group>
  )
}

function HostedSetbackDimensions({
  guides,
  onApply,
}: {
  guides: TopHostedSetbackGuide[]
  onApply: (setbackId: TopHostedSetbackId, nextDistanceFt: number) => void
}) {
  const { settings } = useSettings()
  const [editing, setEditing] = useState<{ id: TopHostedSetbackId; value: string } | null>(null)
  const [hoveredId, setHoveredId] = useState<TopHostedSetbackId | null>(null)

  const commitValue = useCallback((setbackId: TopHostedSetbackId, rawValue: string) => {
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed) || parsed < 0) {
      setEditing(null)
      return
    }
    onApply(setbackId, parsed)
    setEditing(null)
  }, [onApply])

  if (guides.length === 0) return null

  return (
    <group>
      {guides.map((guide) => {
        const isEditing = editing?.id === guide.id
        const isHovered = hoveredId === guide.id
        const isActive = isEditing || isHovered
        const editingValue = isEditing && editing ? editing.value : ''
        return (
          <group key={guide.id}>
            <Line
              points={guide.linePoints}
              color={isActive ? '#ea580c' : TOP_SETBACK_LINE_COLOR}
              lineWidth={isActive ? 2.5 : 1.8}
              transparent
              opacity={isActive ? 1 : 0.96}
              depthWrite={false}
            />
            <Html
              position={guide.labelPosition}
              center
              sprite
              zIndexRange={[140, 0]}
              style={{ pointerEvents: 'auto' }}
            >
              {isEditing ? (
                <input
                  autoFocus
                  type="text"
                  inputMode="decimal"
                  value={editingValue}
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  onChange={(event) => setEditing({ id: guide.id, value: event.target.value })}
                  onBlur={() => commitValue(guide.id, editingValue)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.stopPropagation()
                      commitValue(guide.id, editingValue)
                    } else if (event.key === 'Escape') {
                      event.stopPropagation()
                      setEditing(null)
                    }
                  }}
                  style={{
                    width: 92,
                    padding: '5px 8px',
                    border: '1px solid rgba(234, 88, 12, 0.72)',
                    borderRadius: 8,
                    background: 'rgba(255, 252, 247, 0.98)',
                    color: '#7c2d12',
                    boxShadow: '0 10px 24px rgba(124, 45, 18, 0.16)',
                    fontFamily: '"Plus Jakarta Sans", Inter, system-ui, sans-serif',
                    fontSize: 15,
                    fontWeight: 800,
                    lineHeight: 1.15,
                    textAlign: 'center',
                    outline: 'none',
                    fontVariantNumeric: 'tabular-nums',
                    textShadow: '0 0 8px rgba(255, 251, 235, 0.82)',
                  }}
                />
              ) : (
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseEnter={() => setHoveredId(guide.id)}
                  onMouseLeave={() => setHoveredId((current) => (current === guide.id ? null : current))}
                  onClick={(event) => {
                    event.stopPropagation()
                    setEditing({
                      id: guide.id,
                      value: Number(guide.distanceFt.toFixed(settings.decimalPrecision)).toString(),
                    })
                  }}
                  style={{
                    pointerEvents: 'auto',
                    appearance: 'none',
                    border: 'none',
                    background: 'transparent',
                    color: isActive ? '#9a3412' : '#7c2d12',
                    padding: '4px 8px',
                    fontFamily: '"Plus Jakarta Sans", Inter, system-ui, sans-serif',
                    fontSize: isActive ? 17 : 16,
                    fontWeight: 800,
                    lineHeight: 1.15,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    letterSpacing: '0.01em',
                    fontVariantNumeric: 'tabular-nums',
                    textShadow: isActive
                      ? '0 0 14px rgba(255, 251, 235, 0.98), 0 1px 2px rgba(124, 45, 18, 0.18)'
                      : '0 0 10px rgba(255, 251, 235, 0.92), 0 1px 2px rgba(124, 45, 18, 0.14)',
                    borderBottom: isActive ? '2px solid rgba(234, 88, 12, 0.82)' : '2px solid transparent',
                    transition: 'transform 0.16s ease, color 0.16s ease, border-color 0.16s ease, font-size 0.16s ease',
                  }}
                  title="Click to edit distance"
                >
                  {formatFeetLabel(guide.distanceFt, settings.decimalPrecision)}
                </button>
              )}
            </Html>
          </group>
        )
      })}
    </group>
  )
}

function TopHostedSetbackDimensions({
  host,
  widthFt,
  depthFt,
  offsetUFt,
  offsetVFt,
  roofBaseOffsetFt,
  onApply,
}: {
  host: BaseMassEntity
  widthFt: number
  depthFt: number
  offsetUFt: number
  offsetVFt: number
  roofBaseOffsetFt: number
  onApply: (setbackId: TopHostedSetbackId, nextDistanceFt: number) => void
}) {
  const guides = useMemo(() => resolveTopHostedSetbackGuides({
    host,
    widthFt,
    depthFt,
    offsetUFt,
    offsetVFt,
    localZ: host.params.heightFt / 2 + roofBaseOffsetFt + TOP_SETBACK_LINE_LIFT_FT,
  }), [depthFt, host, offsetUFt, offsetVFt, roofBaseOffsetFt, widthFt])

  return <HostedSetbackDimensions guides={guides} onApply={onApply} />
}

function RectFaceHostedSetbackDimensions({
  faceInfo,
  widthFt,
  spanVFt,
  offsetUFt,
  offsetVFt,
  normalLiftFt,
  onApply,
}: {
  faceInfo: BaseMassFaceInfo
  widthFt: number
  spanVFt: number
  offsetUFt: number
  offsetVFt: number
  normalLiftFt: number
  onApply: (setbackId: TopHostedSetbackId, nextDistanceFt: number) => void
}) {
  const guides = useMemo(() => resolveRectFaceHostedSetbackGuides({
    faceInfo,
    widthFt,
    spanVFt,
    offsetUFt,
    offsetVFt,
    normalLiftFt,
  }), [faceInfo, normalLiftFt, offsetUFt, offsetVFt, spanVFt, widthFt])

  return <HostedSetbackDimensions guides={guides} onApply={onApply} />
}

function HostedPatternSetbackDimensions({
  pattern,
  host,
  roofBaseOffsetFt,
  resolvedInstances,
  onApply,
}: {
  pattern: HostedPatternEntity
  host: BaseMassEntity
  roofBaseOffsetFt: number
  resolvedInstances: ResolvedHostedPatternInstance[]
  onApply: (setbackId: TopHostedSetbackId, nextDistanceFt: number) => void
}) {
  const visibleInstances = useMemo(
    () => resolvedInstances.filter((instance) => !instance.hidden),
    [resolvedInstances],
  )
  const envelope = useMemo(
    () => resolveHostedPatternEnvelope(visibleInstances),
    [visibleInstances],
  )
  const faceInfo = useMemo(
    () => getBaseMassFaceInfo(host, pattern.host.faceId),
    [host, pattern.host.faceId],
  )
  const guides = useMemo(() => {
    if (!envelope || !faceInfo) return []
    if (pattern.host.faceId === 'top') {
      return resolveTopHostedSetbackGuides({
        host,
        widthFt: envelope.spanU,
        depthFt: envelope.spanV,
        offsetUFt: envelope.centerU,
        offsetVFt: envelope.centerV,
        localZ: host.params.heightFt / 2 + roofBaseOffsetFt + TOP_SETBACK_LINE_LIFT_FT,
      })
    }
    if (pattern.params.wrapMode !== 'single-face') {
      return resolveWrappedHostedPatternSetbackGuides({
        pattern,
        host,
        envelope,
      })
    }
    return resolveRectFaceHostedSetbackGuides({
      faceInfo,
      widthFt: envelope.spanU,
      spanVFt: envelope.spanV,
      offsetUFt: envelope.centerU,
      offsetVFt: envelope.centerV,
      normalLiftFt: 0.08,
    })
  }, [envelope, faceInfo, host, pattern, roofBaseOffsetFt])

  if (!envelope || !faceInfo || guides.length === 0) return null

  return <HostedSetbackDimensions guides={guides} onApply={onApply} />
}

function HostedPatternRowGapDimension({
  pattern,
  host,
  roofBaseOffsetFt,
  resolvedInstances,
  onApply,
}: {
  pattern: HostedPatternEntity
  host: BaseMassEntity
  roofBaseOffsetFt: number
  resolvedInstances: ResolvedHostedPatternInstance[]
  onApply: (nextGapFt: number) => void
}) {
  const { settings } = useSettings()
  const [editingValue, setEditingValue] = useState<string | null>(null)
  const [hovered, setHovered] = useState(false)
  const visibleInstances = useMemo(
    () => resolvedInstances.filter((instance) => !instance.hidden),
    [resolvedInstances],
  )
  const rowBands = useMemo(
    () => resolveHostedPatternRowBands(visibleInstances),
    [visibleInstances],
  )
  const envelope = useMemo(
    () => resolveHostedPatternEnvelope(visibleInstances),
    [visibleInstances],
  )
  const guide = useMemo(() => {
    if (!envelope || rowBands.length < 2) return null
    const lowerRow = rowBands[0]!
    const upperRow = rowBands[1]!
    const gapFt = upperRow.minV - lowerRow.maxV
    if (!Number.isFinite(gapFt) || gapFt < -1e-6) return null

    if (pattern.host.faceId === 'top') {
      const anchorU = envelope.maxU
      const lowerPoint = baseMassLocalXYZToWorld(host, {
        x: anchorU,
        y: lowerRow.maxV,
        z: host.params.heightFt / 2 + roofBaseOffsetFt + TOP_SETBACK_LINE_LIFT_FT,
      })
      const upperPoint = baseMassLocalXYZToWorld(host, {
        x: anchorU,
        y: upperRow.minV,
        z: host.params.heightFt / 2 + roofBaseOffsetFt + TOP_SETBACK_LINE_LIFT_FT,
      })
      const labelPoint = baseMassLocalXYZToWorld(host, {
        x: anchorU + 0.8,
        y: (lowerRow.maxV + upperRow.minV) / 2,
        z: host.params.heightFt / 2 + roofBaseOffsetFt + TOP_SETBACK_LINE_LIFT_FT,
      })
      return {
        distanceFt: Math.max(0, gapFt),
        linePoints: [
          [lowerPoint.x, lowerPoint.y, lowerPoint.z],
          [upperPoint.x, upperPoint.y, upperPoint.z],
        ] as [number, number, number][],
        labelPosition: [labelPoint.x, labelPoint.y, labelPoint.z] as [number, number, number],
      }
    }

    if (pattern.params.wrapMode !== 'single-face') {
      const segments = resolveHostedPatternFaceSegments(pattern, host)
      const anchorGlobalU = envelope.centerU
      const lowerPoint = resolveHostedPatternGlobalPoint(segments, anchorGlobalU, lowerRow.maxV, TOP_SETBACK_LINE_LIFT_FT)
      const upperPoint = resolveHostedPatternGlobalPoint(segments, anchorGlobalU, upperRow.minV, TOP_SETBACK_LINE_LIFT_FT)
      const labelPoint = resolveHostedPatternGlobalPoint(segments, anchorGlobalU + 0.8, (lowerRow.maxV + upperRow.minV) / 2, TOP_SETBACK_LINE_LIFT_FT)
      if (!lowerPoint || !upperPoint || !labelPoint) return null
      return {
        distanceFt: Math.max(0, gapFt),
        linePoints: [lowerPoint, upperPoint],
        labelPosition: labelPoint,
      }
    }

    const faceInfo = getBaseMassFaceInfo(host, pattern.host.faceId)
    if (!faceInfo) return null
    return {
      distanceFt: Math.max(0, gapFt),
      linePoints: [
        resolveFaceWorldPoint(faceInfo, envelope.centerU, lowerRow.maxV, TOP_SETBACK_LINE_LIFT_FT),
        resolveFaceWorldPoint(faceInfo, envelope.centerU, upperRow.minV, TOP_SETBACK_LINE_LIFT_FT),
      ],
      labelPosition: resolveFaceWorldPoint(
        faceInfo,
        envelope.centerU + 0.8,
        (lowerRow.maxV + upperRow.minV) / 2,
        TOP_SETBACK_LINE_LIFT_FT,
      ),
    }
  }, [envelope, host, pattern, roofBaseOffsetFt, rowBands])

  const commitValue = useCallback((rawValue: string) => {
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed) || parsed < 0) {
      setEditingValue(null)
      return
    }
    onApply(parsed)
    setEditingValue(null)
  }, [onApply])

  if (!guide) return null

  const isEditing = editingValue !== null
  const isActive = isEditing || hovered

  return (
    <group>
      <Line
        points={guide.linePoints}
        color={isActive ? '#0f766e' : '#14b8a6'}
        lineWidth={isActive ? 2.4 : 1.7}
        transparent
        opacity={0.96}
        depthWrite={false}
      />
      <Html
        position={guide.labelPosition}
        center
        sprite
        zIndexRange={[140, 0]}
        style={{ pointerEvents: 'auto' }}
      >
        {isEditing ? (
          <input
            autoFocus
            type="text"
            inputMode="decimal"
            value={editingValue}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => setEditingValue(event.target.value)}
            onBlur={() => commitValue(editingValue)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.stopPropagation()
                commitValue(editingValue)
              } else if (event.key === 'Escape') {
                event.stopPropagation()
                setEditingValue(null)
              }
            }}
            style={{
              width: 92,
              padding: '5px 8px',
              border: '1px solid rgba(20, 184, 166, 0.72)',
              borderRadius: 8,
              background: 'rgba(245, 255, 253, 0.98)',
              color: '#115e59',
              boxShadow: '0 10px 24px rgba(15, 118, 110, 0.14)',
              fontFamily: '"Plus Jakarta Sans", Inter, system-ui, sans-serif',
              fontSize: 15,
              fontWeight: 800,
              lineHeight: 1.15,
              textAlign: 'center',
              outline: 'none',
              fontVariantNumeric: 'tabular-nums',
            }}
          />
        ) : (
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={(event) => {
              event.stopPropagation()
              setEditingValue(Number(guide.distanceFt.toFixed(settings.decimalPrecision)).toString())
            }}
            style={{
              pointerEvents: 'auto',
              appearance: 'none',
              border: 'none',
              background: 'transparent',
              color: isActive ? '#0f766e' : '#115e59',
              padding: '4px 8px',
              fontFamily: '"Plus Jakarta Sans", Inter, system-ui, sans-serif',
              fontSize: isActive ? 17 : 16,
              fontWeight: 800,
              lineHeight: 1.15,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              letterSpacing: '0.01em',
              fontVariantNumeric: 'tabular-nums',
              textShadow: isActive
                ? '0 0 14px rgba(240, 253, 250, 0.98), 0 1px 2px rgba(15, 118, 110, 0.16)'
                : '0 0 10px rgba(240, 253, 250, 0.92), 0 1px 2px rgba(15, 118, 110, 0.12)',
              borderBottom: isActive ? '2px solid rgba(20, 184, 166, 0.82)' : '2px solid transparent',
              transition: 'transform 0.16s ease, color 0.16s ease, border-color 0.16s ease, font-size 0.16s ease',
            }}
            title="Click to edit row gap"
          >
            {formatFeetLabel(guide.distanceFt, settings.decimalPrecision)}
          </button>
        )}
      </Html>
    </group>
  )
}

function ActiveHostOverlay({
  entity,
  buildingEntityLookup,
  roofBaseOffsetByHostId,
  activeTool,
  viewMode,
  faceId,
  clippingPlanes,
}: {
  entity: BaseMassEntity | HostedFeatureEntity | HostedProxyEntity
  buildingEntityLookup: Map<string, BuildingEntity>
  roofBaseOffsetByHostId: Map<string, number>
  activeTool: string
  viewMode: string
  faceId?: BaseMassFaceId
  clippingPlanes?: THREE.Plane[]
}) {
  const activeFace = useMemo(
    () => {
      if (isBaseMassEntity(entity)) {
        return faceId ? getBaseMassFaceInfo(entity, faceId) : resolvePreferredDrawHostFace(entity, activeTool, viewMode)
      }
      return resolveHostedRectEntityFaceInfo(entity, faceId ?? 'top', buildingEntityLookup, roofBaseOffsetByHostId)
    },
    [entity, activeTool, buildingEntityLookup, faceId, roofBaseOffsetByHostId, viewMode],
  )
  const topZ = isBaseMassEntity(entity) ? getBaseMassTopZ(entity) + 0.02 : null
  const faceQuaternion = useMemo(() => {
    if (!activeFace) return new THREE.Quaternion()
    return resolveFaceQuaternion(activeFace)
  }, [activeFace])

  const polygonShape = useMemo(() => {
    if (!isBaseMassEntity(entity)) return null
    if (entity.params.shape !== 'polygon' || entity.params.points.length < 3) return null
    return new THREE.Shape(entity.params.points.map(point => new THREE.Vector2(point.x, point.y)))
  }, [entity.params])

  if (!activeFace) return null

  if (!isBaseMassEntity(entity)) {
    return (
      <mesh
        position={[activeFace.center.x, activeFace.center.y, activeFace.center.z]}
        quaternion={faceQuaternion}
        raycast={() => null}
        renderOrder={25}
      >
        <planeGeometry args={[activeFace.spanU, activeFace.spanV]} />
        <meshBasicMaterial color={HOST_OVERLAY_COLOR} transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} clippingPlanes={clippingPlanes} />
      </mesh>
    )
  }

  if (activeFace.faceId !== 'top') {
    return (
      <mesh
        position={[activeFace.center.x, activeFace.center.y, activeFace.center.z]}
        quaternion={faceQuaternion}
        raycast={() => null}
        renderOrder={25}
      >
        <planeGeometry args={[activeFace.spanU, activeFace.spanV]} />
        <meshBasicMaterial color={HOST_OVERLAY_COLOR} transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} clippingPlanes={clippingPlanes} />
      </mesh>
    )
  }

  return (
    <group position={[entity.position.x, entity.position.y, topZ ?? 0]} rotation={[0, 0, entity.rotationZRad]}>
      {entity.params.shape === 'rect' && (
        <mesh raycast={() => null} renderOrder={25}>
          <planeGeometry args={[entity.params.widthFt, entity.params.depthFt]} />
          <meshBasicMaterial color={HOST_OVERLAY_COLOR} transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} clippingPlanes={clippingPlanes} />
        </mesh>
      )}

      {entity.params.shape === 'circle' && (
        <mesh raycast={() => null} renderOrder={25}>
          <circleGeometry args={[entity.params.radiusFt, 64]} />
          <meshBasicMaterial color={HOST_OVERLAY_COLOR} transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} clippingPlanes={clippingPlanes} />
        </mesh>
      )}

      {entity.params.shape === 'ring' && (
        <mesh raycast={() => null} renderOrder={25}>
          <ringGeometry args={[entity.params.innerRadiusFt, entity.params.radiusFt, 64]} />
          <meshBasicMaterial color={HOST_OVERLAY_COLOR} transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} clippingPlanes={clippingPlanes} />
        </mesh>
      )}

      {entity.params.shape === 'polygon' && polygonShape && (
        <mesh raycast={() => null} renderOrder={25}>
          <shapeGeometry args={[polygonShape]} />
          <meshBasicMaterial color={HOST_OVERLAY_COLOR} transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} clippingPlanes={clippingPlanes} />
        </mesh>
      )}
    </group>
  )
}

/**
 * Individual box object in the scene
 */
function BoxObject({ object, isSelected, onSelect, clippingPlanes }: ShapeObjectProps) {
  const meshRef = useRef<THREE.Mesh>(null)

  useEffect(() => {
    if (!meshRef.current) return
    meshRef.current.layers.set(object.layer)
  }, [object.layer])

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
    onSelect?.()
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
  }

  return (
    <group>
      <mesh
        ref={meshRef}
        position={object.position}
        rotation={object.rotation}
        onPointerDown={onSelect ? handlePointerDown : undefined}
        onClick={onSelect ? handleClick : undefined}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[object.dimensions.x, object.dimensions.y, object.dimensions.z]} />
        <meshStandardMaterial
          color={object.color}
          metalness={0.1}
          roughness={0.6}
          clippingPlanes={clippingPlanes}
          clipShadows={Boolean(clippingPlanes?.length)}
        />
      </mesh>

      {isSelected && (
        <mesh position={object.position} rotation={object.rotation} raycast={() => null} renderOrder={10}>
          <boxGeometry args={[object.dimensions.x + 0.06, object.dimensions.y + 0.06, object.dimensions.z + 0.06]} />
          <meshStandardMaterial
            color={SELECTED_OVERLAY_COLOR} emissive={SELECTED_OVERLAY_COLOR} emissiveIntensity={0.35}
            transparent opacity={SELECTED_OVERLAY_OPACITY} depthWrite={false}
            polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1}
            clippingPlanes={clippingPlanes}
          />
        </mesh>
      )}
    </group>
  )
}

/**
 * Solid circle (cylinder) — high-end smooth geometry
 * CylinderGeometry is Y-up in Three.js; we rotate +90° around X to make it Z-up.
 */
function CircleObject({ object, isSelected, onSelect, clippingPlanes }: ShapeObjectProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const radius = object.radius ?? object.dimensions.x / 2
  const height = object.dimensions.z

  useEffect(() => {
    if (!meshRef.current) return
    meshRef.current.layers.set(object.layer)
  }, [object.layer])

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
    onSelect?.()
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
  }

  return (
    <group>
      <mesh
        ref={meshRef}
        position={object.position}
        rotation={[Math.PI / 2, 0, 0]}
        onPointerDown={onSelect ? handlePointerDown : undefined}
        onClick={onSelect ? handleClick : undefined}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[radius, radius, height, CIRCLE_SEGMENTS]} />
        <meshStandardMaterial
          color={object.color}
          metalness={0.15}
          roughness={0.5}
          clippingPlanes={clippingPlanes}
          clipShadows={Boolean(clippingPlanes?.length)}
        />
      </mesh>

      {isSelected && (
        <mesh position={object.position} rotation={[Math.PI / 2, 0, 0]} raycast={() => null} renderOrder={10}>
          <cylinderGeometry args={[radius + 0.04, radius + 0.04, height + 0.06, CIRCLE_SEGMENTS]} />
          <meshStandardMaterial
            color={SELECTED_OVERLAY_COLOR} emissive={SELECTED_OVERLAY_COLOR} emissiveIntensity={0.35}
            transparent opacity={SELECTED_OVERLAY_OPACITY} depthWrite={false}
            polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1}
            clippingPlanes={clippingPlanes}
          />
        </mesh>
      )}
    </group>
  )
}

/**
 * Hollow circle (ring) — LatheGeometry with rectangular cross-section
 * LatheGeometry revolves a 2D profile around the Y axis; using Vector2(r, z)
 * naturally produces Z-up geometry.
 */
function RingObject({ object, isSelected, onSelect, clippingPlanes }: ShapeObjectProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const outerR = object.radius ?? object.dimensions.x / 2
  const innerR = object.innerRadius ?? outerR * 0.6
  const height = object.dimensions.z

  useEffect(() => {
    if (!meshRef.current) return
    meshRef.current.layers.set(object.layer)
  }, [object.layer])

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
    onSelect?.()
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
  }

  // Profile centered on y=0 so rotation pivot = ring center
  const halfH = height / 2
  const geo = useMemo(() => {
    const pts = [
      new THREE.Vector2(innerR, -halfH),
      new THREE.Vector2(outerR, -halfH),
      new THREE.Vector2(outerR, halfH),
      new THREE.Vector2(innerR, halfH),
    ]
    return new THREE.LatheGeometry(pts, CIRCLE_SEGMENTS)
  }, [innerR, outerR, halfH])

  const overlayGeo = useMemo(() => {
    const pad = 0.04
    const pts = [
      new THREE.Vector2(Math.max(0, innerR - pad), -halfH - 0.03),
      new THREE.Vector2(outerR + pad, -halfH - 0.03),
      new THREE.Vector2(outerR + pad, halfH + 0.03),
      new THREE.Vector2(Math.max(0, innerR - pad), halfH + 0.03),
    ]
    return new THREE.LatheGeometry(pts, CIRCLE_SEGMENTS)
  }, [innerR, outerR, halfH])

  // LatheGeometry revolves around the Y axis — rotate +π/2 on X so it stands upright (Z-UP).
  // Same rotation as CylinderGeometry: Y-up → Z-up.
  const ringRotation: [number, number, number] = [Math.PI / 2, 0, 0]

  return (
    <group>
      <mesh
        ref={meshRef}
        position={object.position}
        rotation={ringRotation}
        onPointerDown={onSelect ? handlePointerDown : undefined}
        onClick={onSelect ? handleClick : undefined}
        castShadow
        receiveShadow
      >
        <primitive object={geo} attach="geometry" />
        <meshStandardMaterial
          color={object.color}
          metalness={0.15}
          roughness={0.5}
          side={THREE.DoubleSide}
          clippingPlanes={clippingPlanes}
          clipShadows={Boolean(clippingPlanes?.length)}
        />
      </mesh>

      {isSelected && (
        <mesh position={object.position} rotation={ringRotation} raycast={() => null} renderOrder={10}>
          <primitive object={overlayGeo} attach="geometry" />
          <meshStandardMaterial
            color={SELECTED_OVERLAY_COLOR} emissive={SELECTED_OVERLAY_COLOR} emissiveIntensity={0.35}
            transparent opacity={SELECTED_OVERLAY_OPACITY} depthWrite={false} side={THREE.DoubleSide}
            polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1}
            clippingPlanes={clippingPlanes}
          />
        </mesh>
      )}
    </group>
  )
}

function RingObjectExtruded({ object, isSelected, onSelect, clippingPlanes }: ShapeObjectProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const outerR = object.radius ?? object.dimensions.x / 2
  const innerR = object.innerRadius ?? outerR * 0.6
  const height = object.dimensions.z

  useEffect(() => {
    if (!meshRef.current) return
    meshRef.current.layers.set(object.layer)
  }, [object.layer])

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
    onSelect?.()
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
  }

  const createRingShape = useCallback((outerRadius: number, innerRadius: number) => {
    const shape = new THREE.Shape()
    shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false)
    const hole = new THREE.Path()
    hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true)
    shape.holes.push(hole)
    return shape
  }, [])

  const geometry = useMemo(() => {
    const extruded = new THREE.ExtrudeGeometry(createRingShape(outerR, innerR), {
      depth: height,
      bevelEnabled: false,
      curveSegments: CIRCLE_SEGMENTS,
      steps: 1,
    })
    extruded.translate(0, 0, -height / 2)
    return extruded
  }, [createRingShape, height, innerR, outerR])

  const overlayGeometry = useMemo(() => {
    const pad = 0.04
    const overlayHeight = height + 0.06
    const extruded = new THREE.ExtrudeGeometry(
      createRingShape(outerR + pad, Math.max(0.01, innerR - pad)),
      {
        depth: overlayHeight,
        bevelEnabled: false,
        curveSegments: CIRCLE_SEGMENTS,
        steps: 1,
      },
    )
    extruded.translate(0, 0, -overlayHeight / 2)
    return extruded
  }, [createRingShape, height, innerR, outerR])

  return (
    <group>
      <mesh
        ref={meshRef}
        position={object.position}
        onPointerDown={onSelect ? handlePointerDown : undefined}
        onClick={onSelect ? handleClick : undefined}
        castShadow
        receiveShadow
      >
        <primitive object={geometry} attach="geometry" />
        <meshStandardMaterial
          color={object.color}
          metalness={0.15}
          roughness={0.5}
          side={THREE.DoubleSide}
          clippingPlanes={clippingPlanes}
          clipShadows={Boolean(clippingPlanes?.length)}
        />
      </mesh>

      {isSelected && (
        <mesh position={object.position} raycast={() => null} renderOrder={10}>
          <primitive object={overlayGeometry} attach="geometry" />
          <meshStandardMaterial
            color={SELECTED_OVERLAY_COLOR} emissive={SELECTED_OVERLAY_COLOR} emissiveIntensity={0.35}
            transparent opacity={SELECTED_OVERLAY_OPACITY} depthWrite={false} side={THREE.DoubleSide}
            polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1}
            clippingPlanes={clippingPlanes}
          />
        </mesh>
      )}
    </group>
  )
}

function PolygonObject({ entity, isSelected, onSelect, clippingPlanes }: PolygonObjectProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const edgeRef = useRef<THREE.LineSegments>(null)
  const height = entity.params.shape === 'polygon' ? entity.params.heightFt : 0
  const baseZ = entity.position.z - height / 2

  useEffect(() => {
    if (meshRef.current) meshRef.current.layers.set(WORKSPACE_LAYERS.BUILDING)
    if (edgeRef.current) edgeRef.current.layers.set(WORKSPACE_LAYERS.BUILDING)
  }, [])

  const geometry = useMemo(() => {
    if (entity.params.shape !== 'polygon' || entity.params.points.length < 3) return null
    const shape = new THREE.Shape(entity.params.points.map(point => new THREE.Vector2(point.x, point.y)))
    return new THREE.ExtrudeGeometry(shape, {
      depth: entity.params.heightFt,
      bevelEnabled: false,
      steps: 1,
    })
  }, [entity.params])

  const edgeGeometry = useMemo(() => (
    geometry ? new THREE.EdgesGeometry(geometry) : null
  ), [geometry])

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
    onSelect?.()
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
  }

  if (!geometry || !edgeGeometry) return null

  return (
    <group position={[entity.position.x, entity.position.y, baseZ]} rotation={[0, 0, entity.rotationZRad]}>
      <mesh
        ref={meshRef}
        onPointerDown={onSelect ? handlePointerDown : undefined}
        onClick={onSelect ? handleClick : undefined}
        castShadow
        receiveShadow
      >
        <primitive object={geometry} attach="geometry" />
        <meshStandardMaterial
          color={entity.color}
          metalness={0.12}
          roughness={0.58}
          clippingPlanes={clippingPlanes}
          clipShadows={Boolean(clippingPlanes?.length)}
        />
      </mesh>

      <lineSegments ref={edgeRef}>
        <primitive object={edgeGeometry} attach="geometry" />
        <lineBasicMaterial color="#9ca3af" />
      </lineSegments>

      {isSelected && (
        <mesh raycast={() => null} renderOrder={10}>
          <primitive object={geometry} attach="geometry" />
          <meshStandardMaterial
            color={SELECTED_OVERLAY_COLOR}
            emissive={SELECTED_OVERLAY_COLOR}
            emissiveIntensity={0.35}
            transparent
            opacity={SELECTED_OVERLAY_OPACITY}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
            clippingPlanes={clippingPlanes}
          />
        </mesh>
      )}
    </group>
  )
}

function createBufferGeometry(vertices: number[], indices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function createRectShedRoofGeometry(halfW: number, halfD: number, thickness: number, rise: number, ridgeDirection: 'x' | 'y'): THREE.BufferGeometry {
  const highSouthNorth = ridgeDirection === 'x'
  const heights = highSouthNorth
    ? [thickness, thickness, thickness + rise, thickness + rise]
    : [thickness, thickness + rise, thickness + rise, thickness]
  const vertices = [
    -halfW, -halfD, 0,
    halfW, -halfD, 0,
    halfW, halfD, 0,
    -halfW, halfD, 0,
    -halfW, -halfD, heights[0]!,
    halfW, -halfD, heights[1]!,
    halfW, halfD, heights[2]!,
    -halfW, halfD, heights[3]!,
  ]
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ]
  return createBufferGeometry(vertices, indices)
}

function createRectGableRoofGeometry(halfW: number, halfD: number, thickness: number, rise: number, ridgeDirection: 'x' | 'y'): THREE.BufferGeometry {
  const vertices = ridgeDirection === 'x'
    ? [
        -halfW, -halfD, 0,
        halfW, -halfD, 0,
        halfW, halfD, 0,
        -halfW, halfD, 0,
        -halfW, -halfD, thickness,
        halfW, -halfD, thickness,
        halfW, halfD, thickness,
        -halfW, halfD, thickness,
        -halfW, 0, thickness + rise,
        halfW, 0, thickness + rise,
      ]
    : [
        -halfW, -halfD, 0,
        halfW, -halfD, 0,
        halfW, halfD, 0,
        -halfW, halfD, 0,
        -halfW, -halfD, thickness,
        halfW, -halfD, thickness,
        halfW, halfD, thickness,
        -halfW, halfD, thickness,
        0, -halfD, thickness + rise,
        0, halfD, thickness + rise,
      ]

  const indices = ridgeDirection === 'x'
    ? [
        0, 2, 1, 0, 3, 2,
        0, 1, 5, 0, 5, 4,
        3, 7, 6, 3, 6, 2,
        0, 4, 8, 0, 8, 7, 0, 7, 3,
        1, 2, 6, 1, 6, 9, 1, 9, 5,
        4, 5, 9, 4, 9, 8,
        8, 9, 6, 8, 6, 7,
      ]
    : [
        0, 2, 1, 0, 3, 2,
        0, 4, 8, 0, 8, 5, 0, 5, 1,
        3, 2, 6, 3, 6, 9, 3, 9, 7,
        0, 3, 7, 0, 7, 4,
        1, 5, 6, 1, 6, 2,
        4, 7, 9, 4, 9, 8,
        8, 9, 6, 8, 6, 5,
      ]

  return createBufferGeometry(vertices, indices)
}

function createRectHipRoofGeometry(halfW: number, halfD: number, thickness: number, rise: number): THREE.BufferGeometry {
  const vertices = [
    -halfW, -halfD, 0,
    halfW, -halfD, 0,
    halfW, halfD, 0,
    -halfW, halfD, 0,
    -halfW, -halfD, thickness,
    halfW, -halfD, thickness,
    halfW, halfD, thickness,
    -halfW, halfD, thickness,
    0, 0, thickness + rise,
  ]
  const indices = [
    0, 2, 1, 0, 3, 2,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
    4, 5, 8,
    5, 6, 8,
    6, 7, 8,
    7, 4, 8,
  ]
  return createBufferGeometry(vertices, indices)
}

function createCircularConeRoofGeometry(radius: number, thickness: number, rise: number): THREE.LatheGeometry {
  const roofHeight = Math.max(0.1, thickness + rise)
  return new THREE.LatheGeometry([
    new THREE.Vector2(0, roofHeight),
    new THREE.Vector2(radius, thickness),
    new THREE.Vector2(radius, 0),
    new THREE.Vector2(0, 0),
  ], CIRCLE_SEGMENTS)
}

function createCircularDomeRoofGeometry(radius: number, thickness: number, rise: number): THREE.LatheGeometry {
  const profile: THREE.Vector2[] = []
  const steps = 16
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps
    const x = radius * t
    const y = thickness + Math.cos(t * Math.PI / 2) * rise
    profile.push(new THREE.Vector2(x, y))
  }
  profile.push(
    new THREE.Vector2(radius, 0),
    new THREE.Vector2(0, 0),
  )
  return new THREE.LatheGeometry(profile, CIRCLE_SEGMENTS)
}

type RoofHostGeometry = {
  shape: 'rect' | 'circle' | 'ring' | 'polygon'
  color: string
  position: [number, number, number]
  rotation?: [number, number, number]
  quaternion?: [number, number, number, number]
  widthFt?: number
  depthFt?: number
  radiusFt?: number
  innerRadiusFt?: number
  polygonPoints?: BuildingPoint2[]
}

function resolveRoofHostGeometry(
  host: BaseMassEntity | HostedFeatureEntity | HostedProxyEntity,
  buildingEntityLookup: Map<string, BuildingEntity>,
  roofBaseOffsetByHostId: Map<string, number>,
): RoofHostGeometry | null {
  if (isBaseMassEntity(host)) {
    return {
      shape: host.params.shape,
      color: host.color,
      position: [host.position.x, host.position.y, getBaseMassTopZ(host)],
      rotation: [0, 0, host.rotationZRad],
      widthFt: host.params.shape === 'rect' ? host.params.widthFt : undefined,
      depthFt: host.params.shape === 'rect' ? host.params.depthFt : undefined,
      radiusFt: host.params.shape === 'circle' || host.params.shape === 'ring' ? host.params.radiusFt : undefined,
      innerRadiusFt: host.params.shape === 'ring' ? host.params.innerRadiusFt : undefined,
      polygonPoints: host.params.shape === 'polygon' ? host.params.points : undefined,
    }
  }

  const ancestorRoofOffsets = new Map(roofBaseOffsetByHostId)
  ancestorRoofOffsets.delete(host.id)
  const faceInfo = resolveHostedRectEntityTopFaceInfo(host, buildingEntityLookup, ancestorRoofOffsets)
  if (!faceInfo) return null
  const axisU = new THREE.Vector3(faceInfo.axisU.x, faceInfo.axisU.y, faceInfo.axisU.z).normalize()
  const axisV = new THREE.Vector3(faceInfo.axisV.x, faceInfo.axisV.y, faceInfo.axisV.z).normalize()
  const normal = new THREE.Vector3(faceInfo.normal.x, faceInfo.normal.y, faceInfo.normal.z).normalize()
  const basis = new THREE.Matrix4().makeBasis(axisU, axisV, normal)
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis)
  return {
    shape: 'rect',
    color: host.color,
    position: [faceInfo.center.x, faceInfo.center.y, faceInfo.center.z],
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    widthFt: faceInfo.spanU,
    depthFt: faceInfo.spanV,
  }
}

function RoofObject({
  roof,
  host,
  buildingEntityLookup,
  roofBaseOffsetByHostId,
  isSelected,
  onSelect,
  clippingPlanes,
}: {
  roof: HostedRoofEntity
  host: BaseMassEntity | HostedFeatureEntity | HostedProxyEntity
  buildingEntityLookup: Map<string, BuildingEntity>
  roofBaseOffsetByHostId: Map<string, number>
  isSelected: boolean
  onSelect?: () => void
  clippingPlanes?: THREE.Plane[]
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const edgeRef = useRef<THREE.LineSegments>(null)

  useEffect(() => {
    if (meshRef.current) meshRef.current.layers.set(WORKSPACE_LAYERS.BUILDING)
    if (edgeRef.current) edgeRef.current.layers.set(WORKSPACE_LAYERS.BUILDING)
  }, [])

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
    onSelect?.()
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
  }

  const roofHostGeometry = useMemo(
    () => resolveRoofHostGeometry(host, buildingEntityLookup, roofBaseOffsetByHostId),
    [buildingEntityLookup, host, roofBaseOffsetByHostId],
  )

  const roofGeometry = useMemo(() => {
    if (!roofHostGeometry) return null
    const thickness = Math.max(0.1, Number(roof.params.thicknessFt ?? 1))
    const overhang = Math.max(0, Number(roof.params.overhangFt ?? 0))
    const rise = Math.max(0, Number(roof.params.riseFt ?? 0))
    const ridgeDirection = roof.params.ridgeDirection === 'y' ? 'y' : 'x'

    if (roofHostGeometry.shape === 'rect') {
      const halfW = (roofHostGeometry.widthFt ?? 0) / 2 + overhang
      const halfD = (roofHostGeometry.depthFt ?? 0) / 2 + overhang
      switch (roof.kind) {
        case 'shed-roof':
          return createRectShedRoofGeometry(halfW, halfD, thickness, Math.max(0.1, rise), ridgeDirection)
        case 'gable-roof':
          return createRectGableRoofGeometry(halfW, halfD, thickness, Math.max(0.1, rise), ridgeDirection)
        case 'hip-roof':
          return createRectHipRoofGeometry(halfW, halfD, thickness, Math.max(0.1, rise))
        case 'flat-roof':
        default:
          return new THREE.BoxGeometry(halfW * 2, halfD * 2, thickness)
      }
    }

    if (roofHostGeometry.shape === 'circle') {
      const radius = (roofHostGeometry.radiusFt ?? 0) + overhang
      switch (roof.kind) {
        case 'cone-roof':
          return createCircularConeRoofGeometry(radius, thickness, Math.max(0.1, rise))
        case 'dome-roof':
          return createCircularDomeRoofGeometry(radius, thickness, Math.max(0.1, rise))
        case 'flat-roof':
        default:
          return new THREE.CylinderGeometry(radius, radius, thickness, CIRCLE_SEGMENTS)
      }
    }

    if (roofHostGeometry.shape === 'ring') {
      const radius = (roofHostGeometry.radiusFt ?? 0) + overhang
      switch (roof.kind) {
        case 'cone-roof':
          return createCircularConeRoofGeometry(radius, thickness, Math.max(0.1, rise))
        case 'dome-roof':
          return createCircularDomeRoofGeometry(radius, thickness, Math.max(0.1, rise))
        case 'flat-roof':
        default:
          return new THREE.CylinderGeometry(radius, radius, thickness, CIRCLE_SEGMENTS)
      }
    }

    if (roofHostGeometry.shape === 'polygon' && roofHostGeometry.polygonPoints) {
      const shape = new THREE.Shape(roofHostGeometry.polygonPoints.map(point => new THREE.Vector2(point.x, point.y)))
      return new THREE.ExtrudeGeometry(shape, {
        depth: thickness,
        bevelEnabled: false,
        steps: 1,
      })
    }

    return null
  }, [roof, roofHostGeometry])

  const edgeGeometry = useMemo(() => (
    roofGeometry ? new THREE.EdgesGeometry(roofGeometry) : null
  ), [roofGeometry])

  if (!roofGeometry || !edgeGeometry || !roofHostGeometry) return null

  const displayColor = roofHostGeometry.color
  const roofGroupPosition = roofHostGeometry.position
  const roofGroupRotation = roofHostGeometry.rotation
  const roofGroupQuaternion = roofHostGeometry.quaternion
  const usesRadialRoofProfile = (
    (roofHostGeometry.shape === 'circle' || roofHostGeometry.shape === 'ring')
    && (roof.kind === 'cone-roof' || roof.kind === 'dome-roof')
  )
  const meshPosition: [number, number, number] = roofHostGeometry.shape === 'polygon'
    ? [0, 0, 0]
    : usesRadialRoofProfile
      ? [0, 0, 0]
    : roofHostGeometry.shape === 'circle' || roofHostGeometry.shape === 'ring'
      ? [0, 0, Math.max(0.1, Number(roof.params.thicknessFt ?? 1)) / 2]
      : roof.kind === 'flat-roof'
        ? [0, 0, Math.max(0.1, Number(roof.params.thicknessFt ?? 1)) / 2]
        : [0, 0, 0]
  const meshRotation: [number, number, number] = roofHostGeometry.shape === 'circle' || roofHostGeometry.shape === 'ring'
    ? [Math.PI / 2, 0, 0]
    : [0, 0, 0]

  return (
    <group
      position={roofGroupPosition}
      rotation={roofGroupQuaternion ? undefined : roofGroupRotation}
      quaternion={roofGroupQuaternion}
    >
      <mesh
        ref={meshRef}
        position={meshPosition}
        rotation={meshRotation}
        onPointerDown={onSelect ? handlePointerDown : undefined}
        onClick={onSelect ? handleClick : undefined}
        castShadow
        receiveShadow
      >
        <primitive object={roofGeometry} attach="geometry" />
        <meshBasicMaterial
          color={displayColor}
          side={THREE.DoubleSide}
          clippingPlanes={clippingPlanes}
        />
      </mesh>

      <lineSegments ref={edgeRef} position={meshPosition} rotation={meshRotation}>
        <primitive object={edgeGeometry} attach="geometry" />
        <lineBasicMaterial color={isSelected ? SELECTED_OVERLAY_COLOR : '#94a3b8'} />
      </lineSegments>
    </group>
  )
}

function getParapetOffsetDistance(thickness: number): number {
  return -thickness / 2
}

function ParapetObject({
  parapet,
  host,
  roofBaseOffsetFt,
  isSelected,
  onSelect,
  clippingPlanes,
}: {
  parapet: HostedParapetEntity
  host: BaseMassEntity
  roofBaseOffsetFt: number
  isSelected: boolean
  onSelect?: () => void
  clippingPlanes?: THREE.Plane[]
}) {
  const selectedEdgeIds = getResolvedParapetEdgeIdsForHost(host, parapet.params.edgeIds)
  const height = Math.max(0.1, Number(parapet.params.heightFt ?? 3))
  const thickness = Math.max(0.1, Number(parapet.params.thicknessFt ?? 0.5))
  const offsetDistance = getParapetOffsetDistance(thickness)
  const displayColor = host.color

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
    onSelect?.()
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
  }

  const polygonSegments = useMemo(() => {
    if (host.params.shape !== 'polygon' || host.params.points.length < 2) return []
    const points = host.params.points
    let signedArea = 0
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!
      const b = points[(i + 1) % points.length]!
      signedArea += a.x * b.y - b.x * a.y
    }
    const sign = signedArea >= 0 ? 1 : -1
    return points.map((start, index) => {
      const end = points[(index + 1) % points.length]!
      const dx = end.x - start.x
      const dy = end.y - start.y
      const length = Math.sqrt(dx * dx + dy * dy)
      if (length <= 0.001) return null
      const outwardX = (dy / length) * sign
      const outwardY = (-dx / length) * sign
      const centerX = (start.x + end.x) / 2 + outwardX * offsetDistance
      const centerY = (start.y + end.y) / 2 + outwardY * offsetDistance
      return {
        key: `poly-${index}` as ParapetEdgeId,
        position: [centerX, centerY, height / 2] as [number, number, number],
        rotationZRad: Math.atan2(dy, dx),
        dimensions: [length, thickness, height] as [number, number, number],
      }
    }).filter(Boolean) as Array<{
      key: ParapetEdgeId
      position: [number, number, number]
      rotationZRad: number
      dimensions: [number, number, number]
    }>
  }, [host.params, height, thickness, offsetDistance])
  const circularParapetSegments = useMemo(() => {
    if (host.params.shape !== 'circle' && host.params.shape !== 'ring') return []
    const baseRadius = host.params.radiusFt
    const innerRadius = Math.max(0.1, baseRadius - thickness)
    const outerRadius = baseRadius
    return CIRCULAR_PARAPET_EDGE_OPTIONS
      .filter(option => selectedEdgeIds.includes(option.value))
      .map((option) => {
        const shape = new THREE.Shape()
        shape.moveTo(
          outerRadius * Math.cos(option.startAngleRad),
          outerRadius * Math.sin(option.startAngleRad),
        )
        shape.absarc(0, 0, outerRadius, option.startAngleRad, option.endAngleRad, false)
        shape.lineTo(
          innerRadius * Math.cos(option.endAngleRad),
          innerRadius * Math.sin(option.endAngleRad),
        )
        shape.absarc(0, 0, innerRadius, option.endAngleRad, option.startAngleRad, true)
        shape.closePath()
        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth: height,
          bevelEnabled: false,
          steps: 1,
        })
        return {
          key: option.value,
          geometry,
          edgeGeometry: new THREE.EdgesGeometry(geometry),
        }
      })
  }, [host.params, selectedEdgeIds, thickness, height])

  if (host.params.shape === 'circle' || host.params.shape === 'ring') {
    if (circularParapetSegments.length === 0) return null
    const position: [number, number, number] = [host.position.x, host.position.y, getBaseMassTopZ(host) + roofBaseOffsetFt]

    return (
      <group position={position} rotation={[0, 0, host.rotationZRad ?? 0]}>
        {circularParapetSegments.map((segment) => (
          <group key={segment.key}>
            <mesh
              onPointerDown={onSelect ? handlePointerDown : undefined}
              onClick={onSelect ? handleClick : undefined}
              castShadow
              receiveShadow
            >
              <primitive object={segment.geometry} attach="geometry" />
              <meshStandardMaterial
                color={displayColor}
                metalness={0.1}
                roughness={0.56}
                side={THREE.DoubleSide}
                clippingPlanes={clippingPlanes}
                clipShadows={Boolean(clippingPlanes?.length)}
              />
            </mesh>
            <lineSegments>
              <primitive object={segment.edgeGeometry} attach="geometry" />
              <lineBasicMaterial color="#94a3b8" />
            </lineSegments>
            {isSelected && (
              <mesh raycast={() => null} renderOrder={10}>
                <primitive object={segment.geometry} attach="geometry" />
                <meshStandardMaterial
                  color={SELECTED_OVERLAY_COLOR}
                  emissive={SELECTED_OVERLAY_COLOR}
                  emissiveIntensity={0.35}
                  transparent
                  opacity={SELECTED_OVERLAY_OPACITY}
                  depthWrite={false}
                  polygonOffset
                  polygonOffsetFactor={-1}
                  polygonOffsetUnits={-1}
                  side={THREE.DoubleSide}
                  clippingPlanes={clippingPlanes}
                />
              </mesh>
            )}
          </group>
        ))}
      </group>
    )
  }

  return (
    <group position={[host.position.x, host.position.y, getBaseMassTopZ(host) + roofBaseOffsetFt]} rotation={[0, 0, host.rotationZRad]}>
      {host.params.shape === 'rect' && (
        <>
          {selectedEdgeIds.includes('front') && (
            <group position={[0, -host.params.depthFt / 2 - offsetDistance, height / 2]}>
              <mesh onPointerDown={onSelect ? handlePointerDown : undefined} onClick={onSelect ? handleClick : undefined} castShadow receiveShadow>
                <boxGeometry args={[host.params.widthFt, thickness, height]} />
                <meshStandardMaterial color={displayColor} metalness={0.1} roughness={0.56} clippingPlanes={clippingPlanes} clipShadows={Boolean(clippingPlanes?.length)} />
              </mesh>
              {isSelected && (
                <mesh raycast={() => null} renderOrder={10}>
                  <boxGeometry args={[host.params.widthFt, thickness, height]} />
                  <meshStandardMaterial color={SELECTED_OVERLAY_COLOR} emissive={SELECTED_OVERLAY_COLOR} emissiveIntensity={0.35} transparent opacity={SELECTED_OVERLAY_OPACITY} depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} clippingPlanes={clippingPlanes} />
                </mesh>
              )}
            </group>
          )}
          {selectedEdgeIds.includes('back') && (
            <group position={[0, host.params.depthFt / 2 + offsetDistance, height / 2]}>
              <mesh onPointerDown={onSelect ? handlePointerDown : undefined} onClick={onSelect ? handleClick : undefined} castShadow receiveShadow>
                <boxGeometry args={[host.params.widthFt, thickness, height]} />
                <meshStandardMaterial color={displayColor} metalness={0.1} roughness={0.56} clippingPlanes={clippingPlanes} clipShadows={Boolean(clippingPlanes?.length)} />
              </mesh>
              {isSelected && (
                <mesh raycast={() => null} renderOrder={10}>
                  <boxGeometry args={[host.params.widthFt, thickness, height]} />
                  <meshStandardMaterial color={SELECTED_OVERLAY_COLOR} emissive={SELECTED_OVERLAY_COLOR} emissiveIntensity={0.35} transparent opacity={SELECTED_OVERLAY_OPACITY} depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} clippingPlanes={clippingPlanes} />
                </mesh>
              )}
            </group>
          )}
          {selectedEdgeIds.includes('right') && (
            <group position={[host.params.widthFt / 2 + offsetDistance, 0, height / 2]} rotation={[0, 0, Math.PI / 2]}>
              <mesh onPointerDown={onSelect ? handlePointerDown : undefined} onClick={onSelect ? handleClick : undefined} castShadow receiveShadow>
                <boxGeometry args={[host.params.depthFt, thickness, height]} />
                <meshStandardMaterial color={displayColor} metalness={0.1} roughness={0.56} clippingPlanes={clippingPlanes} clipShadows={Boolean(clippingPlanes?.length)} />
              </mesh>
              {isSelected && (
                <mesh raycast={() => null} renderOrder={10}>
                  <boxGeometry args={[host.params.depthFt, thickness, height]} />
                  <meshStandardMaterial color={SELECTED_OVERLAY_COLOR} emissive={SELECTED_OVERLAY_COLOR} emissiveIntensity={0.35} transparent opacity={SELECTED_OVERLAY_OPACITY} depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} clippingPlanes={clippingPlanes} />
                </mesh>
              )}
            </group>
          )}
          {selectedEdgeIds.includes('left') && (
            <group position={[-host.params.widthFt / 2 - offsetDistance, 0, height / 2]} rotation={[0, 0, Math.PI / 2]}>
              <mesh onPointerDown={onSelect ? handlePointerDown : undefined} onClick={onSelect ? handleClick : undefined} castShadow receiveShadow>
                <boxGeometry args={[host.params.depthFt, thickness, height]} />
                <meshStandardMaterial color={displayColor} metalness={0.1} roughness={0.56} clippingPlanes={clippingPlanes} clipShadows={Boolean(clippingPlanes?.length)} />
              </mesh>
              {isSelected && (
                <mesh raycast={() => null} renderOrder={10}>
                  <boxGeometry args={[host.params.depthFt, thickness, height]} />
                  <meshStandardMaterial color={SELECTED_OVERLAY_COLOR} emissive={SELECTED_OVERLAY_COLOR} emissiveIntensity={0.35} transparent opacity={SELECTED_OVERLAY_OPACITY} depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} clippingPlanes={clippingPlanes} />
                </mesh>
              )}
            </group>
          )}
        </>
      )}

      {host.params.shape === 'polygon' && polygonSegments
        .filter(segment => selectedEdgeIds.includes(segment.key))
        .map((segment) => (
        <group key={segment.key} position={segment.position} rotation={[0, 0, segment.rotationZRad]}>
          <mesh onPointerDown={onSelect ? handlePointerDown : undefined} onClick={onSelect ? handleClick : undefined} castShadow receiveShadow>
            <boxGeometry args={segment.dimensions} />
            <meshStandardMaterial color={displayColor} metalness={0.1} roughness={0.56} clippingPlanes={clippingPlanes} clipShadows={Boolean(clippingPlanes?.length)} />
          </mesh>
          {isSelected && (
            <mesh raycast={() => null} renderOrder={10}>
              <boxGeometry args={segment.dimensions} />
              <meshStandardMaterial color={SELECTED_OVERLAY_COLOR} emissive={SELECTED_OVERLAY_COLOR} emissiveIntensity={0.35} transparent opacity={SELECTED_OVERLAY_OPACITY} depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} clippingPlanes={clippingPlanes} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  )
}

function BalconyHandrail({
  widthFt,
  depthFt,
  hostHeightFt,
  heightFt,
  insetFt,
  thicknessFt,
  clippingPlanes,
}: {
  widthFt: number
  depthFt: number
  hostHeightFt: number
  heightFt: number
  insetFt: number
  thicknessFt: number
  clippingPlanes?: THREE.Plane[]
}) {
  const safeWidth = Math.max(0.5, Number(widthFt ?? 0) || 0.5)
  const safeDepth = Math.max(0.5, Number(depthFt ?? 0) || 0.5)
  const safeHostHeight = Math.max(0.1, Number(hostHeightFt ?? 0) || 0.1)
  const safeHeight = Math.max(0.1, Number(heightFt ?? 0) || 0.1)
  const safeThickness = Math.max(0.05, Math.min(safeWidth / 4, safeDepth / 4, Number(thicknessFt ?? 0.18) || 0.18))
  const safeInset = Math.max(0, Math.min((safeWidth - safeThickness) / 2 - 0.05, (safeDepth - safeThickness) / 2 - 0.05, Number(insetFt ?? 0.15) || 0))
  const topY = safeHostHeight / 2 + safeHeight / 2
  const frontZ = safeDepth / 2 - safeInset - safeThickness / 2
  const sideRailDepth = Math.max(safeThickness, safeDepth - safeInset * 2)

  return (
    <group>
      <mesh position={[0, topY, frontZ]} renderOrder={6}>
        <boxGeometry args={[Math.max(safeThickness, safeWidth - safeInset * 2), safeHeight, safeThickness]} />
        <meshStandardMaterial
          color="#cbd5e1"
          metalness={0.4}
          roughness={0.34}
          clippingPlanes={clippingPlanes}
          clipShadows={Boolean(clippingPlanes?.length)}
        />
      </mesh>
      <mesh position={[-safeWidth / 2 + safeInset + safeThickness / 2, topY, 0]} renderOrder={6}>
        <boxGeometry args={[safeThickness, safeHeight, sideRailDepth]} />
        <meshStandardMaterial
          color="#cbd5e1"
          metalness={0.4}
          roughness={0.34}
          clippingPlanes={clippingPlanes}
          clipShadows={Boolean(clippingPlanes?.length)}
        />
      </mesh>
      <mesh position={[safeWidth / 2 - safeInset - safeThickness / 2, topY, 0]} renderOrder={6}>
        <boxGeometry args={[safeThickness, safeHeight, sideRailDepth]} />
        <meshStandardMaterial
          color="#cbd5e1"
          metalness={0.4}
          roughness={0.34}
          clippingPlanes={clippingPlanes}
          clipShadows={Boolean(clippingPlanes?.length)}
        />
      </mesh>
    </group>
  )
}

function HostedFeatureObject({
  feature,
  buildingEntityLookup,
  roofBaseOffsetByHostId,
  isSelected,
  showEditHandles,
  onSelect,
  onUpdate,
  clippingPlanes,
}: {
  feature: HostedFeatureEntity
  buildingEntityLookup: Map<string, BuildingEntity>
  roofBaseOffsetByHostId: Map<string, number>
  isSelected: boolean
  showEditHandles: boolean
  onSelect?: () => void
  onUpdate: (id: string, partial: Partial<HostedFeatureEntity>) => void
  clippingPlanes?: THREE.Plane[]
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const edgeRef = useRef<THREE.LineSegments>(null)

  useEffect(() => {
    if (meshRef.current) meshRef.current.layers.set(WORKSPACE_LAYERS.BUILDING)
    if (edgeRef.current) edgeRef.current.layers.set(WORKSPACE_LAYERS.BUILDING)
  }, [])

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
    onSelect?.()
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
  }

  const transform = useMemo(
    () => resolveHostedRectEntityTransform(feature, buildingEntityLookup, roofBaseOffsetByHostId),
    [buildingEntityLookup, feature, roofBaseOffsetByHostId],
  )

  const geometryArgs = useMemo(
    () => (transform ? [...transform.dimensions] as [number, number, number] : null),
    [transform],
  )
  const edgeGeometry = useMemo(
    () => {
      if (!geometryArgs) return null
      const boxGeometry = new THREE.BoxGeometry(...geometryArgs)
      const nextEdgeGeometry = new THREE.EdgesGeometry(boxGeometry)
      boxGeometry.dispose()
      return nextEdgeGeometry
    },
    [geometryArgs],
  )

  if (!transform || !geometryArgs || !edgeGeometry) return null

  const planeSpanVFt = feature.kind === 'top-feature' ? feature.params.depthFt : feature.params.heightFt
  const surfaceNormalHalfSpanFt = feature.kind === 'top-feature'
    ? Math.max(0.1, Number(feature.params.heightFt ?? 0)) / 2
    : Math.max(0.1, Number(feature.params.depthFt ?? 0)) / 2
  const displayColor = (() => {
    const hostEntity = buildingEntityLookup.get(feature.host.entityId) ?? null
    return hostEntity?.color ?? feature.color
  })()
  const railingSettings = useMemo(() => {
    if (feature.kind !== 'side-feature' || feature.params.preset !== 'balcony') return null
    if (!feature.params.balconyHandrailEnabled) return null
    return {
      heightFt: Math.max(0.1, Number(feature.params.balconyHandrailHeightFt ?? 3.5) || 3.5),
      insetFt: Math.max(0, Number(feature.params.balconyHandrailInsetFt ?? 0.15) || 0),
      thicknessFt: Math.max(0.05, Number(feature.params.balconyHandrailThicknessFt ?? 0.18) || 0.05),
    }
  }, [feature])

  return (
    <group
      position={[transform.position.x, transform.position.y, transform.position.z]}
      quaternion={new THREE.Quaternion(transform.quaternion.x, transform.quaternion.y, transform.quaternion.z, transform.quaternion.w)}
    >
      <mesh
        ref={meshRef}
        onPointerDown={onSelect ? handlePointerDown : undefined}
        onClick={onSelect ? handleClick : undefined}
        castShadow
        receiveShadow
      >
        <boxGeometry args={geometryArgs} />
        <meshStandardMaterial
          color={displayColor}
          emissive={isSelected ? SELECTED_OVERLAY_COLOR : '#000000'}
          emissiveIntensity={isSelected ? 0.08 : 0}
          metalness={0.12}
          roughness={0.52}
          clippingPlanes={clippingPlanes}
          clipShadows={Boolean(clippingPlanes?.length)}
        />
      </mesh>

      <lineSegments ref={edgeRef}>
        <primitive object={edgeGeometry} attach="geometry" />
        <lineBasicMaterial color={isSelected ? SELECTED_OVERLAY_COLOR : '#94a3b8'} />
      </lineSegments>

      {railingSettings && (
        <BalconyHandrail
          widthFt={feature.params.widthFt}
          depthFt={feature.params.depthFt}
          hostHeightFt={feature.params.heightFt}
          heightFt={railingSettings.heightFt}
          insetFt={railingSettings.insetFt}
          thicknessFt={railingSettings.thicknessFt}
          clippingPlanes={clippingPlanes}
        />
      )}

      {isSelected && showEditHandles && (
        <HostedBoxEditHandles
          host={buildingEntityLookup.get(feature.host.entityId) as BaseMassEntity}
          faceId={feature.host.faceId}
          transform={{
            position: [transform.position.x, transform.position.y, transform.position.z],
            quaternion: new THREE.Quaternion(transform.quaternion.x, transform.quaternion.y, transform.quaternion.z, transform.quaternion.w),
            dimensions: transform.dimensions,
            faceInfo: getBaseMassFaceInfo(buildingEntityLookup.get(feature.host.entityId) as BaseMassEntity, feature.host.faceId)!,
            axisU: new THREE.Vector3(),
            axisV: new THREE.Vector3(),
            normal: new THREE.Vector3(),
          }}
          widthFt={feature.params.widthFt}
          planeSpanVFt={planeSpanVFt}
          offsetUFt={feature.params.offsetUFt}
          offsetVFt={feature.params.offsetVFt}
          surfaceNormalHalfSpanFt={surfaceNormalHalfSpanFt}
          onSelect={onSelect}
          onApply={(next) => {
            onUpdate(feature.id, {
              params: {
                ...feature.params,
                widthFt: next.widthFt,
                depthFt: feature.kind === 'top-feature' ? next.planeSpanVFt : feature.params.depthFt,
                heightFt: feature.kind === 'side-feature' ? next.planeSpanVFt : feature.params.heightFt,
                offsetUFt: next.offsetUFt,
                offsetVFt: next.offsetVFt,
              },
            })
          }}
        />
      )}
    </group>
  )
}

function resolveHostedBoxTransform(params: {
  host: BaseMassEntity
  faceId?: string
  widthFt: number
  depthFt: number
  heightFt: number
  offsetUFt: number
  offsetVFt: number
  normalOffsetFt: number
}) {
  const {
    host,
    faceId,
    widthFt,
    depthFt,
    heightFt,
    offsetUFt,
    offsetVFt,
    normalOffsetFt,
  } = params
  if (!faceId) return null
  const faceInfo = getBaseMassFaceInfo(host, faceId as any)
  if (!faceInfo) return null

  const width = Math.max(0.1, Number(widthFt ?? 0))
  const depth = Math.max(0.1, Number(depthFt ?? 0))
  const height = Math.max(0.1, Number(heightFt ?? 0))
  const offsetU = Number(offsetUFt ?? 0)
  const offsetV = Number(offsetVFt ?? 0)

  const axisU = new THREE.Vector3(faceInfo.axisU.x, faceInfo.axisU.y, faceInfo.axisU.z).normalize()
  const axisV = new THREE.Vector3(faceInfo.axisV.x, faceInfo.axisV.y, faceInfo.axisV.z).normalize()
  const normal = new THREE.Vector3(faceInfo.normal.x, faceInfo.normal.y, faceInfo.normal.z).normalize()
  const position = new THREE.Vector3(faceInfo.center.x, faceInfo.center.y, faceInfo.center.z)
    .addScaledVector(axisU, offsetU)
    .addScaledVector(axisV, offsetV)
    .addScaledVector(normal, normalOffsetFt)

  const basis = new THREE.Matrix4()
  let dimensions: [number, number, number]

  if (faceInfo.faceId === 'top') {
    basis.makeBasis(axisU, axisV, normal)
    dimensions = [width, depth, height]
  } else {
    basis.makeBasis(axisU, axisV, normal)
    dimensions = [width, height, depth]
  }

  const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis)
  return {
    position: [position.x, position.y, position.z] as [number, number, number],
    quaternion,
    dimensions,
    faceInfo,
    axisU,
    axisV,
    normal,
  }
}

function HostedBoxEditHandles({
  host,
  faceId,
  transform,
  widthFt,
  planeSpanVFt,
  offsetUFt,
  offsetVFt,
  surfaceNormalHalfSpanFt,
  onApply,
  onSelect,
}: {
  host: BaseMassEntity
  faceId: BaseMassFaceId
  transform: NonNullable<ReturnType<typeof resolveHostedBoxTransform>>
  widthFt: number
  planeSpanVFt: number
  offsetUFt: number
  offsetVFt: number
  surfaceNormalHalfSpanFt: number
  onApply: (next: { widthFt: number; planeSpanVFt: number; offsetUFt: number; offsetVFt: number }) => void
  onSelect?: () => void
}) {
  const { camera, gl } = useThree()
  const cleanupRef = useRef<(() => void) | null>(null)
  const raycasterRef = useRef(new THREE.Raycaster())
  const ndcRef = useRef(new THREE.Vector2())
  const hitRef = useRef(new THREE.Vector3())
  const planeRef = useRef(new THREE.Plane())
  const moveHandleRef = useRef<THREE.Mesh>(null)
  const resizeHandleRef = useRef<THREE.Mesh>(null)

  const faceInfo = transform.faceInfo
  const faceCenter = useMemo(
    () => new THREE.Vector3(faceInfo.center.x, faceInfo.center.y, faceInfo.center.z),
    [faceInfo],
  )
  const axisU = transform.axisU
  const axisV = transform.axisV
  const normal = transform.normal
  const localAxisU = useMemo(() => new THREE.Vector3(1, 0, 0), [])
  const localAxisV = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const localNormal = useMemo(() => new THREE.Vector3(0, 0, 1), [])

  const moveHandlePosition = useMemo(
    () => localNormal.clone().multiplyScalar(surfaceNormalHalfSpanFt + HOSTED_HANDLE_LIFT_FT),
    [localNormal, surfaceNormalHalfSpanFt],
  )
  const resizeHandlePosition = useMemo(
    () => localAxisU
      .clone()
      .multiplyScalar(widthFt / 2)
      .addScaledVector(localAxisV, planeSpanVFt / 2)
      .addScaledVector(localNormal, surfaceNormalHalfSpanFt + HOSTED_HANDLE_LIFT_FT),
    [localAxisU, localAxisV, localNormal, planeSpanVFt, surfaceNormalHalfSpanFt, widthFt],
  )

  const setCursor = useCallback((cursor: string) => {
    gl.domElement.style.cursor = cursor
  }, [gl.domElement])

  const projectClientToFace = useCallback((clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    ndcRef.current.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycasterRef.current.setFromCamera(ndcRef.current, camera)
    planeRef.current.setFromNormalAndCoplanarPoint(normal, faceCenter)
    const hit = raycasterRef.current.ray.intersectPlane(planeRef.current, hitRef.current)
    if (!hit) return null
    const offset = hit.clone().sub(faceCenter)
    return {
      u: offset.dot(axisU),
      v: offset.dot(axisV),
    }
  }, [axisU, axisV, camera, faceCenter, gl.domElement, normal])

  const stopDrag = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    setCursor('default')
  }, [setCursor])

  useEffect(() => {
    if (moveHandleRef.current) moveHandleRef.current.layers.set(WORKSPACE_LAYERS.BUILDING)
    if (resizeHandleRef.current) resizeHandleRef.current.layers.set(WORKSPACE_LAYERS.BUILDING)
  }, [])
  useEffect(() => () => stopDrag(), [stopDrag])

  const startDrag = useCallback((mode: 'move' | 'resize', event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation?.()
    onSelect?.()

    const minU = offsetUFt - widthFt / 2
    const minV = offsetVFt - planeSpanVFt / 2
    setCursor('grabbing')

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const projected = projectClientToFace(pointerEvent.clientX, pointerEvent.clientY)
      if (!projected) return
      if (mode === 'move') {
        let nextOffsetUFt = projected.u
        let nextOffsetVFt = projected.v
        if (faceId === 'top') {
          if (!isTopHostedBoxWithinHost(host, nextOffsetUFt, nextOffsetVFt, widthFt, planeSpanVFt)) {
            let bestOffsetUFt = offsetUFt
            let bestOffsetVFt = offsetVFt
            let low = 0
            let high = 1
            for (let iteration = 0; iteration < 14; iteration += 1) {
              const t = (low + high) / 2
              const candidateOffsetUFt = lerp(offsetUFt, nextOffsetUFt, t)
              const candidateOffsetVFt = lerp(offsetVFt, nextOffsetVFt, t)
              if (isTopHostedBoxWithinHost(host, candidateOffsetUFt, candidateOffsetVFt, widthFt, planeSpanVFt)) {
                bestOffsetUFt = candidateOffsetUFt
                bestOffsetVFt = candidateOffsetVFt
                low = t
              } else {
                high = t
              }
            }
            nextOffsetUFt = bestOffsetUFt
            nextOffsetVFt = bestOffsetVFt
          }
        } else {
          const offsetULimit = Math.max(0, faceInfo.spanU / 2 - widthFt / 2)
          const offsetVLimit = Math.max(0, faceInfo.spanV / 2 - planeSpanVFt / 2)
          nextOffsetUFt = clampValue(projected.u, -offsetULimit, offsetULimit)
          nextOffsetVFt = clampValue(projected.v, -offsetVLimit, offsetVLimit)
        }
        onApply({
          widthFt,
          planeSpanVFt,
          offsetUFt: nextOffsetUFt,
          offsetVFt: nextOffsetVFt,
        })
        return
      }
      let nextWidth = Math.max(HOSTED_HANDLE_MIN_SPAN_FT, projected.u - minU)
      let nextSpanV = Math.max(HOSTED_HANDLE_MIN_SPAN_FT, projected.v - minV)
      if (faceId === 'top') {
        if (!isTopHostedBoxWithinHost(host, minU + nextWidth / 2, minV + nextSpanV / 2, nextWidth, nextSpanV)) {
          let bestWidth = widthFt
          let bestSpanV = planeSpanVFt
          let low = 0
          let high = 1
          for (let iteration = 0; iteration < 14; iteration += 1) {
            const t = (low + high) / 2
            const candidateWidth = lerp(widthFt, nextWidth, t)
            const candidateSpanV = lerp(planeSpanVFt, nextSpanV, t)
            const candidateCenterUFt = minU + candidateWidth / 2
            const candidateCenterVFt = minV + candidateSpanV / 2
            if (isTopHostedBoxWithinHost(host, candidateCenterUFt, candidateCenterVFt, candidateWidth, candidateSpanV)) {
              bestWidth = candidateWidth
              bestSpanV = candidateSpanV
              low = t
            } else {
              high = t
            }
          }
          nextWidth = bestWidth
          nextSpanV = bestSpanV
        } else {
          // Keep the current anchor corner fixed on the roof plane.
          nextWidth = Math.max(HOSTED_HANDLE_MIN_SPAN_FT, nextWidth)
          nextSpanV = Math.max(HOSTED_HANDLE_MIN_SPAN_FT, nextSpanV)
        }
      } else {
        const maxWidth = Math.max(HOSTED_HANDLE_MIN_SPAN_FT, faceInfo.spanU / 2 - minU)
        const maxSpanV = Math.max(HOSTED_HANDLE_MIN_SPAN_FT, faceInfo.spanV / 2 - minV)
        nextWidth = clampValue(nextWidth, HOSTED_HANDLE_MIN_SPAN_FT, maxWidth)
        nextSpanV = clampValue(nextSpanV, HOSTED_HANDLE_MIN_SPAN_FT, maxSpanV)
      }
      onApply({
        widthFt: nextWidth,
        planeSpanVFt: nextSpanV,
        offsetUFt: minU + nextWidth / 2,
        offsetVFt: minV + nextSpanV / 2,
      })
    }

    const handlePointerUp = () => {
      stopDrag()
    }

    cleanupRef.current?.()
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, true)
    window.addEventListener('pointercancel', handlePointerUp, true)
    cleanupRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp, true)
      window.removeEventListener('pointercancel', handlePointerUp, true)
    }
  }, [offsetUFt, onApply, onSelect, planeSpanVFt, projectClientToFace, setCursor, stopDrag, widthFt])

  return (
    <group>
      <mesh
        ref={moveHandleRef}
        position={moveHandlePosition}
        onPointerDown={(event) => startDrag('move', event)}
        onClick={(event) => event.stopPropagation()}
        onPointerOver={(event) => {
          event.stopPropagation()
          setCursor('grab')
        }}
        onPointerOut={(event) => {
          event.stopPropagation()
          if (!cleanupRef.current) setCursor('default')
        }}
        renderOrder={24}
      >
        <sphereGeometry args={[0.24, 18, 18]} />
        <meshStandardMaterial color={HOSTED_HANDLE_MOVE_COLOR} emissive={SELECTED_OVERLAY_COLOR} emissiveIntensity={0.65} metalness={0.05} roughness={0.12} />
      </mesh>

      <mesh
        ref={resizeHandleRef}
        position={resizeHandlePosition}
        quaternion={transform.quaternion}
        onPointerDown={(event) => startDrag('resize', event)}
        onClick={(event) => event.stopPropagation()}
        onPointerOver={(event) => {
          event.stopPropagation()
          setCursor('nwse-resize')
        }}
        onPointerOut={(event) => {
          event.stopPropagation()
          if (!cleanupRef.current) setCursor('default')
        }}
        renderOrder={24}
      >
        <octahedronGeometry args={[0.26, 0]} />
        <meshStandardMaterial color={HOSTED_HANDLE_RESIZE_COLOR} emissive={HOSTED_HANDLE_RESIZE_COLOR} emissiveIntensity={0.55} metalness={0.08} roughness={0.18} />
      </mesh>
    </group>
  )
}

function ProxyFeatureObject({
  proxy,
  buildingEntityLookup,
  roofBaseOffsetByHostId,
  isSelected,
  showEditHandles,
  onSelect,
  onUpdate,
  clippingPlanes,
}: {
  proxy: HostedProxyEntity
  buildingEntityLookup: Map<string, BuildingEntity>
  roofBaseOffsetByHostId: Map<string, number>
  isSelected: boolean
  showEditHandles: boolean
  onSelect?: () => void
  onUpdate: (id: string, partial: Partial<HostedProxyEntity>) => void
  clippingPlanes?: THREE.Plane[]
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const edgeRef = useRef<THREE.LineSegments>(null)

  useEffect(() => {
    if (meshRef.current) meshRef.current.layers.set(WORKSPACE_LAYERS.BUILDING)
    if (edgeRef.current) edgeRef.current.layers.set(WORKSPACE_LAYERS.BUILDING)
  }, [])

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
    onSelect?.()
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
  }

  const isCut = proxy.params.mode === 'cut'
  const transform = useMemo(
    () => resolveHostedRectEntityTransform(proxy, buildingEntityLookup, roofBaseOffsetByHostId),
    [buildingEntityLookup, proxy, roofBaseOffsetByHostId],
  )

  const geometryArgs = useMemo(
    () => (transform ? [...transform.dimensions] as [number, number, number] : null),
    [transform],
  )
  const edgeGeometry = useMemo(
    () => {
      if (!geometryArgs) return null
      const boxGeometry = new THREE.BoxGeometry(...geometryArgs)
      const nextEdgeGeometry = new THREE.EdgesGeometry(boxGeometry)
      boxGeometry.dispose()
      return nextEdgeGeometry
    },
    [geometryArgs],
  )

  if (!transform || !geometryArgs || !edgeGeometry) return null

  const planeSpanVFt = proxy.host.faceId === 'top' ? proxy.params.depthFt : proxy.params.heightFt
  const surfaceNormalHalfSpanFt = proxy.host.faceId === 'top'
    ? Math.max(0.1, Number(proxy.params.heightFt ?? 0)) / 2
    : Math.max(0.1, Number(proxy.params.depthFt ?? 0)) / 2

  return (
    <group
      position={[transform.position.x, transform.position.y, transform.position.z]}
      quaternion={new THREE.Quaternion(transform.quaternion.x, transform.quaternion.y, transform.quaternion.z, transform.quaternion.w)}
    >
      <mesh
        ref={meshRef}
        onPointerDown={onSelect ? handlePointerDown : undefined}
        onClick={onSelect ? handleClick : undefined}
        castShadow={!isCut}
        receiveShadow={!isCut}
      >
        <boxGeometry args={geometryArgs} />
        <meshStandardMaterial
          color={proxy.color}
          metalness={isCut ? 0.02 : 0.12}
          roughness={isCut ? 0.36 : 0.52}
          transparent={isCut}
          opacity={isCut ? 0.32 : 1}
          clippingPlanes={clippingPlanes}
          clipShadows={Boolean(clippingPlanes?.length)}
        />
      </mesh>

      <lineSegments ref={edgeRef}>
        <primitive object={edgeGeometry} attach="geometry" />
        <lineBasicMaterial color={isCut ? '#ef4444' : '#94a3b8'} />
      </lineSegments>

      {isSelected && (
        <mesh raycast={() => null} renderOrder={10}>
          <boxGeometry args={geometryArgs} />
          <meshStandardMaterial
            color={SELECTED_OVERLAY_COLOR}
            emissive={SELECTED_OVERLAY_COLOR}
            emissiveIntensity={0.35}
            transparent
            opacity={SELECTED_OVERLAY_OPACITY}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
            clippingPlanes={clippingPlanes}
          />
        </mesh>
      )}

      {isSelected && showEditHandles && (
        <HostedBoxEditHandles
          host={buildingEntityLookup.get(proxy.host.entityId) as BaseMassEntity}
          faceId={proxy.host.faceId}
          transform={{
            position: [transform.position.x, transform.position.y, transform.position.z],
            quaternion: new THREE.Quaternion(transform.quaternion.x, transform.quaternion.y, transform.quaternion.z, transform.quaternion.w),
            dimensions: transform.dimensions,
            faceInfo: getBaseMassFaceInfo(buildingEntityLookup.get(proxy.host.entityId) as BaseMassEntity, proxy.host.faceId)!,
            axisU: new THREE.Vector3(),
            axisV: new THREE.Vector3(),
            normal: new THREE.Vector3(),
          }}
          widthFt={proxy.params.widthFt}
          planeSpanVFt={planeSpanVFt}
          offsetUFt={proxy.params.offsetUFt}
          offsetVFt={proxy.params.offsetVFt}
          surfaceNormalHalfSpanFt={surfaceNormalHalfSpanFt}
          onSelect={onSelect}
          onApply={(next) => {
            onUpdate(proxy.id, {
              params: {
                ...proxy.params,
                widthFt: next.widthFt,
                depthFt: proxy.host.faceId === 'top' ? next.planeSpanVFt : proxy.params.depthFt,
                heightFt: proxy.host.faceId === 'top' ? proxy.params.heightFt : next.planeSpanVFt,
                offsetUFt: next.offsetUFt,
                offsetVFt: next.offsetVFt,
              },
            })
          }}
        />
      )}
    </group>
  )
}

function HostedPatternInstanceObject({
  instance,
  host,
  roofBaseOffsetFt,
  patternColor,
  pattern,
  isPatternSelected,
  isInstanceSelected,
  isPreview = false,
  onSelect,
  clippingPlanes,
}: {
  instance: ResolvedHostedPatternInstance
  host: BaseMassEntity
  roofBaseOffsetFt: number
  patternColor: string
  pattern?: HostedPatternEntity
  isPatternSelected: boolean
  isInstanceSelected: boolean
  isPreview?: boolean
  onSelect?: () => void
  clippingPlanes?: THREE.Plane[]
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const edgeRef = useRef<THREE.LineSegments>(null)

  useEffect(() => {
    if (meshRef.current) meshRef.current.layers.set(WORKSPACE_LAYERS.BUILDING)
    if (edgeRef.current) edgeRef.current.layers.set(WORKSPACE_LAYERS.BUILDING)
  }, [])

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
    onSelect?.()
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
  }

  const isCut = instance.contentType === 'cut-volume'
  const transform = useMemo(() => resolveHostedBoxTransform({
    host,
    faceId: instance.faceId,
    widthFt: instance.widthFt,
    depthFt: instance.depthFt,
    heightFt: instance.heightFt,
    offsetUFt: instance.offsetUFt,
    offsetVFt: instance.offsetVFt,
    normalOffsetFt: instance.faceId === 'top'
      ? (isCut ? roofBaseOffsetFt - instance.heightFt / 2 : roofBaseOffsetFt + instance.heightFt / 2)
      : (isCut ? -instance.depthFt / 2 : instance.depthFt / 2),
  }), [host, instance, isCut, roofBaseOffsetFt])

  const geometryArgs = useMemo(
    () => (transform ? [...transform.dimensions] as [number, number, number] : null),
    [transform],
  )
  const edgeGeometry = useMemo(() => {
    if (!geometryArgs) return null
    const boxGeometry = new THREE.BoxGeometry(...geometryArgs)
    const nextEdgeGeometry = new THREE.EdgesGeometry(boxGeometry)
    boxGeometry.dispose()
    return nextEdgeGeometry
  }, [geometryArgs])

  if (!transform || !geometryArgs || !edgeGeometry || instance.hidden) return null
  const overlayOpacity = isPreview ? 0.035 : isInstanceSelected ? 0.1 : isPatternSelected ? 0.045 : 0
  const edgeColor = isPreview
    ? '#60a5fa'
    : isInstanceSelected
      ? SELECTED_OVERLAY_COLOR
      : isPatternSelected
        ? '#c084fc'
        : (isCut ? '#ef4444' : '#94a3b8')
  const railingSettings = useMemo(() => {
    if (instance.contentType !== 'feature' || instance.featurePreset !== 'balcony') return null
    if (pattern?.params.balconyHandrailEnabled === false) return null
    return {
      heightFt: Math.max(0.1, Number(pattern?.params.balconyHandrailHeightFt ?? 3.5) || 3.5),
      insetFt: Math.max(0, Number(pattern?.params.balconyHandrailInsetFt ?? 0.15) || 0),
      thicknessFt: Math.max(0.05, Number(pattern?.params.balconyHandrailThicknessFt ?? 0.18) || 0.05),
    }
  }, [instance.contentType, instance.featurePreset, pattern])

  return (
    <group position={transform.position} quaternion={transform.quaternion}>
      <mesh
        ref={meshRef}
        onPointerDown={onSelect ? handlePointerDown : undefined}
        onClick={onSelect ? handleClick : undefined}
        castShadow={!isCut}
        receiveShadow={!isCut}
      >
        <boxGeometry args={geometryArgs} />
        <meshStandardMaterial
          color={isCut ? '#f87171' : patternColor}
          metalness={isCut ? 0.02 : isPreview ? 0.08 : 0.12}
          roughness={isCut ? 0.36 : isPreview ? 0.58 : 0.52}
          transparent={isCut || isPreview}
          opacity={isCut ? 0.32 : isPreview ? 0.62 : 1}
          clippingPlanes={clippingPlanes}
          clipShadows={Boolean(clippingPlanes?.length)}
        />
      </mesh>

      <lineSegments ref={edgeRef}>
        <primitive object={edgeGeometry} attach="geometry" />
        <lineBasicMaterial color={edgeColor} />
      </lineSegments>

      {railingSettings && instance.faceId !== 'top' && (
        <BalconyHandrail
          widthFt={instance.widthFt}
          depthFt={instance.depthFt}
          hostHeightFt={instance.heightFt}
          heightFt={railingSettings.heightFt}
          insetFt={railingSettings.insetFt}
          thicknessFt={railingSettings.thicknessFt}
          clippingPlanes={clippingPlanes}
        />
      )}

      {overlayOpacity > 0 && (
        <mesh raycast={() => null} renderOrder={10}>
          <boxGeometry args={geometryArgs} />
          <meshStandardMaterial
            color={SELECTED_OVERLAY_COLOR}
            emissive={SELECTED_OVERLAY_COLOR}
            emissiveIntensity={0.3}
            transparent
            opacity={overlayOpacity}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
            clippingPlanes={clippingPlanes}
          />
        </mesh>
      )}
    </group>
  )
}

/**
 * Renders all objects in the scene
 */
export function SceneObjects({ clippingPlanes }: { clippingPlanes?: THREE.Plane[] }) {
  const {
    objects,
    buildingEntities,
    selectedObjectId,
    selectedBuildingEntityId,
    selectedHostedPatternInstance,
    buildingHostedPatternPreview,
    setSelectedObjectId,
    setSelectedBuildingEntityId,
    setSelectedHostedPatternInstance,
    updateBuildingEntity,
    buildingHostedSketchIntent,
    buildingHostedSketchFaceId,
    drawingState,
    activeTool,
    workspaceMode,
    cameraNavigationActive,
    viewMode,
  } = useTool()

  const polygonEntities = useMemo(() => (
    buildingEntities.filter((entity): entity is BaseMassEntity => (
      entity.category === 'base-mass' && entity.params.shape === 'polygon'
    ))
  ), [buildingEntities])
  const roofEntities = useMemo(
    () => buildingEntities.filter((entity): entity is HostedRoofEntity => isRoofEntity(entity)),
    [buildingEntities],
  )
  const featureEntities = useMemo(
    () => buildingEntities.filter((entity): entity is HostedFeatureEntity => isFeatureEntity(entity)),
    [buildingEntities],
  )
  const proxyEntities = useMemo(
    () => buildingEntities.filter((entity): entity is HostedProxyEntity => isProxyEntity(entity)),
    [buildingEntities],
  )
  const patternEntities = useMemo(
    () => buildingEntities.filter((entity): entity is HostedPatternEntity => isPatternEntity(entity)),
    [buildingEntities],
  )
  const previewPatternEntity = useMemo(() => {
    if (!buildingHostedPatternPreview) return null
    const host = buildingEntities.find((entity) => entity.id === buildingHostedPatternPreview.host.entityId) ?? null
    return host && isBaseMassEntity(host) ? buildingHostedPatternPreview : null
  }, [buildingEntities, buildingHostedPatternPreview])
  const parapetEntities = useMemo(
    () => buildingEntities.filter((entity): entity is HostedParapetEntity => isParapetEntity(entity)),
    [buildingEntities],
  )
  const baseMassById = useMemo(
    () => new Map(buildingEntities
      .filter((entity): entity is BaseMassEntity => entity.category === 'base-mass')
      .map(entity => [entity.id, entity] as const)),
    [buildingEntities],
  )
  const buildingEntityById = useMemo(
    () => new Map(buildingEntities.map((entity) => [entity.id, entity] as const)),
    [buildingEntities],
  )
  const roofBaseOffsetByHostId = useMemo(() => {
    const map = new Map<string, number>()
    for (const roof of roofEntities) {
      const current = map.get(roof.host.entityId) ?? 0
      map.set(roof.host.entityId, Math.max(current, Number(roof.params.thicknessFt ?? 0)))
    }
    return map
  }, [roofEntities])
  const selectedHostEntity = useMemo(() => {
    const hostId = buildingHostedSketchIntent?.hostEntityId ?? selectedBuildingEntityId
    if (!hostId) return null
    const entity = buildingEntities.find(candidate => candidate.id === hostId) ?? null
    return entity && (isBaseMassEntity(entity) || isHostedRectEntity(entity)) ? entity : null
  }, [buildingEntities, buildingHostedSketchIntent, selectedBuildingEntityId])
  const hostedSketchOverlayFaceId = useMemo(() => {
    if (!buildingHostedSketchIntent || !selectedHostEntity || buildingHostedSketchIntent.hostEntityId !== selectedHostEntity.id) {
      return null
    }
    if (drawingState.isDrawing && drawingState.hostFaceId) {
      return drawingState.hostFaceId as BaseMassFaceId
    }
    if (buildingHostedSketchFaceId) return buildingHostedSketchFaceId
    return buildingHostedSketchIntent.hostKind === 'top-face' ? 'top' : null
  }, [buildingHostedSketchFaceId, buildingHostedSketchIntent, drawingState.hostFaceId, drawingState.isDrawing, selectedHostEntity])
  const showTopHostOverlay = workspaceMode === 'BUILDING_MODE'
    && (
      Boolean(buildingHostedSketchIntent ? hostedSketchOverlayFaceId : ((activeTool === 'rectangle' || activeTool === 'circle' || activeTool === 'ring' || activeTool === 'polygon')))
    )
    && Boolean(selectedHostEntity)
  // Hosted feature/proxy handles currently read as stray geometry in the scene,
  // so we keep hosted editing in the panel/in-canvas dimensions only.
  const showHostedEditHandles = false
  const showHostedSetbackDimensions = workspaceMode === 'BUILDING_MODE'
    && activeTool === 'select'
    && !cameraNavigationActive
  const buildingSelectionEnabled = workspaceMode === 'BUILDING_MODE'
    && activeTool === 'select'
    && !cameraNavigationActive
  const scaffoldSelectionEnabled = workspaceMode === 'SCAFFOLD_MODE'
    && activeTool === 'select'
    && !cameraNavigationActive

  const hiddenLegacyObjectIds = useMemo(() => new Set(polygonEntities.map(entity => entity.id)), [polygonEntities])
  const visibleObjects = useMemo(
    () => objects.filter(obj => !hiddenLegacyObjectIds.has(obj.id)),
    [objects, hiddenLegacyObjectIds],
  )

  const handleObjectSelect = (id: string) => {
    if (activeTool !== 'select') return
    if (cameraNavigationActive) return
    const obj = objects.find(o => o.id === id)
    if (!obj) return
    const isBuildingObj = obj.workspace === 'building'
    if (workspaceMode === 'BUILDING_MODE' && !isBuildingObj) return
    if (workspaceMode === 'SCAFFOLD_MODE' && isBuildingObj) return
    setSelectedObjectId(id)
    setSelectedBuildingEntityId(baseMassById.has(id) || hiddenLegacyObjectIds.has(id) ? id : null)
    setSelectedHostedPatternInstance(null)
  }

  const handleBuildingEntitySelect = (entityId: string) => {
    if (activeTool !== 'select') return
    if (cameraNavigationActive) return
    if (workspaceMode !== 'BUILDING_MODE') return
    setSelectedObjectId(entityId)
    setSelectedBuildingEntityId(entityId)
    setSelectedHostedPatternInstance(null)
  }

  const handleHostedPatternInstanceSelect = useCallback((patternId: string, instanceId: string) => {
    if (activeTool !== 'select') return
    if (cameraNavigationActive) return
    if (workspaceMode !== 'BUILDING_MODE') return
    setSelectedObjectId(patternId)
    setSelectedBuildingEntityId(patternId)
    setSelectedHostedPatternInstance({ patternId, instanceId })
  }, [activeTool, cameraNavigationActive, setSelectedBuildingEntityId, setSelectedHostedPatternInstance, setSelectedObjectId, workspaceMode])

  const patchHostedPatternInstanceOverride = useCallback((
    pattern: HostedPatternEntity,
    instanceId: string,
    patch: Partial<HostedPatternEntity['instanceOverrides'][string]>,
  ) => {
    const currentOverride = pattern.instanceOverrides[instanceId] ?? {}
    const nextOverride = {
      ...currentOverride,
      ...patch,
      ...(patch.analysis !== undefined
        ? { analysis: { ...(currentOverride.analysis ?? {}), ...(patch.analysis ?? {}) } }
        : {}),
    }
    updateBuildingEntity(pattern.id, {
      instanceOverrides: {
        ...pattern.instanceOverrides,
        [instanceId]: nextOverride,
      },
    })
  }, [updateBuildingEntity])

  const clearHostedPatternInstanceOverride = useCallback((pattern: HostedPatternEntity, instanceId: string) => {
    const nextOverrides = { ...pattern.instanceOverrides }
    delete nextOverrides[instanceId]
    updateBuildingEntity(pattern.id, {
      instanceOverrides: nextOverrides,
      skippedInstanceIds: pattern.skippedInstanceIds.filter((candidate) => candidate !== instanceId),
    })
  }, [updateBuildingEntity])

  return (
    <group>
      {showTopHostOverlay && selectedHostEntity && (
        <ActiveHostOverlay
          entity={selectedHostEntity}
          buildingEntityLookup={buildingEntityById}
          roofBaseOffsetByHostId={roofBaseOffsetByHostId}
          activeTool={activeTool}
          viewMode={viewMode}
          faceId={buildingHostedSketchIntent?.hostEntityId === selectedHostEntity.id
            ? (hostedSketchOverlayFaceId ?? undefined)
            : undefined}
          clippingPlanes={clippingPlanes}
        />
      )}

      {polygonEntities.map((entity) => (
        <PolygonObject
          key={entity.id}
          entity={entity}
          isSelected={selectedObjectId === entity.id || selectedBuildingEntityId === entity.id}
          onSelect={buildingSelectionEnabled ? () => handleBuildingEntitySelect(entity.id) : undefined}
          clippingPlanes={clippingPlanes}
        />
      ))}

      {roofEntities.map((roof) => {
        const host = buildingEntityById.get(roof.host.entityId) ?? null
        if (!host || (!isBaseMassEntity(host) && !isHostedRectEntity(host))) return null
        return (
          <RoofObject
            key={roof.id}
            roof={roof}
            host={host}
            buildingEntityLookup={buildingEntityById}
            roofBaseOffsetByHostId={roofBaseOffsetByHostId}
            isSelected={selectedObjectId === roof.id || selectedBuildingEntityId === roof.id}
            onSelect={buildingSelectionEnabled ? () => handleBuildingEntitySelect(roof.id) : undefined}
            clippingPlanes={clippingPlanes}
          />
        )
      })}

      {parapetEntities.map((parapet) => {
        const host = baseMassById.get(parapet.host.entityId)
        if (!host) return null
        return (
          <ParapetObject
            key={parapet.id}
            parapet={parapet}
            host={host}
            roofBaseOffsetFt={roofBaseOffsetByHostId.get(host.id) ?? 0}
            isSelected={selectedObjectId === parapet.id || selectedBuildingEntityId === parapet.id}
            onSelect={buildingSelectionEnabled ? () => handleBuildingEntitySelect(parapet.id) : undefined}
            clippingPlanes={clippingPlanes}
          />
        )
      })}

      {featureEntities.map((feature) => {
        const hostEntity = buildingEntityById.get(feature.host.entityId) ?? null
        if (!hostEntity || (!isBaseMassEntity(hostEntity) && !isHostedRectEntity(hostEntity))) return null
        const isSelected = selectedObjectId === feature.id || selectedBuildingEntityId === feature.id
        const baseHost = isBaseMassEntity(hostEntity) ? hostEntity : null
        const roofBaseOffsetFt = feature.kind === 'top-feature' && baseHost ? (roofBaseOffsetByHostId.get(baseHost.id) ?? 0) : 0
        return (
          <group key={feature.id}>
            <HostedFeatureObject
              feature={feature}
              buildingEntityLookup={buildingEntityById}
              roofBaseOffsetByHostId={roofBaseOffsetByHostId}
              isSelected={isSelected}
              showEditHandles={showHostedEditHandles}
              onSelect={buildingSelectionEnabled ? () => handleBuildingEntitySelect(feature.id) : undefined}
              onUpdate={updateBuildingEntity}
              clippingPlanes={clippingPlanes}
            />
            {showHostedSetbackDimensions && isSelected && feature.kind === 'top-feature' && baseHost && (
              <TopHostedSetbackDimensions
                host={baseHost}
                widthFt={feature.params.widthFt}
                depthFt={feature.params.depthFt}
                offsetUFt={feature.params.offsetUFt}
                offsetVFt={feature.params.offsetVFt}
                roofBaseOffsetFt={roofBaseOffsetFt}
                onApply={(setbackId, nextDistanceFt) => {
                  const nextPlacement = solveTopHostedPlacementForSetback({
                    host: baseHost,
                    widthFt: feature.params.widthFt,
                    depthFt: feature.params.depthFt,
                    offsetUFt: feature.params.offsetUFt,
                    offsetVFt: feature.params.offsetVFt,
                    setbackId,
                    targetDistanceFt: nextDistanceFt,
                  })
                  if (!nextPlacement) return
                  updateBuildingEntity(feature.id, {
                    params: {
                      ...feature.params,
                      offsetUFt: nextPlacement.offsetUFt,
                      offsetVFt: nextPlacement.offsetVFt,
                    },
                  })
                }}
              />
            )}
            {showHostedSetbackDimensions && isSelected && feature.kind === 'top-feature' && !baseHost && isHostedRectEntity(hostEntity) && (() => {
              const faceInfo = resolveHostedRectEntityTopFaceInfo(hostEntity, buildingEntityById, roofBaseOffsetByHostId)
              if (!faceInfo) return null
              return (
                <RectFaceHostedSetbackDimensions
                  faceInfo={faceInfo}
                  widthFt={feature.params.widthFt}
                  spanVFt={feature.params.depthFt}
                  offsetUFt={feature.params.offsetUFt}
                  offsetVFt={feature.params.offsetVFt}
                  normalLiftFt={0.08}
                  onApply={(setbackId, nextDistanceFt) => {
                    const nextPlacement = solveRectFaceHostedPlacementForSetback({
                      faceInfo,
                      widthFt: feature.params.widthFt,
                      spanVFt: feature.params.depthFt,
                      offsetUFt: feature.params.offsetUFt,
                      offsetVFt: feature.params.offsetVFt,
                      setbackId,
                      targetDistanceFt: nextDistanceFt,
                    })
                    if (!nextPlacement) return
                    updateBuildingEntity(feature.id, {
                      params: {
                        ...feature.params,
                        offsetUFt: nextPlacement.offsetUFt,
                        offsetVFt: nextPlacement.offsetVFt,
                      },
                    })
                  }}
                />
              )
            })()}
            {showHostedSetbackDimensions && isSelected && feature.kind === 'side-feature' && (baseHost || isHostedRectEntity(hostEntity)) && (() => {
              const faceInfo = baseHost
                ? getBaseMassFaceInfo(baseHost, feature.host.faceId)
                : resolveHostedRectEntityFaceInfo(hostEntity as HostedFeatureEntity | HostedProxyEntity, feature.host.faceId, buildingEntityById, roofBaseOffsetByHostId)
              if (!faceInfo) return null
              return (
                <RectFaceHostedSetbackDimensions
                  faceInfo={faceInfo}
                  widthFt={feature.params.widthFt}
                  spanVFt={feature.params.heightFt}
                  offsetUFt={feature.params.offsetUFt}
                  offsetVFt={feature.params.offsetVFt}
                  normalLiftFt={0.08}
                  onApply={(setbackId, nextDistanceFt) => {
                    const nextPlacement = solveRectFaceHostedPlacementForSetback({
                      faceInfo,
                      widthFt: feature.params.widthFt,
                      spanVFt: feature.params.heightFt,
                      offsetUFt: feature.params.offsetUFt,
                      offsetVFt: feature.params.offsetVFt,
                      setbackId,
                      targetDistanceFt: nextDistanceFt,
                    })
                    if (!nextPlacement) return
                    updateBuildingEntity(feature.id, {
                      params: {
                        ...feature.params,
                        offsetUFt: nextPlacement.offsetUFt,
                        offsetVFt: nextPlacement.offsetVFt,
                      },
                    })
                  }}
                />
              )
            })()}
          </group>
        )
      })}

      {proxyEntities.map((proxy) => {
        const hostEntity = buildingEntityById.get(proxy.host.entityId) ?? null
        if (!hostEntity || (!isBaseMassEntity(hostEntity) && !isHostedRectEntity(hostEntity))) return null
        const isSelected = selectedObjectId === proxy.id || selectedBuildingEntityId === proxy.id
        const baseHost = isBaseMassEntity(hostEntity) ? hostEntity : null
        const roofBaseOffsetFt = proxy.host.faceId === 'top' && baseHost ? (roofBaseOffsetByHostId.get(baseHost.id) ?? 0) : 0
        return (
          <group key={proxy.id}>
            <ProxyFeatureObject
              proxy={proxy}
              buildingEntityLookup={buildingEntityById}
              roofBaseOffsetByHostId={roofBaseOffsetByHostId}
              isSelected={isSelected}
              showEditHandles={showHostedEditHandles}
              onSelect={buildingSelectionEnabled ? () => handleBuildingEntitySelect(proxy.id) : undefined}
              onUpdate={updateBuildingEntity}
              clippingPlanes={clippingPlanes}
            />
            {showHostedSetbackDimensions && isSelected && proxy.host.faceId === 'top' && baseHost && (
              <TopHostedSetbackDimensions
                host={baseHost}
                widthFt={proxy.params.widthFt}
                depthFt={proxy.params.depthFt}
                offsetUFt={proxy.params.offsetUFt}
                offsetVFt={proxy.params.offsetVFt}
                roofBaseOffsetFt={roofBaseOffsetFt}
                onApply={(setbackId, nextDistanceFt) => {
                  const nextPlacement = solveTopHostedPlacementForSetback({
                    host: baseHost,
                    widthFt: proxy.params.widthFt,
                    depthFt: proxy.params.depthFt,
                    offsetUFt: proxy.params.offsetUFt,
                    offsetVFt: proxy.params.offsetVFt,
                    setbackId,
                    targetDistanceFt: nextDistanceFt,
                  })
                  if (!nextPlacement) return
                  updateBuildingEntity(proxy.id, {
                    params: {
                      ...proxy.params,
                      offsetUFt: nextPlacement.offsetUFt,
                      offsetVFt: nextPlacement.offsetVFt,
                    },
                  })
                }}
              />
            )}
            {showHostedSetbackDimensions && isSelected && proxy.host.faceId === 'top' && !baseHost && isHostedRectEntity(hostEntity) && (() => {
              const faceInfo = resolveHostedRectEntityTopFaceInfo(hostEntity, buildingEntityById, roofBaseOffsetByHostId)
              if (!faceInfo) return null
              return (
                <RectFaceHostedSetbackDimensions
                  faceInfo={faceInfo}
                  widthFt={proxy.params.widthFt}
                  spanVFt={proxy.params.depthFt}
                  offsetUFt={proxy.params.offsetUFt}
                  offsetVFt={proxy.params.offsetVFt}
                  normalLiftFt={0.08}
                  onApply={(setbackId, nextDistanceFt) => {
                    const nextPlacement = solveRectFaceHostedPlacementForSetback({
                      faceInfo,
                      widthFt: proxy.params.widthFt,
                      spanVFt: proxy.params.depthFt,
                      offsetUFt: proxy.params.offsetUFt,
                      offsetVFt: proxy.params.offsetVFt,
                      setbackId,
                      targetDistanceFt: nextDistanceFt,
                    })
                    if (!nextPlacement) return
                    updateBuildingEntity(proxy.id, {
                      params: {
                        ...proxy.params,
                        offsetUFt: nextPlacement.offsetUFt,
                        offsetVFt: nextPlacement.offsetVFt,
                      },
                    })
                  }}
                />
              )
            })()}
            {showHostedSetbackDimensions && isSelected && proxy.host.faceId !== 'top' && (baseHost || isHostedRectEntity(hostEntity)) && (() => {
              const faceInfo = baseHost
                ? getBaseMassFaceInfo(baseHost, proxy.host.faceId)
                : resolveHostedRectEntityFaceInfo(hostEntity as HostedFeatureEntity | HostedProxyEntity, proxy.host.faceId, buildingEntityById, roofBaseOffsetByHostId)
              if (!faceInfo) return null
              return (
                <RectFaceHostedSetbackDimensions
                  faceInfo={faceInfo}
                  widthFt={proxy.params.widthFt}
                  spanVFt={proxy.params.heightFt}
                  offsetUFt={proxy.params.offsetUFt}
                  offsetVFt={proxy.params.offsetVFt}
                  normalLiftFt={0.08}
                  onApply={(setbackId, nextDistanceFt) => {
                    const nextPlacement = solveRectFaceHostedPlacementForSetback({
                      faceInfo,
                      widthFt: proxy.params.widthFt,
                      spanVFt: proxy.params.heightFt,
                      offsetUFt: proxy.params.offsetUFt,
                      offsetVFt: proxy.params.offsetVFt,
                      setbackId,
                      targetDistanceFt: nextDistanceFt,
                    })
                    if (!nextPlacement) return
                    updateBuildingEntity(proxy.id, {
                      params: {
                        ...proxy.params,
                        offsetUFt: nextPlacement.offsetUFt,
                        offsetVFt: nextPlacement.offsetVFt,
                      },
                    })
                  }}
                />
              )
            })()}
          </group>
        )
      })}

      {patternEntities.map((pattern) => {
        const host = baseMassById.get(pattern.host.entityId)
        if (!host) return null
        const roofBaseOffsetFt = pattern.host.faceId === 'top' ? (roofBaseOffsetByHostId.get(host.id) ?? 0) : 0
        const resolvedInstances = resolveHostedPatternInstances(pattern, host)
        const isPatternSelected = selectedObjectId === pattern.id || selectedBuildingEntityId === pattern.id
        const selectedPatternInstanceId = selectedHostedPatternInstance?.patternId === pattern.id
          ? selectedHostedPatternInstance.instanceId
          : null
        const canShowPatternEnvelopeDimensions = true
        return (
          <group key={pattern.id}>
            {resolvedInstances.map((instance) => (
              <group key={instance.instanceId}>
                <HostedPatternInstanceObject
                  instance={instance}
                  host={host}
                  roofBaseOffsetFt={roofBaseOffsetFt}
                  patternColor={pattern.color}
                  pattern={pattern}
                  isPatternSelected={isPatternSelected}
                  isInstanceSelected={selectedPatternInstanceId === instance.instanceId}
                  onSelect={buildingSelectionEnabled ? () => handleHostedPatternInstanceSelect(pattern.id, instance.instanceId) : undefined}
                  clippingPlanes={clippingPlanes}
                />
                {showHostedSetbackDimensions && selectedPatternInstanceId === instance.instanceId && instance.faceId === 'top' && (
                  <TopHostedSetbackDimensions
                    host={host}
                    widthFt={instance.widthFt}
                    depthFt={instance.depthFt}
                    offsetUFt={instance.offsetUFt}
                    offsetVFt={instance.offsetVFt}
                    roofBaseOffsetFt={roofBaseOffsetFt}
                    onApply={(setbackId, nextDistanceFt) => {
                      const nextPlacement = solveTopHostedPlacementForSetback({
                        host,
                        widthFt: instance.widthFt,
                        depthFt: instance.depthFt,
                        offsetUFt: instance.offsetUFt,
                        offsetVFt: instance.offsetVFt,
                        setbackId,
                        targetDistanceFt: nextDistanceFt,
                      })
                      if (!nextPlacement) return
                      patchHostedPatternInstanceOverride(pattern, instance.instanceId, {
                        offsetUFt: nextPlacement.offsetUFt,
                        offsetVFt: nextPlacement.offsetVFt,
                      })
                    }}
                  />
                )}
                {showHostedSetbackDimensions && selectedPatternInstanceId === instance.instanceId && instance.faceId !== 'top' && (() => {
                  const faceInfo = getBaseMassFaceInfo(host, instance.faceId)
                  if (!faceInfo) return null
                  return (
                    <RectFaceHostedSetbackDimensions
                      faceInfo={faceInfo}
                      widthFt={instance.widthFt}
                      spanVFt={instance.heightFt}
                      offsetUFt={instance.offsetUFt}
                      offsetVFt={instance.offsetVFt}
                      normalLiftFt={0.08}
                      onApply={(setbackId, nextDistanceFt) => {
                        const nextPlacement = solveRectFaceHostedPlacementForSetback({
                          faceInfo,
                          widthFt: instance.widthFt,
                          spanVFt: instance.heightFt,
                          offsetUFt: instance.offsetUFt,
                          offsetVFt: instance.offsetVFt,
                          setbackId,
                          targetDistanceFt: nextDistanceFt,
                        })
                        if (!nextPlacement) return
                        patchHostedPatternInstanceOverride(pattern, instance.instanceId, {
                          offsetUFt: nextPlacement.offsetUFt,
                          offsetVFt: nextPlacement.offsetVFt,
                        })
                      }}
                    />
                  )
                })()}
              </group>
            ))}
            {showHostedSetbackDimensions && isPatternSelected && !selectedPatternInstanceId && canShowPatternEnvelopeDimensions && (
              <>
                <HostedPatternSetbackDimensions
                  pattern={pattern}
                  host={host}
                  roofBaseOffsetFt={roofBaseOffsetFt}
                  resolvedInstances={resolvedInstances}
                  onApply={(setbackId, nextDistanceFt) => {
                    const axisKey = setbackId === 'left' || setbackId === 'right' ? 'distributionU' : 'distributionV'
                    const fieldKey = setbackId === 'left' || setbackId === 'bottom' ? 'startSetbackFt' : 'endSetbackFt'
                    const nextSetbackFt = solveHostedPatternDistributionSetback({
                      pattern,
                      host,
                      setbackId,
                      targetDistanceFt: nextDistanceFt,
                    })
                    if (nextSetbackFt == null) return
                    updateBuildingEntity(pattern.id, {
                      params: {
                        ...pattern.params,
                        [axisKey]: {
                          ...pattern.params[axisKey],
                          [fieldKey]: nextSetbackFt,
                        },
                      },
                    })
                  }}
                />
                <HostedPatternRowGapDimension
                  pattern={pattern}
                  host={host}
                  roofBaseOffsetFt={roofBaseOffsetFt}
                  resolvedInstances={resolvedInstances}
                  onApply={(nextGapFt) => {
                    updateBuildingEntity(pattern.id, {
                      params: {
                        ...pattern.params,
                        distributionV: {
                          ...pattern.params.distributionV,
                          mode: 'spacing',
                          spacingFt: nextGapFt,
                        },
                      },
                    })
                  }}
                />
              </>
            )}
          </group>
        )
      })}

      {previewPatternEntity && (() => {
        const host = baseMassById.get(previewPatternEntity.host.entityId)
        if (!host) return null
        const roofBaseOffsetFt = previewPatternEntity.host.faceId === 'top' ? (roofBaseOffsetByHostId.get(host.id) ?? 0) : 0
        const resolvedInstances = resolveHostedPatternInstances(previewPatternEntity, host)
        return (
          <group key={previewPatternEntity.id}>
            {resolvedInstances.map((instance) => (
              <HostedPatternInstanceObject
                key={instance.instanceId}
                instance={instance}
                host={host}
                roofBaseOffsetFt={roofBaseOffsetFt}
                patternColor={previewPatternEntity.color}
                pattern={previewPatternEntity}
                isPatternSelected={false}
                isInstanceSelected={false}
                isPreview
                clippingPlanes={clippingPlanes}
              />
            ))}
          </group>
        )
      })()}

      {visibleObjects.map((obj) => {
        const isBuildingObj = obj.workspace === 'building'
        const selectable =
          (buildingSelectionEnabled && isBuildingObj) ||
          (scaffoldSelectionEnabled && !isBuildingObj)
        const props = {
          object: obj,
          isSelected: selectable && selectedObjectId === obj.id,
          onSelect: selectable ? () => handleObjectSelect(obj.id) : undefined,
          clippingPlanes,
        }
        switch (obj.type) {
          case 'box':
            return <BoxObject key={obj.id} {...props} />
          case 'circle':
            return <CircleObject key={obj.id} {...props} />
          case 'ring':
            return <RingObjectExtruded key={obj.id} {...props} />
          default:
            return null
        }
      })}
    </group>
  )
}
