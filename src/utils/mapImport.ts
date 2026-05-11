import polygonClipping from 'polygon-clipping'
import type { MultiPolygon, Polygon } from 'geojson'
import {
  DEFAULT_BUILDING_ANALYSIS_FLAGS,
  getBaseMassLocalFootprintBounds,
  isBaseMassEntity,
  type BaseMassEntity,
  type BuildingEntity,
  type BuildingPoint2,
} from '../types/buildingEntities'

const EARTH_RADIUS_M = 6378137
const FEET_PER_METER = 3.280839895
const DEFAULT_HEIGHT_FT = 25
const INSERT_PADDING_FT = 12

export const DEFAULT_MAP_IMPORT_VIEW = {
  lng: -79.9959,
  lat: 40.4406,
  zoom: 16.2,
} as const

type LngLatPair = [number, number]
type ClippingPair = [number, number]
type ClippingRing = ClippingPair[]
type ClippingPolygon = ClippingRing[]
type ClippingMultiPolygon = ClippingPolygon[]

type PolygonFeatureLike = {
  geometry: Polygon | MultiPolygon
  properties?: Record<string, unknown> | null
}

type Point2 = { x: number; y: number }

export type ImportedMapFootprint = {
  outerRing: LngLatPair[]
  holes: LngLatPair[][]
  sourceFeatureCount: number
  suggestedHeightFt: number
  areaSqFt: number
  hasInteriorHoles: boolean
}

export type NormalizedImportedFootprint = {
  localPoints: BuildingPoint2[]
  widthFt: number
  depthFt: number
  areaSqFt: number
  hasInteriorHoles: boolean
}

function closeRing(ring: LngLatPair[]): ClippingRing {
  if (ring.length === 0) return []
  const normalized = ring.map(([lng, lat]) => [Number(lng), Number(lat)] as ClippingPair)
  const first = normalized[0]!
  const last = normalized[normalized.length - 1]!
  if (Math.abs(first[0] - last[0]) <= 1e-9 && Math.abs(first[1] - last[1]) <= 1e-9) return normalized
  return [...normalized, [first[0], first[1]]]
}

function stripClosingPair(ring: ClippingRing): LngLatPair[] {
  if (ring.length === 0) return []
  const points = ring.map(([lng, lat]) => [Number(lng), Number(lat)] as LngLatPair)
  if (points.length <= 1) return points
  const first = points[0]!
  const last = points[points.length - 1]!
  if (Math.abs(first[0] - last[0]) <= 1e-9 && Math.abs(first[1] - last[1]) <= 1e-9) {
    return points.slice(0, -1)
  }
  return points
}

function toClippingGeom(feature: PolygonFeatureLike): ClippingPolygon | ClippingMultiPolygon | null {
  if (feature.geometry.type === 'Polygon') {
    return feature.geometry.coordinates.map(ring => closeRing(ring as LngLatPair[]))
  }
  if (feature.geometry.type === 'MultiPolygon') {
    return feature.geometry.coordinates.map(polygon => polygon.map(ring => closeRing(ring as LngLatPair[])))
  }
  return null
}

function pointInRing(ring: LngLatPair[], point: LngLatPair): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    const intersects = (a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / ((b[1] - a[1]) || 1e-9) + a[0]
    if (intersects) inside = !inside
  }
  return inside
}

function pointInPolygonWithHoles(polygon: ClippingPolygon, point: LngLatPair): boolean {
  const outer = stripClosingPair(polygon[0] ?? [])
  if (outer.length < 3 || !pointInRing(outer, point)) return false
  for (let i = 1; i < polygon.length; i += 1) {
    const hole = stripClosingPair(polygon[i] ?? [])
    if (hole.length >= 3 && pointInRing(hole, point)) return false
  }
  return true
}

function averageLngLat(points: LngLatPair[]): LngLatPair {
  if (points.length === 0) return [DEFAULT_MAP_IMPORT_VIEW.lng, DEFAULT_MAP_IMPORT_VIEW.lat]
  let lng = 0
  let lat = 0
  for (const point of points) {
    lng += point[0]
    lat += point[1]
  }
  return [lng / points.length, lat / points.length]
}

function projectLngLatToFeet(point: LngLatPair, reference: LngLatPair): Point2 {
  const lngRad = ((point[0] - reference[0]) * Math.PI) / 180
  const latRad = ((point[1] - reference[1]) * Math.PI) / 180
  const referenceLatCos = Math.cos((reference[1] * Math.PI) / 180)
  return {
    x: EARTH_RADIUS_M * lngRad * referenceLatCos * FEET_PER_METER,
    y: EARTH_RADIUS_M * latRad * FEET_PER_METER,
  }
}

function computeSignedArea(points: Point2[]): number {
  if (points.length < 3) return 0
  let twiceArea = 0
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i]!
    const next = points[(i + 1) % points.length]!
    twiceArea += current.x * next.y - next.x * current.y
  }
  return twiceArea / 2
}

function computeAreaSqFt(points: Point2[]): number {
  return Math.abs(computeSignedArea(points))
}

function choosePolygonForClick(multiPolygon: ClippingMultiPolygon, clickLngLat: LngLatPair): ClippingPolygon | null {
  if (multiPolygon.length === 0) return null
  const directHit = multiPolygon.find(polygon => pointInPolygonWithHoles(polygon, clickLngLat))
  if (directHit) return directHit
  let bestPolygon = multiPolygon[0]!
  let bestArea = 0
  for (const polygon of multiPolygon) {
    const outer = stripClosingPair(polygon[0] ?? [])
    const reference = averageLngLat(outer)
    const projected = outer.map(point => projectLngLatToFeet(point, reference))
    const area = computeAreaSqFt(projected)
    if (area > bestArea) {
      bestArea = area
      bestPolygon = polygon
    }
  }
  return bestPolygon
}

function parseHeightFt(features: PolygonFeatureLike[]): number {
  const parsedHeightsFt = features
    .map(feature => {
      const rawHeight = feature.properties?.height
      const numeric = typeof rawHeight === 'number' ? rawHeight : Number(rawHeight)
      if (!Number.isFinite(numeric) || numeric <= 0) return null
      return numeric * FEET_PER_METER
    })
    .filter((value): value is number => value !== null)
  if (parsedHeightsFt.length === 0) return DEFAULT_HEIGHT_FT
  return Math.max(8, Math.round(Math.max(...parsedHeightsFt)))
}

function dedupeSequentialPoints(points: Point2[]): Point2[] {
  const deduped: Point2[] = []
  for (const point of points) {
    const last = deduped[deduped.length - 1]
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < 0.01) continue
    deduped.push(point)
  }
  if (deduped.length > 2) {
    const first = deduped[0]!
    const last = deduped[deduped.length - 1]!
    if (Math.hypot(first.x - last.x, first.y - last.y) < 0.01) deduped.pop()
  }
  return deduped
}

function pruneCollinearPoints(points: Point2[]): Point2[] {
  if (points.length <= 3) return points
  const pruned: Point2[] = []
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[(i - 1 + points.length) % points.length]!
    const current = points[i]!
    const next = points[(i + 1) % points.length]!
    const abx = current.x - prev.x
    const aby = current.y - prev.y
    const bcx = next.x - current.x
    const bcy = next.y - current.y
    const cross = Math.abs(abx * bcy - aby * bcx)
    const dot = abx * bcx + aby * bcy
    if (cross <= 0.01 && dot >= 0) continue
    pruned.push(current)
  }
  return pruned.length >= 3 ? pruned : points
}

function rotatePoint(point: Point2, angleRad: number): Point2 {
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }
}

function computeDominantOrthogonalAngle(points: Point2[]): number {
  if (points.length < 2) return 0
  let sumX = 0
  let sumY = 0
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i]!
    const next = points[(i + 1) % points.length]!
    const dx = next.x - current.x
    const dy = next.y - current.y
    const length = Math.hypot(dx, dy)
    if (length < 0.5) continue
    const angle = Math.atan2(dy, dx)
    sumX += length * Math.cos(4 * angle)
    sumY += length * Math.sin(4 * angle)
  }
  if (Math.abs(sumX) < 1e-6 && Math.abs(sumY) < 1e-6) return 0
  const dominant = 0.25 * Math.atan2(sumY, sumX)
  return Number.isFinite(dominant) ? dominant : 0
}

function ensureCounterClockwise(points: Point2[]): Point2[] {
  return computeSignedArea(points) < 0 ? [...points].reverse() : points
}

function roundPoint(point: Point2): BuildingPoint2 {
  return {
    x: Math.round(point.x * 100) / 100,
    y: Math.round(point.y * 100) / 100,
  }
}

function getApproximateHalfSpanX(entity: BaseMassEntity): number {
  if (entity.params.shape === 'circle' || entity.params.shape === 'ring') return entity.params.radiusFt
  const bounds = getBaseMassLocalFootprintBounds(entity)
  const halfWidth = Math.max(0.1, (bounds.maxX - bounds.minX) / 2)
  const halfDepth = Math.max(0.1, (bounds.maxY - bounds.minY) / 2)
  const angle = entity.rotationZRad ?? 0
  return Math.abs(Math.cos(angle)) * halfWidth + Math.abs(Math.sin(angle)) * halfDepth
}

export function resolveImportedFootprintFromFeatures(
  features: PolygonFeatureLike[],
  clickLngLat: LngLatPair,
): ImportedMapFootprint | null {
  const clippingGeometries = features
    .map(toClippingGeom)
    .filter((geometry): geometry is ClippingPolygon | ClippingMultiPolygon => geometry !== null)
  if (clippingGeometries.length === 0) return null
  const merged = polygonClipping.union(clippingGeometries[0], ...clippingGeometries.slice(1)) as ClippingMultiPolygon
  if (!Array.isArray(merged) || merged.length === 0) return null
  const selectedPolygon = choosePolygonForClick(merged, clickLngLat)
  if (!selectedPolygon || selectedPolygon.length === 0) return null
  const outerRing = stripClosingPair(selectedPolygon[0] ?? [])
  if (outerRing.length < 3) return null
  const holes = selectedPolygon
    .slice(1)
    .map(stripClosingPair)
    .filter(hole => hole.length >= 3)
  const reference = averageLngLat(outerRing)
  const projected = outerRing.map(point => projectLngLatToFeet(point, reference))
  return {
    outerRing,
    holes,
    sourceFeatureCount: features.length,
    suggestedHeightFt: parseHeightFt(features),
    areaSqFt: Math.round(computeAreaSqFt(projected)),
    hasInteriorHoles: holes.length > 0,
  }
}

export function normalizeImportedFootprint(
  footprint: ImportedMapFootprint,
): NormalizedImportedFootprint | null {
  if (footprint.outerRing.length < 3) return null
  const reference = averageLngLat(footprint.outerRing)
  const projected = dedupeSequentialPoints(
    footprint.outerRing.map(point => projectLngLatToFeet(point, reference)),
  )
  if (projected.length < 3) return null
  const dominantAngle = computeDominantOrthogonalAngle(projected)
  const rotated = projected.map(point => rotatePoint(point, -dominantAngle))
  const cleaned = ensureCounterClockwise(pruneCollinearPoints(dedupeSequentialPoints(rotated)))
  if (cleaned.length < 3) return null
  const xs = cleaned.map(point => point.x)
  const ys = cleaned.map(point => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const localPoints = cleaned.map(point => roundPoint({
    x: point.x - centerX,
    y: point.y - centerY,
  }))
  return {
    localPoints,
    widthFt: Math.max(1, Math.round((maxX - minX) * 100) / 100),
    depthFt: Math.max(1, Math.round((maxY - minY) * 100) / 100),
    areaSqFt: Math.round(computeAreaSqFt(cleaned)),
    hasInteriorHoles: footprint.hasInteriorHoles,
  }
}

export function resolveMapImportPlacementCenter(
  buildingEntities: BuildingEntity[],
  normalized: NormalizedImportedFootprint,
): { x: number; y: number } {
  const baseMasses = buildingEntities.filter(isBaseMassEntity)
  if (baseMasses.length === 0) return { x: 0, y: 0 }
  let maxX = -Infinity
  let yAccumulator = 0
  for (const entity of baseMasses) {
    maxX = Math.max(maxX, entity.position.x + getApproximateHalfSpanX(entity))
    yAccumulator += entity.position.y
  }
  const averageY = yAccumulator / baseMasses.length
  return {
    x: maxX + normalized.widthFt / 2 + INSERT_PADDING_FT,
    y: averageY,
  }
}

export function createImportedPolygonMassEntity(params: {
  id: string
  footprint: ImportedMapFootprint
  heightFt: number
  buildingEntities: BuildingEntity[]
  color?: string
  now?: number
}): BaseMassEntity | null {
  const normalized = normalizeImportedFootprint(params.footprint)
  if (!normalized || normalized.localPoints.length < 3) return null
  const placement = resolveMapImportPlacementCenter(params.buildingEntities, normalized)
  const now = params.now ?? Date.now()
  return {
    id: params.id,
    category: 'base-mass',
    kind: 'polygon-mass',
    host: null,
    position: {
      x: placement.x,
      y: placement.y,
      z: Math.max(0.1, params.heightFt) / 2,
    },
    rotationZRad: 0,
    color: params.color ?? '#d7d7d7',
    params: {
      shape: 'polygon',
      points: normalized.localPoints,
      heightFt: Math.max(0.1, params.heightFt),
    },
    analysis: { ...DEFAULT_BUILDING_ANALYSIS_FLAGS },
    children: [],
    createdAt: now,
    updatedAt: now,
  }
}
