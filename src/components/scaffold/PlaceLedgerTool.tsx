import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { ThreeEvent, useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useTool } from '../../contexts/ToolContext'
import { useCatalogSelection } from '../../contexts/CatalogContext'
import { useScaffoldBaseSettings } from '../../contexts/ScaffoldBaseSettings'
import { computeRosettePositions } from './scaffoldGeometry'
import { RosetteNodes, type RosetteNode } from './RosetteNodes'
import {
	findClosestLedger,
	findClosestTruss,
	findClosestDiagonal,
	type RosetteNodeRef,
	type LedgerConnection,
} from '../../types/scaffoldGraph'
import { inchesToFeet } from './units'

const _yAxis = new THREE.Vector3(0, 1, 0)

/**
 * Represents a planned ledger connection for batch preview.
 */
interface PlannedLedger {
  startNode: RosetteNode
  endNode: RosetteNode
  partNumber: string
  mid: THREE.Vector3
  quat: THREE.Quaternion
  length: number
}

/**
 * Check if a ledger connection already exists between two rosette nodes.
 * Connections are bidirectional, so we check both directions.
 */
function ledgerExistsBetween(
  connections: LedgerConnection[],
  nodeA: RosetteNodeRef,
  nodeB: RosetteNodeRef
): boolean {
  return connections.some(conn => {
    const startMatchesA = conn.startNode.stackId === nodeA.stackId && conn.startNode.liftIndex === nodeA.liftIndex
    const startMatchesB = conn.startNode.stackId === nodeB.stackId && conn.startNode.liftIndex === nodeB.liftIndex
    const endMatchesA = conn.endNode.stackId === nodeA.stackId && conn.endNode.liftIndex === nodeA.liftIndex
    const endMatchesB = conn.endNode.stackId === nodeB.stackId && conn.endNode.liftIndex === nodeB.liftIndex
    return (startMatchesA && endMatchesB) || (startMatchesB && endMatchesA)
  })
}

/**
 * PlaceLedgerTool - One-click smart ledger placement.
 *
 * Click a connection point → automatically finds the closest unoccupied
 * connection point at the same lift level → creates ledger with auto-sized part.
 */
export function PlaceLedgerTool() {
  const { workspaceMode, scaffoldStacks, ledgerConnections, addLedgerConnection } = useTool()
  const { categoryKey, bracePlacementSide, bracePlacementDirection } = useCatalogSelection()
  const { baseSettings } = useScaffoldBaseSettings()
  const { showWoodSill, showBaseCollar } = baseSettings

	// Placement mode: select "ledgers", "trusses", or "braces" category (no specific part needed)
	const isPlacingLedger =
		workspaceMode === 'SCAFFOLD_MODE' && (categoryKey === 'ledgers' || categoryKey === 'trusses' || categoryKey === 'braces')
	const isBrace = categoryKey === 'braces'

	const findClosestPartNumber = useCallback(
		(distanceIn: number) =>
			categoryKey === 'trusses'
				? findClosestTruss(distanceIn, 12, false)
				: categoryKey === 'braces'
					? findClosestDiagonal(distanceIn, 12, false)
					: findClosestLedger(distanceIn, 12, false),
		[categoryKey],
	)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  // For preview line when hovering
  const [previewTarget, setPreviewTarget] = useState<RosetteNode | null>(null)

  // Shift key state for batch completion mode
  const [shiftHeld, setShiftHeld] = useState(false)
  // Batch preview ledgers (when Shift is held)
  const [batchPlan, setBatchPlan] = useState<PlannedLedger[]>([])
  // Animation pulse for batch preview
  const pulseRef = useRef(0)

  // Track Shift key state
  useEffect(() => {
    if (!isPlacingLedger) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
	}, [isPlacingLedger])

  // Build array of all rosette nodes across all stacks
  const nodes = useMemo<RosetteNode[]>(() => {
    const out: RosetteNode[] = []
    for (const stack of scaffoldStacks) {
			const effectiveShowWoodSill = (stack.baseSupport === 'stacked')
				? false
				: (stack.showWoodSill ?? showWoodSill)
			const effectiveShowBaseCollar = (stack.baseSupport === 'stacked')
				? false
				: (stack.showBaseCollar ?? showBaseCollar)

      const positions = computeRosettePositions(
        stack.gridPosition,
				stack.standardSegments,
        stack.jackExtensionIn,
				effectiveShowWoodSill,
				effectiveShowBaseCollar,
      )
      for (const p of positions) {
        out.push({ stackId: stack.id, liftIndex: p.liftIndex, position: p.position })
      }
    }
    return out
  }, [scaffoldStacks, showWoodSill, showBaseCollar])

  /**
   * Derive a rotation-invariant 2D basis (XY plane) for the current lift.
   *
   * IMPORTANT: We cannot rely on world X/Y (scaffold will be rotatable), and we also
   * must avoid PCA-on-positions for perfectly symmetric layouts (e.g. square grids),
   * where PCA can become ambiguous.
   *
   * Strategy:
   * - Sample directions to each node's nearest neighbors (within a small threshold)
   * - Pick the dominant direction (angle histogram in [0, PI)) as axisA
   * - axisB is perpendicular
   */
  const computeLiftAxes = useCallback((nodesAtLift: RosetteNode[], adjacencyScaleFt: number) => {
    if (nodesAtLift.length < 2) return null

    const kNearest = 4
    const maxSampleDist = Number.isFinite(adjacencyScaleFt) ? adjacencyScaleFt * 1.25 : Infinity

    // Histogram over angles in [0, PI)
    const bins = 36 // 5-degree bins
    const counts = new Array<number>(bins).fill(0)
    const sums = new Array<THREE.Vector2>(bins).fill(null as any).map(() => new THREE.Vector2(0, 0))

    const addDirSample = (dx: number, dy: number) => {
      const dir = new THREE.Vector2(dx, dy)
      const len = dir.length()
      if (len < 1e-6) return
      dir.multiplyScalar(1 / len)

      // Fold sign so v and -v land in the same bin
      if (dir.x < 0 || (Math.abs(dir.x) < 1e-12 && dir.y < 0)) dir.multiplyScalar(-1)

      let ang = Math.atan2(dir.y, dir.x)
      if (ang < 0) ang += Math.PI
      const bin = Math.max(0, Math.min(bins - 1, Math.floor((ang / Math.PI) * bins)))
      counts[bin] += 1
      sums[bin].add(dir)
    }



    for (let i = 0; i < nodesAtLift.length; i++) {
      const a = nodesAtLift[i].position
      const dists: { d: number; dx: number; dy: number }[] = []

      for (let j = 0; j < nodesAtLift.length; j++) {
        if (i === j) continue
        const b = nodesAtLift[j].position
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy)


        dists.push({ d, dx, dy })
      }

      dists.sort((p, q) => p.d - q.d)
      for (let k = 0; k < Math.min(kNearest, dists.length); k++) {
        const item = dists[k]
        if (item.d > maxSampleDist) break
        addDirSample(item.dx, item.dy)
      }
    }

    // Choose the dominant direction bin
    let bestBin = -1
    let bestCount = 0
    let bestSumLenSq = 0
    for (let b = 0; b < bins; b++) {
      const c = counts[b]
      if (c === 0) continue
      const sLenSq = sums[b].lengthSq()
      if (c > bestCount || (c === bestCount && sLenSq > bestSumLenSq)) {
        bestCount = c
        bestSumLenSq = sLenSq
        bestBin = b
      }
    }

    if (bestBin < 0) return null
    const axisA = sums[bestBin].clone()
    if (axisA.lengthSq() < 1e-10) axisA.set(1, 0)
    axisA.normalize()
    const axisB = new THREE.Vector2(-axisA.y, axisA.x)
    return { axisA, axisB }
  }, [])

  // Perpendicular tolerance for "colinear" checks - increased to handle slight misalignments
  // when scaffold groups are at different orientations
  const PERP_TOL_FT = 0.5 // ~6" sideways tolerance for "colinear" checks

  const computeAdjacencyScaleFt = useCallback((nodesAtLift: RosetteNode[]): number => {
    if (nodesAtLift.length < 2) return Infinity
    const mins: number[] = []
    for (let i = 0; i < nodesAtLift.length; i++) {
      let best = Infinity
      const a = nodesAtLift[i].position
      for (let j = 0; j < nodesAtLift.length; j++) {
        if (i === j) continue
        const b = nodesAtLift[j].position
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < best) best = d
      }
      if (best < Infinity) mins.push(best)
    }
    mins.sort((x, y) => x - y)
    const idx = Math.max(0, Math.floor(0.75 * (mins.length - 1)))
    return mins[idx] ?? Infinity
  }, [])

  const findNearestAlongAxis = useCallback((
    source: RosetteNode,
    nodesAtLift: RosetteNode[],
    axis: THREE.Vector2,
    perpAxis: THREE.Vector2,
    sign: 1 | -1,
    maxProjFt: number,
  ): RosetteNode | null => {
    let best: RosetteNode | null = null
    let bestProj = Infinity

    for (const candidate of nodesAtLift) {
      if (candidate.stackId === source.stackId) continue

      const dx = candidate.position.x - source.position.x
      const dy = candidate.position.y - source.position.y
      const proj = (dx * axis.x + dy * axis.y) * sign
      if (proj <= 1e-6) continue
      if (proj > maxProjFt) continue

      const perp = Math.abs(dx * perpAxis.x + dy * perpAxis.y)
      if (perp > PERP_TOL_FT) continue

      if (proj < bestProj) {
        bestProj = proj
        best = candidate
      }
    }
    return best
  }, [])

  const getAdjacentCandidates = useCallback((
    source: RosetteNode,
    nodesAtLift: RosetteNode[],
    axes: { axisA: THREE.Vector2; axisB: THREE.Vector2 },
    maxProjFt: number,
    canUse: (candidate: RosetteNode) => boolean,
  ): RosetteNode[] => {
    const out: RosetteNode[] = []

		// Important: we must never "skip" over an intermediate standard.
		// So we always find the nearest geometric neighbor in each direction first,
		// and only then decide whether it can be used.
		const aPos = findNearestAlongAxis(source, nodesAtLift, axes.axisA, axes.axisB, 1, maxProjFt)
		const aNeg = findNearestAlongAxis(source, nodesAtLift, axes.axisA, axes.axisB, -1, maxProjFt)
		const bPos = findNearestAlongAxis(source, nodesAtLift, axes.axisB, axes.axisA, 1, maxProjFt)
		const bNeg = findNearestAlongAxis(source, nodesAtLift, axes.axisB, axes.axisA, -1, maxProjFt)
		if (aPos && canUse(aPos)) out.push(aPos)
		if (aNeg && canUse(aNeg)) out.push(aNeg)
		if (bPos && canUse(bPos)) out.push(bPos)
		if (bNeg && canUse(bNeg)) out.push(bNeg)
    return out
  }, [findNearestAlongAxis])

  /**
   * Find the closest unoccupied rosette node at the same lift level.
   * Returns null if no valid target exists.
   */
  const findClosestUnoccupiedTarget = useCallback((sourceNode: RosetteNode): RosetteNode | null => {
	    const sourceRef: RosetteNodeRef = { stackId: sourceNode.stackId, liftIndex: sourceNode.liftIndex }

	    const nodesAtLift = nodes.filter(n => n.liftIndex === sourceNode.liftIndex)
	    const adjacencyScaleFt = computeAdjacencyScaleFt(nodesAtLift)
	    const axes = computeLiftAxes(nodesAtLift, adjacencyScaleFt)
	    if (!axes) return null
		// Allow connections up to the longest catalog part (10 ft = UH100/UHT100) plus
		// a generous tolerance. We still only ever connect *adjacent* neighbors on each
		// axis direction; if the adjacent bay is already occupied, we do NOT "skip" over
		// it to create a longer overlapping ledger.
	    const maxProjFt = Math.max(adjacencyScaleFt * 2.5, 12)

    const canUse = (candidate: RosetteNode) => {
      const candidateRef: RosetteNodeRef = { stackId: candidate.stackId, liftIndex: candidate.liftIndex }
      return !ledgerExistsBetween(ledgerConnections, sourceRef, candidateRef)
    }

    const adj = getAdjacentCandidates(sourceNode, nodesAtLift, axes, maxProjFt, canUse)
    if (adj.length === 0) return null

    let closest: RosetteNode | null = null
    let minDist = Infinity
    for (const candidate of adj) {
      const dist = sourceNode.position.distanceTo(candidate.position)
      if (dist < minDist) {
        minDist = dist
        closest = candidate
      }
    }
	    return closest
	  }, [nodes, ledgerConnections, computeLiftAxes, computeAdjacencyScaleFt, getAdjacentCandidates])

  /**
   * Find the diagonal brace target for a source rosette node.
   * Braces connect (stackA, liftN) → (stackB, liftN+4) or liftN-4 on the nearest adjacent standard.
   * Part number is selected by horizontal bay distance (same as block mode).
   */
  const findDiagonalBraceTarget = useCallback((sourceNode: RosetteNode, direction: 'ascending' | 'descending' = 'ascending'): RosetteNode | null => {
    const nodesAtLift = nodes.filter(n => n.liftIndex === sourceNode.liftIndex)
    const adjacencyScaleFt = computeAdjacencyScaleFt(nodesAtLift)
    const axes = computeLiftAxes(nodesAtLift, adjacencyScaleFt)
    if (!axes) return null
    const maxProjFt = Math.max(adjacencyScaleFt * 2.5, 12)

    // All adjacent standards at the same lift, sorted by horizontal distance
    const adjacent = getAdjacentCandidates(sourceNode, nodesAtLift, axes, maxProjFt, () => true)
    adjacent.sort((a, b) =>
      sourceNode.position.distanceTo(a.position) - sourceNode.position.distanceTo(b.position)
    )

    const deltaLift = direction === 'ascending' ? 4 : -4
    for (const adj of adjacent) {
      const targetLiftIndex = sourceNode.liftIndex + deltaLift
      if (targetLiftIndex < 0) continue
      const targetNode = nodes.find(n => n.stackId === adj.stackId && n.liftIndex === targetLiftIndex)
      if (!targetNode) continue
      const sRef: RosetteNodeRef = { stackId: sourceNode.stackId, liftIndex: sourceNode.liftIndex }
      const eRef: RosetteNodeRef = { stackId: targetNode.stackId, liftIndex: targetNode.liftIndex }
      if (!ledgerExistsBetween(ledgerConnections, sRef, eRef)) return targetNode
    }
    return null
  }, [nodes, ledgerConnections, computeLiftAxes, computeAdjacencyScaleFt, getAdjacentCandidates])

  /**
   * Compute all possible ledger connections at a given lift level.
   * Rules:
   * - Adjacent neighbors only
	   * - No diagonals (only along the two principal scaffold axes)
	   * - Rotation invariant (axes derived from nearest-neighbor directions)
   */
  const computeBatchPlan = useCallback((liftIndex: number): PlannedLedger[] => {
    const plan: PlannedLedger[] = []
	    const nodesAtLift = nodes.filter(n => n.liftIndex === liftIndex)
	    const adjacencyScaleFt = computeAdjacencyScaleFt(nodesAtLift)
	    const axes = computeLiftAxes(nodesAtLift, adjacencyScaleFt)
	    if (!axes) return plan
	    const maxProjFt = Math.max(adjacencyScaleFt * 2.5, 12)

    // Track which connections we've already planned (to avoid duplicates)
    const plannedPairs = new Set<string>()
    const makePairKey = (a: RosetteNode, b: RosetteNode) => {
      const ids = [a.stackId, b.stackId].sort()
      return `${ids[0]}|${ids[1]}|${liftIndex}`
    }

    for (const sourceNode of nodesAtLift) {
	      const sourceRef: RosetteNodeRef = { stackId: sourceNode.stackId, liftIndex }
      const canUse = (candidate: RosetteNode) => {
        const candidateRef: RosetteNodeRef = { stackId: candidate.stackId, liftIndex }
	        const pairKey = makePairKey(sourceNode, candidate)
        if (plannedPairs.has(pairKey)) return false
        if (ledgerExistsBetween(ledgerConnections, sourceRef, candidateRef)) return false
        return true
      }

      // Adjacent-only neighbors along the two principal scaffold axes (no diagonals)
	      const neighbors = getAdjacentCandidates(sourceNode, nodesAtLift, axes, maxProjFt, canUse)
      for (const neighbor of neighbors) {
	        const pairKey = makePairKey(sourceNode, neighbor)
        if (plannedPairs.has(pairKey)) continue
        plannedPairs.add(pairKey)

        // Calculate geometry for preview
	        const startPos = sourceNode.position
        const endPos = neighbor.position
        const mid = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5)
        const dir = new THREE.Vector3().subVectors(endPos, startPos)
        const length = dir.length()
        if (length < 1e-6) continue
        const quat = new THREE.Quaternion().setFromUnitVectors(_yAxis, dir.normalize())

        // Auto-select ledger part
        const distIn = length * 12 // feet to inches
		const partNumber = findClosestPartNumber(distIn)
        if (!partNumber) continue

        plan.push({
	          startNode: sourceNode,
          endNode: neighbor,
          partNumber,
          mid,
          quat,
          length,
        })
      }
    }

    return plan
	}, [
		nodes,
		ledgerConnections,
		computeLiftAxes,
		computeAdjacencyScaleFt,
		getAdjacentCandidates,
		findClosestPartNumber,
	])

  // Update preview target when hovering a node
  useEffect(() => {
    if (hoveredIndex === null || hoveredIndex >= nodes.length) {
      setPreviewTarget(null)
      return
    }
    const hoveredNode = nodes[hoveredIndex]
    const target = isBrace
      ? findDiagonalBraceTarget(hoveredNode, bracePlacementDirection)
      : findClosestUnoccupiedTarget(hoveredNode)
    setPreviewTarget(target)
  }, [hoveredIndex, nodes, isBrace, bracePlacementDirection, findDiagonalBraceTarget, findClosestUnoccupiedTarget])

  // Determine if a node is a valid click target
  const isValidTarget = useCallback(
    (node: RosetteNode) => {
      if (isBrace) return findDiagonalBraceTarget(node, bracePlacementDirection) !== null
      return findClosestUnoccupiedTarget(node) !== null
    },
    [isBrace, bracePlacementDirection, findDiagonalBraceTarget, findClosestUnoccupiedTarget],
  )

  // Compute preview line from hovered node to its closest target
  const previewLine = useMemo(() => {
    if (hoveredIndex === null || !previewTarget) return null
    const sourceNode = nodes[hoveredIndex]
    if (!sourceNode) return null

    const startPos = sourceNode.position
    const endPos = previewTarget.position
    const mid = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5)
    const dir = new THREE.Vector3().subVectors(endPos, startPos)
    const length = dir.length()
    if (length < 1e-6) return null
    const quat = new THREE.Quaternion().setFromUnitVectors(_yAxis, dir.normalize())
    return { mid, quat, length }
  }, [hoveredIndex, previewTarget, nodes])

  // If we leave ledger placement mode, clear state
  useEffect(() => {
    if (isPlacingLedger) return
    setHoveredIndex(null)
    setPreviewTarget(null)
    setShiftHeld(false)
    setBatchPlan([])
  }, [isPlacingLedger])

  // Compute batch plan when Shift is held and hovering a node (ledgers/trusses only — not braces)
  useEffect(() => {
    if (isBrace || !shiftHeld || hoveredIndex === null || hoveredIndex >= nodes.length) {
      setBatchPlan([])
      return
    }
    const hoveredNode = nodes[hoveredIndex]
	  const plan = computeBatchPlan(hoveredNode.liftIndex)
    setBatchPlan(plan)
  }, [isBrace, shiftHeld, hoveredIndex, nodes, computeBatchPlan])

  // Animation pulse for batch preview
  useFrame((_, delta) => {
    if (batchPlan.length > 0) {
      pulseRef.current += delta * 2.5
    }
  })

  /**
   * Confirm and place all batch ledgers.
   */
  const confirmBatchPlacement = useCallback(() => {
    if (batchPlan.length === 0) return

    for (const planned of batchPlan) {
      const startRef: RosetteNodeRef = { stackId: planned.startNode.stackId, liftIndex: planned.startNode.liftIndex }
      const endRef: RosetteNodeRef = { stackId: planned.endNode.stackId, liftIndex: planned.endNode.liftIndex }
      addLedgerConnection(startRef, endRef, planned.partNumber)
    }

    // Clear the batch plan after placement
    setBatchPlan([])
  }, [batchPlan, addLedgerConnection])

  // Handle Enter key to confirm batch placement
  useEffect(() => {
    if (!isPlacingLedger || batchPlan.length === 0) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        confirmBatchPlacement()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [isPlacingLedger, batchPlan.length, confirmBatchPlacement])

  /**
   * Handle click on a rosette node.
   * - Braces: ONE CLICK places a diagonal from (stackA, liftN) → (stackB, liftN±4)
   * - Ledgers/trusses: ONE CLICK places same-lift horizontal; Shift+click confirms batch
   */
  const handleNodePointerDown = useCallback(
    (node: RosetteNode, e: ThreeEvent<PointerEvent>) => {
      if (!isPlacingLedger) return
      e.stopPropagation()

      if (isBrace) {
        const target = findDiagonalBraceTarget(node, bracePlacementDirection)
        if (!target) return
        const sourceRef: RosetteNodeRef = { stackId: node.stackId, liftIndex: node.liftIndex }
        const targetRef: RosetteNodeRef = { stackId: target.stackId, liftIndex: target.liftIndex }
        // Part number by horizontal (XY) distance — same as block mode
        const dx = node.position.x - target.position.x
        const dy = node.position.y - target.position.y
        const horizontalDistIn = Math.sqrt(dx * dx + dy * dy) * 12
        const partNumber = findClosestPartNumber(horizontalDistIn)
        if (!partNumber) return
        addLedgerConnection(sourceRef, targetRef, partNumber, { diagonalSide: bracePlacementSide, diagonalDirection: bracePlacementDirection })
        return
      }

      // Ledger / truss: batch or single
      if (shiftHeld && batchPlan.length > 0) {
        confirmBatchPlacement()
        return
      }
      const target = findClosestUnoccupiedTarget(node)
      if (!target) return
      const sourceRef: RosetteNodeRef = { stackId: node.stackId, liftIndex: node.liftIndex }
      const targetRef: RosetteNodeRef = { stackId: target.stackId, liftIndex: target.liftIndex }
      const distIn = node.position.distanceTo(target.position) * 12
      const partNumber = findClosestPartNumber(distIn)
      if (!partNumber) {
        console.warn('No suitable horizontal found for distance:', distIn, 'inches')
        return
      }
      addLedgerConnection(sourceRef, targetRef, partNumber)
    },
	  [
		isPlacingLedger,
		isBrace,
		bracePlacementSide,
		bracePlacementDirection,
		findDiagonalBraceTarget,
		shiftHeld,
		batchPlan,
		confirmBatchPlacement,
		findClosestUnoccupiedTarget,
		addLedgerConnection,
		findClosestPartNumber,
	  ],
  )

  if (!isPlacingLedger) return null

  const tubeRadiusFt = inchesToFeet(1.9) / 2

  // Pulsing opacity for batch preview (subtle breathing effect)
  const batchOpacity = batchPlan.length > 0
    ? 0.55 + 0.15 * Math.sin(pulseRef.current)
    : 0.65

  // Show batch mode preview when Shift is held, otherwise show single preview
  const showBatchPreview = shiftHeld && batchPlan.length > 0
  const showSinglePreview = !showBatchPreview && previewLine !== null

  return (
    <group>
      <RosetteNodes
        nodes={nodes}
        start={null} // No "start" in one-click mode
        hoveredIndex={hoveredIndex}
        isValidTarget={isValidTarget}
        onNodePointerDown={handleNodePointerDown}
        onHoverIndex={setHoveredIndex}
      />

      {/* Single ledger preview (normal one-click mode) */}
      {showSinglePreview && previewLine && (
        <mesh
          position={previewLine.mid}
          quaternion={previewLine.quat}
          scale={[1, previewLine.length, 1]}
          raycast={() => null}
        >
          <cylinderGeometry args={[tubeRadiusFt, tubeRadiusFt, 1, 12, 1, false]} />
          <meshStandardMaterial
            color="#4affaa"
            emissive="#2aff88"
            emissiveIntensity={0.3}
            metalness={0.25}
            roughness={0.35}
            transparent
            opacity={0.65}
          />
        </mesh>
      )}

      {/* Batch preview ledgers (Shift + hover mode) */}
      {showBatchPreview && batchPlan.map((planned, i) => (
        <mesh
          key={`batch-preview-${i}`}
          position={planned.mid}
          quaternion={planned.quat}
          scale={[1, planned.length, 1]}
          raycast={() => null}
        >
          <cylinderGeometry args={[tubeRadiusFt, tubeRadiusFt, 1, 12, 1, false]} />
          <meshStandardMaterial
            color="#6af0ff"
            emissive="#40d4ff"
            emissiveIntensity={0.5}
            metalness={0.35}
            roughness={0.25}
            transparent
            opacity={batchOpacity}
          />
        </mesh>
      ))}

      {/* Batch mode indicator overlay */}
      {showBatchPreview && (
        <BatchModeIndicator count={batchPlan.length} />
      )}
    </group>
  )
}

/**
 * Floating HUD indicator showing batch mode is active.
 * Shows ledger count and confirmation instructions.
 */
function BatchModeIndicator({ count }: { count: number }) {
  return (
    <Html
      center
      position={[0, 0, 0]}
      style={{
        pointerEvents: 'none',
        transform: 'translate(-50%, -100%)',
      }}
      zIndexRange={[1000, 1001]}
    >
      <div
        style={{
          position: 'fixed',
          top: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'linear-gradient(135deg, rgba(30, 40, 55, 0.95) 0%, rgba(25, 35, 50, 0.95) 100%)',
          borderRadius: 12,
          padding: '12px 20px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(100, 200, 255, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          animation: 'fadeInSlide 0.2s ease-out',
        }}
      >
        {/* Pulsing icon */}
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: '#6af0ff',
            boxShadow: '0 0 12px #40d4ff, 0 0 4px #40d4ff',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
        {/* Count badge */}
        <div
          style={{
            background: 'linear-gradient(135deg, #40d4ff 0%, #2ab8e6 100%)',
            color: '#0a1520',
            fontSize: 14,
            fontWeight: 700,
            padding: '4px 10px',
            borderRadius: 6,
            minWidth: 28,
            textAlign: 'center',
          }}
        >
          {count}
        </div>
        {/* Instructions */}
        <div style={{ color: '#e0f0ff', fontSize: 13, fontWeight: 500 }}>
          ledgers ready
        </div>
        <div
          style={{
            marginLeft: 8,
            color: 'rgba(200, 220, 240, 0.7)',
            fontSize: 12,
            display: 'flex',
            gap: 6,
          }}
        >
          <span
            style={{
              background: 'rgba(100, 200, 255, 0.15)',
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid rgba(100, 200, 255, 0.25)',
            }}
          >
            Enter
          </span>
          <span style={{ opacity: 0.6 }}>or</span>
          <span
            style={{
              background: 'rgba(100, 200, 255, 0.15)',
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid rgba(100, 200, 255, 0.25)',
            }}
          >
            Click
          </span>
          <span style={{ opacity: 0.8 }}>to place</span>
        </div>
      </div>
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.6; transform: scale(0.85); }
          }
          @keyframes fadeInSlide {
            from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
          }
        `}
      </style>
    </Html>
  )
}

