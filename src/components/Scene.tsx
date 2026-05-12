import { useRef, useEffect, useLayoutEffect, useMemo, useCallback, useState } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import {
  CameraControls,
  GizmoHelper,
  GizmoViewcube,
  OrthographicCamera,
  PerspectiveCamera,
  Grid,
} from '@react-three/drei'
import CameraControlsImpl from 'camera-controls'
import * as THREE from 'three'
import { useSettings } from '../contexts/SettingsContext'
import { useTool, WORKSPACE_LAYERS, type DrawingViewApplyRequest, type LiveCameraState, type ViewMode } from '../contexts/ToolContext'
import { useCatalogSelection } from '../contexts/CatalogContext'
import type { DrawingSectionDefinition } from '../drawings/drawingDocument'
import { DrawingPlane } from './DrawingPlane'
import { DrawingPreview } from './DrawingPreview'
import { SceneObjects } from './SceneObjects'
import { ScaffoldWorkspace } from './scaffold/ScaffoldWorkspace'
import { PlaceStandardTool } from './scaffold/PlaceStandardTool'
import { PlaceLedgerTool } from './scaffold/PlaceLedgerTool'
	import { PlaceBlockTool } from './scaffold/PlaceBlockTool'
import { PlacePlankTool } from './scaffold/PlacePlankTool'

/**
 * Component to set the Three.js scene background color
 */
function SceneBackground() {
  const { scene } = useThree()
  const { settings } = useSettings()

  useEffect(() => {
    scene.background = new THREE.Color(settings.backgroundColor)
  }, [scene, settings.backgroundColor])

  return null
}

function toSerializedVector3(vector: THREE.Vector3): LiveCameraState['position'] {
  return { x: vector.x, y: vector.y, z: vector.z }
}

function vector3LikeEqual(
  a: { x: number; y: number; z: number } | null,
  b: { x: number; y: number; z: number } | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.x === b.x && a.y === b.y && a.z === b.z
}

function liveCameraStatesEqual(a: LiveCameraState | null, b: LiveCameraState | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.zoom === b.zoom &&
    a.projection === b.projection &&
    a.viewMode === b.viewMode &&
    vector3LikeEqual(a.position, b.position) &&
    vector3LikeEqual(a.target, b.target) &&
    vector3LikeEqual(a.orthoDirection, b.orthoDirection)
  )
}

function getUpVectorForViewMode(mode: ViewMode, customDir: THREE.Vector3 | null): [number, number, number] {
  if (mode === 'ortho-top') return [0, 1, 0]
  if (mode === 'ortho-bottom') return [0, -1, 0]
  if (mode === 'ortho-custom' && customDir) {
    const dir = customDir.clone().normalize()
    if (Math.abs(dir.z) > 0.999) {
      return [0, dir.z > 0 ? 1 : -1, 0]
    }
  }
  return [0, 0, 1]
}

function resolveOrthoViewFromCamera(position: THREE.Vector3, target: THREE.Vector3): { mode: ViewMode; direction: THREE.Vector3 | null } {
  const direction = position.clone().sub(target)
  if (direction.lengthSq() <= 1e-8) {
    return { mode: 'ortho-top', direction: null }
  }

  direction.normalize()
  const axisCandidates: Array<{ mode: ViewMode; axis: THREE.Vector3 }> = [
    { mode: 'ortho-right', axis: new THREE.Vector3(1, 0, 0) },
    { mode: 'ortho-left', axis: new THREE.Vector3(-1, 0, 0) },
    { mode: 'ortho-back', axis: new THREE.Vector3(0, 1, 0) },
    { mode: 'ortho-front', axis: new THREE.Vector3(0, -1, 0) },
    { mode: 'ortho-top', axis: new THREE.Vector3(0, 0, 1) },
    { mode: 'ortho-bottom', axis: new THREE.Vector3(0, 0, -1) },
  ]

  let best = axisCandidates[0]!
  let bestDot = -Infinity
  for (const candidate of axisCandidates) {
    const dot = direction.dot(candidate.axis)
    if (dot > bestDot) {
      best = candidate
      bestDot = dot
    }
  }

  if (bestDot > 0.999) {
    return { mode: best.mode, direction: null }
  }

  return { mode: 'ortho-custom', direction }
}

function buildSectionClippingPlanes(section: DrawingSectionDefinition): THREE.Plane[] {
	const origin = new THREE.Vector3(section.origin.x, section.origin.y, section.origin.z)
	const normal = new THREE.Vector3(section.normal.x, section.normal.y, section.normal.z)
	if (normal.lengthSq() <= 1e-8) {
		normal.set(0, 1, 0)
	} else {
		normal.normalize()
	}

	const depthFt = Number.isFinite(section.depthFt) ? Math.max(section.depthFt, 0) : 0
	const planes: THREE.Plane[] = []

	if (section.clipMode === 'section' || depthFt <= 1e-4) {
		planes.push(new THREE.Plane().setFromNormalAndCoplanarPoint(normal.clone().negate(), origin))
	}

	if (depthFt > 1e-4) {
		const backClipPoint = origin.clone().addScaledVector(normal, depthFt)
		planes.push(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, backClipPoint))
	}

	return planes
}

function ActiveSectionMarker({ section, size }: { section: DrawingSectionDefinition; size: number }) {
  const origin = useMemo(
    () => new THREE.Vector3(section.origin.x, section.origin.y, section.origin.z),
    [section.origin.x, section.origin.y, section.origin.z],
  )
  const normal = useMemo(() => {
    const candidate = new THREE.Vector3(section.normal.x, section.normal.y, section.normal.z)
    return candidate.lengthSq() > 1e-8 ? candidate.normalize() : new THREE.Vector3(0, 1, 0)
  }, [section.normal.x, section.normal.y, section.normal.z])
  const rotation = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal),
    [normal],
  )
  const depthLinePositions = useMemo(
    () => new Float32Array([0, 0, 0, 0, 0, Math.max(2, section.depthFt)]),
    [section.depthFt],
  )

  return (
    <group position={[origin.x, origin.y, origin.z]} quaternion={rotation}>
      <mesh renderOrder={20}>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial color="#4a9eff" transparent opacity={0.11} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh renderOrder={21}>
        <sphereGeometry args={[Math.max(size * 0.025, 0.22), 20, 20]} />
        <meshBasicMaterial color="#1d4ed8" toneMapped={false} />
      </mesh>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[depthLinePositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#1d4ed8" toneMapped={false} />
      </line>
    </group>
  )
}

/**
 * Main 3D Scene component
 * - PerspectiveCamera at (10,10,10) looking at origin
 * - OrbitControls with damping
 * - Ambient + Directional (sun) lighting
 * - Optional grid based on settings
 * - Drawing tools and scene objects
 */
export function Scene() {
  const { settings } = useSettings()
  const { categoryKey } = useCatalogSelection()
  const { gl, raycaster } = useThree()
	const {
    activeTool,
    drawingState,
    objects,
    workspaceMode,
		blockToolSettings,
			dxfPreviewEnabled,
			drawingPackage,
    viewMode,
    setViewMode,
    orthoDirection,
    setOrthoDirection,
    saveCameraStateRef,
    requestHomeViewRef,
    setCameraTransitioning,
			setCameraNavigationActive,
			publishLiveCameraState,
			drawingViewApplyRequest,
			clearDrawingViewApplyRequest,
			activeDrawingSectionId,
			setActiveDrawingSectionId,
  } = useTool()
	const controlsRef = useRef<CameraControlsImpl | null>(null)
	const controlsListenersCleanupRef = useRef<(() => void) | null>(null)
  const lastPublishedCameraStateRef = useRef<LiveCameraState | null>(null)
  const pendingDrawingViewRequestRef = useRef<DrawingViewApplyRequest | null>(null)
  const isApplyingDrawingViewRef = useRef(false)
	const navigationModifierRef = useRef({ shiftKey: false, spaceKey: false })
	const middleMousePanRef = useRef<{
		lastX: number
		lastY: number
	} | null>(null)
	const rightMouseOrbitRef = useRef<{
		lastX: number
		lastY: number
	} | null>(null)
	const orbitDragRef = useRef<{
		pointerId: number
		mode: 'pan' | 'orbit'
		lastX: number
		lastY: number
	} | null>(null)

	// In Block tool "Blocks" (assemble) mode, building geometry becomes visual reference only
	// so it should not compete with block handles or block picking.
	const isBlockAssembleInteraction =
		workspaceMode === 'SCAFFOLD_MODE' && activeTool === 'block' && blockToolSettings?.mode === 'assemble'

  /**
   * Bitmask layers for selective picking:
   * - Always allow interaction layer (0) so DrawingPlane still receives pointer events.
	 * - BUILDING_MODE: pick building objects only.
	 * - SCAFFOLD_MODE: pick scaffold objects.
	 * - In Block assemble/edit interactions, building geometry is visual reference only and
	 *   should not compete with block handles for pointer hits.
   */
  useEffect(() => {
    raycaster.layers.set(WORKSPACE_LAYERS.INTERACTION)
		const isBlockAssembleInteraction =
			workspaceMode === 'SCAFFOLD_MODE' && activeTool === 'block' && blockToolSettings?.mode === 'assemble'
		if (workspaceMode === 'BUILDING_MODE') {
			raycaster.layers.enable(WORKSPACE_LAYERS.BUILDING)
		}
		if (workspaceMode === 'SCAFFOLD_MODE') {
			raycaster.layers.enable(WORKSPACE_LAYERS.SCAFFOLD)
			if (!isBlockAssembleInteraction) {
				raycaster.layers.enable(WORKSPACE_LAYERS.BUILDING)
			}
		}
  }, [activeTool, blockToolSettings?.mode, raycaster, workspaceMode])

  /**
   * COORDINATE SYSTEM: Z-UP (CAD Standard)
   * - X = Right
   * - Y = Back/Front (depth)
   * - Z = Vertical Height (UP)
   *
   * Camera looks from upper-front-right toward origin
   */
  const HOME_DIR = useMemo(() => new THREE.Vector3(1, -1, 0.75).normalize(), [])
  // Derive projection from viewMode
  const isOrtho = viewMode !== 'perspective'

	/**
	 * Compute the camera up vector for the CURRENT view mode.
	 *
	 * IMPORTANT: This is intentionally derived WITHOUT calling getDirectionForViewMode(),
	 * because getDirectionForViewMode is declared later in this component (useCallback)
	 * and using it here would hit the Temporal Dead Zone (TDZ) at runtime.
	 *
	 * Z-UP convention:
	 * - Default up is +Z.
	 * - When looking along +/-Z (Top/Bottom views), we must NOT keep up as +Z
	 *   (it becomes parallel to the view direction, causing undefined roll).
	 *   Use +/-Y as the screen-up axis for a stable CAD-like Top/Bottom view.
	 */
	const viewUp: [number, number, number] = useMemo(() => {
		return getUpVectorForViewMode(viewMode, orthoDirection)
	}, [viewMode, orthoDirection])

  // Disable orbit controls while actively drawing any building shape.
  const enableControls = !(
    drawingState.isDrawing &&
    (activeTool === 'rectangle' || activeTool === 'circle' || activeTool === 'ring' || activeTool === 'polygon')
  )

  // Store the previous camera position/target so we can start the new camera from there
  // This prevents the "jump" when switching between ortho and perspective cameras
  const savedCameraState = useRef<{
    position: THREE.Vector3
    target: THREE.Vector3
    zoom: number
  } | null>(null)

  // Compute bounding box that encompasses ALL scene objects for "fit all" framing
  // Z-UP: Objects sit on XY plane at Z=0, extend upward in +Z
  const sceneBoundingBox = useMemo(() => {
    if (objects.length === 0) {
			// No objects yet (new project) — frame a typical building footprint.
			// User expectation: ~30x30x30ft should be comfortably visible in the initial iso/ortho view.
			return new THREE.Box3(new THREE.Vector3(-15, -15, 0), new THREE.Vector3(15, 15, 30))
    }

    // Start with an empty box and expand to include all objects
    const box = new THREE.Box3()
    for (const obj of objects) {
      const half = obj.dimensions.clone().multiplyScalar(0.5)
      const objMin = obj.position.clone().sub(half)
      const objMax = obj.position.clone().add(half)
      box.expandByPoint(objMin)
      box.expandByPoint(objMax)
    }
    return box
  }, [objects])

  // For ViewCube/Home, we want to frame all objects
  const focusBox = sceneBoundingBox

  // Keep a ref so camera framing only happens on explicit requests (viewcube/home),
  // not on dimension edits.
  const focusBoxRef = useRef<THREE.Box3>(new THREE.Box3())
  useEffect(() => {
    focusBoxRef.current = focusBox
  }, [focusBox])
	const savedViewMap = useMemo(() => new Map(drawingPackage.savedViews.map(view => [view.id, view])), [drawingPackage.savedViews])
	const activeSection = useMemo(
		() => drawingPackage.sections.find(section => section.id === activeDrawingSectionId) ?? null,
		[drawingPackage.sections, activeDrawingSectionId],
	)
	const activeClippingPlanes = useMemo(
		() => (activeSection ? buildSectionClippingPlanes(activeSection) : undefined),
		[activeSection],
	)
	const activeSectionMarkerSize = useMemo(() => {
		const size = sceneBoundingBox.getSize(new THREE.Vector3())
		return Math.max(12, Math.max(size.x, size.y, size.z) * 0.85)
	}, [sceneBoundingBox])

  // Update controls each frame (camera-controls requires per-frame update)
  useFrame((_, delta) => {
    if (controlsRef.current) controlsRef.current.update(delta)
  })

	const resolveLeftMouseAction = useCallback(() => {
		if (navigationModifierRef.current.shiftKey) return CameraControlsImpl.ACTION.TRUCK
		return CameraControlsImpl.ACTION.NONE
	}, [])

	const applyNavigationBindings = useCallback((controls: CameraControlsImpl | null) => {
		if (!controls) return

		controls.mouseButtons.left = resolveLeftMouseAction()
		controls.mouseButtons.middle = CameraControlsImpl.ACTION.NONE
		controls.mouseButtons.right = CameraControlsImpl.ACTION.NONE
		controls.mouseButtons.wheel = isOrtho
			? CameraControlsImpl.ACTION.ZOOM
			: CameraControlsImpl.ACTION.DOLLY
		controls.touches.one = isOrtho
			? CameraControlsImpl.ACTION.TOUCH_TRUCK
			: CameraControlsImpl.ACTION.TOUCH_ROTATE
		controls.touches.two = isOrtho
			? CameraControlsImpl.ACTION.TOUCH_ZOOM_TRUCK
			: CameraControlsImpl.ACTION.TOUCH_DOLLY_TRUCK
		controls.touches.three = controls.touches.two
		controls.azimuthRotateSpeed = isOrtho ? 0 : settings.orbitSensitivity * 1.15
		controls.polarRotateSpeed = isOrtho
			? 0
			: settings.orbitSensitivity * 1.15 * (settings.invertOrbitVertical ? -1 : 1)
		controls.dollySpeed = settings.zoomSensitivity
		controls.smoothTime = 0.055
		controls.draggingSmoothTime = 0.002
		controls.restThreshold = 0.0006
		controls.truckSpeed = isOrtho ? 3.2 : 2.7
	}, [isOrtho, resolveLeftMouseAction, settings.invertOrbitVertical, settings.orbitSensitivity, settings.zoomSensitivity])

	const bindControlsNavigationState = useCallback((controls: CameraControlsImpl | null) => {
		controlsListenersCleanupRef.current?.()
		controlsListenersCleanupRef.current = null

		if (!controls) {
			setCameraNavigationActive(false)
			return
		}

		const handleControlStart = () => {
			setCameraNavigationActive(true)
		}
		const handleControlEnd = () => {
			setCameraNavigationActive(false)
		}

		controls.addEventListener('controlstart', handleControlStart)
		controls.addEventListener('controlend', handleControlEnd)
		controls.addEventListener('rest', handleControlEnd)
		controls.addEventListener('sleep', handleControlEnd)

		controlsListenersCleanupRef.current = () => {
			controls.removeEventListener('controlstart', handleControlStart)
			controls.removeEventListener('controlend', handleControlEnd)
			controls.removeEventListener('rest', handleControlEnd)
			controls.removeEventListener('sleep', handleControlEnd)
		}
	}, [setCameraNavigationActive])

	const handleControlsRef = useCallback((controls: CameraControlsImpl | null) => {
		controlsRef.current = controls
		applyNavigationBindings(controls)
		bindControlsNavigationState(controls)
	}, [applyNavigationBindings, bindControlsNavigationState])

	useEffect(() => {
		return () => {
			controlsListenersCleanupRef.current?.()
			controlsListenersCleanupRef.current = null
			setCameraNavigationActive(false)
		}
	}, [setCameraNavigationActive])

	useEffect(() => {
		const canvas = gl.domElement
		if (!canvas) return
		const eventSurface = canvas.parentElement ?? canvas

		const preventAuxDefaults = (event: MouseEvent | PointerEvent) => {
			if (event.button === 1 || event.button === 2) {
				event.preventDefault()
			}
		}

		const preventContextMenu = (event: MouseEvent) => {
			event.preventDefault()
		}

		const isWithinSceneViewport = (clientX: number, clientY: number) => {
			const rect = eventSurface.getBoundingClientRect()
			return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
		}

		const syncLeftDragModifiers = (event: KeyboardEvent | PointerEvent | MouseEvent) => {
			navigationModifierRef.current = {
				shiftKey: !!event.shiftKey,
				spaceKey: event instanceof KeyboardEvent ? event.code === 'Space' || event.key === ' ' || navigationModifierRef.current.spaceKey : navigationModifierRef.current.spaceKey,
			}
			applyNavigationBindings(controlsRef.current)
		}

		const clearLeftDragModifiers = () => {
			navigationModifierRef.current = { shiftKey: false, spaceKey: false }
			middleMousePanRef.current = null
			rightMouseOrbitRef.current = null
			orbitDragRef.current = null
			applyNavigationBindings(controlsRef.current)
			setCameraNavigationActive(false)
		}

		const applyPanDrag = (controls: CameraControlsImpl, deltaX: number, deltaY: number) => {
			const rect = canvas.getBoundingClientRect()
			const width = Math.max(rect.width, 1)
			const height = Math.max(rect.height, 1)
			const camera = controls.camera
			const position = new THREE.Vector3()
			const target = new THREE.Vector3()
			controls.getPosition(position)
			controls.getTarget(target)
			const forward = target.clone().sub(position).normalize()
			const upAxis = camera.up.clone().normalize()
			const rightAxis = new THREE.Vector3().crossVectors(forward, upAxis).normalize()
			const screenUpAxis = new THREE.Vector3().crossVectors(rightAxis, forward).normalize()

			if (camera instanceof THREE.PerspectiveCamera) {
				const offset = position.clone().sub(target)
				const fov = camera.getEffectiveFOV() * THREE.MathUtils.DEG2RAD
				const distanceToTarget = Math.max(offset.length(), 0.001)
				const verticalSpan = 2 * distanceToTarget * Math.tan(fov * 0.5)
				const horizontalSpan = verticalSpan * camera.aspect
				const translation = rightAxis.multiplyScalar(-controls.truckSpeed * deltaX * horizontalSpan / width)
					.add(screenUpAxis.multiplyScalar(controls.truckSpeed * deltaY * verticalSpan / height))
				const nextPosition = position.add(translation)
				const nextTarget = target.add(translation)
				void controls.setLookAt(
					nextPosition.x,
					nextPosition.y,
					nextPosition.z,
					nextTarget.x,
					nextTarget.y,
					nextTarget.z,
					false,
				)
				return
			}
			if (camera instanceof THREE.OrthographicCamera) {
				const horizontalSpan = (camera.right - camera.left) / camera.zoom
				const verticalSpan = (camera.top - camera.bottom) / camera.zoom
				const translation = rightAxis.multiplyScalar(-controls.truckSpeed * deltaX * horizontalSpan / width)
					.add(screenUpAxis.multiplyScalar(controls.truckSpeed * deltaY * verticalSpan / height))
				const nextPosition = position.add(translation)
				const nextTarget = target.add(translation)
				void controls.setLookAt(
					nextPosition.x,
					nextPosition.y,
					nextPosition.z,
					nextTarget.x,
					nextTarget.y,
					nextTarget.z,
					false,
				)
			}
		}

		const applyOrbitDrag = (controls: CameraControlsImpl, deltaX: number, deltaY: number) => {
			const rect = canvas.getBoundingClientRect()
			const width = Math.max(rect.width, 1)
			const height = Math.max(rect.height, 1)
			const rotateSpeed = Math.max(1.25, settings.orbitSensitivity * 1.45)
			const theta = -Math.PI * 2 * rotateSpeed * deltaX / width
			const phi = Math.PI * 2 * rotateSpeed * deltaY / height * (settings.invertOrbitVertical ? -1 : 1)
			void controls.rotate(theta, phi, false)
		}

		const onMouseDownCapture = (event: MouseEvent) => {
			if (!isWithinSceneViewport(event.clientX, event.clientY)) return
			if (event.button === 1) {
				const activeOrbitDrag = orbitDragRef.current
				if (activeOrbitDrag?.mode === 'pan') {
					eventSurface.releasePointerCapture?.(activeOrbitDrag.pointerId)
					orbitDragRef.current = null
				}
				middleMousePanRef.current = {
					lastX: event.clientX,
					lastY: event.clientY,
				}
				setCameraNavigationActive(true)
				event.preventDefault()
				event.stopPropagation()
				event.stopImmediatePropagation?.()
				return
			}
			if (event.button === 2 && !isOrtho) {
				const activeOrbitDrag = orbitDragRef.current
				if (activeOrbitDrag?.mode === 'orbit') {
					eventSurface.releasePointerCapture?.(activeOrbitDrag.pointerId)
					orbitDragRef.current = null
				}
				rightMouseOrbitRef.current = {
					lastX: event.clientX,
					lastY: event.clientY,
				}
				setCameraNavigationActive(true)
				event.preventDefault()
				event.stopPropagation()
				event.stopImmediatePropagation?.()
			}
		}

		const onPointerDownCapture = (event: PointerEvent) => {
			if (!isWithinSceneViewport(event.clientX, event.clientY)) return
			if (event.button === 1) {
				if (middleMousePanRef.current === null) {
					setCameraNavigationActive(true)
					orbitDragRef.current = {
						pointerId: event.pointerId,
						mode: 'pan',
						lastX: event.clientX,
						lastY: event.clientY,
					}
					eventSurface.setPointerCapture?.(event.pointerId)
				}
				event.preventDefault()
				event.stopPropagation()
				event.stopImmediatePropagation?.()
				return
			}
			if (event.button === 2) {
				if (!isOrtho && rightMouseOrbitRef.current === null) {
					setCameraNavigationActive(true)
					orbitDragRef.current = {
						pointerId: event.pointerId,
						mode: 'orbit',
						lastX: event.clientX,
						lastY: event.clientY,
					}
					eventSurface.setPointerCapture?.(event.pointerId)
				} else {
					setCameraNavigationActive(true)
				}
				event.preventDefault()
				event.stopPropagation()
				event.stopImmediatePropagation?.()
				return
			}
			if (event.button !== 0) return
			const wantsBlockPanDrag = activeTool === 'block' && event.shiftKey
			const wantsOrbitDrag =
				!isOrtho &&
				(
					event.altKey ||
					navigationModifierRef.current.spaceKey
				)
			if (wantsBlockPanDrag || wantsOrbitDrag) {
				setCameraNavigationActive(true)
				orbitDragRef.current = {
					pointerId: event.pointerId,
					mode: wantsBlockPanDrag ? 'pan' : 'orbit',
					lastX: event.clientX,
					lastY: event.clientY,
				}
				canvas.setPointerCapture?.(event.pointerId)
				event.preventDefault()
				event.stopPropagation()
				event.stopImmediatePropagation?.()
				return
			}
			syncLeftDragModifiers(event)
		}

		const onMouseMove = (event: MouseEvent) => {
			const controls = controlsRef.current
			if (!controls) return
			const withinViewport = isWithinSceneViewport(event.clientX, event.clientY)
			if (middleMousePanRef.current === null && withinViewport && (event.buttons & 4) === 4) {
				middleMousePanRef.current = {
					lastX: event.clientX - event.movementX,
					lastY: event.clientY - event.movementY,
				}
				rightMouseOrbitRef.current = null
				setCameraNavigationActive(true)
			}
			if (rightMouseOrbitRef.current === null && !isOrtho && withinViewport && (event.buttons & 2) === 2) {
				rightMouseOrbitRef.current = {
					lastX: event.clientX - event.movementX,
					lastY: event.clientY - event.movementY,
				}
				setCameraNavigationActive(true)
			}
			const activeMiddlePan = middleMousePanRef.current
			if (activeMiddlePan) {
				const deltaX = event.clientX - activeMiddlePan.lastX
				const deltaY = event.clientY - activeMiddlePan.lastY
				activeMiddlePan.lastX = event.clientX
				activeMiddlePan.lastY = event.clientY
				applyPanDrag(controls, deltaX, deltaY)
				event.preventDefault()
				event.stopPropagation()
				event.stopImmediatePropagation?.()
				return
			}
			const activeRightOrbit = rightMouseOrbitRef.current
			if (!activeRightOrbit) return
			const deltaX = event.clientX - activeRightOrbit.lastX
			const deltaY = event.clientY - activeRightOrbit.lastY
			activeRightOrbit.lastX = event.clientX
			activeRightOrbit.lastY = event.clientY
			applyOrbitDrag(controls, deltaX, deltaY)
			event.preventDefault()
			event.stopPropagation()
			event.stopImmediatePropagation?.()
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.code === 'Space' || event.key === ' ') {
				navigationModifierRef.current = {
					...navigationModifierRef.current,
					spaceKey: true,
				}
				applyNavigationBindings(controlsRef.current)
				return
			}
			if (!event.shiftKey) return
			syncLeftDragModifiers(event)
		}

		const onKeyUp = (event: KeyboardEvent) => {
			if (event.code === 'Space' || event.key === ' ') {
				navigationModifierRef.current = {
					...navigationModifierRef.current,
					spaceKey: false,
				}
				applyNavigationBindings(controlsRef.current)
				return
			}
			syncLeftDragModifiers(event)
		}

		const onPointerMove = (event: PointerEvent) => {
			if (middleMousePanRef.current !== null || rightMouseOrbitRef.current !== null) return
			const activeOrbitDrag = orbitDragRef.current
			if (!activeOrbitDrag || activeOrbitDrag.pointerId !== event.pointerId) return
			const controls = controlsRef.current
			if (!controls) return
			const deltaX = event.clientX - activeOrbitDrag.lastX
			const deltaY = event.clientY - activeOrbitDrag.lastY
			activeOrbitDrag.lastX = event.clientX
			activeOrbitDrag.lastY = event.clientY
			if (activeOrbitDrag.mode === 'pan') {
				applyPanDrag(controls, deltaX, deltaY)
			} else {
				applyOrbitDrag(controls, deltaX, deltaY)
			}
			event.preventDefault()
			event.stopPropagation()
			event.stopImmediatePropagation?.()
		}

		const endOrbitDrag = (event: PointerEvent) => {
			const activeOrbitDrag = orbitDragRef.current
			if (!activeOrbitDrag || activeOrbitDrag.pointerId !== event.pointerId) return
			eventSurface.releasePointerCapture?.(event.pointerId)
			orbitDragRef.current = null
			setCameraNavigationActive(false)
		}

		const endMiddleMousePan = (event: MouseEvent) => {
			if (event.button === 1 && middleMousePanRef.current !== null) {
				middleMousePanRef.current = null
				setCameraNavigationActive(false)
				return
			}
			if (event.button === 2 && rightMouseOrbitRef.current !== null) {
				rightMouseOrbitRef.current = null
			}
			setCameraNavigationActive(false)
		}

		const onPointerEnd = (event: PointerEvent) => {
			if ((event.button === 1 || event.button === 2) && orbitDragRef.current === null && middleMousePanRef.current === null && rightMouseOrbitRef.current === null) {
				setCameraNavigationActive(false)
			}
		}

		eventSurface.addEventListener('mousedown', preventAuxDefaults)
		eventSurface.addEventListener('pointerdown', preventAuxDefaults)
		eventSurface.addEventListener('auxclick', preventAuxDefaults)
		eventSurface.addEventListener('contextmenu', preventContextMenu)
		window.addEventListener('mousedown', onMouseDownCapture, true)
		window.addEventListener('pointerdown', onPointerDownCapture, true)
		window.addEventListener('mousemove', onMouseMove, true)
		window.addEventListener('pointermove', onPointerMove, true)
		window.addEventListener('mouseup', endMiddleMousePan, true)
		window.addEventListener('pointerup', endOrbitDrag, true)
		window.addEventListener('pointercancel', endOrbitDrag, true)
		window.addEventListener('pointerup', onPointerEnd, true)
		window.addEventListener('pointercancel', onPointerEnd, true)
		window.addEventListener('keydown', onKeyDown, true)
		window.addEventListener('keyup', onKeyUp, true)
		window.addEventListener('blur', clearLeftDragModifiers)

		return () => {
			eventSurface.removeEventListener('mousedown', preventAuxDefaults)
			eventSurface.removeEventListener('pointerdown', preventAuxDefaults)
			eventSurface.removeEventListener('auxclick', preventAuxDefaults)
			eventSurface.removeEventListener('contextmenu', preventContextMenu)
			window.removeEventListener('mousedown', onMouseDownCapture, true)
			window.removeEventListener('pointerdown', onPointerDownCapture, true)
			window.removeEventListener('mousemove', onMouseMove, true)
			window.removeEventListener('pointermove', onPointerMove, true)
			window.removeEventListener('mouseup', endMiddleMousePan, true)
			window.removeEventListener('pointerup', endOrbitDrag, true)
			window.removeEventListener('pointercancel', endOrbitDrag, true)
			window.removeEventListener('pointerup', onPointerEnd, true)
			window.removeEventListener('pointercancel', onPointerEnd, true)
			window.removeEventListener('keydown', onKeyDown, true)
			window.removeEventListener('keyup', onKeyUp, true)
			window.removeEventListener('blur', clearLeftDragModifiers)
			setCameraNavigationActive(false)
		}
	}, [activeTool, applyNavigationBindings, gl, isOrtho, setCameraNavigationActive, settings.invertOrbitVertical, settings.orbitSensitivity])

	// Keep camera navigation mode-independent:
	// - left drag is reserved for tools and selection
	// - middle drag pans
	// - right drag rotates in perspective views
	// - wheel zooms
	useEffect(() => {
		applyNavigationBindings(controlsRef.current)
	}, [applyNavigationBindings])

  // Track the framing request counter as STATE (not ref) so it triggers the effect
  const [frameRequest, setFrameRequest] = useState(0)

  // Helper to save current camera position/target before switching camera types
  const saveCameraState = useCallback(() => {
    const controls = controlsRef.current
    if (!controls) return

    const pos = new THREE.Vector3()
    const target = new THREE.Vector3()
    controls.getPosition(pos)
    controls.getTarget(target)

    savedCameraState.current = {
      position: pos,
      target: target,
      zoom: controls.camera instanceof THREE.OrthographicCamera ? controls.camera.zoom : 40,
    }
  }, [])

	const publishControlsCameraState = useCallback(() => {
		const controls = controlsRef.current
		if (!controls || pendingDrawingViewRequestRef.current || isApplyingDrawingViewRef.current) return

		const position = new THREE.Vector3()
		const target = new THREE.Vector3()
		controls.getPosition(position)
		controls.getTarget(target)

		const nextState: LiveCameraState = {
			position: toSerializedVector3(position),
			target: toSerializedVector3(target),
			zoom: controls.camera instanceof THREE.OrthographicCamera ? controls.camera.zoom : 40,
			projection: controls.camera instanceof THREE.OrthographicCamera ? 'orthographic' : 'perspective',
			viewMode,
			orthoDirection: isOrtho && orthoDirection ? toSerializedVector3(orthoDirection) : null,
		}

		if (!liveCameraStatesEqual(lastPublishedCameraStateRef.current, nextState)) {
			lastPublishedCameraStateRef.current = nextState
			publishLiveCameraState(nextState)
		}
	}, [isOrtho, orthoDirection, publishLiveCameraState, viewMode])

	const applyDrawingViewWithControls = useCallback((request: DrawingViewApplyRequest): boolean => {
		const controls = controlsRef.current
		const view = savedViewMap.get(request.viewId)
		if (!controls || !view) return false

		const position = new THREE.Vector3(view.camera.position.x, view.camera.position.y, view.camera.position.z)
		const target = new THREE.Vector3(view.camera.target.x, view.camera.target.y, view.camera.target.z)
		const resolvedOrtho = view.projection === 'orthographic' ? resolveOrthoViewFromCamera(position, target) : null
		const resolvedViewMode = resolvedOrtho?.mode ?? 'perspective'
		const resolvedDirection = resolvedOrtho?.direction ?? null
		const up = getUpVectorForViewMode(resolvedViewMode, resolvedDirection)

		controls.camera.up.set(up[0], up[1], up[2])
		controls.updateCameraUp()
		controls.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, false)

		if (controls.camera instanceof THREE.OrthographicCamera) {
			controls.zoomTo(Math.max(0.1, view.camera.zoom), false)
			controls.camera.updateProjectionMatrix()
		}

		if (request.activateSection) {
			setActiveDrawingSectionId(view.sectionId ?? null)
		}

		const nextState: LiveCameraState = {
			position: { ...view.camera.position },
			target: { ...view.camera.target },
			zoom: view.camera.zoom,
			projection: view.projection,
			viewMode: resolvedViewMode,
			orthoDirection: resolvedDirection ? toSerializedVector3(resolvedDirection) : null,
		}

		lastPublishedCameraStateRef.current = nextState
		publishLiveCameraState(nextState)
		pendingDrawingViewRequestRef.current = null
		isApplyingDrawingViewRef.current = false
		clearDrawingViewApplyRequest()
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				setCameraTransitioning(false)
			})
		})

		return true
	}, [clearDrawingViewApplyRequest, publishLiveCameraState, savedViewMap, setActiveDrawingSectionId, setCameraTransitioning])

  // Expose saveCameraState to App.tsx via the context ref
  // This allows the Home button to save camera state before switching views
  useEffect(() => {
    saveCameraStateRef.current = saveCameraState
    return () => {
      saveCameraStateRef.current = null
    }
  }, [saveCameraState, saveCameraStateRef])

	useEffect(() => {
		if (!drawingViewApplyRequest) return

		const view = savedViewMap.get(drawingViewApplyRequest.viewId)
		if (!view) {
			clearDrawingViewApplyRequest()
			return
		}

		pendingDrawingViewRequestRef.current = drawingViewApplyRequest
		isApplyingDrawingViewRef.current = true
		setCameraTransitioning(true)

		if (view.projection === 'perspective') {
			setOrthoDirection(null)
			if (viewMode !== 'perspective') {
				setViewMode('perspective')
			} else {
				requestAnimationFrame(() => {
					const pending = pendingDrawingViewRequestRef.current
					if (pending) applyDrawingViewWithControls(pending)
				})
			}
			return
		}

		const position = new THREE.Vector3(view.camera.position.x, view.camera.position.y, view.camera.position.z)
		const target = new THREE.Vector3(view.camera.target.x, view.camera.target.y, view.camera.target.z)
		const resolved = resolveOrthoViewFromCamera(position, target)
		setOrthoDirection(resolved.direction)
		if (viewMode !== resolved.mode) {
			setViewMode(resolved.mode)
		} else {
			requestAnimationFrame(() => {
				const pending = pendingDrawingViewRequestRef.current
				if (pending) applyDrawingViewWithControls(pending)
			})
		}
	}, [applyDrawingViewWithControls, clearDrawingViewApplyRequest, drawingViewApplyRequest, savedViewMap, setCameraTransitioning, setOrthoDirection, setViewMode, viewMode])

	useFrame(() => {
		publishControlsCameraState()
	})

  // Custom (edge/corner) orthographic view using an arbitrary direction vector
  const requestCustomOrtho = useCallback((dir: THREE.Vector3) => {
    // Save current camera state before switching (prevents jump)
    saveCameraState()
    // Hide canvas during transition to mask "bad frames"
    setCameraTransitioning(true)

    const normalizedDir = dir.clone().normalize()
    setOrthoDirection(normalizedDir)
    setViewMode('ortho-custom')
    // Bump frame request to trigger the camera animation effect
    setFrameRequest(prev => prev + 1)
  }, [setOrthoDirection, setViewMode, saveCameraState, setCameraTransitioning])

  // Named orthographic views for the 6 principal faces
  const requestNamedOrtho = useCallback((mode: ViewMode) => {
    // We only expect ortho-* modes here
    if (!mode.startsWith('ortho-')) return

    // Save current camera state before switching (prevents jump)
    saveCameraState()
    // Hide canvas during transition to mask "bad frames"
    setCameraTransitioning(true)

    setOrthoDirection(null)
    setViewMode(mode)
    setFrameRequest(prev => prev + 1)
  }, [setOrthoDirection, setViewMode, saveCameraState, setCameraTransitioning])

  const requestHomeView = useCallback(() => {
    const controls = controlsRef.current
    if (!controls) return

    const isAlreadyPerspective = viewMode === 'perspective'
    if (!isAlreadyPerspective) {
      saveCameraState()
    }

    setCameraTransitioning(true)
    setOrthoDirection(null)
    if (!isAlreadyPerspective) {
      setViewMode('perspective')
    }
    setFrameRequest(prev => prev + 1)
  }, [saveCameraState, setCameraTransitioning, setOrthoDirection, setViewMode, viewMode])

  useEffect(() => {
    requestHomeViewRef.current = requestHomeView
    return () => {
      requestHomeViewRef.current = null
    }
  }, [requestHomeView, requestHomeViewRef])

	useEffect(() => {
		if (!(import.meta.env.DEV || navigator.webdriver)) return
		type SceneDebugWindow = Window & {
			__scaffoldproSceneDebug?: {
				setNamedView: (mode: ViewMode) => void
				getViewMode: () => ViewMode
				getCameraState: () => {
					position: LiveCameraState['position']
					target: LiveCameraState['target']
					isOrtho: boolean
					mouseButtons: {
						left: number
						middle: number
						right: number
						wheel: number
					}
				} | null
				projectWorldToClient: (point: { x: number; y: number; z?: number }) => { x: number; y: number } | null
			}
		}
		const debugWindow = window as SceneDebugWindow
		debugWindow.__scaffoldproSceneDebug = {
			setNamedView: requestNamedOrtho,
			getViewMode: () => viewMode,
			getCameraState: () => {
				const controls = controlsRef.current
				if (!controls) return null
				const position = new THREE.Vector3()
				const target = new THREE.Vector3()
				controls.getPosition(position)
				controls.getTarget(target)
				return {
					position: toSerializedVector3(position),
					target: toSerializedVector3(target),
					isOrtho,
					mouseButtons: {
						left: controls.mouseButtons.left,
						middle: controls.mouseButtons.middle,
						right: controls.mouseButtons.right,
						wheel: controls.mouseButtons.wheel,
					},
				}
			},
			projectWorldToClient: (point) => {
				const camera = controlsRef.current?.camera
				const canvas = gl.domElement
				if (!camera || !canvas) return null
				const projected = new THREE.Vector3(point.x, point.y, point.z ?? 0).project(camera)
				if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z)) return null
				const rect = canvas.getBoundingClientRect()
				return {
					x: rect.left + ((projected.x + 1) * 0.5) * rect.width,
					y: rect.top + ((1 - projected.y) * 0.5) * rect.height,
				}
			},
		}
		return () => {
			if (debugWindow.__scaffoldproSceneDebug?.setNamedView === requestNamedOrtho) {
				delete debugWindow.__scaffoldproSceneDebug
			}
		}
	}, [gl, isOrtho, requestNamedOrtho, viewMode])

  // Request home (perspective) view - called from goHome in App.tsx via context
  // The effect below will run when viewMode changes to 'perspective'

  /**
   * Helper function to compute camera direction from view mode
   *
   * COORDINATE SYSTEM: Z-UP (CAD Standard)
   * - Right view: Camera at +X, looking toward -X
   * - Left view: Camera at -X, looking toward +X
   * - Top view: Camera at +Z, looking toward -Z (down at XY plane)
   * - Bottom view: Camera at -Z, looking toward +Z (up from below XY plane)
   * - Front view: Camera at -Y, looking toward +Y (toward back)
   * - Back view: Camera at +Y, looking toward -Y (toward front)
   */
  const getDirectionForViewMode = useCallback((mode: ViewMode, customDir: THREE.Vector3 | null): THREE.Vector3 => {
    switch (mode) {
      case 'ortho-right':
        return new THREE.Vector3(1, 0, 0)   // Camera at +X
      case 'ortho-left':
        return new THREE.Vector3(-1, 0, 0)  // Camera at -X
      case 'ortho-top':
        return new THREE.Vector3(0, 0, 1)   // Camera at +Z (Z-UP: looking down)
      case 'ortho-bottom':
        return new THREE.Vector3(0, 0, -1)  // Camera at -Z (Z-UP: looking up)
      case 'ortho-front':
        return new THREE.Vector3(0, -1, 0)  // Camera at -Y (Z-UP: front is -Y)
      case 'ortho-back':
        return new THREE.Vector3(0, 1, 0)   // Camera at +Y (Z-UP: back is +Y)
      case 'ortho-custom':
        if (customDir) {
          return customDir.clone().normalize()
        }
        return HOME_DIR.clone()
      case 'perspective':
      default:
        return HOME_DIR.clone()
    }
  }, [HOME_DIR])

  // Helper to position camera based on view mode
	const positionCameraForViewMode = useCallback((enableTransition = true) => {
    const controls = controlsRef.current
    if (!controls) return

    // Get direction for current view mode
    const dir = getDirectionForViewMode(viewMode, orthoDirection)

    // Get the scene bounding box for consistent framing
    const box = focusBoxRef.current
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())

    // Calculate a consistent distance - closer for perspective, appropriate for ortho
    const maxDim = Math.max(1, size.x, size.y, size.z)
    // For perspective (home) view, use a closer distance; for ortho, distance matters less
    const dist = isOrtho ? maxDim * 3 + 10 : maxDim * 2 + 5

    /**
     * Set camera up vector for Z-UP coordinate system
     *
     * For Z-UP, the default "up" direction is +Z (0, 0, 1)
     * When looking straight down (+Z direction) or straight up (-Z direction),
     * we need a different up vector to avoid gimbal lock - use +Y as up in those cases
     */
		const isTopOrBottom = Math.abs(dir.z) > 0.999
		// Keep the camera's up vector consistent with the view mode.
		// IMPORTANT: This must be set BEFORE setLookAt() to avoid a visible roll/"sideways" flash.
		if (isTopOrBottom) {
			controls.camera.up.set(0, dir.z > 0 ? 1 : -1, 0)
		} else {
			controls.camera.up.set(0, 0, 1)
		}
    controls.updateCameraUp()

    // Configure smooth transition timing (in seconds)
    controls.smoothTime = 0.35

    // Calculate camera position
    const pos = center.clone().add(dir.clone().multiplyScalar(dist))

		// Top/Bottom are special: interpolating while changing up-vector tends to produce
		// a brief sideways/rolled frame. Snapping is more CAD-like and avoids that artifact.
		const allowTransition = enableTransition && !isTopOrBottom
		controls.setLookAt(pos.x, pos.y, pos.z, center.x, center.y, center.z, allowTransition)

    // For orthographic camera, set zoom to fit the scene
    if (isOrtho && controls.camera instanceof THREE.OrthographicCamera) {
      const aspect = window.innerWidth / window.innerHeight
      const boxWidth = Math.max(size.x, size.z, 1)
      const boxHeight = Math.max(size.y, boxWidth / aspect, 1)
      const targetZoom = Math.min(
        window.innerHeight / (boxHeight * 2.5),
        window.innerWidth / (boxWidth * 2.5)
      )
			// IMPORTANT: allow zooming out enough to fit a 30ft building on smaller screens.
			// (Higher zoom = more zoomed-in for OrthographicCamera.)
			controls.zoomTo(Math.max(2, Math.min(targetZoom, 60)), allowTransition)
    }
  }, [viewMode, orthoDirection, isOrtho, getDirectionForViewMode])

  // Track if this is the initial mount (no transition) vs user-triggered change (smooth transition)
  const isInitialMount = useRef(true)

  // Use useLayoutEffect to set camera position BEFORE paint (avoids flash on initial render)
  // This runs synchronously after DOM mutations but before browser paint
	useLayoutEffect(() => {
		// If controls are not ready yet (e.g. camera type just switched), the
		// waitForControls effect below will handle the snap+animate sequence.
		if (!controlsRef.current) return
		if (pendingDrawingViewRequestRef.current || isApplyingDrawingViewRef.current) return

    // On initial mount, position immediately without transition
    // On subsequent changes (user clicked ViewCube), use smooth transition
    const shouldAnimate = !isInitialMount.current && frameRequest > 0
    positionCameraForViewMode(shouldAnimate)

		// For ViewCube-triggered changes, unhide the canvas after a couple frames.
		// (We hide to mask the “one bad frame” and any camera-up roll corrections.)
		if (frameRequest > 0) {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					setCameraTransitioning(false)
				})
			})
		}

    if (isInitialMount.current) {
      isInitialMount.current = false
    }
	}, [positionCameraForViewMode, frameRequest, setCameraTransitioning])

  // Also position camera after controls mount (when camera type switches)
  // The controls ref is assigned after render, so we need a useEffect that waits
  useEffect(() => {
    let cancelled = false
    let attempts = 0

    const waitForControls = () => {
      if (cancelled) return
      const controls = controlsRef.current
      if (controls) {
				const pendingRequest = pendingDrawingViewRequestRef.current
				if (pendingRequest) {
					applyDrawingViewWithControls(pendingRequest)
					return
				}
        // CRITICAL: First snap to the saved camera position (where the old camera was)
        // This prevents the "jump" - the new camera starts exactly where the old one was
        if (savedCameraState.current) {
          const { position, target, zoom } = savedCameraState.current

          // Immediately snap to the old camera position (no transition)
          controls.setLookAt(
            position.x, position.y, position.z,
            target.x, target.y, target.z,
            false // NO transition - snap immediately
          )

          // For orthographic camera, also set the zoom immediately
          if (controls.camera instanceof THREE.OrthographicCamera) {
            controls.zoomTo(zoom, false)
          }

          // Clear the saved state
          savedCameraState.current = null

          // Now animate smoothly to the target position
          // Use a small delay to ensure the snap is applied first
          requestAnimationFrame(() => {
            if (!cancelled && controlsRef.current) {
              positionCameraForViewMode(true)
              // Wait a couple more frames then show the canvas again
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  setCameraTransitioning(false)
                })
              })
            }
          })
        } else {
          // No saved state (initial mount or same camera type) - just position
          positionCameraForViewMode(true)
        }
      } else if (attempts < 10) {
        attempts++
        requestAnimationFrame(waitForControls)
      }
    }

    // Start checking for controls
    requestAnimationFrame(waitForControls)

    return () => {
      cancelled = true
    }
	  }, [applyDrawingViewWithControls, isOrtho, positionCameraForViewMode, setCameraTransitioning])

	  const onViewcubeClick = useCallback(
	    (e: ThreeEvent<MouseEvent>) => {
	      e.stopPropagation()

	      // Edges & corners: non-zero mesh positions give nice isometric views
	      const objPos = e.object?.position?.clone?.() as THREE.Vector3 | undefined
	      if (objPos && objPos.lengthSq() > 1e-8) {
	        requestCustomOrtho(objPos)
	        return null
	      }

		      // Faces: use BoxGeometry's material index order (stable) and map to Z-UP semantics.
		      // BoxGeometry groups are:
		      // 0:+X, 1:-X, 2:+Y, 3:-Y, 4:+Z, 5:-Z
		      // In our CAD Z-UP convention:
		      // +Z=Top, -Z=Bottom, -Y=Front, +Y=Back
		      if (typeof e.faceIndex === 'number' && e.faceIndex >= 0) {
		        const matIndex = Math.floor(e.faceIndex / 2)
		        switch (matIndex) {
		          case 0:
		            requestNamedOrtho('ortho-right')
		            return null
		          case 1:
		            requestNamedOrtho('ortho-left')
		            return null
		          case 2:
		            requestNamedOrtho('ortho-back')
		            return null
		          case 3:
		            requestNamedOrtho('ortho-front')
		            return null
		          case 4:
		            requestNamedOrtho('ortho-top')
		            return null
		          case 5:
		            requestNamedOrtho('ortho-bottom')
		            return null
		        }
		      }

		      // Final fallback: classify the clicked face normal into the nearest principal axis.
		      // NOTE: face.normal is in local space; transformDirection gives a world-space direction.
		      const n = e.face?.normal?.clone()
		      if (n && (e.object as any)?.matrixWorld) {
		        n.transformDirection((e.object as any).matrixWorld).normalize()
		        const ax = Math.abs(n.x)
		        const ay = Math.abs(n.y)
		        const az = Math.abs(n.z)
		
		        if (ax >= ay && ax >= az) {
		          requestNamedOrtho(n.x >= 0 ? 'ortho-right' : 'ortho-left')
		          return null
		        }
		        if (ay >= ax && ay >= az) {
		          requestNamedOrtho(n.y >= 0 ? 'ortho-back' : 'ortho-front')
		          return null
		        }
		        requestNamedOrtho(n.z >= 0 ? 'ortho-top' : 'ortho-bottom')
		        return null
		      }
	      return null
	    },
	    [requestCustomOrtho, requestNamedOrtho]
	  )

  return (
    <>
      {/* Set Three.js scene background color */}
      <SceneBackground />

      {/* Camera - use saved position to prevent "jump" when switching camera types */}
      {/* If we have a saved camera state, start the new camera there; otherwise use default */}
      {/* The ref callback immediately sets position and lookAt before first render */}
      {/* Z-UP: Default camera position at (15, -15, 12) - looking from front-right toward origin */}
		  {isOrtho ? (
        <OrthographicCamera
          makeDefault
          ref={(cam) => {
		        if (!cam) return
		        // Apply up FIRST (lookAt uses camera.up to compute rotation)
		        cam.up.set(viewUp[0], viewUp[1], viewUp[2])
			        // Render ALL workspace layers (geometry remains visible across modes)
			        cam.layers.enable(WORKSPACE_LAYERS.INTERACTION)
			        cam.layers.enable(WORKSPACE_LAYERS.BUILDING)
			        cam.layers.enable(WORKSPACE_LAYERS.SCAFFOLD)
		        if (savedCameraState.current) {
		          cam.position.copy(savedCameraState.current.position)
		          cam.lookAt(savedCameraState.current.target)
		          cam.zoom = savedCameraState.current.zoom
		          cam.updateProjectionMatrix()
		        }
          }}
          position={savedCameraState.current?.position?.toArray() ?? [15, -15, 12]}
				  // Keep a reasonable default so new projects don't start overly zoomed-in
				  // before controls finish their first framing pass.
				  zoom={savedCameraState.current?.zoom ?? 12}
          near={0.1}
          far={2000}
		      up={viewUp}
        />
      ) : (
        <PerspectiveCamera
          makeDefault
          ref={(cam) => {
		        if (!cam) return
		        // Perspective always uses Z-UP
		        cam.up.set(0, 0, 1)
			        // Render ALL workspace layers (geometry remains visible across modes)
			        cam.layers.enable(WORKSPACE_LAYERS.INTERACTION)
			        cam.layers.enable(WORKSPACE_LAYERS.BUILDING)
			        cam.layers.enable(WORKSPACE_LAYERS.SCAFFOLD)
		        if (savedCameraState.current) {
		          cam.position.copy(savedCameraState.current.position)
		          cam.lookAt(savedCameraState.current.target)
		          cam.updateProjectionMatrix()
		        }
          }}
          position={savedCameraState.current?.position?.toArray() ?? [15, -15, 12]}
          fov={50}
          near={0.1}
          far={2000}
		      up={[0, 0, 1]}
        />
      )}

      {/* Camera controls (Perspective: orbit, Ortho: pan+zoom) */}
      <CameraControls
        key={isOrtho ? 'ortho' : 'persp'}
        ref={handleControlsRef}
        makeDefault
        enabled={enableControls}
        minDistance={1}
        maxDistance={500}
      />

      {/* Ambient light for base illumination */}
      <ambientLight intensity={0.5} />

      {/* Directional "sun" light with shadows */}
      {/* Z-UP: Light comes from upper-right-front (high Z, positive X, negative Y) */}
      <directionalLight
        position={[30, -20, 40]}
        intensity={1.2}
        castShadow={settings.enableShadows}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={100}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
      />

      {/* Hemisphere light for better ambient */}
      <hemisphereLight args={['#87ceeb', '#362907', 0.3]} />

      {/* Grid plane (visibility controlled by settings) */}
      {/* Z-UP: Grid is on XY plane at Z=0.001 (slight offset to prevent z-fighting) */}
      {/* Light blue/purple graph paper style grid */}
      {settings.showGrid && (
        <Grid
          position={[0, 0, 0.001]}
          rotation={[Math.PI / 2, 0, 0]}  // Rotate to XY plane (Z-UP)
          args={[100, 100]}
          cellSize={settings.gridSize}
          cellThickness={0.5}
          cellColor="#d0d0e8"
          sectionSize={settings.gridSize * 10}
          sectionThickness={1}
          sectionColor="#b8b8d8"
          fadeDistance={150}
          fadeStrength={1}
          followCamera={false}
          infiniteGrid
        />
      )}

      {/* Axes helper (visibility controlled by settings) */}
      {settings.showAxes && <axesHelper args={[5]} />}

      {/* Ground plane for shadow receiving */}
      {/* Z-UP: Shadow plane on XY at Z=-0.05 (below grid) */}
      {settings.enableShadows && (
        <mesh position={[0, 0, -0.05]} receiveShadow>
          <planeGeometry args={[200, 200]} />
          <shadowMaterial opacity={0.15} />
        </mesh>
      )}

      {/* Drawing interaction plane */}
      <DrawingPlane />

      {/* Preview of shape being drawn */}
      <DrawingPreview />

      {/* All created objects */}
	      <SceneObjects clippingPlanes={activeClippingPlanes} />

			{activeSection ? <ActiveSectionMarker section={activeSection} size={activeSectionMarkerSize} /> : null}

	      {/* Scaffold workspace (scaffold mode only) */}
		      {workspaceMode === 'SCAFFOLD_MODE' && (
	        <>
		          <ScaffoldWorkspace clippingPlanes={activeClippingPlanes} />
						{!dxfPreviewEnabled && (
							<>
								{categoryKey === 'liveLoads' ? null : activeTool === 'block' ? (
									<PlaceBlockTool />
								) : (
									<>
										<PlaceStandardTool />
										<PlaceLedgerTool />
										<PlacePlankTool />
									</>
								)}
							</>
						)}
	        </>
		      )}

      {/* ViewCube (Home button is rendered in App.tsx as fixed HTML overlay) */}
      <GizmoHelper
        alignment="top-right"
        margin={[80, 80]}
        onTarget={() => focusBox.getCenter(new THREE.Vector3())}
      >
	        {/*
	          IMPORTANT (high-end UX): The ViewCube is an in-canvas UI control.
	          While placing catalog parts, we must prevent its pointer events from
	          bubbling to world interaction planes (e.g. PlaceStandardTool).
	
	          drei's GizmoViewcube stops propagation on onClick, but NOT onPointerDown.
	          Since placement uses onPointerDown, we stop propagation here at capture
	          time to prevent accidental placement.
	        */}
	        <group
	          onPointerDown={(e: ThreeEvent<PointerEvent>) => {
	            e.stopPropagation()
	            // Also prevent other native listeners on the canvas (e.g. controls) from starting.
	            e.nativeEvent.stopImmediatePropagation?.()
	          }}
	          onPointerUp={(e: ThreeEvent<PointerEvent>) => {
	            e.stopPropagation()
	            e.nativeEvent.stopImmediatePropagation?.()
	          }}
	        >
	          <GizmoViewcube
	            onClick={onViewcubeClick}
	            font="bold 18px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
		            // Z-UP relabeling (BoxGeometry face order: +X,-X,+Y,-Y,+Z,-Z)
		            // We want: +Z=Top, -Z=Bottom, -Y=Front, +Y=Back
		            faces={['Right', 'Left', 'Back', 'Front', 'Top', 'Bottom']}
	            color="#e8e8ec"
	            hoverColor="#4a9eff"
	            textColor="#505060"
	            strokeColor="#c0c0c8"
	            opacity={1}
	          />
	        </group>
      </GizmoHelper>
    </>
  )
}
