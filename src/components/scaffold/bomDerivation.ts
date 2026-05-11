import * as THREE from 'three'
import type { CatalogManufacturer, CatalogPart } from '../../catalog/catalogSchema'
import { roundDisplayWeightLb } from '../../catalog/scaffoldDisplay'
import type { ScaffoldBaseSettings } from '../../contexts/ScaffoldBaseSettings'
import type { RinglockBaseInstance } from './RinglockBases'
import type { RinglockDiagonalInstance } from './RinglockDiagonals'
import type { RinglockLedgerInstance } from './RinglockLedgers'
import { RINGLOCK_PLANK_PROFILE_DEPTH_IN, RINGLOCK_PLANK_WIDTH_IN, type RinglockPlankInstance } from './RinglockPlanks'
import type { RinglockStandardInstance } from './RinglockStandards'
import { buildManualPlankInstances } from './manualPlankPlacement'
import { buildBestFitPlankLayout, resolveClosestCatalogPlankPartNumber } from './plankLayout'
import { UNIVERSAL_RINGLOCK_STANDARDS, type UniversalRinglockStandardId } from './ringlockCatalog'
import { buildStandardPlan, chooseBayLayout, resolveBlockDeckPlan, resolveRoundAutoBayFrame, rotateOffset90 } from './blockPlanning'
import { computeRosettePositions, getStandardBaseOffsetFt } from './scaffoldGeometry'
import { computeRectUnionBoundarySegments } from './guardrailPlanning'
import { inchesToFeet } from './units'
import {
  UNIVERSAL_LEDGER_LENGTHS,
  UNIVERSAL_RINGLOCK_DIAGONALS,
  UNIVERSAL_RINGLOCK_HORIZONTALS,
  UNIVERSAL_RINGLOCK_TRUSSES,
  findClosestDiagonal,
  type LedgerConnection,
  type ManualPlankPlacement,
  type ScaffoldBlockInstance,
  type ScaffoldStack,
} from '../../types/scaffoldGraph'
import { SCAFFOLD_WEIGHTS } from '../../types/scaffoldObjects'

const LEDGER_TUBE_OD_IN = 1.9
const PLANK_MOUTHPIECE_TOTAL_IN = 6

export type BomCategory = 'Standards' | 'Bases' | 'Ledgers' | 'Trusses' | 'Diagonals' | 'Planks'
export type BomSource = 'catalog' | 'fallback' | 'system' | 'missing'

export type BomSelectionTarget = {
  primaryObjectId: string | null
  objectIds: string[]
  stackIds: string[]
}

export type BomLineItem = {
  id: string
  category: BomCategory
  partNumber: string | null
  description: string
  quantity: number
  unitWeightLb: number | null
  totalWeightLb: number | null
  metadataSource: BomSource
  weightSource: BomSource
  selection: BomSelectionTarget
}

export type BomSummary = {
  lineItemCount: number
  totalQuantity: number
  totalWeightLb: number
  weightedLineItemCount: number
  nonCatalogLineItemCount: number
  missingWeightLineItemCount: number
  modelItemCount: number
}

export type DerivedBom = {
  lineItems: BomLineItem[]
  summary: BomSummary
}

export type DerivedScaffoldGeometry = {
	standardInstances: RinglockStandardInstance[]
	baseInstances: RinglockBaseInstance[]
	ledgerInstances: RinglockLedgerInstance[]
	diagonalInstances: RinglockDiagonalInstance[]
	plankInstances: RinglockPlankInstance[]
}

type MutableLineItem = Omit<BomLineItem, 'totalWeightLb'>

const CATEGORY_ORDER: Record<BomCategory, number> = {
  Standards: 0,
  Bases: 1,
  Ledgers: 2,
  Trusses: 3,
  Diagonals: 4,
  Planks: 5,
}

const SOURCE_ORDER: Record<BomSource, number> = {
  catalog: 0,
  system: 1,
  fallback: 2,
  missing: 3,
}

function buildCatalogWeightMap(parts: Array<{ partNumber: string; weightLb?: number }>) {
  return new Map(
    parts
      .filter((part): part is { partNumber: string; weightLb: number } => typeof part.weightLb === 'number')
      .map((part) => [part.partNumber, part.weightLb] as const),
  )
}

function resolveClosestCatalogPlankWeightLb(
  plank: RinglockPlankInstance,
  parts: Array<Pick<CatalogPart, 'partNumber' | 'plankWidthIn'>>,
  weightByPartNumber: Map<string, number>,
) {
  if (plank.partNumber) return weightByPartNumber.get(plank.partNumber) ?? null
  const resolved = resolveClosestCatalogPlankPartNumber(parts, plank.widthIn, plank.lengthFt)
  if (!resolved) return null
  return weightByPartNumber.get(resolved) ?? null
}

function buildPartMap(parts: CatalogPart[]) {
  return new Map(parts.map((part) => [part.partNumber, part] as const))
}

function normalizeBomWeight(value: number | null | undefined) {
  return roundDisplayWeightLb(value)
}

function formatFeetInches(lengthFt: number) {
  if (!Number.isFinite(lengthFt) || lengthFt <= 0) return '0\''
  const totalIn = Math.max(0, Math.round(lengthFt * 12))
  const feet = Math.floor(totalIn / 12)
  const inches = totalIn % 12
  return inches === 0 ? `${feet}'` : `${feet}'-${inches}"`
}

function getWorseSource(a: BomSource, b: BomSource): BomSource {
  return SOURCE_ORDER[a] >= SOURCE_ORDER[b] ? a : b
}

function mergeUniqueStrings(target: string[], incoming: string[]) {
  const seen = new Set(target)
  for (const value of incoming) {
    if (!value || seen.has(value)) continue
    target.push(value)
    seen.add(value)
  }
}

function addOrUpdateLine(lineMap: Map<string, MutableLineItem>, next: MutableLineItem) {
  const existing = lineMap.get(next.id)
  if (!existing) {
    lineMap.set(next.id, next)
    return
  }
  existing.quantity += next.quantity
  existing.metadataSource = getWorseSource(existing.metadataSource, next.metadataSource)
  existing.weightSource = getWorseSource(existing.weightSource, next.weightSource)
  if (!existing.selection.primaryObjectId && next.selection.primaryObjectId) {
    existing.selection.primaryObjectId = next.selection.primaryObjectId
  }
  mergeUniqueStrings(existing.selection.objectIds, next.selection.objectIds)
  mergeUniqueStrings(existing.selection.stackIds, next.selection.stackIds)
  if (existing.unitWeightLb == null && next.unitWeightLb != null) existing.unitWeightLb = next.unitWeightLb
  if (
    SOURCE_ORDER[next.metadataSource] < SOURCE_ORDER[existing.metadataSource] &&
    next.description.trim().length > 0
  ) {
    existing.description = next.description
  }
}

function deriveStandardInstances(scaffoldStacks: ScaffoldStack[], baseSettings: ScaffoldBaseSettings) {
  const out: RinglockStandardInstance[] = []
  for (const stack of scaffoldStacks) {
    const segments = stack.standardSegments
    if (!Array.isArray(segments) || segments.length === 0) continue
    const showWoodSill = stack.baseSupport === 'stacked' ? false : (stack.showWoodSill ?? baseSettings.showWoodSill)
    const showBaseCollar = stack.baseSupport === 'stacked' ? false : (stack.showBaseCollar ?? baseSettings.showBaseCollar)
    const baseOffsetFt = getStandardBaseOffsetFt(stack.jackExtensionIn, showWoodSill, showBaseCollar)
    const baseWorldZ = stack.gridPosition.z + baseOffsetFt
    let cumulativeHeightFt = 0
    let segmentIndex = 0
    for (const seg of segments) {
      const pn = String(seg?.partNumber ?? '')
      const spec = UNIVERSAL_RINGLOCK_STANDARDS[pn as UniversalRinglockStandardId]
      if (!spec) {
        segmentIndex++
        continue
      }
      out.push({
        id: `${stack.id}@${segmentIndex}`,
        stackId: stack.id,
        segmentIndex,
        partNumber: pn,
        basePosition: new THREE.Vector3(stack.gridPosition.x, stack.gridPosition.y, baseWorldZ + cumulativeHeightFt),
        heightFt: spec.heightFt,
        rosetteCount: spec.rosetteCount,
      })
      cumulativeHeightFt += spec.heightFt
      segmentIndex++
    }
  }
  return out
}

function deriveBaseInstances(scaffoldStacks: ScaffoldStack[], baseSettings: ScaffoldBaseSettings) {
  return scaffoldStacks.map<RinglockBaseInstance>((stack) => ({
    id: stack.id,
    groundPosition: stack.gridPosition.clone(),
    jackExtensionIn: stack.jackExtensionIn,
    showWoodSill: stack.baseSupport === 'stacked' ? false : (stack.showWoodSill ?? baseSettings.showWoodSill),
    showBaseCollar: stack.baseSupport === 'stacked' ? false : (stack.showBaseCollar ?? baseSettings.showBaseCollar),
  }))
}

function deriveLedgerInstances(
  scaffoldStacks: ScaffoldStack[],
  ledgerConnections: LedgerConnection[],
  baseSettings: ScaffoldBaseSettings,
) {
  return ledgerConnections
    .map((conn): RinglockLedgerInstance | null => {
      const startStack = scaffoldStacks.find((stack) => stack.id === conn.startNode.stackId)
      const endStack = scaffoldStacks.find((stack) => stack.id === conn.endNode.stackId)
      if (!startStack || !endStack) return null
      const startNodes = computeRosettePositions(
        startStack.gridPosition,
        startStack.standardSegments,
        startStack.jackExtensionIn,
        startStack.baseSupport === 'stacked' ? false : (startStack.showWoodSill ?? baseSettings.showWoodSill),
        startStack.baseSupport === 'stacked' ? false : (startStack.showBaseCollar ?? baseSettings.showBaseCollar),
      )
      const endNodes = computeRosettePositions(
        endStack.gridPosition,
        endStack.standardSegments,
        endStack.jackExtensionIn,
        endStack.baseSupport === 'stacked' ? false : (endStack.showWoodSill ?? baseSettings.showWoodSill),
        endStack.baseSupport === 'stacked' ? false : (endStack.showBaseCollar ?? baseSettings.showBaseCollar),
      )
      const startNode = startNodes.find((node) => node.liftIndex === conn.startNode.liftIndex)
      const endNode = endNodes.find((node) => node.liftIndex === conn.endNode.liftIndex)
      if (!startNode || !endNode) return null
      return { id: conn.id, partNumber: conn.ledgerPartNumber, start: startNode.position, end: endNode.position }
    })
    .filter((instance): instance is RinglockLedgerInstance => instance !== null)
}

function deriveDiagonalInstances(scaffoldBlocks: ScaffoldBlockInstance[]) {
  const out: RinglockDiagonalInstance[] = []
  const boundaryTol = 0.01
  const rectForBlock = (block: ScaffoldBlockInstance) => {
    const halfWidth = block.widthFt / 2
    const halfDepth = block.depthFt / 2
    const corners = [
      rotateOffset90({ x: -halfWidth, y: -halfDepth }, block.rotationSteps ?? 0),
      rotateOffset90({ x: halfWidth, y: -halfDepth }, block.rotationSteps ?? 0),
      rotateOffset90({ x: halfWidth, y: halfDepth }, block.rotationSteps ?? 0),
      rotateOffset90({ x: -halfWidth, y: halfDepth }, block.rotationSteps ?? 0),
    ]
    const xs = corners.map((corner) => block.center.x + corner.x)
    const ys = corners.map((corner) => block.center.y + corner.y)
    return {
      xMin: Math.min(...xs),
      xMax: Math.max(...xs),
      yMin: Math.min(...ys),
      yMax: Math.max(...ys),
    }
  }
  const boundarySegments = computeRectUnionBoundarySegments(scaffoldBlocks.map(rectForBlock))
  const isPerimeterSpan = (start: THREE.Vector3, end: THREE.Vector3) => {
    if (boundarySegments.length === 0) return false
    if (Math.abs(start.y - end.y) <= boundaryTol) {
      const y = (start.y + end.y) * 0.5
      const minX = Math.min(start.x, end.x)
      const maxX = Math.max(start.x, end.x)
      return boundarySegments.some((seg) => (
        seg.kind === 'H' &&
        Math.abs(seg.y - y) <= boundaryTol &&
        Math.min(seg.x0, seg.x1) <= minX + boundaryTol &&
        Math.max(seg.x0, seg.x1) >= maxX - boundaryTol
      ))
    }
    if (Math.abs(start.x - end.x) <= boundaryTol) {
      const x = (start.x + end.x) * 0.5
      const minY = Math.min(start.y, end.y)
      const maxY = Math.max(start.y, end.y)
      return boundarySegments.some((seg) => (
        seg.kind === 'V' &&
        Math.abs(seg.x - x) <= boundaryTol &&
        Math.min(seg.y0, seg.y1) <= minY + boundaryTol &&
        Math.max(seg.y0, seg.y1) >= maxY - boundaryTol
      ))
    }
    return false
  }
  for (const block of scaffoldBlocks) {
    const braceFrontBack = block.braceFrontBack ?? 'off'
    const braceLeftRight = block.braceLeftRight ?? 'off'
    if (braceFrontBack === 'off' && braceLeftRight === 'off') continue
    const suppressed = new Set(block.suppressedDiagonalKeys ?? [])
    const layoutX = chooseBayLayout(block.widthFt)
    const layoutY = chooseBayLayout(block.depthFt)
    const base = block.baseSettings
    const plan = buildStandardPlan({
      heightFt: block.heightFt,
      ledgerEveryN: block.ledgerEveryNRosettes,
      plankedLevelsCount: block.plankedLevelsCount,
      includeBaseDeck: block.includeBaseDeck,
      jackExtensionIn: base.jackExtensionIn,
      showWoodSill: base.showWoodSill,
      showBaseCollar: base.showBaseCollar,
    })
    const rosettes = computeRosettePositions(
      new THREE.Vector3(0, 0, 0),
      plan.segments.map((partNumber) => ({ partNumber })),
      base.jackExtensionIn,
      base.showWoodSill,
      base.showBaseCollar,
    )
    if (rosettes.length < 2) continue
    const rosetteZByLift = new Map(rosettes.map((r) => [r.liftIndex, r.position.z]))
    const maxLiftIndex = rosettes.reduce((maxLift, r) => Math.max(maxLift, r.liftIndex), 0)
    const braceStartLiftIndex = base.showBaseCollar ? 0 : 1
    const braceLiftPairs: Array<{ startLiftIndex: number; endLiftIndex: number; startZ: number; endZ: number }> = []
    for (let liftIndex = braceStartLiftIndex; liftIndex + 4 <= maxLiftIndex; liftIndex += 4) {
      const startZ = rosetteZByLift.get(liftIndex)
      const endZ = rosetteZByLift.get(liftIndex + 4)
      if (typeof startZ !== 'number' || typeof endZ !== 'number') continue
      if (!(endZ > startZ + 1e-6)) continue
      braceLiftPairs.push({ startLiftIndex: liftIndex, endLiftIndex: liftIndex + 4, startZ, endZ })
    }
    if (braceLiftPairs.length === 0) continue
    const halfWidth = block.widthFt / 2
    const halfDepth = block.depthFt / 2
    const toWorld = (localX: number, localY: number, localZ: number) => {
      const rotated = rotateOffset90({ x: localX, y: localY }, block.rotationSteps)
      return new THREE.Vector3(block.center.x + rotated.x, block.center.y + rotated.y, localZ)
    }
    if (braceFrontBack !== 'off') {
      const partNumber = findClosestDiagonal(layoutX.spacingFt * 12) ?? undefined
      for (const faceSign of [1, -1] as const) {
        const ascending = faceSign === 1 ? braceFrontBack === 'slash' : braceFrontBack === 'backslash'
        const faceY = faceSign * halfDepth
        for (let bayIndex = 0; bayIndex < layoutX.bays; bayIndex++) {
          const x0 = bayIndex * layoutX.spacingFt - halfWidth
          const x1 = x0 + layoutX.spacingFt
          if (!isPerimeterSpan(toWorld(x0, faceY, 0), toWorld(x1, faceY, 0))) continue
          const startX = ascending ? x0 : x1
          const endX = ascending ? x1 : x0
          for (const pair of braceLiftPairs) {
            const id = `${block.id}@brace-fb:${faceSign}:${bayIndex}:${pair.startLiftIndex}-${pair.endLiftIndex}`
            if (suppressed.has(id)) continue
            out.push({ id, partNumber, start: toWorld(startX, faceY, pair.startZ), end: toWorld(endX, faceY, pair.endZ) })
          }
        }
      }
    }
    if (braceLeftRight !== 'off') {
      const partNumber = findClosestDiagonal(layoutY.spacingFt * 12) ?? undefined
      for (const faceSign of [1, -1] as const) {
        const ascending = faceSign === 1 ? braceLeftRight === 'slash' : braceLeftRight === 'backslash'
        const faceX = faceSign * halfWidth
        for (let bayIndex = 0; bayIndex < layoutY.bays; bayIndex++) {
          const y0 = bayIndex * layoutY.spacingFt - halfDepth
          const y1 = y0 + layoutY.spacingFt
          if (!isPerimeterSpan(toWorld(faceX, y0, 0), toWorld(faceX, y1, 0))) continue
          const startY = ascending ? y0 : y1
          const endY = ascending ? y1 : y0
          for (const pair of braceLiftPairs) {
            const id = `${block.id}@brace-lr:${faceSign}:${bayIndex}:${pair.startLiftIndex}-${pair.endLiftIndex}`
            if (suppressed.has(id)) continue
            out.push({ id, partNumber, start: toWorld(faceX, startY, pair.startZ), end: toWorld(faceX, endY, pair.endZ) })
          }
        }
      }
    }
  }
  return out
}

function deriveAutoPlanks(scaffoldBlocks: ScaffoldBlockInstance[], selectedManufacturer: CatalogManufacturer) {
  const out: RinglockPlankInstance[] = []
  const plankDepthFt = inchesToFeet(RINGLOCK_PLANK_PROFILE_DEPTH_IN)
  const plankSeatOffsetFt = inchesToFeet(LEDGER_TUBE_OD_IN / 2) - plankDepthFt / 2
  const plankCatalogParts = selectedManufacturer.categories.planks.parts
  for (const block of scaffoldBlocks) {
    const layoutX = chooseBayLayout(block.widthFt)
    const layoutY = chooseBayLayout(block.depthFt)
    const base = block.baseSettings
    const plan = buildStandardPlan({
      heightFt: block.heightFt,
      ledgerEveryN: block.ledgerEveryNRosettes,
      plankedLevelsCount: block.plankedLevelsCount,
      includeBaseDeck: block.includeBaseDeck,
      jackExtensionIn: base.jackExtensionIn,
      showWoodSill: base.showWoodSill,
      showBaseCollar: base.showBaseCollar,
    })
    if (plan.workingDeckLiftIndices.length === 0) continue
    const rosettes = computeRosettePositions(
      new THREE.Vector3(0, 0, 0),
      plan.segments.map((partNumber) => ({ partNumber })),
      base.jackExtensionIn,
      base.showWoodSill,
      base.showBaseCollar,
    )
    const rosetteZByLift = new Map(rosettes.map((r) => [r.liftIndex, r.position.z]))
    const deckPlan = resolveBlockDeckPlan(block, layoutX, layoutY)
    const roundBayFrame = resolveRoundAutoBayFrame(block)
    const runAlongX = deckPlan.runAlongX
    const runLengthFt = deckPlan.runLengthFt
    const crossPart = deckPlan.crossLedgerPartNumber
    const crossLengthIn = UNIVERSAL_LEDGER_LENGTHS[crossPart] ?? Math.round(deckPlan.crossSpanFt * 12)
    const usableSpanIn = Math.max(0, crossLengthIn - PLANK_MOUTHPIECE_TOTAL_IN)
    const plankLayout = buildBestFitPlankLayout(usableSpanIn, runLengthFt, plankCatalogParts)
    if (plankLayout.length === 0) continue
    const halfWidth = block.widthFt / 2
    const halfDepth = block.depthFt / 2
    const visibleLengthFt = Math.max(inchesToFeet(RINGLOCK_PLANK_WIDTH_IN), runLengthFt - inchesToFeet(0.25))
    const runCenterOffsetFt = deckPlan.runAnchor === 'positive'
      ? Math.max(0, runLengthFt - visibleLengthFt) / 2
      : 0
    const rotationZ = block.rotationSteps * (Math.PI / 2) + (runAlongX ? Math.PI / 2 : 0)
    for (const liftIndex of plan.workingDeckLiftIndices) {
      const rosetteZ = rosetteZByLift.get(liftIndex)
      if (typeof rosetteZ !== 'number') continue
      const deckCenterZ = rosetteZ + plankSeatOffsetFt
      for (let bayY = 0; bayY < layoutY.bays; bayY++) {
        for (let bayX = 0; bayX < layoutX.bays; bayX++) {
          const bayCenterX = (bayX + 0.5) * layoutX.spacingFt - halfWidth
          const bayCenterY = (bayY + 0.5) * layoutY.spacingFt - halfDepth
          for (let plankIndex = 0; plankIndex < plankLayout.length; plankIndex++) {
            const slot = plankLayout[plankIndex]
            const localCenter = runAlongX
              ? { x: bayCenterX + runCenterOffsetFt, y: bayCenterY + slot.centerOffsetFt }
              : { x: bayCenterX + slot.centerOffsetFt, y: bayCenterY + runCenterOffsetFt }
            const worldCenter = roundBayFrame
              ? {
                  x: roundBayFrame.origin.x + roundBayFrame.tangent.x * localCenter.x + roundBayFrame.inward.x * localCenter.y,
                  y: roundBayFrame.origin.y + roundBayFrame.tangent.y * localCenter.x + roundBayFrame.inward.y * localCenter.y,
                }
              : (() => {
                  const rotated = rotateOffset90(localCenter, block.rotationSteps)
                  return {
                    x: block.center.x + rotated.x,
                    y: block.center.y + rotated.y,
                  }
                })()
            out.push({
              id: `${block.id}@${liftIndex}:${bayX}:${bayY}:${plankIndex}`,
              center: new THREE.Vector3(worldCenter.x, worldCenter.y, deckCenterZ),
              rotationZ,
              lengthFt: visibleLengthFt,
              widthIn: slot.widthIn,
              partNumber: slot.partNumber,
            })
          }
        }
      }
    }
  }
  return out
}

export function deriveScaffoldGeometry(params: {
	scaffoldStacks: ScaffoldStack[]
	ledgerConnections: LedgerConnection[]
	manualPlankPlacements: ManualPlankPlacement[]
	scaffoldBlocks: ScaffoldBlockInstance[]
	baseSettings: ScaffoldBaseSettings
	selectedManufacturer: CatalogManufacturer
}): DerivedScaffoldGeometry {
	const { scaffoldStacks, ledgerConnections, manualPlankPlacements, scaffoldBlocks, baseSettings, selectedManufacturer } = params
	const standardInstances = deriveStandardInstances(scaffoldStacks, baseSettings)
	const baseInstances = deriveBaseInstances(scaffoldStacks, baseSettings)
	const ledgerInstances = deriveLedgerInstances(scaffoldStacks, ledgerConnections, baseSettings)
	const diagonalInstances = deriveDiagonalInstances(scaffoldBlocks)
	const autoPlankInstances = deriveAutoPlanks(scaffoldBlocks, selectedManufacturer)
	const manualPlankInstances = buildManualPlankInstances(manualPlankPlacements, ledgerInstances, selectedManufacturer.categories.planks.parts)
	const plankInstances = manualPlankInstances.length === 0
		? autoPlankInstances
		: autoPlankInstances.length === 0
			? manualPlankInstances
			: [...autoPlankInstances, ...manualPlankInstances]

	return {
		standardInstances,
		baseInstances,
		ledgerInstances,
		diagonalInstances,
		plankInstances,
	}
}

export function deriveScaffoldBom(params: {
  scaffoldStacks: ScaffoldStack[]
  ledgerConnections: LedgerConnection[]
  manualPlankPlacements: ManualPlankPlacement[]
  scaffoldBlocks: ScaffoldBlockInstance[]
  baseSettings: ScaffoldBaseSettings
  selectedManufacturer: CatalogManufacturer
}): DerivedBom {
  const { selectedManufacturer } = params
  const {
		standardInstances,
		baseInstances,
		ledgerInstances,
		diagonalInstances,
		plankInstances,
	} = deriveScaffoldGeometry(params)

  const standardParts = buildPartMap(selectedManufacturer.categories.standards.parts)
  const ledgerParts = buildPartMap(selectedManufacturer.categories.ledgers.parts)
  const trussParts = buildPartMap(selectedManufacturer.categories.trusses.parts)
  const braceParts = buildPartMap(selectedManufacturer.categories.braces.parts)
  const plankParts = buildPartMap(selectedManufacturer.categories.planks.parts)
  const plankWeightByPartNumber = buildCatalogWeightMap(selectedManufacturer.categories.planks.parts)
  const lineMap = new Map<string, MutableLineItem>()

  for (const instance of standardInstances) {
    const spec = UNIVERSAL_RINGLOCK_STANDARDS[instance.partNumber as UniversalRinglockStandardId]
    const part = standardParts.get(instance.partNumber)
    addOrUpdateLine(lineMap, {
      id: `standards:${instance.partNumber}`,
      category: 'Standards',
      partNumber: instance.partNumber,
      description: part?.description ?? (spec ? `Ringlock standard · ${formatFeetInches(spec.heightFt)}` : 'Ringlock standard'),
      quantity: 1,
      unitWeightLb: normalizeBomWeight(part?.weightLb ?? spec?.weightLbs ?? null),
      metadataSource: part ? 'catalog' : spec ? 'fallback' : 'missing',
      weightSource: typeof part?.weightLb === 'number' ? 'catalog' : spec ? 'fallback' : 'missing',
      selection: {
        primaryObjectId: `standard-${instance.id}`,
        objectIds: [`standard-${instance.id}`],
        stackIds: [instance.stackId],
      },
    })
  }

  const screwJackObjectIds = baseInstances.map((base) => `screw-jack-${base.id}`)
  addOrUpdateLine(lineMap, {
    id: 'bases:screw-jack',
    category: 'Bases',
    partNumber: null,
    description: 'Screw jack',
    quantity: baseInstances.length,
    unitWeightLb: normalizeBomWeight(SCAFFOLD_WEIGHTS['screw-jack'] ?? null),
    metadataSource: 'system',
    weightSource: 'system',
    selection: {
      primaryObjectId: screwJackObjectIds[0] ?? null,
      objectIds: screwJackObjectIds,
      stackIds: baseInstances.map((base) => base.id),
    },
  })
  const woodSillBases = baseInstances.filter((base) => base.showWoodSill)
  const woodSillQty = baseInstances.filter((base) => base.showWoodSill).length
  if (woodSillQty > 0) {
    addOrUpdateLine(lineMap, {
      id: 'bases:wood-sill',
      category: 'Bases',
      partNumber: null,
      description: 'Wood sill 9×9',
      quantity: woodSillQty,
      unitWeightLb: normalizeBomWeight(SCAFFOLD_WEIGHTS['wood-sill-9x9'] ?? null),
      metadataSource: 'system',
      weightSource: 'system',
      selection: {
        primaryObjectId: woodSillBases[0] ? `wood-sill-${woodSillBases[0].id}` : null,
        objectIds: woodSillBases.map((base) => `wood-sill-${base.id}`),
        stackIds: woodSillBases.map((base) => base.id),
      },
    })
  }
  const baseCollarBases = baseInstances.filter((base) => base.showBaseCollar)
  const baseCollarQty = baseInstances.filter((base) => base.showBaseCollar).length
  if (baseCollarQty > 0) {
    addOrUpdateLine(lineMap, {
      id: 'bases:base-collar',
      category: 'Bases',
      partNumber: null,
      description: 'Base collar',
      quantity: baseCollarQty,
      unitWeightLb: normalizeBomWeight(SCAFFOLD_WEIGHTS['base-collar'] ?? null),
      metadataSource: 'system',
      weightSource: 'system',
      selection: {
        primaryObjectId: baseCollarBases[0] ? `base-collar-${baseCollarBases[0].id}` : null,
        objectIds: baseCollarBases.map((base) => `base-collar-${base.id}`),
        stackIds: baseCollarBases.map((base) => base.id),
      },
    })
  }

  for (const instance of ledgerInstances) {
    const partNumber = instance.partNumber ?? ''
    const trussPart = trussParts.get(partNumber)
    const ledgerPart = ledgerParts.get(partNumber)
    const trussSpec = UNIVERSAL_RINGLOCK_TRUSSES[partNumber as keyof typeof UNIVERSAL_RINGLOCK_TRUSSES]
    const ledgerSpec = UNIVERSAL_RINGLOCK_HORIZONTALS[partNumber as keyof typeof UNIVERSAL_RINGLOCK_HORIZONTALS]
    const isTruss = Boolean(trussPart || trussSpec)
    const specLengthIn = isTruss ? trussSpec?.lengthIn : ledgerSpec?.lengthIn
    const description = isTruss
      ? trussPart?.description ?? (specLengthIn ? `Ringlock truss · ${formatFeetInches(specLengthIn / 12)}` : 'Ringlock truss')
      : ledgerPart?.description ?? (specLengthIn ? `Ringlock ledger · ${formatFeetInches(specLengthIn / 12)}` : 'Ringlock ledger')
    addOrUpdateLine(lineMap, {
      id: `${isTruss ? 'trusses' : 'ledgers'}:${partNumber || 'unknown'}`,
      category: isTruss ? 'Trusses' : 'Ledgers',
      partNumber: partNumber || null,
      description,
      quantity: 1,
      unitWeightLb: normalizeBomWeight(trussPart?.weightLb ?? ledgerPart?.weightLb ?? trussSpec?.weightLbs ?? ledgerSpec?.weightLbs ?? null),
      metadataSource: trussPart || ledgerPart ? 'catalog' : trussSpec || ledgerSpec ? 'fallback' : 'missing',
      weightSource: typeof trussPart?.weightLb === 'number' || typeof ledgerPart?.weightLb === 'number'
        ? 'catalog'
        : trussSpec || ledgerSpec ? 'fallback' : 'missing',
      selection: {
        primaryObjectId: `ledger-${instance.id}`,
        objectIds: [`ledger-${instance.id}`],
        stackIds: [],
      },
    })
  }

  for (const instance of diagonalInstances) {
    const partNumber = instance.partNumber ?? ''
    const part = braceParts.get(partNumber)
    const spec = UNIVERSAL_RINGLOCK_DIAGONALS[partNumber as keyof typeof UNIVERSAL_RINGLOCK_DIAGONALS]
    addOrUpdateLine(lineMap, {
      id: `diagonals:${partNumber || 'unknown'}`,
      category: 'Diagonals',
      partNumber: partNumber || null,
      description: part?.description ?? (spec ? `Diagonal brace · ${formatFeetInches(spec.baySizeIn / 12)} bay` : 'Diagonal brace'),
      quantity: 1,
      unitWeightLb: normalizeBomWeight(part?.weightLb ?? spec?.weightLbs ?? null),
      metadataSource: part ? 'catalog' : spec ? 'fallback' : 'missing',
      weightSource: typeof part?.weightLb === 'number' ? 'catalog' : spec ? 'fallback' : 'missing',
      selection: {
        primaryObjectId: `diagonal-${instance.id}`,
        objectIds: [`diagonal-${instance.id}`],
        stackIds: [],
      },
    })
  }

  for (const instance of plankInstances) {
    const resolvedPartNumber = instance.partNumber
      ?? resolveClosestCatalogPlankPartNumber(selectedManufacturer.categories.planks.parts, instance.widthIn, instance.lengthFt)
    const part = resolvedPartNumber ? plankParts.get(resolvedPartNumber) : undefined
    addOrUpdateLine(lineMap, {
      id: `planks:${resolvedPartNumber ?? `${instance.widthIn}:${instance.lengthFt.toFixed(3)}`}`,
      category: 'Planks',
      partNumber: resolvedPartNumber ?? null,
      description: part?.description ?? `Deck plank · ${instance.widthIn}" × ${formatFeetInches(instance.lengthFt)}`,
      quantity: 1,
      unitWeightLb: normalizeBomWeight(part?.weightLb ?? resolveClosestCatalogPlankWeightLb(instance, selectedManufacturer.categories.planks.parts, plankWeightByPartNumber)),
      metadataSource: part ? (instance.partNumber ? 'catalog' : 'fallback') : 'fallback',
      weightSource: typeof part?.weightLb === 'number'
        ? (instance.partNumber ? 'catalog' : 'fallback')
        : resolveClosestCatalogPlankWeightLb(instance, selectedManufacturer.categories.planks.parts, plankWeightByPartNumber) != null
          ? 'fallback'
          : 'missing',
      selection: {
        primaryObjectId: `plank-${instance.id}`,
        objectIds: [`plank-${instance.id}`],
        stackIds: [],
      },
    })
  }

  const lineItems = Array.from(lineMap.values())
    .filter((item) => item.quantity > 0)
    .map<BomLineItem>((item) => ({
      ...item,
      totalWeightLb: item.unitWeightLb == null ? null : item.unitWeightLb * item.quantity,
    }))
    .sort((a, b) => {
      const byCategory = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]
      if (byCategory !== 0) return byCategory
      const byPart = String(a.partNumber ?? '').localeCompare(String(b.partNumber ?? ''))
      if (byPart !== 0) return byPart
      return a.description.localeCompare(b.description)
    })

  const summary: BomSummary = {
    lineItemCount: lineItems.length,
    totalQuantity: lineItems.reduce((sum, item) => sum + item.quantity, 0),
    totalWeightLb: lineItems.reduce((sum, item) => sum + (item.totalWeightLb ?? 0), 0),
    weightedLineItemCount: lineItems.filter((item) => item.totalWeightLb != null).length,
    nonCatalogLineItemCount: lineItems.filter((item) => item.metadataSource !== 'catalog' || item.weightSource !== 'catalog').length,
    missingWeightLineItemCount: lineItems.filter((item) => item.totalWeightLb == null).length,
    modelItemCount: standardInstances.length + baseInstances.length + ledgerInstances.length + diagonalInstances.length + plankInstances.length,
  }

  return { lineItems, summary }
}
