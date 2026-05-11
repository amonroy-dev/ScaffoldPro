import * as THREE from 'three'

export type BuildingEntityId = string

export type BuildingEntityKind =
  | 'rect-mass'
  | 'polygon-mass'
  | 'circle-mass'
  | 'ring-mass'
  | 'flat-roof'
  | 'shed-roof'
  | 'gable-roof'
  | 'hip-roof'
  | 'cone-roof'
  | 'dome-roof'
  | 'parapet'
  | 'top-feature'
  | 'side-feature'
  | 'proxy-feature'
  | 'hosted-pattern'

export type BuildingHostKind =
  | 'world'
  | 'top-face'
  | 'side-face'
  | 'perimeter'
  | 'edge-chain'

export type BuildingAnalysisFlags = {
  blocksScaffold: boolean
  supportsScaffold: boolean
  countsAsRoof: boolean
  countsAsPerimeter: boolean
}

export const DEFAULT_BUILDING_ANALYSIS_FLAGS: BuildingAnalysisFlags = {
  blocksScaffold: true,
  supportsScaffold: false,
  countsAsRoof: false,
  countsAsPerimeter: true,
}

export type BuildingHostRef = {
  entityId: BuildingEntityId
  hostKind: Exclude<BuildingHostKind, 'world'>
  faceId?: string
  edgeIds?: string[]
}

export type BaseMassFaceId = 'top' | 'front' | 'back' | 'left' | 'right'

export type BaseMassFaceInfo = {
  faceId: BaseMassFaceId
  hostKind: 'top-face' | 'side-face'
  center: { x: number; y: number; z: number }
  normal: { x: number; y: number; z: number }
  axisU: { x: number; y: number; z: number }
  axisV: { x: number; y: number; z: number }
  spanU: number
  spanV: number
}

export type FaceSketchRect = {
  faceId: BaseMassFaceId
  center: { x: number; y: number; z: number }
  centerU: number
  centerV: number
  spanU: number
  spanV: number
  minU: number
  maxU: number
  minV: number
  maxV: number
}

export type BuildingPoint2 = {
  x: number
  y: number
}

export type TopHostedSetbackId = 'left' | 'bottom' | 'right' | 'top'

export type HostedFaceRayHit = {
  faceId: BaseMassFaceId
  hostKind: 'top-face' | 'side-face'
  point: { x: number; y: number; z: number }
  distance: number
}

export type RectMassParams = {
  shape: 'rect'
  widthFt: number
  depthFt: number
  heightFt: number
}

export type PolygonMassParams = {
  shape: 'polygon'
  points: BuildingPoint2[]
  heightFt: number
}

export type CircleMassParams = {
  shape: 'circle'
  radiusFt: number
  heightFt: number
}

export type RingMassParams = {
  shape: 'ring'
  radiusFt: number
  innerRadiusFt: number
  heightFt: number
}

export type BaseMassParams =
  | RectMassParams
  | PolygonMassParams
  | CircleMassParams
  | RingMassParams

export type BaseMassEntity = {
  id: BuildingEntityId
  category: 'base-mass'
  kind: 'rect-mass' | 'polygon-mass' | 'circle-mass' | 'ring-mass'
  host: null | BuildingHostRef
  position: { x: number; y: number; z: number }
  rotationZRad: number
  color: string
  params: BaseMassParams
  analysis: BuildingAnalysisFlags
  children: BuildingEntityId[]
  createdAt: number
  updatedAt: number
}

export type RoofDirection = 'x' | 'y'
export type ParapetRectEdgeId = 'front' | 'back' | 'left' | 'right'
export type ParapetArcEdgeId = 'arc-front' | 'arc-right' | 'arc-back' | 'arc-left'
export type ParapetPolygonEdgeId = `poly-${number}`
export type ParapetEdgeId = ParapetRectEdgeId | ParapetArcEdgeId | ParapetPolygonEdgeId
export type ParapetOffsetMode = 'inside' | 'centered' | 'outside'
export type SideFeatureFaceId = Exclude<BaseMassFaceId, 'top'>
export type HostedFeaturePreset =
  | 'top-box'
  | 'roof-unit'
  | 'penthouse'
  | 'balcony'
  | 'canopy'
  | 'screen'
  | 'side-box'
export type ProxyFeatureMode = 'add' | 'cut'
export type HostedPatternContentType = 'feature' | 'volume' | 'cut-volume'
export type HostedPatternAxisMode = 'count' | 'spacing' | 'fit'

export type HostedRoofKind =
  | 'flat-roof'
  | 'shed-roof'
  | 'gable-roof'
  | 'hip-roof'
  | 'cone-roof'
  | 'dome-roof'

export type HostedRoofParams = {
  thicknessFt: number
  overhangFt: number
  riseFt: number
  ridgeDirection: RoofDirection
}

export type HostedRoofEntity = {
  id: BuildingEntityId
  category: 'roof'
  kind: HostedRoofKind
  host: BuildingHostRef & { hostKind: 'top-face' }
  color: string
  params: HostedRoofParams
  analysis: BuildingAnalysisFlags
  children: BuildingEntityId[]
  createdAt: number
  updatedAt: number
}

export type HostedParapetParams = {
  heightFt: number
  thicknessFt: number
  offsetMode: ParapetOffsetMode
  edgeIds: ParapetEdgeId[]
}

export type HostedParapetEntity = {
  id: BuildingEntityId
  category: 'parapet'
  kind: 'parapet'
  host: (BuildingHostRef & { hostKind: 'perimeter' | 'edge-chain' }) | (BuildingHostRef & { hostKind: 'top-face' })
  color: string
  params: HostedParapetParams
  analysis: BuildingAnalysisFlags
  children: BuildingEntityId[]
  createdAt: number
  updatedAt: number
}

export type HostedFeatureParams = {
  preset: HostedFeaturePreset
  widthFt: number
  depthFt: number
  heightFt: number
  offsetUFt: number
  offsetVFt: number
  balconyHandrailEnabled?: boolean
  balconyHandrailHeightFt?: number
  balconyHandrailInsetFt?: number
  balconyHandrailThicknessFt?: number
}

export type HostedTopFeatureEntity = {
  id: BuildingEntityId
  category: 'feature'
  kind: 'top-feature'
  host: BuildingHostRef & { hostKind: 'top-face'; faceId: 'top' }
  color: string
  params: HostedFeatureParams
  analysis: BuildingAnalysisFlags
  children: BuildingEntityId[]
  createdAt: number
  updatedAt: number
}

export type HostedSideFeatureEntity = {
  id: BuildingEntityId
  category: 'feature'
  kind: 'side-feature'
  host: BuildingHostRef & { hostKind: 'side-face'; faceId: SideFeatureFaceId }
  color: string
  params: HostedFeatureParams
  analysis: BuildingAnalysisFlags
  children: BuildingEntityId[]
  createdAt: number
  updatedAt: number
}

export type HostedFeatureEntity = HostedTopFeatureEntity | HostedSideFeatureEntity

export type HostedProxyParams = {
  mode: ProxyFeatureMode
  widthFt: number
  depthFt: number
  heightFt: number
  offsetUFt: number
  offsetVFt: number
}

export type HostedProxyEntity = {
  id: BuildingEntityId
  category: 'proxy'
  kind: 'proxy-feature'
  host: BuildingHostRef & { hostKind: 'top-face' | 'side-face'; faceId: BaseMassFaceId }
  color: string
  params: HostedProxyParams
  analysis: BuildingAnalysisFlags
  children: BuildingEntityId[]
  createdAt: number
  updatedAt: number
}

export type HostedPatternAxisDistribution = {
  mode: HostedPatternAxisMode
  count: number
  spacingFt: number
  startSetbackFt: number
  endSetbackFt: number
  centered: boolean
}

export type HostedPatternWrapMode = 'single-face' | 'all-walls' | 'selected-walls'
export type HostedPatternCornerBehavior = 'continuous' | 'restart-each-face' | 'align-to-corners'

export type HostedPatternInstanceOverride = {
  hidden?: boolean
  detachedEntityId?: BuildingEntityId
  offsetUFt?: number
  offsetVFt?: number
  widthFt?: number
  depthFt?: number
  heightFt?: number
  analysis?: Partial<BuildingAnalysisFlags>
}

export type HostedPatternParams = {
  contentType: HostedPatternContentType
  featurePreset?: HostedFeaturePreset
  widthFt: number
  depthFt: number
  heightFt: number
  balconyHandrailEnabled?: boolean
  balconyHandrailHeightFt?: number
  balconyHandrailInsetFt?: number
  balconyHandrailThicknessFt?: number
  wrapMode?: HostedPatternWrapMode
  cornerBehavior?: HostedPatternCornerBehavior
  wallFaceIds?: SideFeatureFaceId[]
  distributionU: HostedPatternAxisDistribution
  distributionV: HostedPatternAxisDistribution
}

export type HostedPatternEntity = {
  id: BuildingEntityId
  category: 'pattern'
  kind: 'hosted-pattern'
  host: BuildingHostRef & { hostKind: 'top-face' | 'side-face'; faceId: BaseMassFaceId }
  color: string
  params: HostedPatternParams
  analysis: BuildingAnalysisFlags
  skippedInstanceIds: string[]
  instanceOverrides: Record<string, HostedPatternInstanceOverride>
  children: BuildingEntityId[]
  createdAt: number
  updatedAt: number
}

export type ResolvedHostedPatternInstance = {
  instanceId: string
  patternId: BuildingEntityId
  contentType: HostedPatternContentType
  featurePreset?: HostedFeaturePreset
  faceId: BaseMassFaceId
  widthFt: number
  depthFt: number
  heightFt: number
  offsetUFt: number
  offsetVFt: number
  globalCenterUFt: number
  globalMinUFt: number
  globalMaxUFt: number
  analysis: BuildingAnalysisFlags
  hidden: boolean
}

export type BuildingEntity =
  | BaseMassEntity
  | HostedRoofEntity
  | HostedParapetEntity
  | HostedFeatureEntity
  | HostedProxyEntity
  | HostedPatternEntity

export function isBaseMassEntity(entity: BuildingEntity | null | undefined): entity is BaseMassEntity {
  return Boolean(entity && entity.category === 'base-mass')
}

export function isRoofEntity(entity: BuildingEntity | null | undefined): entity is HostedRoofEntity {
  return Boolean(entity && entity.category === 'roof')
}

export function isParapetEntity(entity: BuildingEntity | null | undefined): entity is HostedParapetEntity {
  return Boolean(entity && entity.category === 'parapet')
}

export function isFeatureEntity(entity: BuildingEntity | null | undefined): entity is HostedFeatureEntity {
  return Boolean(entity && entity.category === 'feature')
}

export function isProxyEntity(entity: BuildingEntity | null | undefined): entity is HostedProxyEntity {
  return Boolean(entity && entity.category === 'proxy')
}

export function isHostedRectEntity(
  entity: BuildingEntity | null | undefined,
): entity is HostedFeatureEntity | HostedProxyEntity {
  return Boolean(entity && (entity.category === 'feature' || entity.category === 'proxy'))
}

export function isPatternEntity(entity: BuildingEntity | null | undefined): entity is HostedPatternEntity {
  return Boolean(entity && entity.category === 'pattern')
}

export function isTopFeatureEntity(entity: BuildingEntity | null | undefined): entity is HostedTopFeatureEntity {
  return Boolean(entity && entity.category === 'feature' && entity.kind === 'top-feature')
}

export function isSideFeatureEntity(entity: BuildingEntity | null | undefined): entity is HostedSideFeatureEntity {
  return Boolean(entity && entity.category === 'feature' && entity.kind === 'side-feature')
}

export function getRoofTypeLabel(kind: HostedRoofKind): string {
  switch (kind) {
    case 'flat-roof':
      return 'Flat roof'
    case 'shed-roof':
      return 'Shed roof'
    case 'gable-roof':
      return 'Gable roof'
    case 'hip-roof':
      return 'Hip roof'
    case 'cone-roof':
      return 'Cone roof'
    case 'dome-roof':
      return 'Dome roof'
    default:
      return 'Roof'
  }
}

export function getParapetOffsetLabel(_mode: ParapetOffsetMode): string {
  return 'Inside'
}

export const RECT_PARAPET_EDGE_OPTIONS: Array<{ value: ParapetRectEdgeId; label: string }> = [
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
]

export const CIRCULAR_PARAPET_EDGE_OPTIONS: Array<{ value: ParapetArcEdgeId; label: string; startAngleRad: number; endAngleRad: number }> = [
  { value: 'arc-front', label: 'Front Arc', startAngleRad: Math.PI / 4, endAngleRad: (3 * Math.PI) / 4 },
  { value: 'arc-right', label: 'Right Arc', startAngleRad: -Math.PI / 4, endAngleRad: Math.PI / 4 },
  { value: 'arc-back', label: 'Back Arc', startAngleRad: (5 * Math.PI) / 4, endAngleRad: (7 * Math.PI) / 4 },
  { value: 'arc-left', label: 'Left Arc', startAngleRad: (3 * Math.PI) / 4, endAngleRad: (5 * Math.PI) / 4 },
]

export function getParapetEdgeOptionsForHost(host: BaseMassEntity): Array<{ value: ParapetEdgeId; label: string }> {
  switch (host.params.shape) {
    case 'rect':
      return RECT_PARAPET_EDGE_OPTIONS
    case 'circle':
    case 'ring':
      return CIRCULAR_PARAPET_EDGE_OPTIONS.map(({ value, label }) => ({ value, label }))
    case 'polygon':
      return host.params.points.map((_, index) => ({
        value: `poly-${index}` as ParapetPolygonEdgeId,
        label: `Edge ${index + 1}`,
      }))
    default:
      return []
  }
}

export function getDefaultParapetEdgeIdsForHost(host: BaseMassEntity): ParapetEdgeId[] {
  return getParapetEdgeOptionsForHost(host).map(option => option.value)
}

export function getResolvedParapetEdgeIdsForHost(
  host: BaseMassEntity,
  edgeIds: ParapetEdgeId[],
): ParapetEdgeId[] {
  const available = getDefaultParapetEdgeIdsForHost(host)
  const requested = edgeIds.length > 0 ? edgeIds : available
  return available.filter(edgeId => requested.includes(edgeId))
}

export function getHostedFeaturePresetLabel(preset: HostedFeaturePreset): string {
  switch (preset) {
    case 'roof-unit':
      return 'Roof unit'
    case 'penthouse':
      return 'Penthouse'
    case 'balcony':
      return 'Balcony'
    case 'canopy':
      return 'Canopy'
    case 'screen':
      return 'Screen wall'
    case 'side-box':
      return 'Side box'
    case 'top-box':
    default:
      return 'Top box'
  }
}

export function getHostedFeatureDefaultColor(preset: HostedFeaturePreset): string {
  switch (preset) {
    case 'roof-unit':
      return '#ced7dd'
    case 'penthouse':
      return '#d4c4ae'
    case 'balcony':
      return '#d8c8b4'
    case 'canopy':
      return '#cfd8d2'
    case 'screen':
      return '#c5cfda'
    case 'side-box':
      return '#d6cfbf'
    case 'top-box':
    default:
      return '#d9d4c8'
  }
}

export function getProxyModeLabel(mode: ProxyFeatureMode): string {
  switch (mode) {
    case 'cut':
      return 'Cut volume'
    case 'add':
    default:
      return 'Volume'
  }
}

export function getHostedPatternContentLabel(contentType: HostedPatternContentType, featurePreset?: HostedFeaturePreset) {
  if (contentType === 'feature') {
    return `${getHostedFeaturePresetLabel(featurePreset ?? 'balcony')} pattern`
  }
  return contentType === 'cut-volume' ? 'Cut pattern' : 'Volume pattern'
}

export function getProxyDefaultColor(mode: ProxyFeatureMode): string {
  return mode === 'cut' ? '#f87171' : '#d9cfba'
}

export function getHostedFeatureDefaultHeightFt(preset: HostedFeaturePreset): number {
  switch (preset) {
    case 'roof-unit':
      return 6
    case 'penthouse':
      return 8
    case 'balcony':
      return 3
    case 'canopy':
      return 2.5
    case 'screen':
      return 8
    case 'side-box':
    case 'top-box':
    default:
      return 4
  }
}

export function getHostedFeatureDefaultDepthFt(preset: HostedFeaturePreset): number {
  switch (preset) {
    case 'screen':
      return 1.25
    case 'canopy':
      return 4
    case 'balcony':
      return 4.5
    case 'roof-unit':
      return 6
    case 'penthouse':
      return 8
    case 'side-box':
    case 'top-box':
    default:
      return 4
  }
}

export function getHostedFeatureDefaultAnalysis(preset: HostedFeaturePreset): BuildingAnalysisFlags {
  switch (preset) {
    case 'balcony':
      return {
        blocksScaffold: true,
        supportsScaffold: true,
        countsAsRoof: false,
        countsAsPerimeter: false,
      }
    case 'canopy':
    case 'screen':
    case 'side-box':
    case 'roof-unit':
    case 'penthouse':
    case 'top-box':
    default:
      return {
        blocksScaffold: true,
        supportsScaffold: false,
        countsAsRoof: false,
        countsAsPerimeter: false,
      }
  }
}

export function hostedFeatureSupportsHandrail(preset: HostedFeaturePreset): boolean {
  return preset === 'balcony'
}

export function getHostedFeatureDefaultHandrailEnabled(preset: HostedFeaturePreset): boolean {
  return hostedFeatureSupportsHandrail(preset)
}

export function getHostedFeatureDefaultHandrailHeightFt(preset: HostedFeaturePreset): number {
  return hostedFeatureSupportsHandrail(preset) ? 3.5 : 0
}

export function getHostedFeatureDefaultHandrailInsetFt(preset: HostedFeaturePreset): number {
  return hostedFeatureSupportsHandrail(preset) ? 0.15 : 0
}

export function getHostedFeatureDefaultHandrailThicknessFt(preset: HostedFeaturePreset): number {
  return hostedFeatureSupportsHandrail(preset) ? 0.18 : 0
}

export function getHostedFeatureHandrailSettings(params: {
  preset?: HostedFeaturePreset
  featurePreset?: HostedFeaturePreset
  balconyHandrailEnabled?: boolean
  balconyHandrailHeightFt?: number
  balconyHandrailInsetFt?: number
  balconyHandrailThicknessFt?: number
}) {
  const safePreset = params.preset ?? params.featurePreset ?? 'balcony'
  return {
    enabled: hostedFeatureSupportsHandrail(safePreset)
      && (params.balconyHandrailEnabled ?? getHostedFeatureDefaultHandrailEnabled(safePreset)),
    heightFt: Math.max(0.1, Number(params.balconyHandrailHeightFt ?? getHostedFeatureDefaultHandrailHeightFt(safePreset)) || 0.1),
    insetFt: Math.max(0, Number(params.balconyHandrailInsetFt ?? getHostedFeatureDefaultHandrailInsetFt(safePreset)) || 0),
    thicknessFt: Math.max(0.05, Number(params.balconyHandrailThicknessFt ?? getHostedFeatureDefaultHandrailThicknessFt(safePreset)) || 0.05),
  }
}

export function getProxyDefaultHeightFt(mode: ProxyFeatureMode): number {
  return mode === 'cut' ? 6 : 8
}

export function getProxyDefaultDepthFt(mode: ProxyFeatureMode): number {
  return mode === 'cut' ? 4 : 5
}

export function getBaseMassHeightFt(entity: BaseMassEntity): number {
  return entity.params.heightFt
}

export function getBaseMassTopZ(entity: BaseMassEntity): number {
  return entity.position.z + getBaseMassHeightFt(entity) / 2
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function getBaseMassLocalFootprintBounds(entity: BaseMassEntity): {
  minX: number
  maxX: number
  minY: number
  maxY: number
} {
  switch (entity.params.shape) {
    case 'rect':
      return {
        minX: -entity.params.widthFt / 2,
        maxX: entity.params.widthFt / 2,
        minY: -entity.params.depthFt / 2,
        maxY: entity.params.depthFt / 2,
      }
    case 'circle':
    case 'ring':
      return {
        minX: -entity.params.radiusFt,
        maxX: entity.params.radiusFt,
        minY: -entity.params.radiusFt,
        maxY: entity.params.radiusFt,
      }
    case 'polygon': {
      const xs = entity.params.points.map(point => point.x)
      const ys = entity.params.points.map(point => point.y)
      if (xs.length === 0 || ys.length === 0) {
        return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
      }
      return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
      }
    }
    default:
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  }
}

export function worldPointToBaseMassLocalXYZ(
  entity: BaseMassEntity,
  point: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const localXY = worldPointToBaseMassLocalXY(entity, point)
  return {
    x: localXY.x,
    y: localXY.y,
    z: point.z - entity.position.z,
  }
}

export function worldPointToBaseMassLocalXY(
  entity: BaseMassEntity,
  point: { x: number; y: number },
): BuildingPoint2 {
  const dx = point.x - entity.position.x
  const dy = point.y - entity.position.y
  const angle = -(entity.rotationZRad ?? 0)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  }
}

export function baseMassLocalXYZToWorld(
  entity: BaseMassEntity,
  point: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const angle = entity.rotationZRad ?? 0
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: entity.position.x + point.x * cos - point.y * sin,
    y: entity.position.y + point.x * sin + point.y * cos,
    z: entity.position.z + point.z,
  }
}

function projectPointToSegment(point: BuildingPoint2, a: BuildingPoint2, b: BuildingPoint2): BuildingPoint2 {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq <= 1e-9) return { x: a.x, y: a.y }
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1)
  return {
    x: a.x + dx * t,
    y: a.y + dy * t,
  }
}

function isPointOnSegment(point: BuildingPoint2, a: BuildingPoint2, b: BuildingPoint2, epsilon = 1e-4): boolean {
  const projection = projectPointToSegment(point, a, b)
  const dx = point.x - projection.x
  const dy = point.y - projection.y
  return dx * dx + dy * dy <= epsilon * epsilon
}

function isPointOnPolygonBoundary(points: BuildingPoint2[], point: BuildingPoint2): boolean {
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j]!
    const b = points[i]!
    if (isPointOnSegment(point, a, b)) return true
  }
  return false
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

export function isPointInsideBaseMassFootprint(
  entity: BaseMassEntity,
  point: { x: number; y: number },
): boolean {
  const local = worldPointToBaseMassLocalXY(entity, point)
  switch (entity.params.shape) {
    case 'rect':
      return Math.abs(local.x) <= entity.params.widthFt / 2 && Math.abs(local.y) <= entity.params.depthFt / 2
    case 'circle':
      return local.x * local.x + local.y * local.y <= entity.params.radiusFt * entity.params.radiusFt
    case 'ring': {
      const radiusSq = local.x * local.x + local.y * local.y
      return radiusSq <= entity.params.radiusFt * entity.params.radiusFt
        && radiusSq >= entity.params.innerRadiusFt * entity.params.innerRadiusFt
    }
    case 'polygon':
      return pointInPolygon(entity.params.points, local) || isPointOnPolygonBoundary(entity.params.points, local)
    default:
      return false
  }
}

export function getBaseMassFaceInfo(
  entity: BaseMassEntity,
  faceId: BaseMassFaceId,
): BaseMassFaceInfo | null {
  const angle = entity.rotationZRad ?? 0
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const right = { x: cos, y: sin, z: 0 }
  const topAxisV = { x: -sin, y: cos, z: 0 }
  const frontNormal = { x: sin, y: -cos, z: 0 }

  if (faceId === 'top') {
    const bounds = getBaseMassLocalFootprintBounds(entity)
    switch (entity.params.shape) {
      case 'rect':
        return {
          faceId,
          hostKind: 'top-face',
          center: { x: entity.position.x, y: entity.position.y, z: getBaseMassTopZ(entity) },
          normal: { x: 0, y: 0, z: 1 },
          axisU: right,
          axisV: topAxisV,
          spanU: entity.params.widthFt,
          spanV: entity.params.depthFt,
        }
      case 'circle':
      case 'ring':
        return {
          faceId,
          hostKind: 'top-face',
          center: { x: entity.position.x, y: entity.position.y, z: getBaseMassTopZ(entity) },
          normal: { x: 0, y: 0, z: 1 },
          axisU: right,
          axisV: topAxisV,
          spanU: entity.params.radiusFt * 2,
          spanV: entity.params.radiusFt * 2,
        }
      case 'polygon': {
        return {
          faceId,
          hostKind: 'top-face',
          center: { x: entity.position.x, y: entity.position.y, z: getBaseMassTopZ(entity) },
          normal: { x: 0, y: 0, z: 1 },
          axisU: right,
          axisV: topAxisV,
          spanU: bounds.maxX - bounds.minX,
          spanV: bounds.maxY - bounds.minY,
        }
      }
      default:
        return null
    }
  }

  const bounds = getBaseMassLocalFootprintBounds(entity)
  const spanX = Math.max(0.1, bounds.maxX - bounds.minX)
  const spanY = Math.max(0.1, bounds.maxY - bounds.minY)
  const centerLocalX = (bounds.minX + bounds.maxX) / 2
  const centerLocalY = (bounds.minY + bounds.maxY) / 2
  const resolveWorldCenter = (localX: number, localY: number) => (
    baseMassLocalXYZToWorld(entity, { x: localX, y: localY, z: 0 })
  )

  switch (faceId) {
    case 'front': {
      const center = resolveWorldCenter(centerLocalX, bounds.minY)
      return {
        faceId,
        hostKind: 'side-face',
        center,
        normal: frontNormal,
        axisU: right,
        axisV: { x: 0, y: 0, z: 1 },
        spanU: spanX,
        spanV: entity.params.heightFt,
      }
    }
    case 'back': {
      const center = resolveWorldCenter(centerLocalX, bounds.maxY)
      return {
        faceId,
        hostKind: 'side-face',
        center,
        normal: { x: -frontNormal.x, y: -frontNormal.y, z: 0 },
        axisU: { x: -right.x, y: -right.y, z: 0 },
        axisV: { x: 0, y: 0, z: 1 },
        spanU: spanX,
        spanV: entity.params.heightFt,
      }
    }
    case 'right': {
      const center = resolveWorldCenter(bounds.maxX, centerLocalY)
      return {
        faceId,
        hostKind: 'side-face',
        center,
        normal: right,
        axisU: topAxisV,
        axisV: { x: 0, y: 0, z: 1 },
        spanU: spanY,
        spanV: entity.params.heightFt,
      }
    }
    case 'left': {
      const center = resolveWorldCenter(bounds.minX, centerLocalY)
      return {
        faceId,
        hostKind: 'side-face',
        center,
        normal: { x: -right.x, y: -right.y, z: 0 },
        axisU: { x: -topAxisV.x, y: -topAxisV.y, z: 0 },
        axisV: { x: 0, y: 0, z: 1 },
        spanU: spanY,
        spanV: entity.params.heightFt,
      }
    }
    default:
      return null
  }
}

export function resolvePreferredDrawHostFace(
  entity: BaseMassEntity | null,
  activeTool: string,
  viewMode: string,
): BaseMassFaceInfo | null {
  if (!entity) return null
  if (activeTool === 'rectangle' && entity.params.shape === 'rect') {
    const sideFaceByView: Partial<Record<string, BaseMassFaceId>> = {
      'ortho-front': 'front',
      'ortho-back': 'back',
      'ortho-left': 'left',
      'ortho-right': 'right',
    }
    const sideFaceId = sideFaceByView[viewMode]
    if (sideFaceId) return getBaseMassFaceInfo(entity, sideFaceId)
  }
  return getBaseMassFaceInfo(entity, 'top')
}

type BuildingEntityLookup = Map<string, BuildingEntity> | readonly BuildingEntity[]

function getBuildingEntityFromLookup(
  lookup: BuildingEntityLookup,
  entityId: string,
): BuildingEntity | null {
  if (lookup instanceof Map) return lookup.get(entityId) ?? null
  return lookup.find((candidate) => candidate.id === entityId) ?? null
}

export type HostedRectWorldTransform = {
  position: { x: number; y: number; z: number }
  quaternion: { x: number; y: number; z: number; w: number }
  dimensions: [number, number, number]
  sourceFaceId: BaseMassFaceId
}

function resolveHostedRectHostFaceInfo(
  entity: HostedFeatureEntity | HostedProxyEntity,
  lookup: BuildingEntityLookup,
  roofBaseOffsetByHostId?: Map<string, number>,
  depth = 0,
): BaseMassFaceInfo | null {
  if (depth > 8) return null
  const hostEntity = getBuildingEntityFromLookup(lookup, entity.host.entityId)
  if (!hostEntity) return null
  if (isBaseMassEntity(hostEntity)) {
    return getBaseMassFaceInfo(hostEntity, entity.host.faceId)
  }
  if (!isHostedRectEntity(hostEntity)) return null
  return resolveHostedRectEntityFaceInfo(hostEntity, entity.host.faceId, lookup, roofBaseOffsetByHostId, depth + 1)
}

export function resolveHostedRectEntityTransform(
  entity: HostedFeatureEntity | HostedProxyEntity,
  lookup: BuildingEntityLookup,
  roofBaseOffsetByHostId?: Map<string, number>,
  depth = 0,
): HostedRectWorldTransform | null {
  if (depth > 8) return null
  const faceInfo = resolveHostedRectHostFaceInfo(entity, lookup, roofBaseOffsetByHostId, depth)
  if (!faceInfo) return null

  const widthFt = Math.max(0.1, Number(entity.params.widthFt ?? 0) || 0.1)
  const depthFt = Math.max(0.1, Number(entity.params.depthFt ?? 0) || 0.1)
  const heightFt = Math.max(0.1, Number(entity.params.heightFt ?? 0) || 0.1)
  const offsetUFt = Number(entity.params.offsetUFt ?? 0)
  const offsetVFt = Number(entity.params.offsetVFt ?? 0)
  const roofBaseOffsetFt = entity.host.faceId === 'top'
    ? (isBaseMassEntity(getBuildingEntityFromLookup(lookup, entity.host.entityId))
        ? (roofBaseOffsetByHostId?.get(entity.host.entityId) ?? 0)
        : 0)
    : 0
  const normalOffsetFt = isFeatureEntity(entity)
    ? (entity.kind === 'top-feature' ? roofBaseOffsetFt + heightFt / 2 : depthFt / 2)
    : (entity.host.faceId === 'top'
        ? (entity.params.mode === 'cut' ? roofBaseOffsetFt - heightFt / 2 : roofBaseOffsetFt + heightFt / 2)
        : (entity.params.mode === 'cut' ? -depthFt / 2 : depthFt / 2))

  const axisU = new THREE.Vector3(faceInfo.axisU.x, faceInfo.axisU.y, faceInfo.axisU.z).normalize()
  const axisV = new THREE.Vector3(faceInfo.axisV.x, faceInfo.axisV.y, faceInfo.axisV.z).normalize()
  const normal = new THREE.Vector3(faceInfo.normal.x, faceInfo.normal.y, faceInfo.normal.z).normalize()
  const position = new THREE.Vector3(faceInfo.center.x, faceInfo.center.y, faceInfo.center.z)
    .addScaledVector(axisU, offsetUFt)
    .addScaledVector(axisV, offsetVFt)
    .addScaledVector(normal, normalOffsetFt)

  const basis = new THREE.Matrix4().makeBasis(axisU, axisV, normal)
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis)
  const dimensions = faceInfo.faceId === 'top'
    ? [widthFt, depthFt, heightFt] as [number, number, number]
    : [widthFt, heightFt, depthFt] as [number, number, number]

  return {
    position: { x: position.x, y: position.y, z: position.z },
    quaternion: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
    dimensions,
    sourceFaceId: faceInfo.faceId,
  }
}

export function resolveHostedRectEntityTopFaceInfo(
  entity: HostedFeatureEntity | HostedProxyEntity,
  lookup: BuildingEntityLookup,
  roofBaseOffsetByHostId?: Map<string, number>,
  depth = 0,
): BaseMassFaceInfo | null {
  return resolveHostedRectEntityFaceInfo(entity, 'top', lookup, roofBaseOffsetByHostId, depth)
}

export function resolveHostedRectEntityFaceInfo(
  entity: HostedFeatureEntity | HostedProxyEntity,
  faceId: BaseMassFaceId,
  lookup: BuildingEntityLookup,
  roofBaseOffsetByHostId?: Map<string, number>,
  depth = 0,
): BaseMassFaceInfo | null {
  const transform = resolveHostedRectEntityTransform(entity, lookup, roofBaseOffsetByHostId, depth + 1)
  if (!transform) return null

  const quaternion = new THREE.Quaternion(
    transform.quaternion.x,
    transform.quaternion.y,
    transform.quaternion.z,
    transform.quaternion.w,
  )
  const xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion).normalize()
  const yAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion).normalize()
  const zAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion).normalize()
  const position = new THREE.Vector3(transform.position.x, transform.position.y, transform.position.z)
  const hostRoofOffsetFt = roofBaseOffsetByHostId?.get(entity.id) ?? 0

  if (transform.sourceFaceId === 'top') {
    const widthAxis = xAxis
    const depthAxis = yAxis
    const heightAxis = zAxis
    const widthFt = transform.dimensions[0]
    const depthFt = transform.dimensions[1]
    const heightFt = transform.dimensions[2]
    switch (faceId) {
      case 'top': {
        const center = position.clone().addScaledVector(heightAxis, heightFt / 2 + hostRoofOffsetFt)
        return {
          faceId: 'top',
          hostKind: 'top-face',
          center: { x: center.x, y: center.y, z: center.z },
          normal: { x: heightAxis.x, y: heightAxis.y, z: heightAxis.z },
          axisU: { x: widthAxis.x, y: widthAxis.y, z: widthAxis.z },
          axisV: { x: depthAxis.x, y: depthAxis.y, z: depthAxis.z },
          spanU: widthFt,
          spanV: depthFt,
        }
      }
      case 'front': {
        const center = position.clone().addScaledVector(depthAxis, depthFt / 2)
        return {
          faceId: 'front',
          hostKind: 'side-face',
          center: { x: center.x, y: center.y, z: center.z },
          normal: { x: depthAxis.x, y: depthAxis.y, z: depthAxis.z },
          axisU: { x: widthAxis.x, y: widthAxis.y, z: widthAxis.z },
          axisV: { x: heightAxis.x, y: heightAxis.y, z: heightAxis.z },
          spanU: widthFt,
          spanV: heightFt,
        }
      }
      case 'back': {
        const center = position.clone().addScaledVector(depthAxis, -depthFt / 2)
        return {
          faceId: 'back',
          hostKind: 'side-face',
          center: { x: center.x, y: center.y, z: center.z },
          normal: { x: -depthAxis.x, y: -depthAxis.y, z: -depthAxis.z },
          axisU: { x: -widthAxis.x, y: -widthAxis.y, z: -widthAxis.z },
          axisV: { x: heightAxis.x, y: heightAxis.y, z: heightAxis.z },
          spanU: widthFt,
          spanV: heightFt,
        }
      }
      case 'right': {
        const center = position.clone().addScaledVector(widthAxis, widthFt / 2)
        return {
          faceId: 'right',
          hostKind: 'side-face',
          center: { x: center.x, y: center.y, z: center.z },
          normal: { x: widthAxis.x, y: widthAxis.y, z: widthAxis.z },
          axisU: { x: -depthAxis.x, y: -depthAxis.y, z: -depthAxis.z },
          axisV: { x: heightAxis.x, y: heightAxis.y, z: heightAxis.z },
          spanU: depthFt,
          spanV: heightFt,
        }
      }
      case 'left': {
        const center = position.clone().addScaledVector(widthAxis, -widthFt / 2)
        return {
          faceId: 'left',
          hostKind: 'side-face',
          center: { x: center.x, y: center.y, z: center.z },
          normal: { x: -widthAxis.x, y: -widthAxis.y, z: -widthAxis.z },
          axisU: { x: depthAxis.x, y: depthAxis.y, z: depthAxis.z },
          axisV: { x: heightAxis.x, y: heightAxis.y, z: heightAxis.z },
          spanU: depthFt,
          spanV: heightFt,
        }
      }
    }
  }

  const widthAxis = xAxis
  const heightAxis = yAxis
  const depthAxis = zAxis
  const widthFt = transform.dimensions[0]
  const heightFt = transform.dimensions[1]
  const depthFt = transform.dimensions[2]
  switch (faceId) {
    case 'top': {
      const center = position.clone().addScaledVector(heightAxis, heightFt / 2 + hostRoofOffsetFt)
      return {
        faceId: 'top',
        hostKind: 'top-face',
        center: { x: center.x, y: center.y, z: center.z },
        normal: { x: heightAxis.x, y: heightAxis.y, z: heightAxis.z },
        axisU: { x: widthAxis.x, y: widthAxis.y, z: widthAxis.z },
        axisV: { x: depthAxis.x, y: depthAxis.y, z: depthAxis.z },
        spanU: widthFt,
        spanV: depthFt,
      }
    }
    case 'front': {
      const center = position.clone().addScaledVector(depthAxis, depthFt / 2)
      return {
        faceId: 'front',
        hostKind: 'side-face',
        center: { x: center.x, y: center.y, z: center.z },
        normal: { x: depthAxis.x, y: depthAxis.y, z: depthAxis.z },
        axisU: { x: widthAxis.x, y: widthAxis.y, z: widthAxis.z },
        axisV: { x: heightAxis.x, y: heightAxis.y, z: heightAxis.z },
        spanU: widthFt,
        spanV: heightFt,
      }
    }
    case 'back': {
      const center = position.clone().addScaledVector(depthAxis, -depthFt / 2)
      return {
        faceId: 'back',
        hostKind: 'side-face',
        center: { x: center.x, y: center.y, z: center.z },
        normal: { x: -depthAxis.x, y: -depthAxis.y, z: -depthAxis.z },
        axisU: { x: -widthAxis.x, y: -widthAxis.y, z: -widthAxis.z },
        axisV: { x: heightAxis.x, y: heightAxis.y, z: heightAxis.z },
        spanU: widthFt,
        spanV: heightFt,
      }
    }
    case 'right': {
      const center = position.clone().addScaledVector(widthAxis, widthFt / 2)
      return {
        faceId: 'right',
        hostKind: 'side-face',
        center: { x: center.x, y: center.y, z: center.z },
        normal: { x: widthAxis.x, y: widthAxis.y, z: widthAxis.z },
        axisU: { x: -depthAxis.x, y: -depthAxis.y, z: -depthAxis.z },
        axisV: { x: heightAxis.x, y: heightAxis.y, z: heightAxis.z },
        spanU: depthFt,
        spanV: heightFt,
      }
    }
    case 'left': {
      const center = position.clone().addScaledVector(widthAxis, -widthFt / 2)
      return {
        faceId: 'left',
        hostKind: 'side-face',
        center: { x: center.x, y: center.y, z: center.z },
        normal: { x: -widthAxis.x, y: -widthAxis.y, z: -widthAxis.z },
        axisU: { x: depthAxis.x, y: depthAxis.y, z: depthAxis.z },
        axisV: { x: heightAxis.x, y: heightAxis.y, z: heightAxis.z },
        spanU: depthFt,
        spanV: heightFt,
      }
    }
  }
}

export function isPointInsideRectFaceInfo(
  faceInfo: BaseMassFaceInfo,
  point: { x: number; y: number; z: number },
  tolerance = 0.25,
): boolean {
  const offset = {
    x: point.x - faceInfo.center.x,
    y: point.y - faceInfo.center.y,
    z: point.z - faceInfo.center.z,
  }
  const normalDistance = offset.x * faceInfo.normal.x + offset.y * faceInfo.normal.y + offset.z * faceInfo.normal.z
  if (Math.abs(normalDistance) > tolerance) return false
  const { u, v } = getFacePointCoordinates(faceInfo, point)
  return Math.abs(u) <= faceInfo.spanU / 2 + tolerance
    && Math.abs(v) <= faceInfo.spanV / 2 + tolerance
}

export function clampPointToRectFaceInfo(
  faceInfo: BaseMassFaceInfo,
  point: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const { u, v } = getFacePointCoordinates(faceInfo, point)
  return resolveFacePointFromCoordinates(
    faceInfo,
    clamp(u, -faceInfo.spanU / 2, faceInfo.spanU / 2),
    clamp(v, -faceInfo.spanV / 2, faceInfo.spanV / 2),
  )
}

export function resolveRectFaceSketchRect(
  faceInfo: BaseMassFaceInfo,
  startPoint: { x: number; y: number; z: number },
  endPoint: { x: number; y: number; z: number },
): FaceSketchRect {
  const startOffset = {
    x: startPoint.x - faceInfo.center.x,
    y: startPoint.y - faceInfo.center.y,
    z: startPoint.z - faceInfo.center.z,
  }
  const endOffset = {
    x: endPoint.x - faceInfo.center.x,
    y: endPoint.y - faceInfo.center.y,
    z: endPoint.z - faceInfo.center.z,
  }

  const startU = startOffset.x * faceInfo.axisU.x + startOffset.y * faceInfo.axisU.y + startOffset.z * faceInfo.axisU.z
  const endU = endOffset.x * faceInfo.axisU.x + endOffset.y * faceInfo.axisU.y + endOffset.z * faceInfo.axisU.z
  const startV = startOffset.x * faceInfo.axisV.x + startOffset.y * faceInfo.axisV.y + startOffset.z * faceInfo.axisV.z
  const endV = endOffset.x * faceInfo.axisV.x + endOffset.y * faceInfo.axisV.y + endOffset.z * faceInfo.axisV.z

  const minU = Math.min(startU, endU)
  const maxU = Math.max(startU, endU)
  const minV = Math.min(startV, endV)
  const maxV = Math.max(startV, endV)
  const centerU = (startU + endU) / 2
  const centerV = (startV + endV) / 2

  return {
    faceId: faceInfo.faceId,
    center: resolveFacePointFromCoordinates(faceInfo, centerU, centerV),
    centerU,
    centerV,
    spanU: maxU - minU,
    spanV: maxV - minV,
    minU,
    maxU,
    minV,
    maxV,
  }
}

export function isRectFaceSketchRectWithinFace(
  faceInfo: BaseMassFaceInfo,
  startPoint: { x: number; y: number; z: number },
  endPoint: { x: number; y: number; z: number },
): boolean {
  const sketchRect = resolveRectFaceSketchRect(faceInfo, startPoint, endPoint)
  const halfSpanU = faceInfo.spanU / 2
  const halfSpanV = faceInfo.spanV / 2
  return sketchRect.minU >= -halfSpanU - 1e-4
    && sketchRect.maxU <= halfSpanU + 1e-4
    && sketchRect.minV >= -halfSpanV - 1e-4
    && sketchRect.maxV <= halfSpanV + 1e-4
}

export function constrainRectFaceSketchPoint(
  faceInfo: BaseMassFaceInfo,
  startPoint: { x: number; y: number; z: number },
  point: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const clampedStart = clampPointToRectFaceInfo(faceInfo, startPoint)
  const clampedPoint = clampPointToRectFaceInfo(faceInfo, point)
  if (isRectFaceSketchRectWithinFace(faceInfo, clampedStart, clampedPoint)) {
    return clampedPoint
  }

  let bestPoint = clampedStart
  let low = 0
  let high = 1
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const t = (low + high) / 2
    const candidate = clampPointToRectFaceInfo(faceInfo, {
      x: clampedStart.x + (clampedPoint.x - clampedStart.x) * t,
      y: clampedStart.y + (clampedPoint.y - clampedStart.y) * t,
      z: clampedStart.z + (clampedPoint.z - clampedStart.z) * t,
    })
    if (isRectFaceSketchRectWithinFace(faceInfo, clampedStart, candidate)) {
      bestPoint = candidate
      low = t
    } else {
      high = t
    }
  }
  return bestPoint
}

export function raycastRectFaceInfo(
  faceInfo: BaseMassFaceInfo,
  rayOrigin: { x: number; y: number; z: number },
  rayDirection: { x: number; y: number; z: number },
): HostedFaceRayHit | null {
  const denominator = (
    rayDirection.x * faceInfo.normal.x
    + rayDirection.y * faceInfo.normal.y
    + rayDirection.z * faceInfo.normal.z
  )
  if (Math.abs(denominator) <= 1e-6) return null
  const numerator = (
    (faceInfo.center.x - rayOrigin.x) * faceInfo.normal.x
    + (faceInfo.center.y - rayOrigin.y) * faceInfo.normal.y
    + (faceInfo.center.z - rayOrigin.z) * faceInfo.normal.z
  )
  const distance = numerator / denominator
  if (distance < 0) return null
  const point = {
    x: rayOrigin.x + rayDirection.x * distance,
    y: rayOrigin.y + rayDirection.y * distance,
    z: rayOrigin.z + rayDirection.z * distance,
  }
  if (!isPointInsideRectFaceInfo(faceInfo, point)) return null
  return {
    faceId: faceInfo.faceId,
    hostKind: faceInfo.hostKind,
    point,
    distance,
  }
}

export function isPointInsideBaseMassFace(
  entity: BaseMassEntity,
  faceId: BaseMassFaceId,
  point: { x: number; y: number; z: number },
): boolean {
  if (faceId === 'top') {
    return Math.abs(point.z - getBaseMassTopZ(entity)) <= 0.25
      && isPointInsideBaseMassFootprint(entity, point)
  }

  const faceInfo = getBaseMassFaceInfo(entity, faceId)
  if (!faceInfo) return false

  const offset = {
    x: point.x - faceInfo.center.x,
    y: point.y - faceInfo.center.y,
    z: point.z - faceInfo.center.z,
  }
  const normalDistance = offset.x * faceInfo.normal.x + offset.y * faceInfo.normal.y + offset.z * faceInfo.normal.z
  if (Math.abs(normalDistance) > 0.25) return false

  const { u, v } = getFacePointCoordinates(faceInfo, point)
  return Math.abs(u) <= faceInfo.spanU / 2 + 0.25
    && Math.abs(v) <= faceInfo.spanV / 2 + 0.25
}

function getFacePointCoordinates(
  faceInfo: BaseMassFaceInfo,
  point: { x: number; y: number; z: number },
): { u: number; v: number } {
  const offset = {
    x: point.x - faceInfo.center.x,
    y: point.y - faceInfo.center.y,
    z: point.z - faceInfo.center.z,
  }
  return {
    u: offset.x * faceInfo.axisU.x + offset.y * faceInfo.axisU.y + offset.z * faceInfo.axisU.z,
    v: offset.x * faceInfo.axisV.x + offset.y * faceInfo.axisV.y + offset.z * faceInfo.axisV.z,
  }
}

export function raycastBaseMassFace(
  entity: BaseMassEntity,
  faceId: BaseMassFaceId,
  rayOrigin: { x: number; y: number; z: number },
  rayDirection: { x: number; y: number; z: number },
): HostedFaceRayHit | null {
  const faceInfo = getBaseMassFaceInfo(entity, faceId)
  if (!faceInfo) return null
  if (faceId !== 'top' && entity.params.shape !== 'rect') return null

  const denominator = (
    rayDirection.x * faceInfo.normal.x
    + rayDirection.y * faceInfo.normal.y
    + rayDirection.z * faceInfo.normal.z
  )
  if (Math.abs(denominator) <= 1e-6) return null

  const numerator = (
    (faceInfo.center.x - rayOrigin.x) * faceInfo.normal.x
    + (faceInfo.center.y - rayOrigin.y) * faceInfo.normal.y
    + (faceInfo.center.z - rayOrigin.z) * faceInfo.normal.z
  )
  const distance = numerator / denominator
  if (distance < 0) return null

  const point = {
    x: rayOrigin.x + rayDirection.x * distance,
    y: rayOrigin.y + rayDirection.y * distance,
    z: rayOrigin.z + rayDirection.z * distance,
  }
  if (!isPointInsideBaseMassFace(entity, faceId, point)) return null

  return {
    faceId,
    hostKind: faceInfo.hostKind,
    point,
    distance,
  }
}

function worldDirectionToBaseMassLocal(
  entity: BaseMassEntity,
  direction: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const angle = -(entity.rotationZRad ?? 0)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: direction.x * cos - direction.y * sin,
    y: direction.x * sin + direction.y * cos,
    z: direction.z,
  }
}

function raycastRectBaseMassFaces(
  entity: BaseMassEntity,
  faceIds: BaseMassFaceId[],
  rayOrigin: { x: number; y: number; z: number },
  rayDirection: { x: number; y: number; z: number },
): HostedFaceRayHit | null {
  if (entity.params.shape !== 'rect') return null

  const originLocal = worldPointToBaseMassLocalXYZ(entity, rayOrigin)
  const directionLocal = worldDirectionToBaseMassLocal(entity, rayDirection)
  const halfWidth = entity.params.widthFt / 2
  const halfDepth = entity.params.depthFt / 2
  const halfHeight = entity.params.heightFt / 2

  let tMin = Number.NEGATIVE_INFINITY
  let tMax = Number.POSITIVE_INFINITY
  let nearFaceId: BaseMassFaceId | null = null
  let farFaceId: BaseMassFaceId | null = null

  const updateSlab = (
    origin: number,
    direction: number,
    min: number,
    max: number,
    minFaceId: BaseMassFaceId | null,
    maxFaceId: BaseMassFaceId | null,
  ): boolean => {
    if (Math.abs(direction) <= 1e-9) {
      return origin >= min && origin <= max
    }

    let nearT = (min - origin) / direction
    let farT = (max - origin) / direction
    let nextNearFaceId = minFaceId
    let nextFarFaceId = maxFaceId
    if (nearT > farT) {
      const tmpT = nearT
      nearT = farT
      farT = tmpT
      const tmpFaceId = nextNearFaceId
      nextNearFaceId = nextFarFaceId
      nextFarFaceId = tmpFaceId
    }

    if (nearT > tMin) {
      tMin = nearT
      nearFaceId = nextNearFaceId
    }
    if (farT < tMax) {
      tMax = farT
      farFaceId = nextFarFaceId
    }
    return tMin <= tMax
  }

  if (!updateSlab(originLocal.x, directionLocal.x, -halfWidth, halfWidth, 'left', 'right')) return null
  if (!updateSlab(originLocal.y, directionLocal.y, -halfDepth, halfDepth, 'front', 'back')) return null
  if (!updateSlab(originLocal.z, directionLocal.z, -halfHeight, halfHeight, null, 'top')) return null
  if (tMax < 0) return null

  const hitDistance = tMin >= 0 ? tMin : tMax
  const hitFaceId = tMin >= 0 ? nearFaceId : farFaceId
  if (!hitFaceId || !faceIds.includes(hitFaceId)) return null

  const hitLocalPoint = {
    x: originLocal.x + directionLocal.x * hitDistance,
    y: originLocal.y + directionLocal.y * hitDistance,
    z: originLocal.z + directionLocal.z * hitDistance,
  }
  const hitWorldPoint = baseMassLocalXYZToWorld(entity, hitLocalPoint)
  return {
    faceId: hitFaceId,
    hostKind: hitFaceId === 'top' ? 'top-face' : 'side-face',
    point: hitWorldPoint,
    distance: hitDistance,
  }
}

export function raycastBaseMassFaces(
  entity: BaseMassEntity,
  faceIds: BaseMassFaceId[],
  rayOrigin: { x: number; y: number; z: number },
  rayDirection: { x: number; y: number; z: number },
): HostedFaceRayHit | null {
  if (entity.params.shape === 'rect') {
    return raycastRectBaseMassFaces(entity, faceIds, rayOrigin, rayDirection)
  }

  let nearestHit: HostedFaceRayHit | null = null
  for (const faceId of faceIds) {
    const hit = raycastBaseMassFace(entity, faceId, rayOrigin, rayDirection)
    if (!hit) continue
    if (!nearestHit || hit.distance < nearestHit.distance) {
      nearestHit = hit
    }
  }
  return nearestHit
}

function resolveFacePointFromCoordinates(
  faceInfo: BaseMassFaceInfo,
  u: number,
  v: number,
): { x: number; y: number; z: number } {
  return {
    x: faceInfo.center.x + faceInfo.axisU.x * u + faceInfo.axisV.x * v,
    y: faceInfo.center.y + faceInfo.axisU.y * u + faceInfo.axisV.y * v,
    z: faceInfo.center.z + faceInfo.axisU.z * u + faceInfo.axisV.z * v,
  }
}

function clampPointToPolygonBoundary(points: BuildingPoint2[], point: BuildingPoint2): BuildingPoint2 {
  if (pointInPolygon(points, point) || isPointOnPolygonBoundary(points, point)) return point

  let nearest = points[0] ?? point
  let minDistanceSq = Number.POSITIVE_INFINITY
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j]!
    const b = points[i]!
    const candidate = projectPointToSegment(point, a, b)
    const dx = point.x - candidate.x
    const dy = point.y - candidate.y
    const distanceSq = dx * dx + dy * dy
    if (distanceSq < minDistanceSq) {
      minDistanceSq = distanceSq
      nearest = candidate
    }
  }
  return nearest
}

export function clampPointToBaseMassFace(
  entity: BaseMassEntity,
  faceId: BaseMassFaceId,
  point: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const faceInfo = getBaseMassFaceInfo(entity, faceId)
  if (!faceInfo) return point

  if (faceId === 'top') {
    const local = worldPointToBaseMassLocalXYZ(entity, point)
    const localZ = entity.params.heightFt / 2

    switch (entity.params.shape) {
      case 'rect':
        return baseMassLocalXYZToWorld(entity, {
          x: clamp(local.x, -entity.params.widthFt / 2, entity.params.widthFt / 2),
          y: clamp(local.y, -entity.params.depthFt / 2, entity.params.depthFt / 2),
          z: localZ,
        })
      case 'circle': {
        const radius = Math.hypot(local.x, local.y)
        if (radius <= entity.params.radiusFt || radius <= 1e-9) {
          return baseMassLocalXYZToWorld(entity, { x: local.x, y: local.y, z: localZ })
        }
        const scale = entity.params.radiusFt / radius
        return baseMassLocalXYZToWorld(entity, {
          x: local.x * scale,
          y: local.y * scale,
          z: localZ,
        })
      }
      case 'ring': {
        const radius = Math.hypot(local.x, local.y)
        const angle = Math.atan2(local.y, local.x)
        const clampedRadius = radius <= 1e-9
          ? entity.params.innerRadiusFt
          : clamp(radius, entity.params.innerRadiusFt, entity.params.radiusFt)
        return baseMassLocalXYZToWorld(entity, {
          x: Math.cos(angle) * clampedRadius,
          y: Math.sin(angle) * clampedRadius,
          z: localZ,
        })
      }
      case 'polygon': {
        const clampedLocal = clampPointToPolygonBoundary(entity.params.points, { x: local.x, y: local.y })
        return baseMassLocalXYZToWorld(entity, {
          x: clampedLocal.x,
          y: clampedLocal.y,
          z: localZ,
        })
      }
      default:
        return point
    }
  }

  const { u, v } = getFacePointCoordinates(faceInfo, point)
  return resolveFacePointFromCoordinates(
    faceInfo,
    clamp(u, -faceInfo.spanU / 2, faceInfo.spanU / 2),
    clamp(v, -faceInfo.spanV / 2, faceInfo.spanV / 2),
  )
}

export function isFaceSketchRectWithinHost(
  entity: BaseMassEntity,
  faceId: BaseMassFaceId,
  startPoint: { x: number; y: number; z: number },
  endPoint: { x: number; y: number; z: number },
): boolean {
  const faceInfo = getBaseMassFaceInfo(entity, faceId)
  const sketchRect = resolveFaceSketchRect(entity, faceId, startPoint, endPoint)
  if (!faceInfo || !sketchRect) return false

  const halfSpanU = faceInfo.spanU / 2
  const halfSpanV = faceInfo.spanV / 2
  if (faceId !== 'top' || entity.params.shape === 'rect') {
    return sketchRect.minU >= -halfSpanU - 1e-4
      && sketchRect.maxU <= halfSpanU + 1e-4
      && sketchRect.minV >= -halfSpanV - 1e-4
      && sketchRect.maxV <= halfSpanV + 1e-4
  }

  const sampleCount = 5
  for (let uIndex = 0; uIndex < sampleCount; uIndex += 1) {
    const uT = uIndex / (sampleCount - 1)
    const sampleU = sketchRect.minU + sketchRect.spanU * uT
    for (let vIndex = 0; vIndex < sampleCount; vIndex += 1) {
      const vT = vIndex / (sampleCount - 1)
      const sampleV = sketchRect.minV + sketchRect.spanV * vT
      const samplePoint = resolveFacePointFromCoordinates(faceInfo, sampleU, sampleV)
      if (!isPointInsideBaseMassFootprint(entity, samplePoint)) {
        return false
      }
    }
  }
  return true
}

export function constrainFaceSketchPoint(
  entity: BaseMassEntity,
  faceId: BaseMassFaceId,
  startPoint: { x: number; y: number; z: number },
  point: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const clampedStart = clampPointToBaseMassFace(entity, faceId, startPoint)
  const clampedPoint = clampPointToBaseMassFace(entity, faceId, point)
  if (isFaceSketchRectWithinHost(entity, faceId, clampedStart, clampedPoint)) {
    return clampedPoint
  }

  let bestPoint = clampedStart
  let low = 0
  let high = 1
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const t = (low + high) / 2
    const candidate = clampPointToBaseMassFace(entity, faceId, {
      x: clampedStart.x + (clampedPoint.x - clampedStart.x) * t,
      y: clampedStart.y + (clampedPoint.y - clampedStart.y) * t,
      z: clampedStart.z + (clampedPoint.z - clampedStart.z) * t,
    })
    if (isFaceSketchRectWithinHost(entity, faceId, clampedStart, candidate)) {
      bestPoint = candidate
      low = t
    } else {
      high = t
    }
  }
  return bestPoint
}

export function resolveFaceSketchRect(
  entity: BaseMassEntity,
  faceId: BaseMassFaceId,
  startPoint: { x: number; y: number; z: number },
  endPoint: { x: number; y: number; z: number },
): FaceSketchRect | null {
  const faceInfo = getBaseMassFaceInfo(entity, faceId)
  if (!faceInfo) return null

  const startOffset = {
    x: startPoint.x - faceInfo.center.x,
    y: startPoint.y - faceInfo.center.y,
    z: startPoint.z - faceInfo.center.z,
  }
  const endOffset = {
    x: endPoint.x - faceInfo.center.x,
    y: endPoint.y - faceInfo.center.y,
    z: endPoint.z - faceInfo.center.z,
  }

  const startU = startOffset.x * faceInfo.axisU.x + startOffset.y * faceInfo.axisU.y + startOffset.z * faceInfo.axisU.z
  const endU = endOffset.x * faceInfo.axisU.x + endOffset.y * faceInfo.axisU.y + endOffset.z * faceInfo.axisU.z
  const startV = startOffset.x * faceInfo.axisV.x + startOffset.y * faceInfo.axisV.y + startOffset.z * faceInfo.axisV.z
  const endV = endOffset.x * faceInfo.axisV.x + endOffset.y * faceInfo.axisV.y + endOffset.z * faceInfo.axisV.z

  const minU = Math.min(startU, endU)
  const maxU = Math.max(startU, endU)
  const minV = Math.min(startV, endV)
  const maxV = Math.max(startV, endV)
  const centerU = (startU + endU) / 2
  const centerV = (startV + endV) / 2

  return {
    faceId,
    center: {
      x: faceInfo.center.x + faceInfo.axisU.x * centerU + faceInfo.axisV.x * centerV,
      y: faceInfo.center.y + faceInfo.axisU.y * centerU + faceInfo.axisV.y * centerV,
      z: faceInfo.center.z + faceInfo.axisU.z * centerU + faceInfo.axisV.z * centerV,
    },
    centerU,
    centerV,
    spanU: maxU - minU,
    spanV: maxV - minV,
    minU,
    maxU,
    minV,
    maxV,
  }
}

function solveAxisAlignedCircleRayDistance(
  origin: BuildingPoint2,
  direction: BuildingPoint2,
  radius: number,
): number[] {
  if (radius <= 0) return []
  if (Math.abs(direction.x) > Math.abs(direction.y)) {
    const y = origin.y
    const discriminant = radius * radius - y * y
    if (discriminant < -1e-9) return []
    const root = Math.sqrt(Math.max(0, discriminant))
    return [root, -root]
      .map(candidateX => (candidateX - origin.x) / direction.x)
      .filter(distance => distance >= -1e-6)
      .sort((a, b) => a - b)
  }
  const x = origin.x
  const discriminant = radius * radius - x * x
  if (discriminant < -1e-9) return []
  const root = Math.sqrt(Math.max(0, discriminant))
  return [root, -root]
    .map(candidateY => (candidateY - origin.y) / direction.y)
    .filter(distance => distance >= -1e-6)
    .sort((a, b) => a - b)
}

function intersectRayWithSegment(
  origin: BuildingPoint2,
  direction: BuildingPoint2,
  a: BuildingPoint2,
  b: BuildingPoint2,
): number | null {
  const segment = { x: b.x - a.x, y: b.y - a.y }
  const cross = direction.x * segment.y - direction.y * segment.x
  if (Math.abs(cross) <= 1e-9) return null
  const offset = { x: a.x - origin.x, y: a.y - origin.y }
  const rayT = (offset.x * segment.y - offset.y * segment.x) / cross
  const segmentT = (offset.x * direction.y - offset.y * direction.x) / cross
  if (rayT < -1e-6 || segmentT < -1e-6 || segmentT > 1 + 1e-6) return null
  return Math.max(0, rayT)
}

export function resolveTopHostSetbackDistance(
  entity: BaseMassEntity,
  pointLocal: BuildingPoint2,
  direction: TopHostedSetbackId,
): number | null {
  const dir = direction === 'left'
    ? { x: -1, y: 0 }
    : direction === 'right'
      ? { x: 1, y: 0 }
      : direction === 'bottom'
        ? { x: 0, y: -1 }
        : { x: 0, y: 1 }

  switch (entity.params.shape) {
    case 'rect': {
      const bounds = getBaseMassLocalFootprintBounds(entity)
      if (direction === 'left') return Math.max(0, pointLocal.x - bounds.minX)
      if (direction === 'right') return Math.max(0, bounds.maxX - pointLocal.x)
      if (direction === 'bottom') return Math.max(0, pointLocal.y - bounds.minY)
      return Math.max(0, bounds.maxY - pointLocal.y)
    }
    case 'circle': {
      const hits = solveAxisAlignedCircleRayDistance(pointLocal, dir, entity.params.radiusFt)
      const nextHit = hits.find(distance => distance >= -1e-6)
      return nextHit == null ? null : Math.max(0, nextHit)
    }
    case 'ring': {
      const hits = [
        ...solveAxisAlignedCircleRayDistance(pointLocal, dir, entity.params.radiusFt),
        ...solveAxisAlignedCircleRayDistance(pointLocal, dir, entity.params.innerRadiusFt),
      ]
        .filter(distance => distance >= -1e-6)
        .sort((a, b) => a - b)
      const nextHit = hits.find(distance => distance >= -1e-6)
      return nextHit == null ? null : Math.max(0, nextHit)
    }
    case 'polygon': {
      if (entity.params.points.length < 2) return null
      let nearest: number | null = null
      for (let index = 0; index < entity.params.points.length; index += 1) {
        const start = entity.params.points[index]!
        const end = entity.params.points[(index + 1) % entity.params.points.length]!
        const distance = intersectRayWithSegment(pointLocal, dir, start, end)
        if (distance == null) continue
        if (nearest == null || distance < nearest) {
          nearest = distance
        }
      }
      return nearest == null ? null : Math.max(0, nearest)
    }
    default:
      return null
  }
}

export function isTopHostedBoxWithinHost(
  entity: BaseMassEntity,
  centerU: number,
  centerV: number,
  widthFt: number,
  depthFt: number,
): boolean {
  const faceInfo = getBaseMassFaceInfo(entity, 'top')
  if (!faceInfo) return false

  const halfWidth = Math.max(0.05, widthFt / 2)
  const halfDepth = Math.max(0.05, depthFt / 2)
  const sampleCount = 5
  for (let uIndex = 0; uIndex < sampleCount; uIndex += 1) {
    const uT = uIndex / (sampleCount - 1)
    const sampleU = centerU - halfWidth + widthFt * uT
    for (let vIndex = 0; vIndex < sampleCount; vIndex += 1) {
      const vT = vIndex / (sampleCount - 1)
      const sampleV = centerV - halfDepth + depthFt * vT
      const samplePoint = resolveFacePointFromCoordinates(faceInfo, sampleU, sampleV)
      if (!isPointInsideBaseMassFootprint(entity, samplePoint)) {
        return false
      }
    }
  }

  return true
}

export function getHostedPatternPlaneSpanVFt(
  faceId: BaseMassFaceId,
  depthFt: number,
  heightFt: number,
) {
  return faceId === 'top'
    ? Math.max(0.1, Number(depthFt ?? 0))
    : Math.max(0.1, Number(heightFt ?? 0))
}

export function isHostedBoxWithinFace(
  entity: BaseMassEntity,
  faceId: BaseMassFaceId,
  centerU: number,
  centerV: number,
  widthFt: number,
  planeSpanVFt: number,
): boolean {
  if (faceId === 'top') {
    return isTopHostedBoxWithinHost(entity, centerU, centerV, widthFt, planeSpanVFt)
  }

  const faceInfo = getBaseMassFaceInfo(entity, faceId)
  if (!faceInfo) return false
  const halfWidth = Math.max(0.05, widthFt / 2)
  const halfSpanV = Math.max(0.05, planeSpanVFt / 2)
  return centerU - halfWidth >= -faceInfo.spanU / 2 - 1e-4
    && centerU + halfWidth <= faceInfo.spanU / 2 + 1e-4
    && centerV - halfSpanV >= -faceInfo.spanV / 2 - 1e-4
    && centerV + halfSpanV <= faceInfo.spanV / 2 + 1e-4
}

function sanitizeHostedPatternAxisDistribution(
  axis: HostedPatternAxisDistribution | undefined,
): HostedPatternAxisDistribution {
  return {
    mode: axis?.mode === 'spacing' || axis?.mode === 'fit' ? axis.mode : 'count',
    count: Math.max(1, Math.round(Number(axis?.count ?? 1) || 1)),
    spacingFt: Math.max(0, Number(axis?.spacingFt ?? 0) || 0),
    startSetbackFt: Math.max(0, Number(axis?.startSetbackFt ?? 0) || 0),
    endSetbackFt: Math.max(0, Number(axis?.endSetbackFt ?? 0) || 0),
    centered: axis?.centered !== false,
  }
}

export function sanitizeHostedPatternCornerBehavior(
  cornerBehavior: HostedPatternCornerBehavior | undefined,
  faceId: BaseMassFaceId,
  wrapMode: HostedPatternWrapMode | undefined,
): HostedPatternCornerBehavior {
  if (faceId === 'top' || wrapMode === 'single-face') return 'continuous'
  return cornerBehavior === 'restart-each-face' || cornerBehavior === 'align-to-corners'
    ? cornerBehavior
    : 'continuous'
}

function resolveHostedPatternAxisCenters(params: {
  faceSpanFt: number
  itemSpanFt: number
  distribution: HostedPatternAxisDistribution
}): number[] {
  const {
    faceSpanFt,
    itemSpanFt,
    distribution,
  } = params
  const availableSpan = Math.max(0, faceSpanFt - distribution.startSetbackFt - distribution.endSetbackFt)
  const itemSpan = Math.max(0.1, itemSpanFt)
  if (availableSpan < itemSpan - 1e-6) return []

  let count = Math.max(1, Math.round(distribution.count || 1))
  let spacingFt = Math.max(0, distribution.spacingFt || 0)

  if (distribution.mode === 'count') {
    const maxCount = Math.max(1, Math.floor(availableSpan / itemSpan))
    count = Math.min(count, maxCount)
    spacingFt = count <= 1
      ? 0
      : Math.max(0, (availableSpan - count * itemSpan) / Math.max(1, count - 1))
  } else {
    count = Math.max(1, Math.floor((availableSpan + spacingFt) / Math.max(itemSpan + spacingFt, 1e-6)))
    if (distribution.mode === 'fit') {
      count = Math.max(1, count)
    }
  }

  if (count <= 0) return []

  const occupiedSpan = count * itemSpan + Math.max(0, count - 1) * spacingFt
  const freeSpan = Math.max(0, availableSpan - occupiedSpan)
  const leadingOffset = distribution.centered ? freeSpan / 2 : 0
  const firstCenter = -faceSpanFt / 2 + distribution.startSetbackFt + leadingOffset + itemSpan / 2

  return Array.from({ length: count }, (_, index) => (
    firstCenter + index * (itemSpan + spacingFt)
  ))
}

function resolveHostedPatternAxisCentersAlignedToCorners(params: {
  faceSpanFt: number
  itemSpanFt: number
  distribution: HostedPatternAxisDistribution
}): number[] {
  const {
    faceSpanFt,
    itemSpanFt,
    distribution,
  } = params
  const availableSpan = Math.max(0, faceSpanFt - distribution.startSetbackFt - distribution.endSetbackFt)
  const itemSpan = Math.max(0.1, itemSpanFt)
  if (availableSpan < itemSpan - 1e-6) return []

  let count = Math.max(1, Math.round(distribution.count || 1))
  if (distribution.mode !== 'count') {
    const spacingFt = Math.max(0, distribution.spacingFt || 0)
    count = Math.max(1, Math.floor((availableSpan + spacingFt) / Math.max(itemSpan + spacingFt, 1e-6)))
  }

  return resolveHostedPatternAxisCenters({
    faceSpanFt,
    itemSpanFt,
    distribution: {
      ...distribution,
      mode: 'count',
      count,
      centered: false,
    },
  })
}

function mergePatternAnalysis(
  baseAnalysis: BuildingAnalysisFlags,
  overrideAnalysis?: Partial<BuildingAnalysisFlags>,
) {
  return {
    ...baseAnalysis,
    ...(overrideAnalysis ?? {}),
  }
}

const RECT_PATTERN_WRAP_ORDER: SideFeatureFaceId[] = ['front', 'right', 'back', 'left']

export function sanitizeHostedPatternWallFaceIds(
  faceIds: SideFeatureFaceId[] | undefined,
  startFaceId: SideFeatureFaceId,
): SideFeatureFaceId[] {
  const requested = Array.isArray(faceIds) ? faceIds.filter((faceId): faceId is SideFeatureFaceId => (
    RECT_PATTERN_WRAP_ORDER.includes(faceId)
  )) : []
  const next = new Set<SideFeatureFaceId>([startFaceId, ...requested])
  return RECT_PATTERN_WRAP_ORDER.filter((faceId) => next.has(faceId))
}

export function resolveHostedPatternFaceIds(
  pattern: HostedPatternEntity,
  host: BaseMassEntity,
): BaseMassFaceId[] {
  if (pattern.host.entityId !== host.id) return []
  if (pattern.host.faceId === 'top') return ['top']
  if (host.params.shape !== 'rect') return [pattern.host.faceId]
  const startFaceId = pattern.host.faceId as SideFeatureFaceId
  const startIndex = RECT_PATTERN_WRAP_ORDER.indexOf(startFaceId)
  if (startIndex < 0) return [pattern.host.faceId]
  const orderedFaces = [
    ...RECT_PATTERN_WRAP_ORDER.slice(startIndex),
    ...RECT_PATTERN_WRAP_ORDER.slice(0, startIndex),
  ]
  if (pattern.params.wrapMode === 'all-walls') return orderedFaces
  if (pattern.params.wrapMode === 'selected-walls') {
    const selectedFaces = new Set(sanitizeHostedPatternWallFaceIds(pattern.params.wallFaceIds, startFaceId))
    return orderedFaces.filter((faceId) => selectedFaces.has(faceId))
  }
  return [pattern.host.faceId]
}

export function resolveHostedPatternInstances(
  pattern: HostedPatternEntity,
  host: BaseMassEntity,
): ResolvedHostedPatternInstance[] {
  if (pattern.host.entityId !== host.id) return []
  const faceIds = resolveHostedPatternFaceIds(pattern, host)
  if (faceIds.length === 0) return []
  const faceInfos = faceIds
    .map((faceId) => getBaseMassFaceInfo(host, faceId))
    .filter((faceInfo): faceInfo is BaseMassFaceInfo => Boolean(faceInfo))
  if (faceInfos.length === 0) return []
  const primaryFaceInfo = faceInfos[0]

  const distributionU = sanitizeHostedPatternAxisDistribution(pattern.params.distributionU)
  const distributionV = sanitizeHostedPatternAxisDistribution(pattern.params.distributionV)
  const cornerBehavior = sanitizeHostedPatternCornerBehavior(
    pattern.params.cornerBehavior,
    pattern.host.faceId,
    pattern.params.wrapMode,
  )
  const widthFt = Math.max(0.1, Number(pattern.params.widthFt ?? 0))
  const depthFt = Math.max(0.1, Number(pattern.params.depthFt ?? 0))
  const heightFt = Math.max(0.1, Number(pattern.params.heightFt ?? 0))
  const planeSpanVFt = getHostedPatternPlaneSpanVFt(primaryFaceInfo.faceId, depthFt, heightFt)
  const totalSpanU = faceInfos.reduce((sum, faceInfo) => sum + faceInfo.spanU, 0)
  const centersV = resolveHostedPatternAxisCenters({
    faceSpanFt: primaryFaceInfo.spanV,
    itemSpanFt: planeSpanVFt,
    distribution: distributionV,
  })
  const faceSegments = faceInfos.map((faceInfo) => ({ faceInfo, spanU: faceInfo.spanU }))
  let runningStart = -totalSpanU / 2
  const resolvedSegments = faceSegments.map((segment) => {
    const start = runningStart
    const end = start + segment.spanU
    runningStart = end
    return {
      faceInfo: segment.faceInfo,
      start,
      end,
      center: start + segment.spanU / 2,
    }
  })

  const buildInstance = (params: {
    instanceId: string
    faceInfo: BaseMassFaceInfo
    globalCenterUFt: number
    localCenterUFt: number
    localCenterVFt: number
  }): ResolvedHostedPatternInstance | null => {
    const {
      instanceId,
      faceInfo,
      globalCenterUFt,
      localCenterUFt,
      localCenterVFt,
    } = params
    const override = pattern.instanceOverrides[instanceId]
    const nextWidthFt = Math.max(0.1, Number(override?.widthFt ?? widthFt))
    const nextDepthFt = Math.max(0.1, Number(override?.depthFt ?? depthFt))
    const nextHeightFt = Math.max(0.1, Number(override?.heightFt ?? heightFt))
    const nextPlaneSpanVFt = getHostedPatternPlaneSpanVFt(faceInfo.faceId, nextDepthFt, nextHeightFt)
    const offsetUFt = Number(override?.offsetUFt ?? localCenterUFt)
    const offsetVFt = Number(override?.offsetVFt ?? localCenterVFt)
    const resolvedGlobalCenterUFt = globalCenterUFt + (offsetUFt - localCenterUFt)
    const globalMinUFt = resolvedGlobalCenterUFt - nextWidthFt / 2
    const globalMaxUFt = resolvedGlobalCenterUFt + nextWidthFt / 2
    const hidden = Boolean(override?.hidden) || pattern.skippedInstanceIds.includes(instanceId)
    if (!hidden && !isHostedBoxWithinFace(host, faceInfo.faceId, offsetUFt, offsetVFt, nextWidthFt, nextPlaneSpanVFt)) {
      return null
    }
    return {
      instanceId,
      patternId: pattern.id,
      contentType: pattern.params.contentType,
      featurePreset: pattern.params.featurePreset,
      faceId: faceInfo.faceId,
      widthFt: nextWidthFt,
      depthFt: nextDepthFt,
      heightFt: nextHeightFt,
      offsetUFt,
      offsetVFt,
      globalCenterUFt: resolvedGlobalCenterUFt,
      globalMinUFt,
      globalMaxUFt,
      analysis: mergePatternAnalysis(pattern.analysis, override?.analysis),
      hidden,
    }
  }

  const nextInstances: ResolvedHostedPatternInstance[] = []
  if (cornerBehavior === 'continuous') {
    const totalSpanU = faceInfos.reduce((sum, faceInfo) => sum + faceInfo.spanU, 0)
    const centersU = resolveHostedPatternAxisCenters({
      faceSpanFt: totalSpanU,
      itemSpanFt: widthFt,
      distribution: distributionU,
    })
    for (let vIndex = 0; vIndex < centersV.length; vIndex += 1) {
      for (let uIndex = 0; uIndex < centersU.length; uIndex += 1) {
        const globalCenterU = centersU[uIndex] ?? 0
        const segment = resolvedSegments.find((candidate, index) => (
          globalCenterU >= candidate.start - 1e-6
          && (globalCenterU <= candidate.end + 1e-6 || index === resolvedSegments.length - 1)
        )) ?? resolvedSegments[resolvedSegments.length - 1]
        if (!segment) continue
        const nextInstance = buildInstance({
          instanceId: `${pattern.id}:r${vIndex}:c${uIndex}`,
          faceInfo: segment.faceInfo,
          globalCenterUFt: globalCenterU,
          localCenterUFt: globalCenterU - segment.center,
          localCenterVFt: centersV[vIndex] ?? 0,
        })
        if (nextInstance) nextInstances.push(nextInstance)
      }
    }
    return nextInstances
  }

  for (let vIndex = 0; vIndex < centersV.length; vIndex += 1) {
    for (const segment of resolvedSegments) {
      const localCentersU = cornerBehavior === 'align-to-corners'
        ? resolveHostedPatternAxisCentersAlignedToCorners({
            faceSpanFt: segment.faceInfo.spanU,
            itemSpanFt: widthFt,
            distribution: distributionU,
          })
        : resolveHostedPatternAxisCenters({
            faceSpanFt: segment.faceInfo.spanU,
            itemSpanFt: widthFt,
            distribution: distributionU,
          })
      for (let uIndex = 0; uIndex < localCentersU.length; uIndex += 1) {
        const localCenterU = localCentersU[uIndex] ?? 0
        const nextInstance = buildInstance({
          instanceId: `${pattern.id}:f${segment.faceInfo.faceId}:r${vIndex}:c${uIndex}`,
          faceInfo: segment.faceInfo,
          globalCenterUFt: segment.center + localCenterU,
          localCenterUFt: localCenterU,
          localCenterVFt: centersV[vIndex] ?? 0,
        })
        if (nextInstance) nextInstances.push(nextInstance)
      }
    }
  }

  return nextInstances
}
