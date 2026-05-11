import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Camera,
  Check,
  CloudOff,
  Loader2,
  MapPinned,
  MousePointer2,
  Box,
  LayoutGrid,
  Square,
  Circle,
  CircleDot,
	Pentagon,
		Scale,
	Undo2,
	Redo2,
		Settings,
		Eye,
		FileDown,
  ChevronDown,
} from 'lucide-react'
import { useSettings } from '../contexts/SettingsContext'
import { useTool, ToolType } from '../contexts/ToolContext'
import { useProjectSession } from '../contexts/ProjectSessionContext'
	import { useJobWorkspace } from '../pm/hooks/useJobWorkspace'
	import { useScaffoldBaseSettings } from '../contexts/ScaffoldBaseSettings'
		import { buildRisa3dDxfExport, type RisaDxfAxisMapping } from '../utils/dxf/risa3dDxf'
import { useModelStore } from '../store/useModelStore'
import { ModeToggle } from './ModeToggle'
import { CatalogSelector } from './CatalogSelector'
import { Tooltip } from './ui/Tooltip'
import { useCatalogSelection } from '../contexts/CatalogContext'
import { createImportedPolygonMassEntity, type ImportedMapFootprint } from '../utils/mapImport'
import './Toolbar.css'

const MapImportDialog = lazy(async () => {
	const module = await import('./MapImportDialog')
	return { default: module.MapImportDialog }
})

interface DropdownItem {
  id: ToolType
  label: string
  icon: ReactNode
}

interface ToolbarProps {
	onOpenSettings: () => void
}

const shapes3D: DropdownItem[] = [
  { id: 'rectangle', label: 'Rectangle', icon: <Square size={16} /> },
  { id: 'circle', label: 'Circle', icon: <Circle size={16} /> },
  { id: 'ring', label: 'Hollow Circle', icon: <CircleDot size={16} /> },
  { id: 'polygon', label: 'Polygon', icon: <Pentagon size={16} /> },
]

export function Toolbar({ onOpenSettings }: ToolbarProps) {
	const { settings, updateSettings } = useSettings()
	const {
		activeTool,
		setActiveTool,
		buildingHostedSketchIntent,
		updateBlockToolSettings,
		setBlockEditMode,
		setBlockEditActionMode,
		clearBlockSelection,
		setSelectedStackIds,
		setIsEditingBlock,
		setSelectedObjectId,
		setSelectedBuildingEntityId,
		setHoveredLiveLoadDeckTargets,
		setSelectedLiveLoadDeckTarget,
		cancelDrawing,
		buildingEntities,
		addBuildingEntity,
			scaffoldStacks,
			scaffoldBlocks,
			ledgerConnections,
				dxfPreviewEnabled,
				setDxfPreviewEnabled,
		workspaceMode,
		setWorkspaceMode,
			undo,
			redo,
			canUndo,
			canRedo,
	} = useTool()
		const { baseSettings } = useScaffoldBaseSettings()
	const { categoryKey, setCategoryKey, setPartId } = useCatalogSelection()
	const navigate = useNavigate()
	const projectSession = useProjectSession()
	const jobWorkspace = useJobWorkspace()
  const [shapesOpen, setShapesOpen] = useState(false)
	const [mapImportOpen, setMapImportOpen] = useState(false)
	const [catalogOpen, setCatalogOpen] = useState(false)
	const [loadsOpen, setLoadsOpen] = useState(false)
		const [dxfExportOpen, setDxfExportOpen] = useState(false)
	const [dxfAxisMapping, setDxfAxisMapping] = useState<RisaDxfAxisMapping>('RISA_Y_UP')
		const [dxfIncludeJoints, setDxfIncludeJoints] = useState(true)
	const [dxfIncludeJacks, setDxfIncludeJacks] = useState(true)
	  const shapesDropdownRef = useRef<HTMLDivElement>(null)
	const catalogDropdownRef = useRef<HTMLDivElement>(null)
		const loadsDropdownRef = useRef<HTMLDivElement>(null)
		const dxfDropdownRef = useRef<HTMLDivElement>(null)

		// Building geometry tools are only available in Building mode.
		const shapesEnabled = workspaceMode === 'BUILDING_MODE'
    const hostedSketchStatus = useMemo(() => {
      if (!buildingHostedSketchIntent || activeTool !== 'rectangle') return null
      if (buildingHostedSketchIntent.target === 'feature') {
        return buildingHostedSketchIntent.hostKind === 'side-face'
          ? 'Move onto the wall you want, then drag directly on that host face to sketch a side feature. Press Esc to cancel.'
          : 'Drag on the highlighted top face to sketch a rooftop feature. Press Esc to cancel.'
      }
      return buildingHostedSketchIntent.hostKind === 'top-face'
        ? 'Drag on the highlighted top face to sketch a proxy or cut volume. Press Esc to cancel.'
        : 'Move onto the host face you want, then drag directly on that surface to sketch a proxy or cut volume. Press Esc to cancel.'
    }, [activeTool, buildingHostedSketchIntent])

			// High-end UX: keep the Catalog control visible so it never feels "broken".
			// If the user clicks it while in BUILDING_MODE, we switch to SCAFFOLD_MODE and open it.
			const catalogEnabled = workspaceMode === 'SCAFFOLD_MODE'
			const showCatalog = true

			// If we leave scaffold mode, force-close the catalog UI (prevents “ghost open” state).
		useEffect(() => {
				if (!catalogEnabled) setCatalogOpen(false)
			}, [catalogEnabled])

			useEffect(() => {
				if (workspaceMode !== 'SCAFFOLD_MODE') setLoadsOpen(false)
			}, [workspaceMode])

			// If we leave building mode, force-close the shapes dropdown.
			useEffect(() => {
				if (!shapesEnabled) setShapesOpen(false)
			}, [shapesEnabled])

			// DXF actions are scaffold-only; close its popover when leaving scaffold mode.
			useEffect(() => {
				if (workspaceMode !== 'SCAFFOLD_MODE') setDxfExportOpen(false)
			}, [workspaceMode])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
				const target = e.target as Node
				const inShapes = shapesDropdownRef.current?.contains(target) ?? false
				const inCatalog = catalogDropdownRef.current?.contains(target) ?? false
				const inLoads = loadsDropdownRef.current?.contains(target) ?? false
					const inDxf = dxfDropdownRef.current?.contains(target) ?? false
					if (!inShapes && !inCatalog && !inLoads && !inDxf) {
					setShapesOpen(false)
					setMapImportOpen(false)
					setCatalogOpen(false)
						setLoadsOpen(false)
						setDxfExportOpen(false)
				}
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close dropdown on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShapesOpen(false)
			setMapImportOpen(false)
				setCatalogOpen(false)
					setLoadsOpen(false)
					setDxfExportOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleShapeSelect = (tool: ToolType) => {
			if (!shapesEnabled) return
    setActiveTool(tool)
    setShapesOpen(false)
  }

	const handleOpenMapImport = useCallback(() => {
		if (!shapesEnabled) return
		cancelDrawing()
		setActiveTool('select')
		setShapesOpen(false)
		setCatalogOpen(false)
		setLoadsOpen(false)
		setDxfExportOpen(false)
		setMapImportOpen(true)
	}, [cancelDrawing, setActiveTool, shapesEnabled])

	const handleImportMapFootprint = useCallback((footprint: ImportedMapFootprint, heightFt: number) => {
		const now = Date.now()
		const uid = `${now}-${Math.random().toString(36).slice(2, 11)}`
		const entity = createImportedPolygonMassEntity({
			id: `map-footprint-${uid}`,
			footprint,
			heightFt,
			buildingEntities,
			now,
		})
		if (!entity) return
		addBuildingEntity(entity)
		setSelectedBuildingEntityId(entity.id)
		setSelectedObjectId(entity.id)
		setMapImportOpen(false)
	}, [addBuildingEntity, buildingEntities, setSelectedBuildingEntityId, setSelectedObjectId])

	const exitLiveLoadMode = useCallback(() => {
		if (categoryKey !== 'liveLoads') return
		setCategoryKey('standards')
		setPartId(null)
		setLoadsOpen(false)
	}, [categoryKey, setCategoryKey, setPartId])

	const handleActivateLiveLoadTool = useCallback(() => {
		setWorkspaceMode('SCAFFOLD_MODE')
		setDxfPreviewEnabled(false)
		setShapesOpen(false)
		setCatalogOpen(false)
		setLoadsOpen(false)
		setDxfExportOpen(false)
		setCategoryKey('liveLoads')
		setPartId(null)
		updateBlockToolSettings({ mode: 'assemble' })
		setBlockEditMode(false)
		setBlockEditActionMode('neutral')
		setIsEditingBlock(false)
		clearBlockSelection()
		setSelectedStackIds([])
		setSelectedObjectId(null)
		setHoveredLiveLoadDeckTargets([])
		setSelectedLiveLoadDeckTarget(null)
		setActiveTool('select')
	}, [
		setActiveTool,
		setBlockEditActionMode,
		setBlockEditMode,
		setCategoryKey,
		setDxfPreviewEnabled,
		setIsEditingBlock,
		setPartId,
		setHoveredLiveLoadDeckTargets,
		setSelectedLiveLoadDeckTarget,
		setSelectedStackIds,
		setSelectedObjectId,
		setWorkspaceMode,
		clearBlockSelection,
		updateBlockToolSettings,
	])

	  const isShapeTool = shapesEnabled && (activeTool === 'rectangle' || activeTool === 'circle' || activeTool === 'ring' || activeTool === 'polygon')
	const isLoadToolActive = workspaceMode === 'SCAFFOLD_MODE' && categoryKey === 'liveLoads'

	const projectName = projectSession?.projectName ?? ''
		const saveStatus = projectSession?.saveStatus ?? 'idle'
		const lastSavedAt = projectSession?.lastSavedAt ?? null
			const backPath = jobWorkspace?.jobsPath ?? '/projects'
			const backLabel = jobWorkspace ? 'Jobs' : 'Projects'

		const pillVariant = saveStatus === 'saving' ? 'saving' : saveStatus === 'error' ? 'error' : 'saved'
		const SaveIcon = saveStatus === 'saving' ? Loader2 : saveStatus === 'error' ? CloudOff : Check

		const formatSavedStamp = (d: Date) => {
			const now = new Date()
			const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
			const sameDay = now.toDateString() === d.toDateString()
			if (sameDay) return time
			const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
			return `${date} ${time}`
		}

		const saveLabel =
			saveStatus === 'saving'
				? 'Saving…'
				: saveStatus === 'error'
					? 'Not saved'
					: lastSavedAt
						? `Saved • ${formatSavedStamp(lastSavedAt)}`
						: 'Saved'

			// DXF export / preview actions are only meaningful in scaffold mode.
			const canDxfActions = workspaceMode === 'SCAFFOLD_MODE' && scaffoldStacks.length > 0

				// High-end: if DXF becomes unavailable, auto-close the popover.
				useEffect(() => {
					if (!canDxfActions) setDxfExportOpen(false)
				}, [canDxfActions])

			const sanitizeFilenamePart = (s: string) =>
				s
					.trim()
					.replace(/[^a-zA-Z0-9_-]+/g, '_')
					.replace(/_+/g, '_')
					.replace(/^_+|_+$/g, '')
					.slice(0, 64)

			const downloadTextFile = (content: string, filename: string, mime = 'application/dxf') => {
				const blob = new Blob([content], { type: mime })
				const url = URL.createObjectURL(blob)
				const a = document.createElement('a')
				a.href = url
				a.download = filename
				a.click()
				URL.revokeObjectURL(url)
			}

				const handleToggleDxfPreview = () => {
				if (!canDxfActions) return
				setActiveTool('select')
				setDxfPreviewEnabled(!dxfPreviewEnabled)
				setShapesOpen(false)
				setCatalogOpen(false)
					setLoadsOpen(false)
					setDxfExportOpen(false)
			}

				const handleToggleLegLoads = () => {
					updateSettings({ showLegLoads: !settings.showLegLoads })
				}

				const handleExportDxf = (override?: { axisMapping?: RisaDxfAxisMapping }) => {
					if (!canDxfActions) return
					const { dxf } = buildRisa3dDxfExport({
						scaffoldStacks,
						ledgerConnections,
						baseSettings: {
							showWoodSill: baseSettings.showWoodSill,
							showBaseCollar: baseSettings.showBaseCollar,
						},
						options: {
							axisMapping: override?.axisMapping ?? dxfAxisMapping,
							units: 'inches',
							includeJoints: dxfIncludeJoints,
							includeJacks: dxfIncludeJacks,
						},
					})
					const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..*$/, '')
					const namePart = sanitizeFilenamePart(projectName || 'ScaffoldPro') || 'ScaffoldPro'
					downloadTextFile(dxf, `${namePart}_RISA3D_${stamp}.dxf`)
					setDxfExportOpen(false)
				}

				const canBlockTool = workspaceMode === 'SCAFFOLD_MODE'
				const handleToggleBlockTool = () => {
					if (!canBlockTool) return
					// Block tool is an interactive placement mode; disable analysis preview.
					setDxfPreviewEnabled(false)
					setShapesOpen(false)
					setCatalogOpen(false)
						setLoadsOpen(false)
						setDxfExportOpen(false)
					if (activeTool === 'block' && categoryKey !== 'liveLoads') {
						setBlockEditMode(false)
						setIsEditingBlock(false)
						clearBlockSelection()
						setActiveTool('select')
						return
					}
					if (categoryKey === 'liveLoads') {
						setCategoryKey('standards')
						setPartId(null)
					}
					updateBlockToolSettings({ mode: 'assemble' })
					setBlockEditActionMode('neutral')
					setIsEditingBlock(false)
					clearBlockSelection()
					setActiveTool('block')
					setBlockEditMode(true)
				}

			const handleUndo = () => {
				if (!canUndo) return
				setShapesOpen(false)
				setCatalogOpen(false)
				setDxfExportOpen(false)
				undo()
			}

			const createViewFromLiveCamera = useModelStore(s => s.createViewFromLiveCamera)
			const hasLiveCamera = useModelStore(s => s.liveCamera !== null)

			const handleSaveView = () => {
				setShapesOpen(false)
				setCatalogOpen(false)
				setDxfExportOpen(false)
				createViewFromLiveCamera()
			}

			const handleRedo = () => {
				if (!canRedo) return
				setShapesOpen(false)
				setCatalogOpen(false)
				setDxfExportOpen(false)
				redo()
			}

  return (
    <div className="toolbar">
			<div className="toolbar-left">
				{projectSession ? (
					<>
								<Tooltip content={`Back to ${backLabel}`} align="start">
								<button
									className="toolbar-btn toolbar-nav-btn"
										onClick={() => navigate(backPath)}
										aria-label={`Back to ${backLabel}`}
									type="button"
								>
									<ArrowLeft size={18} />
										<span className="toolbar-nav-label">{backLabel}</span>
								</button>
							</Tooltip>

						<div className="toolbar-project-meta" title={projectName}>
							<div className="toolbar-project-name">{projectName}</div>
								<div className={`toolbar-save-pill ${pillVariant}`} aria-live="polite">
									<SaveIcon size={14} className={saveStatus === 'saving' ? 'spin' : ''} />
									<span>{saveLabel}</span>
								</div>
						</div>
					</>
				) : null}
			</div>

			{/* Centered tool groups */}
			<div className="toolbar-center">
				<div className="toolbar-group">
					<ModeToggle />
				</div>

				<div className="toolbar-divider" />

        <div className="toolbar-group">
          {/* Select Tool */}
          <button
            className={`toolbar-btn ${activeTool === 'select' ? 'active' : ''}`}
            onClick={() => {
							exitLiveLoadMode()
							setActiveTool('select')
						}}
            title="Select (V)"
          >
            <MousePointer2 size={18} />
          </button>

						{/* Block Generator Tool (Scaffold mode only) */}
						{workspaceMode === 'SCAFFOLD_MODE' && (
							<Tooltip content="Block generator" align="start">
								<button
									className={`toolbar-btn ${activeTool === 'block' && categoryKey !== 'liveLoads' ? 'active' : ''}`}
									onClick={handleToggleBlockTool}
									title="Block generator"
									aria-label="Block generator"
									type="button"
								>
									<LayoutGrid size={18} />
								</button>
							</Tooltip>
						)}
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          {/* 3D Shapes Dropdown */}
	          <div className="dropdown-container" ref={shapesDropdownRef}>
						<Tooltip content={shapesEnabled ? '3D Shapes' : '3D Shapes (Building mode only)'}>
							<button
								className={`toolbar-btn dropdown-trigger ${isShapeTool ? 'active' : ''}`}
								aria-disabled={!shapesEnabled}
								onClick={() => {
									if (!shapesEnabled) return
									setShapesOpen(!shapesOpen)
									setCatalogOpen(false)
									setLoadsOpen(false)
								}}
								type="button"
							>
								<Box size={18} />
								<ChevronDown size={12} className="dropdown-arrow" />
							</button>
						</Tooltip>

	            {shapesOpen && shapesEnabled && (
              <div className="dropdown-menu">
                <div className="dropdown-header">3D Shapes</div>
                {shapes3D.map((shape) => (
                  <button
                    key={shape.id}
                    className={`dropdown-item ${activeTool === shape.id ? 'active' : ''}`}
                    onClick={() => handleShapeSelect(shape.id)}
								type="button"
                  >
                    {shape.icon}
                    <span>{shape.label}</span>
                  </button>
                ))}
              </div>
	            )}
          </div>

					<Tooltip content={shapesEnabled ? 'Insert from Map' : 'Insert from Map (Building mode only)'} align="start">
						<button
							className="toolbar-btn toolbar-map-trigger"
							aria-disabled={!shapesEnabled}
							onClick={handleOpenMapImport}
							type="button"
						>
							<MapPinned size={18} />
							<span className="toolbar-map-trigger-text">Map</span>
						</button>
					</Tooltip>
        </div>

						<div
							className={`catalog-toolbar-slot ${showCatalog ? 'visible' : ''} ${catalogEnabled ? '' : 'disabled'}`}
							aria-hidden={!showCatalog}
							title={catalogEnabled ? 'Catalog' : 'Catalog (switches to Scaffold mode)'}
						>
					<div className="toolbar-divider" />

					<div className="toolbar-group">
						<CatalogSelector
									open={catalogOpen && catalogEnabled}
							onToggle={() => {
										if (!catalogEnabled) {
											setShapesOpen(false)
											setLoadsOpen(false)
											setWorkspaceMode('SCAFFOLD_MODE')
											setCatalogOpen(true)
											return
										}
										setCatalogOpen(!catalogOpen)
										setShapesOpen(false)
										setLoadsOpen(false)
							}}
							onClose={() => setCatalogOpen(false)}
							containerRef={catalogDropdownRef}
						/>
					</div>
				</div>

				{workspaceMode === 'SCAFFOLD_MODE' && (
					<>
						<div className="toolbar-divider" />

						<div className="toolbar-group">
							<div className="dropdown-container" ref={loadsDropdownRef}>
								<Tooltip content="Loads" align="start">
									<button
										className={`toolbar-btn dropdown-trigger ${isLoadToolActive ? 'active' : ''}`}
										onClick={() => {
											setShapesOpen(false)
											setCatalogOpen(false)
											setLoadsOpen(!loadsOpen)
										}}
										type="button"
										title="Loads"
										aria-label="Loads"
									>
										<Scale size={18} />
										<span className="catalog-trigger-text">Loads</span>
										<ChevronDown size={12} className="dropdown-arrow" />
									</button>
								</Tooltip>

								{loadsOpen && (
									<div className="dropdown-menu" role="menu" aria-label="Loads">
										<div className="dropdown-header">Loads</div>
										<button
											className={`dropdown-item ${isLoadToolActive ? 'active' : ''}`}
											onClick={handleActivateLiveLoadTool}
											type="button"
											role="menuitem"
										>
											<Scale size={16} />
											<span>Live Load</span>
										</button>
									</div>
								)}
							</div>
						</div>
					</>
				)}


      </div>

				<div className="toolbar-right">
					<div className="toolbar-group toolbar-history-group">
						<Tooltip content={canUndo ? 'Undo (Ctrl/Cmd+Z)' : 'Nothing to undo'} align="end">
							<button
								className="toolbar-btn"
								aria-disabled={!canUndo}
								onClick={handleUndo}
								type="button"
								title="Undo"
								aria-label="Undo"
							>
								<Undo2 size={18} />
							</button>
						</Tooltip>

						<Tooltip content={canRedo ? 'Redo (Ctrl+Y / Shift+Cmd+Z)' : 'Nothing to redo'} align="end">
							<button
								className="toolbar-btn"
								aria-disabled={!canRedo}
								onClick={handleRedo}
								type="button"
								title="Redo"
								aria-label="Redo"
							>
								<Redo2 size={18} />
							</button>
						</Tooltip>
					</div>

					{workspaceMode === 'SCAFFOLD_MODE' && (
						<div className="toolbar-group">
							<Tooltip
								content={settings.showLegLoads ? 'Hide leg loads' : 'Show leg loads'}
								align="end"
							>
								<button
									className={`toolbar-btn ${settings.showLegLoads ? 'active' : ''}`}
									onClick={handleToggleLegLoads}
									aria-pressed={settings.showLegLoads}
									type="button"
									title={settings.showLegLoads ? 'Hide leg loads' : 'Show leg loads'}
								>
									<Scale size={18} />
								</button>
							</Tooltip>

							{/* DXF wireframe preview */}
							<Tooltip
								content={canDxfActions ? 'Centerline preview' : 'Preview (place at least one standard)'}
								align="end"
							>
								<button
									className={`toolbar-btn ${dxfPreviewEnabled ? 'active' : ''}`}
									aria-disabled={!canDxfActions}
									onClick={handleToggleDxfPreview}
									type="button"
								>
									<Eye size={18} />
								</button>
							</Tooltip>

							{/* Export DXF (high-end preset popover) */}
							<div className="dropdown-container" ref={dxfDropdownRef}>
								<Tooltip
									content={canDxfActions ? 'Export DXF (RISA-3D)' : 'Export DXF (place at least one standard)'}
									align="end"
								>
									<button
										className={`toolbar-btn dropdown-trigger ${dxfExportOpen ? 'active' : ''}`}
										aria-disabled={!canDxfActions}
										onClick={() => {
											if (!canDxfActions) return
											setDxfExportOpen(!dxfExportOpen)
											setShapesOpen(false)
											setCatalogOpen(false)
										}}
										type="button"
									>
										<FileDown size={18} />
										<ChevronDown size={12} className="dropdown-arrow" />
									</button>
								</Tooltip>

								{dxfExportOpen && canDxfActions && (
									<div className="dropdown-menu align-right dxf-menu">
										<div className="dropdown-header">DXF Export</div>

										<button
											className="dropdown-item"
											onClick={() => {
												setDxfAxisMapping('RISA_Y_UP')
												handleExportDxf({ axisMapping: 'RISA_Y_UP' })
											}}
											type="button"
										>
											<span className="dropdown-check">
												{dxfAxisMapping === 'RISA_Y_UP' ? <Check size={16} /> : <span className="dropdown-check-spacer" />}
											</span>
											<span>Export: RISA-3D Import (Y-up)</span>
										</button>

										<button
											className="dropdown-item"
											onClick={() => {
												setDxfAxisMapping('Z_UP')
												handleExportDxf({ axisMapping: 'Z_UP' })
											}}
											type="button"
										>
											<span className="dropdown-check">
												{dxfAxisMapping === 'Z_UP' ? <Check size={16} /> : <span className="dropdown-check-spacer" />}
											</span>
											<span>Export: CAD / ScaffoldPro (Z-up)</span>
										</button>

										<div className="dropdown-header">Options</div>

										<button
											className="dropdown-item"
											onClick={() => setDxfIncludeJoints(v => !v)}
											type="button"
										>
											<span className="dropdown-check">
												{dxfIncludeJoints ? <Check size={16} /> : <span className="dropdown-check-spacer" />}
											</span>
											<span>Include joints (POINT)</span>
										</button>

										<button
											className="dropdown-item"
											onClick={() => setDxfIncludeJacks(v => !v)}
											type="button"
										>
											<span className="dropdown-check">
												{dxfIncludeJacks ? <Check size={16} /> : <span className="dropdown-check-spacer" />}
											</span>
											<span>Include jacks (SCF_JACKS)</span>
										</button>

										<div className="dropdown-hint">
											RISA mapping: <code>LINE → members</code>, <code>POINT → joints</code>
										</div>
									</div>
								)}
							</div>
						</div>
					)}

					<div className="toolbar-group">
						<Tooltip content={hasLiveCamera ? 'Save current view to Drawings' : 'Orbit the model first to capture a view'} align="end">
							<button
								className="toolbar-btn"
								aria-disabled={!hasLiveCamera}
								onClick={handleSaveView}
								type="button"
							>
								<Camera size={18} />
							</button>
						</Tooltip>
					</div>

					<div className="toolbar-group">
						<Tooltip content="Settings" align="end">
							<button
								className="toolbar-btn"
								onClick={onOpenSettings}
								type="button"
								title="Settings"
							>
								<Settings size={18} />
							</button>
						</Tooltip>
					</div>
				</div>

      {/* Active Tool Indicator - positioned below toolbar */}
      <div className="toolbar-status">
        {hostedSketchStatus && (
          <span className="status-text">{hostedSketchStatus}</span>
        )}
	        {!hostedSketchStatus && shapesEnabled && activeTool === 'rectangle' && (
          <span className="status-text">Click and drag on grid to draw rectangle</span>
        )}
        {!hostedSketchStatus && shapesEnabled && activeTool === 'circle' && (
          <span className="status-text">Click center, drag to set radius</span>
        )}
        {!hostedSketchStatus && shapesEnabled && activeTool === 'ring' && (
          <span className="status-text">Click center, drag to set outer radius</span>
        )}
        {!hostedSketchStatus && shapesEnabled && activeTool === 'polygon' && (
          <span className="status-text">Click to place points, then press Enter or double-click to finish</span>
        )}
      </div>

			{mapImportOpen && (
				<Suspense fallback={null}>
					<MapImportDialog
						isOpen={mapImportOpen}
						onClose={() => setMapImportOpen(false)}
						onImport={handleImportMapFootprint}
					/>
				</Suspense>
			)}
    </div>
  )
}
