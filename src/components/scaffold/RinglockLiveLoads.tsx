import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { WORKSPACE_LAYERS } from '../../contexts/ToolContext'
import type { RinglockLiveLoadInstance } from './manualLiveLoadPlacement'
import { inchesToFeet } from './units'

const LIVE_LOAD_POOL = 4000
const LIVE_LOAD_PICK_THICKNESS_FT = inchesToFeet(10)
const LIVE_LOAD_VISUAL_THICKNESS_FT = inchesToFeet(0.35)
const DEFAULT_LIVE_LOAD_COLOR = '#22d3ee'
const DEFAULT_LIVE_LOAD_SELECTED_COLOR = '#67e8f9'

function createOneWayStripeTexture(backgroundFill: string, stripeColor: string) {
	const canvas = document.createElement('canvas')
	canvas.width = 256
	canvas.height = 256
	const ctx = canvas.getContext('2d')
	if (!ctx) return new THREE.CanvasTexture(canvas)

	ctx.clearRect(0, 0, canvas.width, canvas.height)
	ctx.fillStyle = backgroundFill
	ctx.fillRect(0, 0, canvas.width, canvas.height)

	ctx.strokeStyle = stripeColor
	ctx.lineWidth = 5
	for (let x = 24; x < canvas.width; x += 36) {
		ctx.beginPath()
		ctx.moveTo(x, 0)
		ctx.lineTo(x, canvas.height)
		ctx.stroke()
	}

	const texture = new THREE.CanvasTexture(canvas)
	texture.colorSpace = THREE.SRGBColorSpace
	texture.wrapS = THREE.RepeatWrapping
	texture.wrapT = THREE.RepeatWrapping
	texture.repeat.set(1, 1)
	return texture
}

export function RinglockLiveLoads({
	liveLoads,
	layer = WORKSPACE_LAYERS.SCAFFOLD,
	selectedId,
	onSelect,
	clippingPlanes,
	fillColor = DEFAULT_LIVE_LOAD_COLOR,
	emissiveColor = fillColor,
	backgroundFill = 'rgba(34, 211, 238, 0.24)',
	stripeColor = 'rgba(236, 254, 255, 0.92)',
	opacity = 0.42,
	selectedFillColor = DEFAULT_LIVE_LOAD_SELECTED_COLOR,
	outlineColor,
	outlineOpacity = 0,
}: {
	liveLoads: RinglockLiveLoadInstance[]
	layer?: number
	selectedId?: string | null
	onSelect?: (liveLoad: RinglockLiveLoadInstance, e?: ThreeEvent<PointerEvent>) => void
	clippingPlanes?: THREE.Plane[]
	fillColor?: string
	emissiveColor?: string
	backgroundFill?: string
	stripeColor?: string
	opacity?: number
	selectedFillColor?: string
	outlineColor?: string
	outlineOpacity?: number
}) {
	const fillMeshRef = useRef<THREE.InstancedMesh>(null)
	const pickMeshRef = useRef<THREE.InstancedMesh>(null)
	const outlineMeshRef = useRef<THREE.InstancedMesh>(null)
	const bodyGeometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
	const fillGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), [])
	const stripeTexture = useMemo(() => createOneWayStripeTexture(backgroundFill, stripeColor), [backgroundFill, stripeColor])
	const clipShadows = Boolean(clippingPlanes?.length)

	useEffect(() => {
		return () => {
			bodyGeometry.dispose()
			fillGeometry.dispose()
			stripeTexture.dispose()
		}
	}, [bodyGeometry, fillGeometry, stripeTexture])

	useEffect(() => {
		if (fillMeshRef.current) fillMeshRef.current.layers.set(layer)
		if (pickMeshRef.current) pickMeshRef.current.layers.set(layer)
		if (outlineMeshRef.current) outlineMeshRef.current.layers.set(layer)
	}, [layer])

	useEffect(() => {
		if (!pickMeshRef.current) return
		pickMeshRef.current.userData.scaffPickKind = 'live-load'
		pickMeshRef.current.userData.scaffItems = liveLoads
	}, [liveLoads])

	useLayoutEffect(() => {
		const tmpMatrix = new THREE.Matrix4()
		const tmpQuat = new THREE.Quaternion()
		const tmpScale = new THREE.Vector3()
		const zAxis = new THREE.Vector3(0, 0, 1)
		const visibleCount = Math.min(liveLoads.length, LIVE_LOAD_POOL)

		const updateMesh = (mesh: THREE.InstancedMesh | null, thicknessFt: number, scaleMultiplier = 1) => {
			if (!mesh) return
			mesh.count = visibleCount
			for (let i = 0; i < visibleCount; i++) {
				const liveLoad = liveLoads[i]
				tmpQuat.setFromAxisAngle(zAxis, liveLoad.rotationZ)
				tmpScale.set(liveLoad.widthFt * scaleMultiplier, liveLoad.lengthFt * scaleMultiplier, thicknessFt)
				tmpMatrix.compose(liveLoad.center, tmpQuat, tmpScale)
				mesh.setMatrixAt(i, tmpMatrix)
			}
			mesh.instanceMatrix.needsUpdate = true
		}

		updateMesh(fillMeshRef.current, LIVE_LOAD_VISUAL_THICKNESS_FT)
		updateMesh(pickMeshRef.current, LIVE_LOAD_PICK_THICKNESS_FT)
		updateMesh(outlineMeshRef.current, LIVE_LOAD_VISUAL_THICKNESS_FT, 1.06)
	}, [liveLoads])

	const selectedLoad = selectedId ? liveLoads.find(liveLoad => liveLoad.id === selectedId) ?? null : null

	const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
		if (e.button !== 0) return
		e.stopPropagation()
		e.nativeEvent.stopImmediatePropagation?.()
		if (!onSelect) return
		const instanceId = e.instanceId
		if (instanceId === undefined || instanceId < 0 || instanceId >= liveLoads.length) return
		onSelect(liveLoads[instanceId], e)
	}

	return (
		<group>
			<instancedMesh
				ref={pickMeshRef}
				args={[undefined, undefined, LIVE_LOAD_POOL]}
				frustumCulled={false}
				onPointerDown={onSelect ? handlePointerDown : undefined}
			>
				<primitive object={bodyGeometry} attach="geometry" />
				<meshBasicMaterial transparent opacity={0} depthWrite={false} />
			</instancedMesh>

			<instancedMesh
				ref={fillMeshRef}
				args={[undefined, undefined, LIVE_LOAD_POOL]}
				frustumCulled={false}
				onPointerDown={onSelect ? handlePointerDown : undefined}
			>
				<primitive object={fillGeometry} attach="geometry" />
				<meshStandardMaterial
					map={stripeTexture}
					color={fillColor}
					emissive={emissiveColor}
					emissiveIntensity={0.34}
					transparent
					opacity={opacity}
					metalness={0.08}
					roughness={0.48}
					depthWrite={false}
					side={THREE.DoubleSide}
					polygonOffset
					polygonOffsetFactor={-1}
					polygonOffsetUnits={-1}
					clippingPlanes={clippingPlanes}
					clipShadows={clipShadows}
				/>
			</instancedMesh>

			{outlineOpacity > 0 && outlineColor ? (
				<instancedMesh
					ref={outlineMeshRef}
					args={[undefined, undefined, LIVE_LOAD_POOL]}
					frustumCulled={false}
					onPointerDown={onSelect ? handlePointerDown : undefined}
				>
					<primitive object={fillGeometry} attach="geometry" />
					<meshBasicMaterial
						color={outlineColor}
						transparent
						opacity={outlineOpacity}
						depthWrite={false}
						side={THREE.DoubleSide}
					/>
				</instancedMesh>
			) : null}

			{selectedLoad ? (
				<mesh
					raycast={() => null}
					renderOrder={12}
					position={[selectedLoad.center.x, selectedLoad.center.y, selectedLoad.center.z + inchesToFeet(0.02)]}
					rotation={[0, 0, selectedLoad.rotationZ]}
					scale={[selectedLoad.widthFt * 1.03, selectedLoad.lengthFt * 1.03, 1]}
				>
					<primitive object={fillGeometry} attach="geometry" />
					<meshBasicMaterial
						color={selectedFillColor}
						transparent
						opacity={0.42}
						depthWrite={false}
						side={THREE.DoubleSide}
					/>
				</mesh>
			) : null}
		</group>
	)
}
