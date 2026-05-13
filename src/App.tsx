import { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Home } from 'lucide-react'
import { Scene } from './components/Scene'
import { DockedInspector } from './components/DockedInspector'
import { StackMoveHud } from './components/StackMoveHud'
import { SettingsPanel } from './components/SettingsPanel'
import { Toolbar } from './components/Toolbar'
import { ProjectPersistence } from './components/ProjectPersistence'
import { SettingsProvider, useSettings } from './contexts/SettingsContext'
import { CatalogProvider, useCatalogSelection } from './contexts/CatalogContext'
import { ToolProvider, useTool } from './contexts/ToolContext'
import { ScaffoldBaseSettingsProvider } from './contexts/ScaffoldBaseSettings'

/**
 * Categories that use auto-select mode (no specific part needed).
 * ESC should switch away from these categories to exit placement mode.
 */
const AUTO_SELECT_CATEGORIES = new Set(['ledgers', 'braces', 'trusses', 'sideBrackets'])

function isTextInputTarget(target: EventTarget | null): boolean {
	if (!target || !(target instanceof HTMLElement)) return false
	const tag = target.tagName
	return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

function hasBlockingModalOpen(): boolean {
	return !!document.querySelector('[data-scaffoldpro-modal]')
}

function parseDiagonalSelectionId(selectedObjectId: string | null): {
	diagonalId: string
	blockId: string
	braceGroup: 'frontBack' | 'leftRight'
} | null {
	if (!selectedObjectId?.startsWith('diagonal-')) return null
	const diagonalId = selectedObjectId.slice('diagonal-'.length)
	const markerIndex = diagonalId.indexOf('@brace-')
	if (markerIndex <= 0) return null
	const blockId = diagonalId.slice(0, markerIndex)
	const suffix = diagonalId.slice(markerIndex + '@brace-'.length)
	if (suffix.startsWith('fb:')) return { diagonalId, blockId, braceGroup: 'frontBack' }
	if (suffix.startsWith('lr:')) return { diagonalId, blockId, braceGroup: 'leftRight' }
	return null
}


/**
 * Inner app component that uses settings context
 * Separated to allow useSettings hook access
 */
export function AppContent() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { settings } = useSettings()
  const {
		activeTool,
		setSelectedObjectId,
		selectedObjectId,
		buildingHostedPatternPreview,
		setBuildingHostedPatternPreview,
		setSelectedHostedPatternInstance,
		selectedLiveLoadDeckTargets,
		selectedLiveLoadDeckTarget,
		setSelectedLiveLoadDeckTargets,
		setSelectedLiveLoadDeckTarget,
		setHoveredLiveLoadDeckTargets,
		buildingEntities,
		removeBuildingEntity,
		removeObject,
		removeScaffoldStack,
		selectedStackIds,
		setSelectedStackIds,
		removeLedgerConnection,
		removeManualLiveLoadPlacement,
		selectedBlockIds,
		removeScaffoldBlock,
		suppressDiagonalMemberInBlock,
		blockToolSettings,
		viewMode,
		setViewMode,
		setOrthoDirection,
		saveCameraStateRef,
		requestHomeViewRef,
		cameraTransitioning,
		undo,
		redo,
		canUndo,
		canRedo,
	} = useTool()
	const { categoryKey, partId, setPartId, setCategoryKey } = useCatalogSelection()
	const isOrtho = viewMode !== 'perspective'

	// 3D workspace (mobile): lock page scroll + enable safe touch interaction on the canvas.
	// This component only mounts on the /app/:projectId route, so it won't affect marketing/legal pages.
	useEffect(() => {
		document.body.classList.add('workspace-3d')
		return () => {
			document.body.classList.remove('workspace-3d')
		}
	}, [])

  const goHome = () => {
    if (requestHomeViewRef.current) {
      requestHomeViewRef.current()
      return
    }
    saveCameraStateRef.current?.()
    setViewMode('perspective')
    setOrthoDirection(null)
  }

	// Keyboard shortcuts: Delete/Backspace – delete selected component
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
				// Avoid accidental multi-delete from key auto-repeat when the user holds Delete.
				if (e.repeat) return
				if (e.defaultPrevented) return
			if (e.key !== 'Delete' && e.key !== 'Backspace') return
			if (isTextInputTarget(e.target)) return

			e.preventDefault()

			// Block deletion: if block(s) are selected in Blocks (assemble) mode, delete them
			if (selectedBlockIds.length > 0 && activeTool === 'block' && categoryKey !== 'liveLoads' && blockToolSettings.mode === 'assemble') {
				for (const blockId of [...selectedBlockIds]) {
					removeScaffoldBlock(blockId)
				}
				return
			}

			// Multi-stack deletion (marquee-selected standards)
			if (selectedStackIds.length > 1) {
				for (const id of [...selectedStackIds]) {
					removeScaffoldStack(id)
				}
				setSelectedStackIds([])
				return
			}

			if (!selectedObjectId) return // nothing selected

				// Parse the selection ID to determine what to delete.
				// NOTE: Standards are selectable per-*segment* (id like "<stackId>@<segmentIndex>")
				// but deletion is stack-level. So we normalize to stackId before deleting.
			let stackId: string | null = null
			if (selectedObjectId.startsWith('standard-')) {
					const payload = selectedObjectId.replace('standard-', '')
					const at = payload.indexOf('@')
					stackId = at >= 0 ? payload.slice(0, at) : payload
			} else if (selectedObjectId.startsWith('wood-sill-')) {
				stackId = selectedObjectId.replace('wood-sill-', '')
			} else if (selectedObjectId.startsWith('screw-jack-')) {
				stackId = selectedObjectId.replace('screw-jack-', '')
			} else if (selectedObjectId.startsWith('base-collar-')) {
				stackId = selectedObjectId.replace('base-collar-', '')
			}

			if (stackId) {
				removeScaffoldStack(stackId)
			} else if (selectedObjectId.startsWith('ledger-')) {
				const connectionId = selectedObjectId.replace('ledger-', '')
				removeLedgerConnection(connectionId)
			} else if (selectedObjectId.startsWith('live-load-')) {
				const placementId = selectedObjectId.replace('live-load-', '')
				removeManualLiveLoadPlacement(placementId)
				} else if (selectedObjectId.startsWith('diagonal-')) {
					const diagonal = parseDiagonalSelectionId(selectedObjectId)
					if (!diagonal) return
						suppressDiagonalMemberInBlock(diagonal.blockId, diagonal.diagonalId)
					setSelectedObjectId(null)
			} else {
				const isBuildingEntitySelection = buildingEntities.some(entity => entity.id === selectedObjectId)
				if (isBuildingEntitySelection) {
					removeBuildingEntity(selectedObjectId)
					return
				}
				// Building object (SceneObject)
				removeObject(selectedObjectId)
			}
		}

		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
		}, [selectedObjectId, selectedBlockIds, selectedStackIds, activeTool, blockToolSettings.mode, buildingEntities, categoryKey, removeBuildingEntity, removeScaffoldStack, removeLedgerConnection, removeManualLiveLoadPlacement, removeObject, removeScaffoldBlock, suppressDiagonalMemberInBlock, setSelectedObjectId, setSelectedStackIds])

	// Keyboard shortcuts: Undo / Redo
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.repeat) return
			if (e.defaultPrevented) return
			if (isTextInputTarget(e.target)) return
			if (e.altKey) return

			const hasUndoModifier = e.ctrlKey || e.metaKey
			if (!hasUndoModifier) return

			const key = e.key.toLowerCase()
			const isUndo = key === 'z' && !e.shiftKey
			const isRedo = key === 'y' || (key === 'z' && e.shiftKey)
			if (!isUndo && !isRedo) return

			e.preventDefault()

			if (isUndo) {
				if (canUndo) undo()
				return
			}

			if (canRedo) redo()
		}

		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [undo, redo, canUndo, canRedo])

  // Keyboard shortcut: Escape cancels placement mode and clears selection.
  // Use capture-phase so we still receive the event even if a downstream listener stops propagation.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (hasBlockingModalOpen()) return
      // Skip if focused on a text input
	      if (isTextInputTarget(e.target)) return
      e.preventDefault()
      e.stopPropagation()

      if (categoryKey === 'liveLoads' && (selectedLiveLoadDeckTarget || selectedLiveLoadDeckTargets.length > 0)) {
        setHoveredLiveLoadDeckTargets([])
        setSelectedLiveLoadDeckTargets([])
        setSelectedLiveLoadDeckTarget(null)
        setSelectedObjectId(null)
        return
      }

      if (buildingHostedPatternPreview) {
        setBuildingHostedPatternPreview(null)
        setSelectedHostedPatternInstance(null)
        setSelectedObjectId(null)
        return
      }

      // Check if we're in placement mode and cancel it
      const isPlacingStandard = categoryKey === 'standards' && partId !== null
      const isPlacingAutoSelect = AUTO_SELECT_CATEGORIES.has(categoryKey)

      if (isPlacingStandard) {
        // Clear the selected part to exit standard placement mode
        setPartId(null)
        return
      }

      if (isPlacingAutoSelect) {
        // Switch back to standards category to exit auto-select placement mode
        setCategoryKey('standards')
        return
      }

      // Otherwise, clear any selected object
      setSelectedObjectId(null)
    }
    window.addEventListener('keydown', onKeyDown, true) // capture phase
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    setSelectedObjectId,
    buildingHostedPatternPreview,
    setBuildingHostedPatternPreview,
    setSelectedHostedPatternInstance,
    categoryKey,
    partId,
    selectedLiveLoadDeckTargets,
    selectedLiveLoadDeckTarget,
    setHoveredLiveLoadDeckTargets,
    setPartId,
    setCategoryKey,
    setSelectedLiveLoadDeckTargets,
    setSelectedLiveLoadDeckTarget,
  ])

  // Cursor based on active tool
  const getCursor = () => {
    switch (activeTool) {
      case 'rectangle':
        return 'crosshair'
      default:
        return 'default'
    }
  }

  return (
    <>
      {/* Professional Toolbar */}
			      <Toolbar onOpenSettings={() => setSettingsOpen(true)} />

      {/* Full viewport 3D Canvas */}
      {/* opacity: 0 during camera transition to mask the "one bad frame" when switching camera types */}
      <Canvas
			dpr={[1, 2]}
        shadows={settings.enableShadows}
			onCreated={({ gl }) => {
				gl.localClippingEnabled = true
			}}
        gl={{
          antialias: settings.antiAliasing,
          alpha: false,
          powerPreference: 'high-performance',
        }}
        style={{
	          // Explicitly keep WebGL below the fixed toolbar so it can never intercept clicks.
	          // (Padding-top alone can still leave the canvas positioned under the toolbar depending on layout.)
	          position: 'fixed',
		          // Safe-area aware (iOS notch) toolbar offset.
		          top: 'calc(48px + env(safe-area-inset-top))',
	          left: 0,
	          right: 0,
		          bottom: 'env(safe-area-inset-bottom)',
          background: settings.backgroundColor,
          cursor: getCursor(),
          opacity: cameraTransitioning ? 0 : 1,
				// Prevent browser gesture handling from hijacking camera controls.
				touchAction: 'none',
        }}
      >
        <Scene />
      </Canvas>

      {/* Home button - positioned next to ViewCube (upper-right) */}
      {/* Styled to match ViewCube colors for cohesive professional look */}
      <button
        type="button"
        onClick={goHome}
        title="Home (Perspective View)"
        style={{
          position: 'fixed',
	          top: 'calc(60px + env(safe-area-inset-top))',
          right: 148, // Positioned close to ViewCube
          width: 32,
          height: 32,
          borderRadius: 6,
          border: '1px solid #c0c0c8', // Match ViewCube strokeColor
          background: isOrtho ? '#4a9eff' : '#e8e8ec', // Match ViewCube color/hoverColor
          color: isOrtho ? '#ffffff' : '#505060', // Match ViewCube textColor
          display: 'grid',
          placeItems: 'center',
          cursor: 'pointer',
          padding: 0,
          zIndex: 170,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
          transition: 'all 0.15s ease',
        }}
      >
        <Home size={16} />
      </button>

			      {/* Docked inspector (tabs + collapsible rail) */}
			      <DockedInspector />

			{/* CAD distance/angle HUD for move/copy 'place' step */}
			<StackMoveHud />

      {/* Settings UI overlay */}
	      <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}

/**
 * Legacy single-route wrapper.
 * The active router now mounts the shared provider tree in ProjectEditorLayout
 * so Model + Drawings can share the same durable project state.
 */
function App({ projectId }: { projectId?: string }) {
  return (
    <SettingsProvider>
      <CatalogProvider>
        <ToolProvider>
          {projectId ? <ProjectPersistence projectId={projectId} /> : null}
          <ScaffoldBaseSettingsProvider>
            <AppContent />
          </ScaffoldBaseSettingsProvider>
        </ToolProvider>
      </CatalogProvider>
    </SettingsProvider>
  )
}

export default App
