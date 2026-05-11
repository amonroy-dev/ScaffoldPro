import * as THREE from 'three'

import type { LedgerConnection, ScaffoldStack } from '../../types/scaffoldGraph'
import { feetToInches } from '../unitConversion'
import { buildScaffoldCenterlineModelFt } from './scaffoldCenterlines'

/**
 * RISA-3D oriented DXF export.
 *
 * Notes:
 * - RISA-3D's default global vertical axis is Y (many CAD/Three.js apps are Z-up).
 * - RISA import commonly maps: POINT -> joints, LINE -> members.
 *
 * This exporter therefore supports an axis mapping preset that rotates Z-up world
 * into a Y-up DXF (X stays X; Z becomes Y; Y becomes Z).
 */
export type RisaDxfAxisMapping = 'Z_UP' | 'RISA_Y_UP'
export type DxfLinearUnits = 'inches' | 'feet'

export interface Risa3dDxfOptions {
  /** Default: 'RISA_Y_UP' for frictionless RISA-3D import. */
  axisMapping?: RisaDxfAxisMapping
  /** Default: 'inches' (RISA-friendly). */
  units?: DxfLinearUnits
  /** Include POINT entities for joints. Default: true. */
  includeJoints?: boolean
  /** Include jack/ground segments layer. Default: true. */
  includeJacks?: boolean
  /** Include standard segments layer. Default: true. */
  includeStandards?: boolean
  /** Include ledger segments layer. Default: true. */
  includeLedgers?: boolean
  /** Emit a minimal TABLES section (LTYPE + LAYER). Default: true. */
  includeTables?: boolean
  /** Emit a minimal BLOCKS section (*MODEL_SPACE/*PAPER_SPACE). Default: true. */
  includeBlocks?: boolean
  /** Emit group code 5 handles for entities. Default: true. */
  includeHandles?: boolean
  /** DXF version string (HEADER $ACADVER). Default: 'AC1015' (AutoCAD 2000). */
  acadVersion?: string
  /** Decimal places for coordinates. Default: 6. */
  precision?: number
  /** Newline sequence. Default: '\r\n' for broad CAD compatibility. */
  newline?: '\n' | '\r\n'
}

function fmt(n: number, precision: number): string {
  // Avoid scientific notation (DXF readers can be picky)
  return Number.isFinite(n) ? n.toFixed(precision) : '0'
}

function posKeyFt(v: THREE.Vector3): string {
  return `${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`
}

function mapAxisFt(v: THREE.Vector3, mapping: RisaDxfAxisMapping): THREE.Vector3 {
  if (mapping === 'RISA_Y_UP') {
    // Z-up (X,Y,Z) -> Y-up (X,Y,Z) = (X,Z,Y)
    return new THREE.Vector3(v.x, v.z, v.y)
  }
  return v.clone()
}

function unitsCode(units: DxfLinearUnits): number {
  // AutoCAD $INSUNITS codes.
  // 1=inches, 2=feet (we only need these for now).
  return units === 'feet' ? 2 : 1
}

function toUnits(vFt: THREE.Vector3, units: DxfLinearUnits): { x: number; y: number; z: number } {
  if (units === 'feet') return { x: vFt.x, y: vFt.y, z: vFt.z }
  return { x: feetToInches(vFt.x), y: feetToInches(vFt.y), z: feetToInches(vFt.z) }
}

function expandBounds(
  bounds: { min: THREE.Vector3; max: THREE.Vector3 } | null,
  p: { x: number; y: number; z: number },
): { min: THREE.Vector3; max: THREE.Vector3 } {
  if (!bounds) {
    return {
      min: new THREE.Vector3(p.x, p.y, p.z),
      max: new THREE.Vector3(p.x, p.y, p.z),
    }
  }
  bounds.min.x = Math.min(bounds.min.x, p.x)
  bounds.min.y = Math.min(bounds.min.y, p.y)
  bounds.min.z = Math.min(bounds.min.z, p.z)
  bounds.max.x = Math.max(bounds.max.x, p.x)
  bounds.max.y = Math.max(bounds.max.y, p.y)
  bounds.max.z = Math.max(bounds.max.z, p.z)
  return bounds
}

export function buildRisa3dDxfExport(args: {
  scaffoldStacks: ScaffoldStack[]
  ledgerConnections: LedgerConnection[]
  baseSettings: { showWoodSill: boolean; showBaseCollar: boolean }
  options?: Risa3dDxfOptions
}): {
  dxf: string
  modelFt: ReturnType<typeof buildScaffoldCenterlineModelFt>
} {
  const modelFt = buildScaffoldCenterlineModelFt(args)

  const options: Required<Risa3dDxfOptions> = {
    axisMapping: args.options?.axisMapping ?? 'RISA_Y_UP',
    units: args.options?.units ?? 'inches',
    includeJoints: args.options?.includeJoints ?? true,
    includeJacks: args.options?.includeJacks ?? true,
    includeStandards: args.options?.includeStandards ?? true,
    includeLedgers: args.options?.includeLedgers ?? true,
    includeTables: args.options?.includeTables ?? true,
    includeBlocks: args.options?.includeBlocks ?? true,
    includeHandles: args.options?.includeHandles ?? true,
    acadVersion: args.options?.acadVersion ?? 'AC1015',
    precision: args.options?.precision ?? 6,
    newline: args.options?.newline ?? '\r\n',
  }

  const out: string[] = []
  const pair = (code: number, value: string | number) => {
    out.push(String(code))
    out.push(String(value))
  }

  let nextHandle = 0x100
  const allocHandle = () => {
    const h = nextHandle.toString(16).toUpperCase()
    nextHandle += 1
    return h
  }

  // Track bounds in *export* coordinate system + export units.
  let bounds: { min: THREE.Vector3; max: THREE.Vector3 } | null = null

  const vOut = (vFt: THREE.Vector3) => {
    const mappedFt = mapAxisFt(vFt, options.axisMapping)
    return toUnits(mappedFt, options.units)
  }

  // Some CAD importers behave better when layer + linetype tables exist.
  // Use AutoCAD Color Index (ACI) colors.
  const layers: Array<{ name: string; color: number; ltype: string }> = [
    { name: '0', color: 7, ltype: 'CONTINUOUS' },
    { name: 'SCF_STANDARDS', color: 4, ltype: 'CONTINUOUS' }, // cyan
    { name: 'SCF_LEDGERS', color: 3, ltype: 'CONTINUOUS' }, // green
    { name: 'SCF_JACKS', color: 30, ltype: 'CONTINUOUS' }, // orange-ish
    { name: 'SCF_JOINTS', color: 7, ltype: 'CONTINUOUS' }, // white
  ]

  const layerNameForSegment = (layer: string) => {
    return layer === 'SCF_STANDARD'
      ? 'SCF_STANDARDS'
      : layer === 'SCF_LEDGER'
        ? 'SCF_LEDGERS'
        : layer === 'SCF_JACK'
          ? 'SCF_JACKS'
          : 'SCF_STANDARDS'
  }

  type SegmentFt = ReturnType<typeof buildScaffoldCenterlineModelFt>['segmentsFt'][number]
  const segmentIncluded = (s: SegmentFt) => {
    if (s.layer === 'SCF_JACK' && !options.includeJacks) return false
    if (s.layer === 'SCF_STANDARD' && !options.includeStandards) return false
    if (s.layer === 'SCF_LEDGER' && !options.includeLedgers) return false
    return true
  }

  const exportSegmentsFt: SegmentFt[] = modelFt.segmentsFt.filter(segmentIncluded)

  const exportJointPointsFt = () => {
    const m = new Map<string, THREE.Vector3>()
    for (const s of exportSegmentsFt) {
      const ks = posKeyFt(s.start)
      if (!m.has(ks)) m.set(ks, s.start.clone())
      const ke = posKeyFt(s.end)
      if (!m.has(ke)) m.set(ke, s.end.clone())
    }
    return Array.from(m.values())
  }

  // HEADER
  pair(0, 'SECTION')
  pair(2, 'HEADER')
  pair(9, '$ACADVER')
  pair(1, options.acadVersion)

  pair(9, '$INSUNITS')
  pair(70, unitsCode(options.units))
  pair(9, '$MEASUREMENT')
  pair(70, 0) // 0 = imperial

  // Point display defaults (helps when opening in general CAD viewers).
  pair(9, '$PDMODE')
  pair(70, 0)
  pair(9, '$PDSIZE')
  pair(40, 0)

  // Precompute bounds from all exported geometry (in export units).
  for (const s of exportSegmentsFt) {
    const a = vOut(s.start)
    const b = vOut(s.end)
    bounds = expandBounds(bounds, a)
    bounds = expandBounds(bounds, b)
  }

  if (options.includeJoints) {
    for (const pFt of exportJointPointsFt()) {
      const p = vOut(pFt)
      bounds = expandBounds(bounds, p)
    }
  }

  // $EXTMIN/$EXTMAX help some importers position/zoom correctly.
  const bMin = bounds?.min ?? new THREE.Vector3(0, 0, 0)
  const bMax = bounds?.max ?? new THREE.Vector3(0, 0, 0)
  pair(9, '$EXTMIN')
  pair(10, fmt(bMin.x, options.precision))
  pair(20, fmt(bMin.y, options.precision))
  pair(30, fmt(bMin.z, options.precision))
  pair(9, '$EXTMAX')
  pair(10, fmt(bMax.x, options.precision))
  pair(20, fmt(bMax.y, options.precision))
  pair(30, fmt(bMax.z, options.precision))

  // $HANDSEED is optional; include it when emitting handles.
  if (options.includeHandles) {
    pair(9, '$HANDSEED')
    pair(5, 'FFFF')
  }

  pair(0, 'ENDSEC')

  // TABLES (LTYPE + LAYER) - improves compatibility with stricter CAD readers.
  if (options.includeTables) {
    pair(0, 'SECTION')
    pair(2, 'TABLES')

    // LTYPE table (CONTINUOUS)
    pair(0, 'TABLE')
    pair(2, 'LTYPE')
    pair(70, 1)
    pair(0, 'LTYPE')
    pair(2, 'CONTINUOUS')
    pair(70, 0)
    pair(3, 'Solid line')
    pair(72, 65)
    pair(73, 0)
    pair(40, 0)
    pair(0, 'ENDTAB')

    // LAYER table
    pair(0, 'TABLE')
    pair(2, 'LAYER')
    pair(70, layers.length)
    for (const l of layers) {
      pair(0, 'LAYER')
      pair(2, l.name)
      pair(70, 0)
      pair(62, l.color)
      pair(6, l.ltype)
    }
    pair(0, 'ENDTAB')

    pair(0, 'ENDSEC')
  }

  // BLOCKS (minimal model/paper space blocks). Some CAD readers prefer this present.
  if (options.includeBlocks) {
    pair(0, 'SECTION')
    pair(2, 'BLOCKS')

    pair(0, 'BLOCK')
    pair(8, '0')
    pair(2, '*MODEL_SPACE')
    pair(70, 0)
    pair(10, 0)
    pair(20, 0)
    pair(30, 0)
    pair(3, '*MODEL_SPACE')
    pair(1, '')
    pair(0, 'ENDBLK')

    pair(0, 'BLOCK')
    pair(8, '0')
    pair(2, '*PAPER_SPACE')
    pair(70, 0)
    pair(10, 0)
    pair(20, 0)
    pair(30, 0)
    pair(3, '*PAPER_SPACE')
    pair(1, '')
    pair(0, 'ENDBLK')

    pair(0, 'ENDSEC')
  }

  // ENTITIES
  pair(0, 'SECTION')
  pair(2, 'ENTITIES')

  // Metadata comment (safe; ignored by most importers)
  pair(999, 'ScaffoldPro - RISA-3D DXF Export')
  pair(999, `Units=${options.units}, AxisMapping=${options.axisMapping}`)

  if (options.includeJoints) {
    for (const pFt of exportJointPointsFt()) {
      const p = vOut(pFt)
      pair(0, 'POINT')
      if (options.includeHandles) pair(5, allocHandle())
      pair(8, 'SCF_JOINTS')
      pair(10, fmt(p.x, options.precision))
      pair(20, fmt(p.y, options.precision))
      pair(30, fmt(p.z, options.precision))
    }
  }

  for (const s of exportSegmentsFt) {
    const a = vOut(s.start)
    const b = vOut(s.end)
    pair(0, 'LINE')
    if (options.includeHandles) pair(5, allocHandle())
    pair(8, layerNameForSegment(s.layer))
    pair(10, fmt(a.x, options.precision))
    pair(20, fmt(a.y, options.precision))
    pair(30, fmt(a.z, options.precision))
    pair(11, fmt(b.x, options.precision))
    pair(21, fmt(b.y, options.precision))
    pair(31, fmt(b.z, options.precision))
  }

  pair(0, 'ENDSEC')
  pair(0, 'EOF')

  return { dxf: out.join(options.newline) + options.newline, modelFt }
}
