import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { WORKSPACE_LAYERS } from '../../contexts/ToolContext'
import { inchesToFeet } from './units'

const DIAGONAL_COLOR = '#b8bcc0'
const SELECTED_OVERLAY_COLOR = '#a855f7'
const DIAGONAL_POOL = 4000

export type RinglockDiagonalInstance = {
	id: string
	partNumber?: string
	start: THREE.Vector3
	end: THREE.Vector3
}

export function RinglockDiagonals({
	diagonals,
	layer = WORKSPACE_LAYERS.SCAFFOLD,
	selectedId,
	onSelect,
		clippingPlanes,
}: {
	diagonals: RinglockDiagonalInstance[]
	layer?: number
	selectedId?: string | null
	onSelect?: (diagonal: RinglockDiagonalInstance, e?: ThreeEvent<PointerEvent>) => void
		clippingPlanes?: THREE.Plane[]
}) {
	const meshRef = useRef<THREE.InstancedMesh>(null)
	const pickRef = useRef<THREE.InstancedMesh>(null)
		const clipShadows = Boolean(clippingPlanes?.length)
	const radiusFt = inchesToFeet(1.9) / 2
	const pickRadiusFt = Math.max(radiusFt, inchesToFeet(8) / 2)

	const geometry = useMemo(() => {
		return new THREE.CylinderGeometry(radiusFt, radiusFt, 1, 12, 1, false)
	}, [radiusFt])

	const pickGeometry = useMemo(() => {
		return new THREE.CylinderGeometry(pickRadiusFt, pickRadiusFt, 1, 12, 1, false)
	}, [pickRadiusFt])

	useEffect(() => {
		return () => {
			geometry.dispose()
			pickGeometry.dispose()
		}
	}, [geometry, pickGeometry])

	useEffect(() => {
		meshRef.current?.layers.set(layer)
		pickRef.current?.layers.set(layer)
	}, [layer])

	useEffect(() => {
		if (!pickRef.current) return
		pickRef.current.userData.scaffPickKind = 'diagonal'
		pickRef.current.userData.scaffItems = diagonals
	}, [diagonals])

	useLayoutEffect(() => {
		const mesh = meshRef.current
		const pick = pickRef.current
		if (!mesh && !pick) return
		const count = Math.min(diagonals.length, DIAGONAL_POOL)
		if (mesh) mesh.count = count
		if (pick) pick.count = count

		const yAxis = new THREE.Vector3(0, 1, 0)
		const tmpMid = new THREE.Vector3()
		const tmpDir = new THREE.Vector3()
		const tmpQuat = new THREE.Quaternion()
		const tmpScale = new THREE.Vector3()
		const tmpMatrix = new THREE.Matrix4()

		for (let i = 0; i < count; i++) {
			const d = diagonals[i]
			tmpMid.addVectors(d.start, d.end).multiplyScalar(0.5)
			tmpDir.subVectors(d.end, d.start)
			const length = tmpDir.length()

			if (length < 1e-6) {
				tmpQuat.identity()
				tmpScale.set(1, 0, 1)
			} else {
				tmpDir.divideScalar(length)
				tmpQuat.setFromUnitVectors(yAxis, tmpDir)
				tmpScale.set(1, length, 1)
			}

			tmpMatrix.compose(tmpMid, tmpQuat, tmpScale)
			mesh?.setMatrixAt(i, tmpMatrix)
			pick?.setMatrixAt(i, tmpMatrix)
		}

		if (mesh) mesh.instanceMatrix.needsUpdate = true
		if (pick) pick.instanceMatrix.needsUpdate = true
	}, [diagonals])

	const selectedIndex = selectedId ? diagonals.findIndex((d) => d.id === selectedId) : -1

	const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
		if (e.button !== 0) return
		e.stopPropagation()
		e.nativeEvent.stopImmediatePropagation?.()
		if (!onSelect) return
		const instanceId = e.instanceId
		if (instanceId === undefined || instanceId < 0 || instanceId >= diagonals.length) return
		onSelect(diagonals[instanceId], e)
	}

	return (
		<group>
			<instancedMesh
				ref={pickRef}
				args={[undefined, undefined, DIAGONAL_POOL]}
				frustumCulled={false}
				onPointerDown={onSelect ? handlePointerDown : undefined}
			>
				<primitive object={pickGeometry} attach="geometry" />
				<meshBasicMaterial transparent opacity={0} depthWrite={false} />
			</instancedMesh>

			<instancedMesh
				ref={meshRef}
				args={[undefined, undefined, DIAGONAL_POOL]}
				frustumCulled={false}
				castShadow
				receiveShadow
			>
				<primitive object={geometry} attach="geometry" />
					<meshStandardMaterial color={DIAGONAL_COLOR} metalness={0.32} roughness={0.28} clippingPlanes={clippingPlanes} clipShadows={clipShadows} />
			</instancedMesh>

			{selectedIndex >= 0 && selectedIndex < diagonals.length && (() => {
				const diagonal = diagonals[selectedIndex]
				const mid = new THREE.Vector3().addVectors(diagonal.start, diagonal.end).multiplyScalar(0.5)
				const dir = new THREE.Vector3().subVectors(diagonal.end, diagonal.start)
				const length = dir.length()
				if (length < 1e-6) return null
				dir.divideScalar(length)
				const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
				return (
					<mesh
						raycast={() => null}
						renderOrder={10}
						position={[mid.x, mid.y, mid.z]}
						quaternion={quat}
						scale={[1.05, length, 1.05]}
					>
						<primitive object={geometry} attach="geometry" />
						<meshStandardMaterial
							color={SELECTED_OVERLAY_COLOR}
							emissive={SELECTED_OVERLAY_COLOR}
							emissiveIntensity={0.35}
							transparent
							opacity={0.32}
							depthWrite={false}
							polygonOffset
							polygonOffsetFactor={-1}
							polygonOffsetUnits={-1}
								clippingPlanes={clippingPlanes}
						/>
					</mesh>
				)
			})()}
		</group>
	)
}
