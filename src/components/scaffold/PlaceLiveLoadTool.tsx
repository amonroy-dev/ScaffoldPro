import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useTool } from '../../contexts/ToolContext'
import { useCatalogSelection } from '../../contexts/CatalogContext'
import { useScaffoldBaseSettings } from '../../contexts/ScaffoldBaseSettings'
import { RinglockLedgers, type RinglockLedgerInstance } from './RinglockLedgers'
import {
	buildManualLiveLoadPreviewForLedger,
	computeManualLiveLoadBatchPreview,
	type RinglockLiveLoadInstance,
} from './manualLiveLoadPlacement'
import { getLedgerSideSign } from './manualSupportSpan'
import { computeRosettePositions } from './scaffoldGeometry'
import { inchesToFeet } from './units'

const PREVIEW_POOL = 2000
const PREVIEW_THICKNESS_FT = inchesToFeet(0.35)

export function PlaceLiveLoadTool() {
	const {
		workspaceMode,
		scaffoldStacks,
		ledgerConnections,
		manualLiveLoadPlacements,
		liveLoadPlacementPsf,
		addManualLiveLoadPlacement,
		cameraNavigationActive,
	} = useTool()
	const { categoryKey } = useCatalogSelection()
	const { baseSettings } = useScaffoldBaseSettings()
	const isPlacingLiveLoad = workspaceMode === 'SCAFFOLD_MODE' && categoryKey === 'liveLoads'
	const [hoveredLedgerId, setHoveredLedgerId] = useState<string | null>(null)
	const [hoveredSideSign, setHoveredSideSign] = useState<1 | -1>(1)
	const [shiftHeld, setShiftHeld] = useState(false)
	const pulseRef = useRef(0)

	useEffect(() => {
		if (!isPlacingLiveLoad) return
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
	}, [isPlacingLiveLoad])

	useEffect(() => {
		if (isPlacingLiveLoad) return
		setHoveredLedgerId(null)
		setHoveredSideSign(1)
		setShiftHeld(false)
	}, [isPlacingLiveLoad])

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
		if (!isPlacingLiveLoad || !hoveredLedger) return null
		return buildManualLiveLoadPreviewForLedger(
			hoveredLedger,
			ledgerInstances,
			hoveredSideSign,
			manualLiveLoadPlacements,
			liveLoadPlacementPsf,
		)
	}, [isPlacingLiveLoad, hoveredLedger, ledgerInstances, hoveredSideSign, manualLiveLoadPlacements, liveLoadPlacementPsf])

	const batchPreview = useMemo(() => {
		if (!isPlacingLiveLoad || !shiftHeld || !hoveredLedger) return []
		return computeManualLiveLoadBatchPreview(
			hoveredLedger,
			ledgerInstances,
			hoveredSideSign,
			manualLiveLoadPlacements,
			liveLoadPlacementPsf,
		)
	}, [isPlacingLiveLoad, shiftHeld, hoveredLedger, ledgerInstances, hoveredSideSign, manualLiveLoadPlacements, liveLoadPlacementPsf])

	const showBatchPreview = shiftHeld && batchPreview.length > 0
	const previewLoads = showBatchPreview
		? batchPreview.map(preview => preview.liveLoad)
		: (singlePreview ? [singlePreview.liveLoad] : [])

	const confirmBatchPlacement = useCallback(() => {
		if (batchPreview.length === 0) return
		for (const preview of batchPreview) {
			addManualLiveLoadPlacement(
				preview.placement.supportLedgerId,
				preview.placement.sideSign,
				preview.placement.magnitudePsf,
			)
		}
	}, [batchPreview, addManualLiveLoadPlacement])

	useEffect(() => {
		if (!isPlacingLiveLoad || batchPreview.length === 0) return
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== 'Enter') return
			e.preventDefault()
			e.stopPropagation()
			confirmBatchPlacement()
		}
		window.addEventListener('keydown', onKeyDown, true)
		return () => window.removeEventListener('keydown', onKeyDown, true)
	}, [isPlacingLiveLoad, batchPreview.length, confirmBatchPlacement])

	const handleLedgerHover = useCallback((ledger: RinglockLedgerInstance, e?: ThreeEvent<PointerEvent>) => {
		if (!isPlacingLiveLoad || cameraNavigationActive) return
		setHoveredLedgerId(ledger.id)
		if (e?.point) setHoveredSideSign(getLedgerSideSign(ledger, e.point))
	}, [cameraNavigationActive, isPlacingLiveLoad])

	const handleLedgerHoverOut = useCallback(() => {
		if (cameraNavigationActive) return
		setHoveredLedgerId(null)
	}, [cameraNavigationActive])

	const handleLedgerPointerDown = useCallback((ledger: RinglockLedgerInstance, e?: ThreeEvent<PointerEvent>) => {
		if (!isPlacingLiveLoad || cameraNavigationActive) return
		if (e) e.stopPropagation()
		const sideSign = hoveredLedgerId === ledger.id
			? hoveredSideSign
			: (e?.point ? getLedgerSideSign(ledger, e.point) : hoveredSideSign)
		setHoveredLedgerId(ledger.id)
		setHoveredSideSign(sideSign)

		if (shiftHeld) {
			const previews = computeManualLiveLoadBatchPreview(
				ledger,
				ledgerInstances,
				sideSign,
				manualLiveLoadPlacements,
				liveLoadPlacementPsf,
			)
			if (previews.length > 0) {
				for (const preview of previews) {
					addManualLiveLoadPlacement(
						preview.placement.supportLedgerId,
						preview.placement.sideSign,
						preview.placement.magnitudePsf,
					)
				}
				return
			}
		}

		const preview = buildManualLiveLoadPreviewForLedger(
			ledger,
			ledgerInstances,
			sideSign,
			manualLiveLoadPlacements,
			liveLoadPlacementPsf,
		)
		if (!preview) return
		addManualLiveLoadPlacement(
			preview.placement.supportLedgerId,
			preview.placement.sideSign,
			preview.placement.magnitudePsf,
		)
	}, [
		cameraNavigationActive,
		isPlacingLiveLoad,
		hoveredLedgerId,
		hoveredSideSign,
		shiftHeld,
		ledgerInstances,
		manualLiveLoadPlacements,
		liveLoadPlacementPsf,
		addManualLiveLoadPlacement,
	])

	useFrame((_, delta) => {
		if (showBatchPreview) pulseRef.current += delta * 2.5
	})

	if (!isPlacingLiveLoad) return null

	const batchOpacity = showBatchPreview
		? 0.28 + 0.12 * Math.sin(pulseRef.current)
		: 0.34

	return (
		<group>
			<RinglockLedgers
				ledgers={ledgerInstances}
				showVisuals={false}
				onSelect={handleLedgerPointerDown}
				onHover={handleLedgerHover}
				onHoverOut={handleLedgerHoverOut}
			/>

			{previewLoads.length > 0 ? (
				<PreviewLiveLoads
					liveLoads={previewLoads}
					opacity={batchOpacity}
					color={showBatchPreview ? '#fbbf24' : '#f59e0b'}
				/>
			) : null}

			{showBatchPreview ? <BatchModeIndicator count={batchPreview.length} magnitudePsf={liveLoadPlacementPsf} /> : null}
		</group>
	)
}

function PreviewLiveLoads({
	liveLoads,
	opacity,
	color,
}: {
	liveLoads: RinglockLiveLoadInstance[]
	opacity: number
	color: string
}) {
	const meshRef = useRef<THREE.InstancedMesh>(null)
	const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])

	useEffect(() => () => geometry.dispose(), [geometry])

	useLayoutEffect(() => {
		const mesh = meshRef.current
		if (!mesh) return
		const count = Math.min(liveLoads.length, PREVIEW_POOL)
		const matrix = new THREE.Matrix4()
		const quaternion = new THREE.Quaternion()
		const scale = new THREE.Vector3()
		const zAxis = new THREE.Vector3(0, 0, 1)

		mesh.count = count
		for (let i = 0; i < count; i++) {
			const liveLoad = liveLoads[i]
			quaternion.setFromAxisAngle(zAxis, liveLoad.rotationZ)
			scale.set(liveLoad.widthFt, liveLoad.lengthFt, PREVIEW_THICKNESS_FT)
			matrix.compose(liveLoad.center, quaternion, scale)
			mesh.setMatrixAt(i, matrix)
		}
		mesh.instanceMatrix.needsUpdate = true
	}, [liveLoads])

	return (
		<instancedMesh ref={meshRef} args={[undefined, undefined, PREVIEW_POOL]} frustumCulled={false} raycast={() => null}>
			<primitive object={geometry} attach="geometry" />
			<meshStandardMaterial
				color={color}
				emissive={color}
				emissiveIntensity={0.2}
				metalness={0.05}
				roughness={0.38}
				transparent
				opacity={opacity}
				depthWrite={false}
			/>
		</instancedMesh>
	)
}

function BatchModeIndicator({ count, magnitudePsf }: { count: number; magnitudePsf: number }) {
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
					background: 'linear-gradient(135deg, rgba(54, 35, 5, 0.95) 0%, rgba(88, 51, 6, 0.95) 100%)',
					borderRadius: 12,
					padding: '12px 20px',
					boxShadow: '0 8px 32px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(251, 191, 36, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
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
						background: '#fbbf24',
						boxShadow: '0 0 12px #f59e0b, 0 0 4px #f59e0b',
					}}
				/>
				<div
					style={{
						color: '#fff7ed',
						fontSize: 14,
						fontWeight: 700,
						letterSpacing: '0.01em',
					}}
				>
					Live load run preview · {Number(magnitudePsf.toFixed(2))} psf · {count} bay{count === 1 ? '' : 's'} · Press Enter to place
				</div>
			</div>
		</Html>
	)
}
