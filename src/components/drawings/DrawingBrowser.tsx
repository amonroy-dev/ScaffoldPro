/**
 * DrawingBrowser — Left sidebar: palette tabs + sheet/view/annotation/section panels.
 */
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Plus } from 'lucide-react'
import type {
	DrawingPackageDocument,
	DrawingSavedView,
	DrawingSectionDefinition,
	DrawingSheet,
	DrawingTemplate,
} from '../../drawings/drawingDocument'
import type { PaletteMode } from './drawingConstants'
import {
	DRAWING_PALETTE_TABS,
	formatAuthoringSourceLabel,
	formatProjectionLabel,
	formatSheetReferenceList,
	formatViewportKindLabel,
} from './drawingConstants'

function hasSelectionModifier(event: { ctrlKey: boolean; metaKey: boolean }) {
	return event.ctrlKey || event.metaKey
}

export type DrawingBrowserProps = {
	// Palette state
	activePaletteMode: PaletteMode
	setActivePaletteMode: (mode: PaletteMode) => void

	// Sheet data
	activeSheet: DrawingSheet | null
	activeTemplate: DrawingTemplate | null
	isActiveSheetFirstPage: boolean
	drawingPackage: DrawingPackageDocument
	templateMap: ReadonlyMap<string, DrawingTemplate>
	sectionMap: ReadonlyMap<string, DrawingSectionDefinition>
	viewSheetNumbersMap: ReadonlyMap<string, string[]>
	sectionSheetNumbersMap: ReadonlyMap<string, string[]>
	sectionViewMap: ReadonlyMap<string, DrawingSavedView>
	activeDrawingSectionId: string | null

	// Sheet actions
	newSheetTemplate: DrawingTemplate | null
	handleCreateSheetFromTemplate: () => void
	handleDuplicateSheet: () => void
	handleSelectSheet: (sheetId: string) => void

	// View / insert
	activeView: DrawingSavedView | null
	activeViewPlacementPreview: { sizeLabel: string; placementLabel: string } | null
	canSendActiveViewToSheet: boolean
	handleSendActiveViewToSheet: () => void
	canInsertViewsToSheet: boolean
	handleSendViewToSheet: (viewId: string) => void
	handleSelectView: (viewId: string) => void

	// Source view actions
	canCreateSourceViewFromModel: boolean
	handleCreateSourceViewFromModel: () => void
	canCaptureLiveModel: boolean
	handleCaptureActiveViewFromModel: () => void
	canOpenActiveViewInModel: boolean
	handleOpenViewInModel: () => void

	// Annotate
	handleAddNote: () => void
	handleAddCallout: () => void

	// Section actions
	handleSelectSection: (sectionId: string) => void
	canCreateSectionLinkedView: boolean
	handleCreateLinkedViewFromSection: () => void
	canActivateSectionInModel: boolean
	handleActivateSectionInModel: () => void

	// Selection state
	selectedViewportIds: string[]
	selectedAnnotationIds: string[]
	handleViewportSelection: (viewportId: string, multiSelect: boolean) => void
	handleAnnotationSelection: (annotationId: string, multiSelect: boolean) => void
	clearViewportInteractionState: () => void
	clearAnnotationInteractionState: () => void
	clearSourceAnnotationInteractionState: () => void
	setSelectedSourceAnnotationId: (id: string | null) => void

	// Viewport references
	activeSheetViewportReferences: Array<{
		id: string
		referenceLabel: string
		title: string
		viewName: string
		kindLabel: string
		sectionMarker: string | null
	}>
}

export function DrawingBrowser(props: DrawingBrowserProps) {
	const {
		activePaletteMode, setActivePaletteMode,
		activeSheet, activeTemplate,
		drawingPackage, templateMap, sectionMap,
		viewSheetNumbersMap, sectionViewMap, activeDrawingSectionId,
		newSheetTemplate, handleCreateSheetFromTemplate, handleDuplicateSheet, handleSelectSheet,
		activeView,
		canSendActiveViewToSheet, handleSendActiveViewToSheet,
		canInsertViewsToSheet, handleSendViewToSheet, handleSelectView,
		canCreateSourceViewFromModel, handleCreateSourceViewFromModel,
		canCaptureLiveModel, handleCaptureActiveViewFromModel,
		canOpenActiveViewInModel, handleOpenViewInModel,
		handleAddNote, handleAddCallout,
		handleSelectSection,
		canCreateSectionLinkedView, handleCreateLinkedViewFromSection,
		canActivateSectionInModel, handleActivateSectionInModel,
		selectedViewportIds, selectedAnnotationIds,
		handleViewportSelection, handleAnnotationSelection,
		clearViewportInteractionState, clearAnnotationInteractionState, clearSourceAnnotationInteractionState,
		setSelectedSourceAnnotationId,
		activeSheetViewportReferences,
	} = props

	return (
		<aside className="drawing-shell-chrome drawing-rail">
			{/* ── Palette tabs ── */}
			<div className="drawing-palette-tabs" role="tablist" aria-label="Palette">
				{DRAWING_PALETTE_TABS.map(tab => (
					<button
						key={tab.id}
						aria-selected={activePaletteMode === tab.id}
						className={`drawing-palette-tab ${activePaletteMode === tab.id ? 'active' : ''}`}
						onClick={() => setActivePaletteMode(tab.id)}
						role="tab"
						type="button"
					>
						{tab.label}
					</button>
				))}
			</div>

			{activePaletteMode === 'sheet' ? (
				<>
					{/* Active sheet summary */}
					<section className="drawing-panel">
						<div className="drawing-panel-label">Active Sheet</div>
						<strong>{activeSheet ? `${activeSheet.number} · ${activeSheet.name}` : '—'}</strong>
						<div className="drawing-item-meta">
							<span>{activeTemplate?.paperSizeLabel ?? '—'}</span>
							<span>{activeSheet?.viewports.length ?? 0} vp</span>
							<span>{activeSheet?.annotations.length ?? 0} ann</span>
						</div>
						<div className="drawing-panel-actions split">
							<button className="drawing-action-btn accent" disabled={!newSheetTemplate} onClick={handleCreateSheetFromTemplate} type="button">
								<Plus size={14} /> New
							</button>
							<button className="drawing-action-btn" onClick={handleDuplicateSheet} type="button">
								Duplicate
							</button>
						</div>
					</section>

					{/* Sheet list */}
					<section className="drawing-panel">
						<div className="drawing-panel-label">Sheets</div>
						<div className="drawing-list">
							{drawingPackage.sheets.map(sheet => (
								<button
									key={sheet.id}
									className={`drawing-list-item ${sheet.id === drawingPackage.activeSheetId ? 'active' : ''}`}
									onClick={() => handleSelectSheet(sheet.id)}
									type="button"
								>
									<strong>{sheet.number}</strong>
									<span>{sheet.name}</span>
									<div className="drawing-item-meta">
										<span>{templateMap.get(sheet.templateId)?.paperSizeLabel ?? '—'}</span>
										<span>{sheet.viewports.length} vp</span>
										<span>{sheet.annotations.length} ann</span>
									</div>
								</button>
							))}
						</div>
					</section>
				</>
			) : null}

			{activePaletteMode === 'insert' ? (
				<>
					{/* Place view */}
					<section className="drawing-panel">
						<div className="drawing-panel-label">Place View</div>
						<strong>{activeView?.name ?? 'No view selected'}</strong>
						<div className="drawing-item-meta">
							<span>{activeView ? formatViewportKindLabel(activeView.kind) : '—'}</span>
							<span>{activeView?.scaleLabel ?? '—'}</span>
						</div>
						<div className="drawing-panel-actions split">
							<button className="drawing-action-btn accent" disabled={!canSendActiveViewToSheet} onClick={handleSendActiveViewToSheet} type="button">
								<Plus size={14} /> Place
							</button>
							<button className="drawing-action-btn" disabled={!canCreateSourceViewFromModel} onClick={handleCreateSourceViewFromModel} type="button">
								<Plus size={14} /> New
							</button>
						</div>
					</section>

					{/* Saved views */}
					<section className="drawing-panel">
						<div className="drawing-panel-label">Saved Views</div>
						<div className="drawing-palette-list compact">
							{drawingPackage.savedViews.map(view => (
								<article key={view.id} className={`drawing-palette-row ${view.id === drawingPackage.activeViewId ? 'active' : ''}`}>
									<div className="drawing-palette-row-body">
										<strong>{view.name}</strong>
										<div className="drawing-item-meta">
											<span>{view.kind.toUpperCase()}</span>
											<span>{view.scaleLabel}</span>
											<span>{formatSheetReferenceList(viewSheetNumbersMap.get(view.id) ?? [])}</span>
										</div>
									</div>
									<div className="drawing-palette-row-actions">
										<button className="drawing-action-btn compact" onClick={() => handleSelectView(view.id)} type="button">
											{view.id === drawingPackage.activeViewId ? '●' : 'Set'}
										</button>
										<button className="drawing-action-btn accent compact" disabled={!canInsertViewsToSheet} onClick={() => handleSendViewToSheet(view.id)} type="button">
											Place
										</button>
									</div>
								</article>
							))}
						</div>
					</section>

					{/* Placed references */}
					<section className="drawing-panel">
						<div className="drawing-panel-label">Placed References</div>
						{activeSheetViewportReferences.length > 0 ? (
							<div className="drawing-reference-list">
								{activeSheetViewportReferences.map(reference => (
									<button
										key={reference.id}
										className={`drawing-reference-item ${selectedViewportIds.includes(reference.id) ? 'active' : ''}`}
										onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
											clearViewportInteractionState()
											clearAnnotationInteractionState()
											clearSourceAnnotationInteractionState()
											handleViewportSelection(reference.id, hasSelectionModifier(event))
											setSelectedSourceAnnotationId(null)
										}}
										type="button"
									>
										<div className="drawing-reference-tag">{reference.referenceLabel}</div>
										<strong>{reference.title}</strong>
										<div className="drawing-item-meta">
											<span>{reference.kindLabel}</span>
											{reference.sectionMarker ? <span>Cut {reference.sectionMarker}</span> : null}
										</div>
									</button>
								))}
							</div>
						) : (
							<div className="drawing-empty-state">No placed viewports.</div>
						)}
					</section>
				</>
			) : null}

			{activePaletteMode === 'view' ? (
				<>
					<section className="drawing-panel">
						<div className="drawing-panel-label">Saved Views</div>
						<div className="drawing-list compact">
							{drawingPackage.savedViews.map(view => (
								<button
									key={view.id}
									className={`drawing-list-item ${view.id === drawingPackage.activeViewId ? 'active' : ''}`}
									onClick={() => handleSelectView(view.id)}
									type="button"
								>
									<strong>{view.name}</strong>
									<div className="drawing-item-meta">
										<span>{view.kind.toUpperCase()}</span>
										<span>{formatProjectionLabel(view.projection)}</span>
										<span>{view.scaleLabel}</span>
										<span>{formatAuthoringSourceLabel(view.authoringSource)}</span>
										{view.directionLabel ? <span>{view.directionLabel}</span> : null}
										{view.sectionId ? <span>{sectionMap.get(view.sectionId)?.markerLabel ?? 'Section'}</span> : null}
									</div>
								</button>
							))}
						</div>
						<div className="drawing-panel-actions split">
							<button className="drawing-action-btn accent" disabled={!canCreateSourceViewFromModel} onClick={handleCreateSourceViewFromModel} type="button">
								<Plus size={14} /> New
							</button>
							<button className="drawing-action-btn" disabled={!canCaptureLiveModel} onClick={handleCaptureActiveViewFromModel} type="button">
								Update
							</button>
							<button className="drawing-action-btn" disabled={!canOpenActiveViewInModel} onClick={() => handleOpenViewInModel()} type="button">
								Apply
							</button>
						</div>
					</section>
				</>
			) : null}

			{activePaletteMode === 'annotate' ? (
				<>
					<section className="drawing-panel">
						<div className="drawing-panel-label">Annotations</div>
						<div className="drawing-panel-actions split">
							<button className="drawing-action-btn accent" onClick={handleAddNote} type="button">
								<Plus size={14} /> Note
							</button>
							<button className="drawing-action-btn" onClick={handleAddCallout} type="button">
								<Plus size={14} /> Callout
							</button>
						</div>
					</section>

					<section className="drawing-panel">
						<div className="drawing-panel-label">Sheet Annotations</div>
						{activeSheet?.annotations.length ? (
							<div className="drawing-list compact">
								{activeSheet.annotations.map(annotation => (
									<button
										key={annotation.id}
										className={`drawing-list-item ${selectedAnnotationIds.includes(annotation.id) ? 'active' : ''}`}
										onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
											clearViewportInteractionState()
											clearAnnotationInteractionState()
											clearSourceAnnotationInteractionState()
											handleAnnotationSelection(annotation.id, hasSelectionModifier(event))
											setSelectedSourceAnnotationId(null)
										}}
										type="button"
									>
										<strong>{annotation.text.slice(0, 40) || 'Untitled'}</strong>
										<div className="drawing-item-meta">
											<span>{annotation.kind}</span>
											<span>{annotation.xIn.toFixed(2)}, {annotation.yIn.toFixed(2)}</span>
										</div>
									</button>
								))}
							</div>
						) : (
							<div className="drawing-empty-state">No annotations on this sheet.</div>
						)}
					</section>
				</>
			) : null}

			{activePaletteMode === 'sections' ? (
				<>
					<section className="drawing-panel">
						<div className="drawing-panel-label">Sections</div>
						<div className="drawing-list compact">
							{drawingPackage.sections.map(section => (
								<button
									key={section.id}
									className={`drawing-list-item ${section.id === drawingPackage.activeSectionId ? 'active' : ''}`}
									onClick={() => handleSelectSection(section.id)}
									type="button"
								>
									<strong>{section.markerLabel} · {section.name}</strong>
									<div className="drawing-item-meta">
										<span>{section.clipMode}</span>
										<span>{section.depthFt.toFixed(1)} ft</span>
										{sectionViewMap.get(section.id) ? <span>{sectionViewMap.get(section.id)?.name}</span> : null}
										{activeDrawingSectionId === section.id ? <span>Live</span> : null}
									</div>
								</button>
							))}
						</div>
						<div className="drawing-panel-actions split">
							<button className="drawing-action-btn accent" disabled={!canCreateSectionLinkedView} onClick={handleCreateLinkedViewFromSection} type="button">
								<Plus size={14} /> Linked View
							</button>
							<button className="drawing-action-btn" disabled={!canActivateSectionInModel} onClick={() => handleActivateSectionInModel()} type="button">
								Show Cut
							</button>
						</div>
					</section>
				</>
			) : null}
		</aside>
	)
}
