import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { ThreeEvent, useFrame } from '@react-three/fiber'
import { useTool } from '../../contexts/ToolContext'
import { useCatalogSelection } from '../../contexts/CatalogContext'
import { useScaffoldBaseSettings } from '../../contexts/ScaffoldBaseSettings'
import { RinglockLedgers, type RinglockLedgerInstance } from './RinglockLedgers'
import { computeRosettePositions } from './scaffoldGeometry'
import { inchesToFeet } from './units'
import {
  buildManualPlankPreviewForLedger,
  buildManualPlankInstances,
  computeManualPlankBatchPreview,
  getLedgerSideSign,
} from './manualPlankPlacement'

const PREVIEW_POOL = 4000
const PREVIEW_DEPTH_FT = inchesToFeet(2.25)

export function PlacePlankTool() {
  const {
    workspaceMode,
    scaffoldStacks,
    ledgerConnections,
    manualPlankPlacements,
    addManualPlankPlacement,
    cameraNavigationActive,
  } = useTool()
	const { categoryKey, selectedManufacturer } = useCatalogSelection()
  const { baseSettings } = useScaffoldBaseSettings()
  const isPlacingPlank = workspaceMode === 'SCAFFOLD_MODE' && categoryKey === 'planks'
  const [hoveredLedgerId, setHoveredLedgerId] = useState<string | null>(null)
  const [hoveredSideSign, setHoveredSideSign] = useState<1 | -1>(1)
  const [shiftHeld, setShiftHeld] = useState(false)
  const pulseRef = useRef(0)

  useEffect(() => {
    if (!isPlacingPlank) return
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
  }, [isPlacingPlank])

  useEffect(() => {
    if (isPlacingPlank) return
    setHoveredLedgerId(null)
    setHoveredSideSign(1)
    setShiftHeld(false)
  }, [isPlacingPlank])

  useEffect(() => {
    if (!cameraNavigationActive) return
    setHoveredLedgerId(null)
  }, [cameraNavigationActive])

  const ledgerInstances = useMemo<RinglockLedgerInstance[]>(() => {
    return ledgerConnections
      .map((conn): RinglockLedgerInstance | null => {
        const startStack = scaffoldStacks.find(s => s.id === conn.startNode.stackId)
        const endStack = scaffoldStacks.find(s => s.id === conn.endNode.stackId)
        if (!startStack || !endStack) return null

        const startShowWoodSill = startStack.baseSupport === 'stacked'
          ? false
          : (startStack.showWoodSill ?? baseSettings.showWoodSill)
        const startShowBaseCollar = startStack.baseSupport === 'stacked'
          ? false
          : (startStack.showBaseCollar ?? baseSettings.showBaseCollar)
        const endShowWoodSill = endStack.baseSupport === 'stacked'
          ? false
          : (endStack.showWoodSill ?? baseSettings.showWoodSill)
        const endShowBaseCollar = endStack.baseSupport === 'stacked'
          ? false
          : (endStack.showBaseCollar ?? baseSettings.showBaseCollar)

        const startNodes = computeRosettePositions(
          startStack.gridPosition,
          startStack.standardSegments,
          startStack.jackExtensionIn,
          startShowWoodSill,
          startShowBaseCollar,
        )
        const endNodes = computeRosettePositions(
          endStack.gridPosition,
          endStack.standardSegments,
          endStack.jackExtensionIn,
          endShowWoodSill,
          endShowBaseCollar,
        )

        const startNode = startNodes.find(n => n.liftIndex === conn.startNode.liftIndex)
        const endNode = endNodes.find(n => n.liftIndex === conn.endNode.liftIndex)
        if (!startNode || !endNode) return null

        return {
          id: conn.id,
          partNumber: conn.ledgerPartNumber,
          start: startNode.position,
          end: endNode.position,
        }
      })
      .filter((ledger): ledger is RinglockLedgerInstance => ledger !== null)
  }, [ledgerConnections, scaffoldStacks, baseSettings.showWoodSill, baseSettings.showBaseCollar])

  const hoveredLedger = useMemo(
    () => ledgerInstances.find(ledger => ledger.id === hoveredLedgerId) ?? null,
    [ledgerInstances, hoveredLedgerId],
  )

  const singlePreview = useMemo(() => {
    if (!isPlacingPlank || !hoveredLedger) return null
		return buildManualPlankPreviewForLedger(
			hoveredLedger,
			ledgerInstances,
			hoveredSideSign,
			manualPlankPlacements,
			selectedManufacturer.categories.planks.parts,
		)
	}, [isPlacingPlank, hoveredLedger, ledgerInstances, hoveredSideSign, manualPlankPlacements, selectedManufacturer])

  const batchPreview = useMemo(() => {
    if (!isPlacingPlank || !shiftHeld || !hoveredLedger) return []
		return computeManualPlankBatchPreview(
			hoveredLedger,
			ledgerInstances,
			hoveredSideSign,
			manualPlankPlacements,
			selectedManufacturer.categories.planks.parts,
		)
	}, [isPlacingPlank, shiftHeld, hoveredLedger, ledgerInstances, hoveredSideSign, manualPlankPlacements, selectedManufacturer])

  const showBatchPreview = shiftHeld && batchPreview.length > 0
  const previewPlanks = showBatchPreview
    ? batchPreview.flatMap(preview => preview.planks)
    : (singlePreview?.planks ?? [])

  const confirmBatchPlacement = useCallback(() => {
    if (batchPreview.length === 0) return
    for (const preview of batchPreview) {
      addManualPlankPlacement(preview.placement.supportLedgerId, preview.placement.sideSign)
    }
  }, [batchPreview, addManualPlankPlacement])

  useEffect(() => {
    if (!isPlacingPlank || batchPreview.length === 0) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      e.stopPropagation()
      confirmBatchPlacement()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [isPlacingPlank, batchPreview.length, confirmBatchPlacement])

  const handleLedgerHover = useCallback((ledger: RinglockLedgerInstance, e?: ThreeEvent<PointerEvent>) => {
    if (!isPlacingPlank || cameraNavigationActive) return
    setHoveredLedgerId(ledger.id)
    if (e?.point) setHoveredSideSign(getLedgerSideSign(ledger, e.point))
  }, [cameraNavigationActive, isPlacingPlank])

  const handleLedgerHoverOut = useCallback(() => {
    if (cameraNavigationActive) return
    setHoveredLedgerId(null)
  }, [cameraNavigationActive])

  const handleLedgerPointerDown = useCallback((ledger: RinglockLedgerInstance, e?: ThreeEvent<PointerEvent>) => {
    if (!isPlacingPlank || cameraNavigationActive) return
    if (e) e.stopPropagation()
    const sideSign = hoveredLedgerId === ledger.id
      ? hoveredSideSign
      : (e?.point ? getLedgerSideSign(ledger, e.point) : hoveredSideSign)
    setHoveredLedgerId(ledger.id)
    setHoveredSideSign(sideSign)

    if (shiftHeld) {
			const previews = computeManualPlankBatchPreview(
				ledger,
				ledgerInstances,
				sideSign,
				manualPlankPlacements,
				selectedManufacturer.categories.planks.parts,
			)
      if (previews.length > 0) {
        for (const preview of previews) {
          addManualPlankPlacement(preview.placement.supportLedgerId, preview.placement.sideSign)
        }
        return
      }
    }

		const preview = buildManualPlankPreviewForLedger(
			ledger,
			ledgerInstances,
			sideSign,
			manualPlankPlacements,
			selectedManufacturer.categories.planks.parts,
		)
    if (!preview) return
    addManualPlankPlacement(preview.placement.supportLedgerId, preview.placement.sideSign)
  }, [
    cameraNavigationActive,
    isPlacingPlank,
    hoveredLedgerId,
    hoveredSideSign,
    shiftHeld,
    ledgerInstances,
    manualPlankPlacements,
		selectedManufacturer,
    addManualPlankPlacement,
  ])

  useFrame((_, delta) => {
    if (showBatchPreview) pulseRef.current += delta * 2.5
  })

  if (!isPlacingPlank) return null

  const batchOpacity = showBatchPreview
    ? 0.36 + 0.14 * Math.sin(pulseRef.current)
    : 0.42

  return (
    <group>
      <RinglockLedgers
        ledgers={ledgerInstances}
        showVisuals={false}
        onSelect={handleLedgerPointerDown}
        onHover={handleLedgerHover}
        onHoverOut={handleLedgerHoverOut}
      />

      {previewPlanks.length > 0 && (
        <PreviewPlanks
          planks={previewPlanks}
          opacity={batchOpacity}
          color={showBatchPreview ? '#6af0ff' : '#4affaa'}
          emissive={showBatchPreview ? '#40d4ff' : '#2aff88'}
        />
      )}

      {showBatchPreview && <BatchModeIndicator count={batchPreview.length} />}
    </group>
  )
}

function PreviewPlanks({
  planks,
  opacity,
  color,
  emissive,
}: {
  planks: ReturnType<typeof buildManualPlankInstances>
  opacity: number
  color: string
  emissive: string
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])

  useEffect(() => () => geometry.dispose(), [geometry])

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const count = Math.min(planks.length, PREVIEW_POOL)
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const zAxis = new THREE.Vector3(0, 0, 1)

    mesh.count = count
    for (let i = 0; i < count; i++) {
      const plank = planks[i]
      quaternion.setFromAxisAngle(zAxis, plank.rotationZ)
	      scale.set(inchesToFeet(plank.widthIn), plank.lengthFt, PREVIEW_DEPTH_FT)
      matrix.compose(plank.center, quaternion, scale)
      mesh.setMatrixAt(i, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [planks])

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, PREVIEW_POOL]} frustumCulled={false} raycast={() => null}>
      <primitive object={geometry} attach="geometry" />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={0.42}
        metalness={0.2}
        roughness={0.28}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </instancedMesh>
  )
}

function BatchModeIndicator({ count }: { count: number }) {
  return (
    <Html
      center
      position={[0, 0, 0]}
      style={{ pointerEvents: 'none', transform: 'translate(-50%, -100%)' }}
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
        }}
      >
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
        <div style={{ color: '#e0f0ff', fontSize: 13, fontWeight: 500 }}>plank sets ready</div>
        <div style={{ marginLeft: 8, color: 'rgba(200, 220, 240, 0.7)', fontSize: 12, display: 'flex', gap: 6 }}>
          <span style={{ background: 'rgba(100, 200, 255, 0.15)', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(100, 200, 255, 0.25)' }}>
            Enter
          </span>
          <span style={{ opacity: 0.6 }}>or</span>
          <span style={{ background: 'rgba(100, 200, 255, 0.15)', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(100, 200, 255, 0.25)' }}>
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
        `}
      </style>
    </Html>
  )
}
