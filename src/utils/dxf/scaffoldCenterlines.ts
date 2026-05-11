import * as THREE from 'three'

import type { LedgerConnection, ScaffoldStack } from '../../types/scaffoldGraph'
import { computeRosettePositions, getStandardBaseOffsetFt } from '../../components/scaffold/scaffoldGeometry'
import { UNIVERSAL_RINGLOCK_STANDARDS, type UniversalRinglockStandardId } from '../../components/scaffold/ringlockCatalog'

export type ScaffoldCenterlineLayer = 'SCF_STANDARD' | 'SCF_LEDGER' | 'SCF_JACK' | 'SCF_JOINT'

export interface ScaffoldCenterlineSegmentFt {
  start: THREE.Vector3
  end: THREE.Vector3
  layer: ScaffoldCenterlineLayer
}

export interface ScaffoldCenterlineModelFt {
  segmentsFt: ScaffoldCenterlineSegmentFt[]
  pointsFt: THREE.Vector3[]
}

function posKey(v: THREE.Vector3): string {
  return `${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`
}

export function buildScaffoldCenterlineModelFt(args: {
  scaffoldStacks: ScaffoldStack[]
  ledgerConnections: LedgerConnection[]
  baseSettings: { showWoodSill: boolean; showBaseCollar: boolean }
}): ScaffoldCenterlineModelFt {
  const { scaffoldStacks, ledgerConnections, baseSettings } = args

  const segmentsFt: ScaffoldCenterlineSegmentFt[] = []

  const effectiveFlagsByStackId = new Map<string, { showWoodSill: boolean; showBaseCollar: boolean }>()
  for (const s of scaffoldStacks) {
    const showWoodSill = s.baseSupport === 'stacked' ? false : (s.showWoodSill ?? baseSettings.showWoodSill)
    const showBaseCollar = s.baseSupport === 'stacked' ? false : (s.showBaseCollar ?? baseSettings.showBaseCollar)
    effectiveFlagsByStackId.set(s.id, { showWoodSill, showBaseCollar })
  }

  // Precompute rosette nodes per stack.
  const nodesByStackId = new Map<string, Array<{ liftIndex: number; position: THREE.Vector3 }>>()
  for (const s of scaffoldStacks) {
    const flags = effectiveFlagsByStackId.get(s.id) ?? { showWoodSill: baseSettings.showWoodSill, showBaseCollar: baseSettings.showBaseCollar }
    const nodes = computeRosettePositions(
      s.gridPosition,
      s.standardSegments,
      s.jackExtensionIn,
      flags.showWoodSill,
      flags.showBaseCollar,
    )
    nodes.sort((a, b) => a.position.z - b.position.z)
    nodesByStackId.set(s.id, nodes)

			// Base joint (bottom of standard). This makes the exported frame model start at a sensible node,
			// rather than the first rosette floating above the base.
			const standardBaseWorldZ =
				s.gridPosition.z + getStandardBaseOffsetFt(s.jackExtensionIn, flags.showWoodSill, flags.showBaseCollar)
			const basePoint = new THREE.Vector3(s.gridPosition.x, s.gridPosition.y, standardBaseWorldZ)

				// Ground/grid point (where the base assembly sits).
				// The user expects to see a wireframe segment from the grid up to the bottom of the standard
				// (i.e., the screw jack / base assembly height).
				const groundPoint = s.gridPosition.clone()
				const isStacked = s.baseSupport === 'stacked'
				// Base assembly centerline (grid -> standard base) on its own layer.
				// Guard against accidental zero-length lines.
				if (!isStacked && Math.abs(basePoint.z - groundPoint.z) > 1e-6) {
					segmentsFt.push({ start: groundPoint.clone(), end: basePoint.clone(), layer: 'SCF_JACK' })
				}

			// Standard centerlines (RISA-friendly): export ONE member per stacked standard *piece*,
			// not rosette-to-rosette segments.
			let z = basePoint.z
			for (const seg of s.standardSegments ?? []) {
				const pn = String((seg as any)?.partNumber ?? '')
				const spec = UNIVERSAL_RINGLOCK_STANDARDS[pn as UniversalRinglockStandardId]
				if (!spec) continue
				const bottom = new THREE.Vector3(basePoint.x, basePoint.y, z)
				const top = new THREE.Vector3(basePoint.x, basePoint.y, z + spec.heightFt)
				if (Math.abs(top.z - bottom.z) > 1e-6) {
					segmentsFt.push({ start: bottom.clone(), end: top.clone(), layer: 'SCF_STANDARD' })
				}
				z += spec.heightFt
			}
  }

  // Ledger centerlines.
  for (const c of ledgerConnections) {
    const startNodes = nodesByStackId.get(c.startNode.stackId)
    const endNodes = nodesByStackId.get(c.endNode.stackId)
    if (!startNodes || !endNodes) continue

    const start = startNodes.find(n => n.liftIndex === c.startNode.liftIndex)?.position
    const end = endNodes.find(n => n.liftIndex === c.endNode.liftIndex)?.position
    if (!start || !end) continue

    segmentsFt.push({ start: start.clone(), end: end.clone(), layer: 'SCF_LEDGER' })
  }

	  // Joint points: only emit points that correspond to actual exported member endpoints.
	  // (Avoid exporting every rosette as a joint in RISA when there is no member attached.)
	  const pointsByKey = new Map<string, THREE.Vector3>()
	  for (const s of segmentsFt) {
	    const ks = posKey(s.start)
	    if (!pointsByKey.has(ks)) pointsByKey.set(ks, s.start.clone())
	    const ke = posKey(s.end)
	    if (!pointsByKey.has(ke)) pointsByKey.set(ke, s.end.clone())
	  }

	  return { segmentsFt, pointsFt: Array.from(pointsByKey.values()) }
}
