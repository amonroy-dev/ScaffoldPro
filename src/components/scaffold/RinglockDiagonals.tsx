import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { WORKSPACE_LAYERS } from '../../contexts/ToolContext'
import { inchesToFeet } from './units'

const DIAGONAL_COLOR = '#b8bcc0'
const SELECTED_OVERLAY_COLOR = '#a855f7'
const DIAGONAL_POOL = 4000
const GLB_GROUP_POOL = 1000
const FEET_PER_METER = 3.280839895013123

export type RinglockDiagonalInstance = {
	id: string
	partNumber?: string
	start: THREE.Vector3
	end: THREE.Vector3
}

const UD_GLB_PATHS: Partial<Record<string, string>> = {
	UD20:  "/UD20  2'-0 Diagonal.glb",
	UD36:  "/UD36  3'-6 Diagonal.glb",
	UD40:  "/UD40  4'-0 Diagonal.glb",
	UD50:  "/UD50  5'-0 Diagonal.glb",
	UD60:  "/UD60  6'-0 Diagonal.glb",
	UD70:  "/UD70  7'-0 Diagonal.glb",
	UD80:  "/UD80  8'-0 Diagonal.glb",
	UD100: "/UD100  10'-0 Diagonal.glb",
}

// Preload all GLBs at module level so they're ready before first render
Object.values(UD_GLB_PATHS).forEach(path => { if (path) useGLTF.preload(path) })

function mergeGlbGeometry(scene: THREE.Group): THREE.BufferGeometry {
	const geoms: THREE.BufferGeometry[] = []
	scene.updateMatrixWorld(true)
	scene.traverse((object) => {
		if (!(object instanceof THREE.Mesh) || !object.geometry) return
		const g = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()
		g.applyMatrix4(object.matrixWorld)
		for (const attr of Object.keys(g.attributes)) {
			if (attr !== 'position') g.deleteAttribute(attr)
		}
		geoms.push(g)
	})
	const merged = mergeGeometries(geoms, false) ?? new THREE.BufferGeometry()
	for (const g of geoms) g.dispose()
	return merged
}

// ─── Per-part-number GLB group ──────────────────────────────────────────────

function DiagonalGlbGroup({
	partNumber,
	diagonals,
	layer,
	clippingPlanes,
}: {
	partNumber: string
	diagonals: RinglockDiagonalInstance[]
	layer: number
	clippingPlanes?: THREE.Plane[]
}) {
	const gltf = useGLTF(UD_GLB_PATHS[partNumber]!)
	const meshRef = useRef<THREE.InstancedMesh>(null)
	const clipShadows = Boolean(clippingPlanes?.length)

	const { geom, modelDir } = useMemo(() => {
		const merged = mergeGlbGeometry(gltf.scene as THREE.Group)
		const fallbackDir = new THREE.Vector3(0, 0, 1)
		if (!merged.getAttribute('position')) {
			return { geom: merged, modelDir: fallbackDir }
		}

		// Scale from meters (glTF) to feet (scene units)
		merged.applyMatrix4(new THREE.Matrix4().makeScale(FEET_PER_METER, FEET_PER_METER, FEET_PER_METER))
		merged.computeVertexNormals()

		const posAttr = merged.getAttribute('position') as THREE.BufferAttribute
		const posArr = posAttr.array as Float32Array
		const vCount = Math.floor(posArr.length / 3)

		// Step 1: bounding box diagonal as a first approximation of the tube axis
		const bounds = new THREE.Box3().setFromBufferAttribute(posAttr)
		const approxAxis = new THREE.Vector3().subVectors(bounds.max, bounds.min)
		if (approxAxis.length() < 0.01) approxAxis.set(0, 0, 1)
		else approxAxis.normalize()

		// Step 2: project all vertices onto the approx axis, find extent
		let minProj = Infinity, maxProj = -Infinity
		const projs = new Float32Array(vCount)
		for (let i = 0; i < vCount; i++) {
			const p = posArr[i * 3] * approxAxis.x + posArr[i * 3 + 1] * approxAxis.y + posArr[i * 3 + 2] * approxAxis.z
			projs[i] = p
			if (p < minProj) minProj = p
			if (p > maxProj) maxProj = p
		}

		// Step 3: centroid of vertices near each end (within 5% of the range)
		const range = maxProj - minProj
		const thresh = range * 0.05
		const endA = new THREE.Vector3()
		const endB = new THREE.Vector3()
		let nA = 0, nB = 0
		for (let i = 0; i < vCount; i++) {
			if (projs[i] - minProj < thresh) {
				endA.x += posArr[i * 3]; endA.y += posArr[i * 3 + 1]; endA.z += posArr[i * 3 + 2]; nA++
			}
			if (maxProj - projs[i] < thresh) {
				endB.x += posArr[i * 3]; endB.y += posArr[i * 3 + 1]; endB.z += posArr[i * 3 + 2]; nB++
			}
		}
		if (nA > 0) endA.divideScalar(nA)
		if (nB > 0) endB.divideScalar(nB)

		// Step 4: center geometry at the midpoint of the two connector centroids
		const tubeMid = new THREE.Vector3().addVectors(endA, endB).multiplyScalar(0.5)
		merged.applyMatrix4(new THREE.Matrix4().makeTranslation(-tubeMid.x, -tubeMid.y, -tubeMid.z))
		merged.computeVertexNormals()

		// modelDir: the natural tube direction in (now-centered) model space.
		// We use endA→endB but then negate so the connector that sits at endB (top)
		// aligns with d.start and the connector at endA (bottom) aligns with d.end,
		// which matches the ascending placement convention.
		const dir = new THREE.Vector3().subVectors(endB, endA)
		if (dir.length() < 0.01) dir.copy(fallbackDir)
		else dir.normalize()
		dir.negate()

		return { geom: merged, modelDir: dir }
	}, [gltf.scene])

	useEffect(() => () => geom.dispose(), [geom])

	useEffect(() => {
		meshRef.current?.layers.set(layer)
	}, [layer])

	const count = Math.min(diagonals.length, GLB_GROUP_POOL)

	useLayoutEffect(() => {
		const mesh = meshRef.current
		if (!mesh) return
		mesh.count = count

		const tmpMid = new THREE.Vector3()
		const tmpDir = new THREE.Vector3()
		const tmpQuat = new THREE.Quaternion()
		const tmpScale = new THREE.Vector3(1, 1, 1)
		const tmpMatrix = new THREE.Matrix4()

		for (let i = 0; i < count; i++) {
			const d = diagonals[i]
			tmpMid.addVectors(d.start, d.end).multiplyScalar(0.5)
			tmpDir.subVectors(d.end, d.start)
			const len = tmpDir.length()

			if (len < 1e-6) {
				tmpQuat.identity()
			} else {
				tmpDir.divideScalar(len)
				tmpQuat.setFromUnitVectors(modelDir, tmpDir)
			}

			tmpMatrix.compose(tmpMid, tmpQuat, tmpScale)
			mesh.setMatrixAt(i, tmpMatrix)
		}

		mesh.instanceMatrix.needsUpdate = true
	}, [diagonals, count, modelDir])

	return (
		<instancedMesh
			ref={meshRef}
			args={[undefined, undefined, GLB_GROUP_POOL]}
			frustumCulled={false}
			castShadow
			receiveShadow
		>
			<primitive object={geom} attach="geometry" />
			<meshStandardMaterial
				color={DIAGONAL_COLOR}
				metalness={0.32}
				roughness={0.28}
				clippingPlanes={clippingPlanes}
				clipShadows={clipShadows}
			/>
		</instancedMesh>
	)
}

// ─── Main component ──────────────────────────────────────────────────────────

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
	// ── Invisible pick cylinder (unchanged — handles click detection) ──────────
	const pickRef = useRef<THREE.InstancedMesh>(null)
	const pickRadiusFt = Math.max(inchesToFeet(1.9) / 2, inchesToFeet(8) / 2)

	const pickGeometry = useMemo(() => {
		return new THREE.CylinderGeometry(pickRadiusFt, pickRadiusFt, 1, 12, 1, false)
	}, [pickRadiusFt])

	useEffect(() => {
		return () => pickGeometry.dispose()
	}, [pickGeometry])

	useEffect(() => {
		pickRef.current?.layers.set(layer)
	}, [layer])

	useEffect(() => {
		if (!pickRef.current) return
		pickRef.current.userData.scaffPickKind = 'diagonal'
		pickRef.current.userData.scaffItems = diagonals
	}, [diagonals])

	useLayoutEffect(() => {
		const pick = pickRef.current
		if (!pick) return
		const count = Math.min(diagonals.length, DIAGONAL_POOL)
		pick.count = count

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
			pick.setMatrixAt(i, tmpMatrix)
		}

		pick.instanceMatrix.needsUpdate = true
	}, [diagonals])

	const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
		if (e.button !== 0) return
		e.stopPropagation()
		e.nativeEvent.stopImmediatePropagation?.()
		if (!onSelect) return
		const instanceId = e.instanceId
		if (instanceId === undefined || instanceId < 0 || instanceId >= diagonals.length) return
		onSelect(diagonals[instanceId], e)
	}

	// ── Group by part number for GLB rendering ────────────────────────────────
	const { glbGroups, fallbackDiagonals } = useMemo(() => {
		const groups = new Map<string, RinglockDiagonalInstance[]>()
		const fallback: RinglockDiagonalInstance[] = []
		for (const d of diagonals) {
			const pn = d.partNumber
			if (pn && UD_GLB_PATHS[pn]) {
				const arr = groups.get(pn) ?? []
				arr.push(d)
				groups.set(pn, arr)
			} else {
				fallback.push(d)
			}
		}
		return { glbGroups: groups, fallbackDiagonals: fallback }
	}, [diagonals])

	// ── Fallback cylinder instanced mesh for unknown part numbers ─────────────
	const fallbackMeshRef = useRef<THREE.InstancedMesh>(null)
	const fallbackRadiusFt = inchesToFeet(1.9) / 2

	const fallbackGeometry = useMemo(() => {
		return new THREE.CylinderGeometry(fallbackRadiusFt, fallbackRadiusFt, 1, 12, 1, false)
	}, [fallbackRadiusFt])

	useEffect(() => {
		return () => fallbackGeometry.dispose()
	}, [fallbackGeometry])

	useEffect(() => {
		fallbackMeshRef.current?.layers.set(layer)
	}, [layer])

	useLayoutEffect(() => {
		const mesh = fallbackMeshRef.current
		if (!mesh) return
		const count = Math.min(fallbackDiagonals.length, DIAGONAL_POOL)
		mesh.count = count

		const yAxis = new THREE.Vector3(0, 1, 0)
		const tmpMid = new THREE.Vector3()
		const tmpDir = new THREE.Vector3()
		const tmpQuat = new THREE.Quaternion()
		const tmpScale = new THREE.Vector3()
		const tmpMatrix = new THREE.Matrix4()

		for (let i = 0; i < count; i++) {
			const d = fallbackDiagonals[i]
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
			mesh.setMatrixAt(i, tmpMatrix)
		}

		mesh.instanceMatrix.needsUpdate = true
	}, [fallbackDiagonals])

	// ── Selection highlight (cylinder overlay on the selected diagonal) ────────
	const selectedIndex = selectedId ? diagonals.findIndex((d) => d.id === selectedId) : -1

	const highlightGeometry = useMemo(() => {
		return new THREE.CylinderGeometry(fallbackRadiusFt, fallbackRadiusFt, 1, 12, 1, false)
	}, [fallbackRadiusFt])

	useEffect(() => {
		return () => highlightGeometry.dispose()
	}, [highlightGeometry])

	return (
		<group>
			{/* Invisible pick cylinders — covers all diagonals for click detection */}
			<instancedMesh
				ref={pickRef}
				args={[undefined, undefined, DIAGONAL_POOL]}
				frustumCulled={false}
				onPointerDown={onSelect ? handlePointerDown : undefined}
			>
				<primitive object={pickGeometry} attach="geometry" />
				<meshBasicMaterial transparent opacity={0} depthWrite={false} />
			</instancedMesh>

			{/* GLB visual groups per part number */}
			{Array.from(glbGroups.entries()).map(([pn, group]) => (
				<Suspense key={pn} fallback={null}>
					<DiagonalGlbGroup
						partNumber={pn}
						diagonals={group}
						layer={layer}
						clippingPlanes={clippingPlanes}
					/>
				</Suspense>
			))}

			{/* Fallback cylinder for diagonals with no GLB */}
			{fallbackDiagonals.length > 0 && (
				<instancedMesh
					ref={fallbackMeshRef}
					args={[undefined, undefined, DIAGONAL_POOL]}
					frustumCulled={false}
					castShadow
					receiveShadow
				>
					<primitive object={fallbackGeometry} attach="geometry" />
					<meshStandardMaterial
						color={DIAGONAL_COLOR}
						metalness={0.32}
						roughness={0.28}
						clippingPlanes={clippingPlanes}
						clipShadows={Boolean(clippingPlanes?.length)}
					/>
				</instancedMesh>
			)}

			{/* Selection highlight */}
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
						<primitive object={highlightGeometry} attach="geometry" />
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
