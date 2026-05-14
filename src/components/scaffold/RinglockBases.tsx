import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { ThreeEvent } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { WORKSPACE_LAYERS } from '../../contexts/ToolContext'
import { inchesToFeet } from './units'

/**
 * Base assembly instance data.
 * Each standard that sits on ground/shape gets one of these.
 */
export type RinglockBaseInstance = {
  id: string
  /** Position at ground level (bottom of wood sill or base plate if no sill) */
  groundPosition: THREE.Vector3
  /** Screw jack extension in inches (0–12) */
  jackExtensionIn: number
	/** Per-instance visibility (effective values) */
	showWoodSill: boolean
	showBaseCollar: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Structural dimensions — used by getStandardBaseOffsetFt (do not remove)
// ─────────────────────────────────────────────────────────────────────────────

const WOOD_SILL = {
  widthIn: 9,
  depthIn: 9,
  thicknessIn: 0.5,
}

// Only thicknessIn is needed structurally; width/depth drive the wood sill geometry.
const JACK_PLATE = {
  thicknessIn: 0.375,
}

// Only baseHeightIn is structural (drives getStandardBaseOffsetFt).
const JACK_STEM = {
  baseHeightIn: 2,
}

const COLLAR_LOWER = {
  heightIn: 7.0,
}

// ─────────────────────────────────────────────────────────────────────────────
// GLB asset paths & orientation
// ─────────────────────────────────────────────────────────────────────────────

const FEET_PER_METER = 3.280839895013123

// Screw jack body (plate + threaded rod)
const SCREW_JACK_ASSET_PATH = '/USJ20 Base.glb'

// Handle nut (wing nut that rides on the rod)
const HANDLE_NUT_ASSET_PATH = '/Handle Nut.glb'
// Same Y-up → Z-up base rotation, plus 90° around Z to fix the wings going sideways.
const HANDLE_NUT_ROT_X = Math.PI / 2
const HANDLE_NUT_ROT_Z = Math.PI / 2

// Base collar GLB
const BASE_COLLAR_ASSET_PATH = '/UBC Base Collar.glb'
const BASE_COLLAR_MODEL_ROTATION_X_RAD = Math.PI

// ─────────────────────────────────────────────────────────────────────────────
// Pool sizes — pre-allocated so InstancedMesh is never recreated on count change
// ─────────────────────────────────────────────────────────────────────────────

const BASE_POOL = 500
const WOOD_SILL_POOL = 500
const COLLAR_POOL = 500

// ─────────────────────────────────────────────────────────────────────────────
// Materials
// ─────────────────────────────────────────────────────────────────────────────

const STEEL_COLOR = '#b8bcc0'
const STEEL_METALNESS = 0.32
const STEEL_ROUGHNESS = 0.28

const WOOD_COLOR = '#c4a574'
const WOOD_METALNESS = 0
const WOOD_ROUGHNESS = 0.85

const SELECTED_OVERLAY_COLOR = '#a855f7'

// ─────────────────────────────────────────────────────────────────────────────
// Component Props
// ─────────────────────────────────────────────────────────────────────────────

export type RinglockBasesProps = {
  bases: RinglockBaseInstance[]
  layer?: number
  selectedId?: string | null
  onSelect?: (
		base: RinglockBaseInstance,
		componentType: 'wood-sill' | 'screw-jack' | 'base-collar',
		e?: ThreeEvent<PointerEvent>
	) => void
	clippingPlanes?: THREE.Plane[]
}

/**
 * Instanced rendering for Ringlock base assemblies.
 *
 * Stack (bottom to top):
 * 1. Wood sill (optional)
 * 2. Screw jack: USJ20 Base GLB body (Z-scaled to match structural height)
 * 3. Handle nut: Handle Nut GLB positioned at the top of the jack rod
 * 4. Base collar (optional): UBC Base Collar GLB
 */
export function RinglockBases({
  bases,
  layer = WORKSPACE_LAYERS.SCAFFOLD,
  selectedId,
  onSelect,
	clippingPlanes,
}: RinglockBasesProps) {
	const woodSillBases = useMemo(() => bases.filter(b => b.showWoodSill), [bases])
	const baseCollarBases = useMemo(() => bases.filter(b => b.showBaseCollar), [bases])
	const clipShadows = Boolean(clippingPlanes?.length)

  // ── Refs ──────────────────────────────────────────────────────────────────
  const woodSillRef    = useRef<THREE.InstancedMesh>(null)
  const screwJackRef   = useRef<THREE.InstancedMesh>(null)
  const handleNutRef   = useRef<THREE.InstancedMesh>(null)
  const collarRef      = useRef<THREE.InstancedMesh>(null)

  const woodHighlightRef      = useRef<THREE.Mesh>(null)
  const screwJackHighlightRef = useRef<THREE.Mesh>(null)
  const handleNutHighlightRef = useRef<THREE.Mesh>(null)
  const collarHighlightRef    = useRef<THREE.Mesh>(null)

  // ── userData for pick cycling ─────────────────────────────────────────────
  useEffect(() => {
    if (woodSillRef.current) {
      woodSillRef.current.userData.scaffPickKind = 'base'
      woodSillRef.current.userData.scaffBaseComponentType = 'wood-sill'
      woodSillRef.current.userData.scaffItems = woodSillBases
    }
    for (const r of [screwJackRef, handleNutRef]) {
      if (!r.current) continue
      r.current.userData.scaffPickKind = 'base'
      r.current.userData.scaffBaseComponentType = 'screw-jack'
      r.current.userData.scaffItems = bases
    }
    if (collarRef.current) {
      collarRef.current.userData.scaffPickKind = 'base'
      collarRef.current.userData.scaffBaseComponentType = 'base-collar'
      collarRef.current.userData.scaffItems = baseCollarBases
    }
  }, [bases, woodSillBases, baseCollarBases])

  // ── Load GLBs ─────────────────────────────────────────────────────────────
  const screwJackAsset  = useGLTF(SCREW_JACK_ASSET_PATH)
  const handleNutAsset  = useGLTF(HANDLE_NUT_ASSET_PATH)
  const baseCollarAsset = useGLTF(BASE_COLLAR_ASSET_PATH)

  // ── Convert dimensions to feet ────────────────────────────────────────────
  const woodSillWidthFt  = inchesToFeet(WOOD_SILL.widthIn)
  const woodSillDepthFt  = inchesToFeet(WOOD_SILL.depthIn)
  const woodSillThickFt  = inchesToFeet(WOOD_SILL.thicknessIn)
  const jackPlateThickFt = inchesToFeet(JACK_PLATE.thicknessIn)
  const jackStemBaseFt   = inchesToFeet(JACK_STEM.baseHeightIn)

  // ── Geometries ────────────────────────────────────────────────────────────

  const woodSillGeom = useMemo(() => {
    return new THREE.BoxGeometry(woodSillWidthFt, woodSillDepthFt, woodSillThickFt)
  }, [woodSillWidthFt, woodSillDepthFt, woodSillThickFt])

  /** Merge all meshes from a GLB scene into one geometry, stripped to positions only. */
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

  /**
   * Screw jack body geometry (USJ20 Base GLB).
   * Anchored so its bottom face sits at z = 0 in local space.
   * Returns geometry + natural height in feet (used for Z-scaling per instance).
   */
  const { screwJackGeom, screwJackNaturalHeightFt } = useMemo(() => {
    const merged = mergeGlbGeometry(screwJackAsset.scene)
    if (!merged.getAttribute('position')) {
      return { screwJackGeom: merged, screwJackNaturalHeightFt: 1 }
    }
    merged.applyMatrix4(new THREE.Matrix4().makeScale(FEET_PER_METER, FEET_PER_METER, FEET_PER_METER))
    merged.computeVertexNormals()
    const bounds = new THREE.Box3().setFromBufferAttribute(merged.getAttribute('position') as THREE.BufferAttribute)
    const cx = (bounds.min.x + bounds.max.x) / 2
    const cy = (bounds.min.y + bounds.max.y) / 2
    // Translate so bottom (min z) is at z = 0
    merged.applyMatrix4(new THREE.Matrix4().makeTranslation(-cx, -cy, -bounds.min.z))
    merged.computeVertexNormals()
    const naturalHeight = bounds.max.z - bounds.min.z
    return { screwJackGeom: merged, screwJackNaturalHeightFt: Math.max(naturalHeight, 0.01) }
  }, [screwJackAsset.scene])

  /**
   * Handle nut geometry.
   * Anchored so its vertical center sits at z = 0 in local space.
   * Returns geometry + half-height in feet (used to position the nut top at collarBaseZ).
   */
  const { handleNutGeom, handleNutHalfHeightFt } = useMemo(() => {
    const merged = mergeGlbGeometry(handleNutAsset.scene)
    if (!merged.getAttribute('position')) {
      return { handleNutGeom: merged, handleNutHalfHeightFt: 0 }
    }
    merged.applyMatrix4(new THREE.Matrix4().makeRotationX(HANDLE_NUT_ROT_X))
    merged.applyMatrix4(new THREE.Matrix4().makeRotationZ(HANDLE_NUT_ROT_Z))
    merged.applyMatrix4(new THREE.Matrix4().makeScale(FEET_PER_METER, FEET_PER_METER, FEET_PER_METER))
    merged.computeVertexNormals()
    const bounds = new THREE.Box3().setFromBufferAttribute(merged.getAttribute('position') as THREE.BufferAttribute)
    const cx = (bounds.min.x + bounds.max.x) / 2
    const cy = (bounds.min.y + bounds.max.y) / 2
    const cz = (bounds.min.z + bounds.max.z) / 2
    merged.applyMatrix4(new THREE.Matrix4().makeTranslation(-cx, -cy, -cz))
    merged.computeVertexNormals()
    const halfH = (bounds.max.z - bounds.min.z) / 2
    return { handleNutGeom: merged, handleNutHalfHeightFt: Math.max(halfH, 0) }
  }, [handleNutAsset.scene])

  /** Base collar GLB — same processing as before (bottom at z = 0). */
  const collarGeom = useMemo(() => {
    const merged = mergeGlbGeometry(baseCollarAsset.scene)
    if (!merged.getAttribute('position')) return merged
    merged.applyMatrix4(new THREE.Matrix4().makeRotationX(BASE_COLLAR_MODEL_ROTATION_X_RAD))
    merged.applyMatrix4(new THREE.Matrix4().makeScale(FEET_PER_METER, FEET_PER_METER, FEET_PER_METER))
    merged.computeVertexNormals()
    const bounds = new THREE.Box3().setFromBufferAttribute(merged.getAttribute('position') as THREE.BufferAttribute)
    const cx = (bounds.min.x + bounds.max.x) / 2
    const cy = (bounds.min.y + bounds.max.y) / 2
    merged.applyMatrix4(new THREE.Matrix4().makeTranslation(-cx, -cy, -bounds.min.z))
    merged.computeVertexNormals()
    return merged
  }, [baseCollarAsset.scene])

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      woodSillGeom.dispose()
      screwJackGeom.dispose()
      handleNutGeom.dispose()
      collarGeom.dispose()
    }
  }, [woodSillGeom, screwJackGeom, handleNutGeom, collarGeom])

  // ── Layers ────────────────────────────────────────────────────────────────
  useEffect(() => {
    for (const m of [woodSillRef.current, screwJackRef.current, handleNutRef.current, collarRef.current]) {
      m?.layers.set(layer)
    }
  }, [layer])

  // ── Instance matrix updates ───────────────────────────────────────────────
  useLayoutEffect(() => {
    const tmpPos    = new THREE.Vector3()
    const tmpQuat   = new THREE.Quaternion()
    const tmpScale  = new THREE.Vector3(1, 1, 1)
    const tmpMatrix = new THREE.Matrix4()
    tmpQuat.identity()

    const jackCount   = bases.length
    const woodCount   = woodSillBases.length
    const collarCount = baseCollarBases.length
    if (woodSillRef.current)  woodSillRef.current.count  = woodCount
    if (screwJackRef.current) screwJackRef.current.count = jackCount
    if (handleNutRef.current) handleNutRef.current.count = jackCount
    if (collarRef.current)    collarRef.current.count    = collarCount

    if (bases.length === 0) return

    let woodIdx   = 0
    let collarIdx = 0
    for (let i = 0; i < bases.length; i++) {
      const b  = bases[i]
      const gx = b.groundPosition.x
      const gy = b.groundPosition.y
      let   gz = b.groundPosition.z

      const extensionFt = inchesToFeet(b.jackExtensionIn)

      // 1. Wood sill (optional)
      if (b.showWoodSill && woodSillRef.current) {
        tmpPos.set(gx, gy, gz + woodSillThickFt / 2)
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
        woodSillRef.current.setMatrixAt(woodIdx, tmpMatrix)
        woodIdx++
        gz += woodSillThickFt
      }

      // Structural top of the screw jack assembly — base collar sits here.
      // This MUST match getStandardBaseOffsetFt exactly (minus any wood sill already added).
      const jackTopFt = jackPlateThickFt + jackStemBaseFt + extensionFt

      // 2. Screw jack body (USJ20 GLB)
      // Z-scaled so its top reaches gz + jackTopFt. X/Y stay at 1 to avoid width distortion
      // on the base plate; the plate is thin (<5% of total height) so the distortion is minimal.
      if (screwJackRef.current) {
        const scaleZ = jackTopFt / screwJackNaturalHeightFt
        tmpPos.set(gx, gy, gz)
        tmpScale.set(1, 1, scaleZ)
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
        screwJackRef.current.setMatrixAt(i, tmpMatrix)
        tmpScale.set(1, 1, 1)
      }

      // 3. Handle nut — top of nut sits at gz + jackTopFt (flush with collar base)
      if (handleNutRef.current) {
        const nutCenterZ = gz + jackTopFt - handleNutHalfHeightFt
        tmpPos.set(gx, gy, nutCenterZ)
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
        handleNutRef.current.setMatrixAt(i, tmpMatrix)
      }

      // 4. Base collar (optional) — bottom at gz + jackTopFt (unchanged)
      if (b.showBaseCollar) {
        const collarBaseZ = gz + jackTopFt
        if (collarRef.current) {
          tmpPos.set(gx, gy, collarBaseZ)
          tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
          collarRef.current.setMatrixAt(collarIdx, tmpMatrix)
        }
        collarIdx++
      }
    }

    woodSillRef.current  && (woodSillRef.current.instanceMatrix.needsUpdate  = true)
    screwJackRef.current && (screwJackRef.current.instanceMatrix.needsUpdate = true)
    handleNutRef.current && (handleNutRef.current.instanceMatrix.needsUpdate = true)
    collarRef.current    && (collarRef.current.instanceMatrix.needsUpdate    = true)
  }, [bases, woodSillBases, baseCollarBases, woodSillThickFt, jackPlateThickFt, jackStemBaseFt, screwJackNaturalHeightFt, handleNutHalfHeightFt])

  // ── Selection highlight ───────────────────────────────────────────────────
  const selectedBaseId    = selectedId?.split('-').slice(2).join('-') || null
  const selectedType      = selectedId?.startsWith('wood-sill-')   ? 'wood-sill'
                          : selectedId?.startsWith('screw-jack-')  ? 'screw-jack'
                          : selectedId?.startsWith('base-collar-') ? 'base-collar'
                          : null
  const selectedIndex       = selectedBaseId ? bases.findIndex(b => b.id === selectedBaseId)           : -1
  const selectedWoodIndex   = selectedBaseId ? woodSillBases.findIndex(b => b.id === selectedBaseId)   : -1
  const selectedCollarIndex = selectedBaseId ? baseCollarBases.findIndex(b => b.id === selectedBaseId) : -1

  useLayoutEffect(() => {
    const tmp = new THREE.Matrix4()
    const hideAll = () => {
      if (woodHighlightRef.current)      woodHighlightRef.current.visible      = false
      if (screwJackHighlightRef.current) screwJackHighlightRef.current.visible = false
      if (handleNutHighlightRef.current) handleNutHighlightRef.current.visible = false
      if (collarHighlightRef.current)    collarHighlightRef.current.visible    = false
    }
    hideAll()
    if (selectedIndex < 0 || selectedIndex >= bases.length) return

    if (selectedType === 'wood-sill' && selectedWoodIndex >= 0 && woodSillRef.current && woodHighlightRef.current) {
      woodSillRef.current.getMatrixAt(selectedWoodIndex, tmp)
      woodHighlightRef.current.matrix.copy(tmp)
      woodHighlightRef.current.visible = true
      return
    }
    if (selectedType === 'screw-jack') {
      if (screwJackRef.current && screwJackHighlightRef.current) {
        screwJackRef.current.getMatrixAt(selectedIndex, tmp)
        screwJackHighlightRef.current.matrix.copy(tmp)
        screwJackHighlightRef.current.visible = true
      }
      if (handleNutRef.current && handleNutHighlightRef.current) {
        handleNutRef.current.getMatrixAt(selectedIndex, tmp)
        handleNutHighlightRef.current.matrix.copy(tmp)
        handleNutHighlightRef.current.visible = true
      }
      return
    }
    if (selectedType === 'base-collar' && selectedCollarIndex >= 0 && collarRef.current && collarHighlightRef.current) {
      collarRef.current.getMatrixAt(selectedCollarIndex, tmp)
      collarHighlightRef.current.matrix.copy(tmp)
      collarHighlightRef.current.visible = true
    }
  }, [bases, selectedIndex, selectedWoodIndex, selectedCollarIndex, selectedType])

  // ── Pointer handlers ──────────────────────────────────────────────────────
  const handleWoodSillPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation(); e.nativeEvent.stopImmediatePropagation?.()
    if (!onSelect) return
    const id = e.instanceId
    if (id !== undefined && id < woodSillBases.length) onSelect(woodSillBases[id], 'wood-sill', e)
  }
  const handleScrewJackPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation(); e.nativeEvent.stopImmediatePropagation?.()
    if (!onSelect) return
    const id = e.instanceId
    if (id !== undefined && id < bases.length) onSelect(bases[id], 'screw-jack', e)
  }
  const handleBaseCollarPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation(); e.nativeEvent.stopImmediatePropagation?.()
    if (!onSelect) return
    const id = e.instanceId
    if (id !== undefined && id < baseCollarBases.length) onSelect(baseCollarBases[id], 'base-collar', e)
  }

  const overlayMat = (
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
  )

  return (
    <group>
      {/* Wood Sill */}
      <instancedMesh ref={woodSillRef} args={[undefined, undefined, WOOD_SILL_POOL]}
        frustumCulled={false} castShadow receiveShadow
        onPointerDown={onSelect ? handleWoodSillPointerDown : undefined}>
        <primitive object={woodSillGeom} attach="geometry" />
        <meshStandardMaterial color={WOOD_COLOR} metalness={WOOD_METALNESS} roughness={WOOD_ROUGHNESS} clippingPlanes={clippingPlanes} clipShadows={clipShadows} />
      </instancedMesh>

      {/* Screw Jack Body (USJ20 Base GLB) */}
      <instancedMesh ref={screwJackRef} args={[undefined, undefined, BASE_POOL]}
        frustumCulled={false} castShadow receiveShadow
        onPointerDown={onSelect ? handleScrewJackPointerDown : undefined}>
        <primitive object={screwJackGeom} attach="geometry" />
        <meshStandardMaterial color={STEEL_COLOR} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} clippingPlanes={clippingPlanes} clipShadows={clipShadows} />
      </instancedMesh>

      {/* Handle Nut (Handle Nut GLB) */}
      <instancedMesh ref={handleNutRef} args={[undefined, undefined, BASE_POOL]}
        frustumCulled={false} castShadow receiveShadow
        onPointerDown={onSelect ? handleScrewJackPointerDown : undefined}>
        <primitive object={handleNutGeom} attach="geometry" />
        <meshStandardMaterial color={STEEL_COLOR} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} clippingPlanes={clippingPlanes} clipShadows={clipShadows} />
      </instancedMesh>

      {/* Base Collar (UBC Base Collar GLB) */}
      <instancedMesh ref={collarRef} args={[undefined, undefined, COLLAR_POOL]}
        frustumCulled={false} castShadow
        onPointerDown={onSelect ? handleBaseCollarPointerDown : undefined}>
        <primitive object={collarGeom} attach="geometry" />
        <meshStandardMaterial color={STEEL_COLOR} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} clippingPlanes={clippingPlanes} clipShadows={clipShadows} />
      </instancedMesh>

      {/* Selection overlays */}
      <mesh ref={woodHighlightRef} visible={false} matrixAutoUpdate={false} raycast={() => null} renderOrder={10}>
        <primitive object={woodSillGeom} attach="geometry" />{overlayMat}
      </mesh>
      <mesh ref={screwJackHighlightRef} visible={false} matrixAutoUpdate={false} raycast={() => null} renderOrder={10}>
        <primitive object={screwJackGeom} attach="geometry" />{overlayMat}
      </mesh>
      <mesh ref={handleNutHighlightRef} visible={false} matrixAutoUpdate={false} raycast={() => null} renderOrder={10}>
        <primitive object={handleNutGeom} attach="geometry" />{overlayMat}
      </mesh>
      <mesh ref={collarHighlightRef} visible={false} matrixAutoUpdate={false} raycast={() => null} renderOrder={10}>
        <primitive object={collarGeom} attach="geometry" />{overlayMat}
      </mesh>
    </group>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Structural height helper — imported by PlaceStandardTool, ScaffoldCatalogPreview
// ─────────────────────────────────────────────────────────────────────────────

export function getStandardBaseOffsetFt(
  jackExtensionIn: number,
  showWoodSill: boolean,
  showBaseCollar: boolean,
): number {
  let offset = 0
  if (showWoodSill)    offset += inchesToFeet(WOOD_SILL.thicknessIn)
  offset += inchesToFeet(JACK_PLATE.thicknessIn)
  offset += inchesToFeet(JACK_STEM.baseHeightIn + jackExtensionIn)
  if (showBaseCollar)  offset += inchesToFeet(COLLAR_LOWER.heightIn)
  return offset
}
