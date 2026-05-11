/**
 * DrawingInspector — Right-side property inspector panel for the Drawings workspace.
 * Extracted from DrawingsWorkspace.tsx as part of CAD-style decomposition.
 *
 * Contains:
 *  - Viewport Inspector (placement, alignment, sizing)
 *  - Source View Authoring (source canvas + source annotations)
 *  - Annotation Inspector (text, kind, leader)
 *  - Source Annotation Inspector (source-space marks)
 */
import { Plus, Trash2 } from 'lucide-react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { DerivedScaffoldGeometry } from '../scaffold/bomDerivation'
import type { useTool } from '../../contexts/ToolContext'
import type {
	DrawingAnnotation,
	DrawingAnnotationKind,
	DrawingDisplayPreset,
	DrawingSavedView,
	DrawingSectionDefinition,
	DrawingSheet,
	DrawingSourceAnnotation,
	DrawingSourceAnnotationKind,
	DrawingViewport,
} from '../../drawings/drawingDocument'
import {
	formatAuthoringSourceLabel,
	formatProjectionLabel,
	formatSheetReferenceList,
	formatSourceAnnotationKindLabel,
	formatViewportKindLabel,
	formatViewportReference,
	MIN_VIEWPORT_HEIGHT_IN,
	MIN_VIEWPORT_WIDTH_IN,
	SHEET_ALIGNMENT_ACTIONS,
	type SheetAlignmentAction,
} from './drawingConstants'

// Lazy-import to avoid circular deps — the canvas is defined in DrawingsWorkspace
import { DrawingSourceViewCanvas } from './DrawingSourceViewCanvas'

export interface DrawingInspectorProps {
	/* ── Viewport Inspector ── */
	selectedViewport: DrawingViewport | undefined
	selectedViewportView: DrawingSavedView | undefined
	selectedViewportSection: DrawingSectionDefinition | undefined
	displayedViewports: DrawingViewport[]
	activeSheet: DrawingSheet | undefined

	/* ── Selection summary ── */
	hasViewportSelectionSummary: boolean
	hasAnnotationSelectionSummary: boolean
	selectedViewportCount: number
	selectedAnnotationCount: number
	selectedSheetItemCount: number

	/* ── Source View Authoring ── */
	activeView: DrawingSavedView | undefined
	activeSourceSection: DrawingSectionDefinition | null
	activeSourceDisplayPreset: DrawingDisplayPreset | null
	sourceCanvasRef: React.MutableRefObject<HTMLDivElement | null>
	displayedSourceAnnotations: DrawingSourceAnnotation[]
	selectedSourceAnnotationId: string | null
	sourceAnnotationDragSession: { annotationId: string } | null
	objects: ReturnType<typeof useTool>['objects']
	scaffoldGeometry: DerivedScaffoldGeometry
	viewSheetNumbersMap: ReadonlyMap<string, string[]>

	/* ── Annotation Inspector ── */
	selectedAnnotation: DrawingAnnotation | undefined

	/* ── Source Annotation Inspector ── */
	selectedSourceAnnotation: DrawingSourceAnnotation | undefined

	/* ── Handlers ── */
	onViewportPlacementChange: (viewportId: string, field: 'xIn' | 'yIn' | 'widthIn' | 'heightIn', rawValue: string) => void
	onViewportContentOffsetChange: (viewportId: string, field: 'contentOffsetXIn' | 'contentOffsetYIn', rawValue: string) => void
	onViewportAlignToSheet: (viewportId: string, action: SheetAlignmentAction) => void
	onResetViewportFraming: (viewportId: string) => void
	onDeleteViewport: (viewportId: string) => void
	onAnnotationTextChange: (id: string, text: string) => void
	onAnnotationKindChange: (id: string, kind: DrawingAnnotationKind) => void
	onAnnotationPlacementChange: (id: string, field: 'xIn' | 'yIn' | 'widthIn', rawValue: string) => void
	onAnnotationLeaderChange: (id: string, axis: 'xIn' | 'yIn', rawValue: string) => void
	onAnnotationAlignToSheet: (id: string, action: SheetAlignmentAction) => void
	onDeleteAnnotation: (id: string) => void
	onSourceAnnotationTextChange: (id: string, text: string) => void
	onSourceAnnotationPlacementChange: (id: string, field: 'x' | 'y' | 'width', rawValue: string) => void
	onSourceAnnotationTargetChange: (id: string, axis: 'x' | 'y', rawValue: string) => void
	onDeleteSourceAnnotation: (id: string) => void
	onAddSourceAnnotation: (kind: DrawingSourceAnnotationKind) => void
	onSelectSourceAnnotation: (id: string | null) => void
	onClearViewportInteraction: () => void
	onClearAnnotationInteraction: () => void
	onClearSourceAnnotationInteraction: () => void
	onClearSheetSelection: () => void
	onBeginSourceNoteDrag: (event: ReactPointerEvent<HTMLButtonElement>, annotation: DrawingSourceAnnotation) => void
	onBeginSourceDimensionDrag: (event: ReactPointerEvent<SVGElement>, annotation: DrawingSourceAnnotation) => void
	onBeginSourceDimensionHandleDrag: (event: ReactPointerEvent<SVGElement>, annotation: DrawingSourceAnnotation, kind: 'dimension-start' | 'dimension-end') => void
}

export function DrawingInspector(props: DrawingInspectorProps) {
	const {
		selectedViewport, selectedViewportView, selectedViewportSection,
		displayedViewports, activeSheet,
		hasViewportSelectionSummary, hasAnnotationSelectionSummary,
		selectedViewportCount, selectedAnnotationCount, selectedSheetItemCount,
		activeView, activeSourceSection, activeSourceDisplayPreset,
		sourceCanvasRef, displayedSourceAnnotations, selectedSourceAnnotationId,
		sourceAnnotationDragSession, objects, scaffoldGeometry, viewSheetNumbersMap,
		selectedAnnotation, selectedSourceAnnotation,
		onViewportPlacementChange, onViewportContentOffsetChange, onViewportAlignToSheet,
		onResetViewportFraming, onDeleteViewport,
		onAnnotationTextChange, onAnnotationKindChange, onAnnotationPlacementChange,
		onAnnotationLeaderChange, onAnnotationAlignToSheet, onDeleteAnnotation,
		onSourceAnnotationTextChange, onSourceAnnotationPlacementChange,
		onSourceAnnotationTargetChange, onDeleteSourceAnnotation,
		onAddSourceAnnotation, onSelectSourceAnnotation,
		onClearViewportInteraction, onClearAnnotationInteraction,
		onClearSourceAnnotationInteraction, onClearSheetSelection,
		onBeginSourceNoteDrag, onBeginSourceDimensionDrag, onBeginSourceDimensionHandleDrag,
	} = props

	const clearAll = () => {
		onClearViewportInteraction()
		onClearAnnotationInteraction()
		onClearSourceAnnotationInteraction()
		onClearSheetSelection()
	}

	return (
		<aside className="drawing-shell-chrome drawing-rail right">
			{/* ── Viewport Inspector ── */}
			<section className="drawing-panel">
				<div className="drawing-panel-label">Viewport Inspector</div>
				{selectedViewport ? (
					<>
						<h3>{selectedViewport.title}</h3>
						<p className="drawing-panel-subtle">Resize the paper-space box, pan the framing inside it, or type exact placement values for a Chief-style layout workflow.</p>
						<ul className="drawing-metrics">
							<li><span>Reference</span><strong>{activeSheet ? formatViewportReference((displayedViewports.findIndex(viewport => viewport.id === selectedViewport.id) + 1), activeSheet.number) : '—'}</strong></li>
							<li><span>View</span><strong>{selectedViewportView?.name ?? 'Missing view'}</strong></li>
							<li><span>Type</span><strong>{formatViewportKindLabel(selectedViewportView?.kind)}</strong></li>
							<li><span>Cut</span><strong>{selectedViewportSection?.markerLabel ? `Cut ${selectedViewportSection.markerLabel}` : '—'}</strong></li>
							<li><span>Placement</span><strong>{selectedViewport.placementMode}</strong></li>
							<li><span>Scale</span><strong>{selectedViewport.scaleLabel}</strong></li>
						</ul>
						<div className="drawing-form-stack">
						  <div className="drawing-input-grid">
							<label className="drawing-field">
							  <span>X (in)</span>
							  <input className="drawing-input" onChange={event => onViewportPlacementChange(selectedViewport.id, 'xIn', event.target.value)} step="0.1" type="number" value={selectedViewport.xIn} />
							</label>
							<label className="drawing-field">
							  <span>Y (in)</span>
							  <input className="drawing-input" onChange={event => onViewportPlacementChange(selectedViewport.id, 'yIn', event.target.value)} step="0.1" type="number" value={selectedViewport.yIn} />
							</label>
						  </div>
						  <div className="drawing-input-grid">
							<label className="drawing-field">
							  <span>Width (in)</span>
							  <input className="drawing-input" min={MIN_VIEWPORT_WIDTH_IN} onChange={event => onViewportPlacementChange(selectedViewport.id, 'widthIn', event.target.value)} step="0.1" type="number" value={selectedViewport.widthIn} />
							</label>
							<label className="drawing-field">
							  <span>Height (in)</span>
							  <input className="drawing-input" min={MIN_VIEWPORT_HEIGHT_IN} onChange={event => onViewportPlacementChange(selectedViewport.id, 'heightIn', event.target.value)} step="0.1" type="number" value={selectedViewport.heightIn} />
							</label>
						  </div>
						  <div className="drawing-input-grid">
							<label className="drawing-field">
							  <span>Content X (in)</span>
							  <input className="drawing-input" onChange={event => onViewportContentOffsetChange(selectedViewport.id, 'contentOffsetXIn', event.target.value)} step="0.1" type="number" value={selectedViewport.contentOffsetXIn} />
							</label>
							<label className="drawing-field">
							  <span>Content Y (in)</span>
							  <input className="drawing-input" onChange={event => onViewportContentOffsetChange(selectedViewport.id, 'contentOffsetYIn', event.target.value)} step="0.1" type="number" value={selectedViewport.contentOffsetYIn} />
							</label>
						  </div>
							  <div>
								<div className="drawing-panel-subtle">Align this layout box to printable margins or sheet centerlines.</div>
								<div className="drawing-layout-action-grid">
								  {SHEET_ALIGNMENT_ACTIONS.map(entry => (
									<button className="drawing-action-btn" key={entry.action} onClick={() => onViewportAlignToSheet(selectedViewport.id, entry.action)} type="button">
									  <span>{entry.label}</span>
									</button>
								  ))}
								</div>
							  </div>
						</div>
						<div className="drawing-panel-actions split">
						  <button className="drawing-action-btn" onClick={() => onResetViewportFraming(selectedViewport.id)} type="button">
							<span>Recenter framing</span>
						  </button>
						  <button className="drawing-action-btn" onClick={() => {
							onClearViewportInteraction()
							onClearSheetSelection()
						  }} type="button">
							<span>Clear selection</span>
						  </button>
						</div>
						<div className="drawing-panel-actions">
						  <button className="drawing-action-btn danger" onClick={() => onDeleteViewport(selectedViewport.id)} type="button">
							<Trash2 size={16} />
							<span>Delete viewport</span>
						  </button>
						</div>
					</>
				) : hasViewportSelectionSummary ? (
					<>
						<h3>{selectedViewportCount === 1 ? 'Viewport included in multi-selection' : `${selectedViewportCount} viewports selected`}</h3>
						<p className="drawing-panel-subtle">Sheet multi-selection is active. Detailed viewport controls return when exactly one sheet item is focused.</p>
						<ul className="drawing-metrics">
						  <li><span>Selected viewports</span><strong>{selectedViewportCount}</strong></li>
						  <li><span>Selected annotations</span><strong>{selectedAnnotationCount}</strong></li>
						  <li><span>Total sheet items</span><strong>{selectedSheetItemCount}</strong></li>
						</ul>
						<div className="drawing-empty-state">
						  Use Ctrl/Cmd-click to add or remove placed views. Drag, resize, and pan still collapse to the focused viewport for this phase.
						</div>
						<div className="drawing-panel-actions">
						  <button className="drawing-action-btn" onClick={() => {
							onClearViewportInteraction()
							onClearAnnotationInteraction()
							onClearSheetSelection()
						  }} type="button">
							<span>Clear selection</span>
						  </button>
						</div>
					</>
				) : (
					<div className="drawing-empty-state">
						Select a placed viewport on the active sheet to resize it, pan its framing, or type exact box dimensions.
					</div>
				)}
			</section>

			{/* ── Source View Authoring ── */}
			<section className="drawing-panel">
				<div className="drawing-panel-label">Source View Authoring</div>
				<h3>{activeView?.name ?? 'No active view'}</h3>
				{activeView ? (
					<>
						<p className="drawing-panel-subtle">
						  Author notes and simple dimensions in the saved view itself. Every sheet viewport referencing this view inherits the same source-space marks.
						</p>
						<ul className="drawing-metrics">
						  <li><span>Type</span><strong>{formatViewportKindLabel(activeView.kind)}</strong></li>
						  <li><span>Projection</span><strong>{formatProjectionLabel(activeView.projection)}</strong></li>
						  <li><span>Source</span><strong>{formatAuthoringSourceLabel(activeView.authoringSource)}</strong></li>
						  <li><span>Placed On</span><strong>{formatSheetReferenceList(viewSheetNumbersMap.get(activeView.id) ?? [])}</strong></li>
						</ul>
						<DrawingSourceViewCanvas
							canvasRef={sourceCanvasRef}
							view={activeView}
							section={activeSourceSection}
							displayPreset={activeSourceDisplayPreset}
							objects={objects}
							scaffoldGeometry={scaffoldGeometry}
							sourceAnnotations={displayedSourceAnnotations}
							selectedSourceAnnotationId={selectedSourceAnnotationId}
							draggingAnnotationId={sourceAnnotationDragSession?.annotationId ?? null}
							onBackgroundPointerDown={clearAll}
							onNotePointerDown={onBeginSourceNoteDrag}
							onDimensionPointerDown={onBeginSourceDimensionDrag}
							onDimensionStartHandlePointerDown={(event, annotation) => onBeginSourceDimensionHandleDrag(event, annotation, 'dimension-start')}
							onDimensionEndHandlePointerDown={(event, annotation) => onBeginSourceDimensionHandleDrag(event, annotation, 'dimension-end')}
						/>
						<div className="drawing-panel-subtle drawing-source-view-hint">
							Drag notes, dimension lines, or dimension endpoints directly in source space. Updates feed every placed viewport tied to this view.
						</div>
						{displayedSourceAnnotations.length > 0 ? (
						  <div className="drawing-list compact">
							{displayedSourceAnnotations.map(annotation => (
							  <button
								key={annotation.id}
								className={`drawing-list-item ${annotation.id === selectedSourceAnnotationId ? 'active' : ''}`}
								onClick={() => {
									clearAll()
									onSelectSourceAnnotation(annotation.id)
								}}
								type="button"
							  >
								<span>{formatSourceAnnotationKindLabel(annotation.kind)}</span>
								<strong>{annotation.text.slice(0, 44) || 'Untitled source annotation'}</strong>
								<div className="drawing-item-meta">
								  <span>{annotation.x.toFixed(1)}%</span>
								  <span>{annotation.y.toFixed(1)}%</span>
								  {annotation.kind === 'note' ? <span>{annotation.width.toFixed(1)}% wide</span> : null}
								</div>
							  </button>
							))}
						  </div>
						) : (
						  <div className="drawing-empty-state">
							No source notes or dimensions yet. Add them here, then send or move the viewports on sheets independently.
						  </div>
						)}
						<div className="drawing-panel-actions split">
						  <button className="drawing-action-btn" onClick={() => onAddSourceAnnotation('note')} type="button">
							<Plus size={16} />
							<span>Add source note</span>
						  </button>
						  <button className="drawing-action-btn" onClick={() => onAddSourceAnnotation('dimension')} type="button">
							<Plus size={16} />
							<span>Add dimension</span>
						  </button>
						</div>
					</>
				) : (
					<div className="drawing-empty-state">
						Select or create a saved view from the live model before authoring source annotations.
					</div>
				)}
			</section>

			{/* ── Annotation Inspector ── */}
			<section className="drawing-panel">
				<div className="drawing-panel-label">Annotation Inspector</div>
				{selectedAnnotation ? (
					<>
						<h3>{selectedAnnotation.kind === 'callout' ? 'Callout' : 'Note'} · {selectedAnnotation.id.slice(0, 8)}</h3>
						<p className="drawing-panel-subtle">Click an annotation to select it. Drag the note box to reposition it and drag the callout dot to retarget the leader.</p>
						<div className="drawing-form-stack">
						  <label className="drawing-field">
							<span>Text</span>
							<textarea
							  className="drawing-textarea"
							  onChange={event => onAnnotationTextChange(selectedAnnotation.id, event.target.value)}
							  rows={4}
							  value={selectedAnnotation.text}
							/>
						  </label>
						  <label className="drawing-field">
							<span>Kind</span>
							<select className="drawing-select" onChange={event => onAnnotationKindChange(selectedAnnotation.id, event.target.value as DrawingAnnotationKind)} value={selectedAnnotation.kind}>
							  <option value="text">Text note</option>
							  <option value="callout">Callout</option>
							</select>
						  </label>
						  <div className="drawing-input-grid">
							<label className="drawing-field">
							  <span>X (in)</span>
							  <input className="drawing-input" onChange={event => onAnnotationPlacementChange(selectedAnnotation.id, 'xIn', event.target.value)} step="0.1" type="number" value={selectedAnnotation.xIn} />
							</label>
							<label className="drawing-field">
							  <span>Y (in)</span>
							  <input className="drawing-input" onChange={event => onAnnotationPlacementChange(selectedAnnotation.id, 'yIn', event.target.value)} step="0.1" type="number" value={selectedAnnotation.yIn} />
							</label>
							<label className="drawing-field">
							  <span>Width (in)</span>
							  <input className="drawing-input" onChange={event => onAnnotationPlacementChange(selectedAnnotation.id, 'widthIn', event.target.value)} step="0.1" type="number" value={selectedAnnotation.widthIn} />
							</label>
						  </div>
						  {selectedAnnotation.kind === 'callout' ? (
							<div className="drawing-input-grid">
							  <label className="drawing-field">
								<span>Leader X (in)</span>
								<input className="drawing-input" onChange={event => onAnnotationLeaderChange(selectedAnnotation.id, 'xIn', event.target.value)} step="0.1" type="number" value={selectedAnnotation.leaderTo?.xIn ?? selectedAnnotation.xIn} />
							  </label>
							  <label className="drawing-field">
								<span>Leader Y (in)</span>
								<input className="drawing-input" onChange={event => onAnnotationLeaderChange(selectedAnnotation.id, 'yIn', event.target.value)} step="0.1" type="number" value={selectedAnnotation.leaderTo?.yIn ?? selectedAnnotation.yIn} />
							  </label>
							</div>
						  ) : null}
							  <div>
								<div className="drawing-panel-subtle">Align the selected note box to printable margins or sheet centerlines.</div>
								<div className="drawing-layout-action-grid">
								  {SHEET_ALIGNMENT_ACTIONS.map(entry => (
									<button className="drawing-action-btn" key={entry.action} onClick={() => onAnnotationAlignToSheet(selectedAnnotation.id, entry.action)} type="button">
									  <span>{entry.label}</span>
									</button>
								  ))}
								</div>
							  </div>
						</div>
						<div className="drawing-panel-actions">
						  <button className="drawing-action-btn" onClick={() => {
							onClearAnnotationInteraction()
							onClearSheetSelection()
						  }} type="button">
							<span>Clear selection</span>
						  </button>
						  <button className="drawing-action-btn danger" onClick={() => onDeleteAnnotation(selectedAnnotation.id)} type="button">
							<Trash2 size={16} />
							<span>Delete annotation</span>
						  </button>
						</div>
					</>
				) : hasAnnotationSelectionSummary ? (
					<>
						<h3>{selectedAnnotationCount === 1 ? 'Annotation included in multi-selection' : `${selectedAnnotationCount} annotations selected`}</h3>
						<p className="drawing-panel-subtle">Sheet multi-selection is active. Detailed annotation fields return when exactly one sheet item is selected.</p>
						<ul className="drawing-metrics">
						  <li><span>Selected annotations</span><strong>{selectedAnnotationCount}</strong></li>
						  <li><span>Selected viewports</span><strong>{selectedViewportCount}</strong></li>
						  <li><span>Total sheet items</span><strong>{selectedSheetItemCount}</strong></li>
						</ul>
						<div className="drawing-empty-state">
						  Use Ctrl/Cmd-click to build a sheet-space selection set. Annotation dragging still focuses a single note or callout before moving it.
						</div>
						<div className="drawing-panel-actions">
						  <button className="drawing-action-btn" onClick={() => {
							onClearViewportInteraction()
							onClearAnnotationInteraction()
							onClearSheetSelection()
						  }} type="button">
							<span>Clear selection</span>
						  </button>
						</div>
					</>
				) : (
					<div className="drawing-empty-state">
						Select a note or callout on the sheet to edit its text, position, width, and leader target.
					</div>
				)}
			</section>

			{/* ── Source Annotation Inspector ── */}
			<section className="drawing-panel">
				<div className="drawing-panel-label">Source Annotation Inspector</div>
				{selectedSourceAnnotation ? (
					<>
						<h3>{formatSourceAnnotationKindLabel(selectedSourceAnnotation.kind)} · {selectedSourceAnnotation.id.slice(0, 8)}</h3>
						<p className="drawing-panel-subtle">These marks live on the source view and appear in every placed viewport that references it.</p>
						<div className="drawing-form-stack">
						  <label className="drawing-field">
							<span>Label / text</span>
							<textarea
							  className="drawing-textarea"
							  onChange={event => onSourceAnnotationTextChange(selectedSourceAnnotation.id, event.target.value)}
							  rows={3}
							  value={selectedSourceAnnotation.text}
							/>
						  </label>
						  <div className="drawing-input-grid">
							<label className="drawing-field">
							  <span>{selectedSourceAnnotation.kind === 'dimension' ? 'Start X (%)' : 'X (%)'}</span>
							  <input className="drawing-input" onChange={event => onSourceAnnotationPlacementChange(selectedSourceAnnotation.id, 'x', event.target.value)} step="1" type="number" value={selectedSourceAnnotation.x} />
							</label>
							<label className="drawing-field">
							  <span>{selectedSourceAnnotation.kind === 'dimension' ? 'Start Y (%)' : 'Y (%)'}</span>
							  <input className="drawing-input" onChange={event => onSourceAnnotationPlacementChange(selectedSourceAnnotation.id, 'y', event.target.value)} step="1" type="number" value={selectedSourceAnnotation.y} />
							</label>
							{selectedSourceAnnotation.kind === 'note' ? (
							  <label className="drawing-field">
								<span>Width (%)</span>
								<input className="drawing-input" onChange={event => onSourceAnnotationPlacementChange(selectedSourceAnnotation.id, 'width', event.target.value)} step="1" type="number" value={selectedSourceAnnotation.width} />
							  </label>
							) : null}
						  </div>
						  {selectedSourceAnnotation.kind === 'dimension' ? (
							<div className="drawing-input-grid">
							  <label className="drawing-field">
								<span>End X (%)</span>
								<input className="drawing-input" onChange={event => onSourceAnnotationTargetChange(selectedSourceAnnotation.id, 'x', event.target.value)} step="1" type="number" value={selectedSourceAnnotation.target?.x ?? selectedSourceAnnotation.x} />
							  </label>
							  <label className="drawing-field">
								<span>End Y (%)</span>
								<input className="drawing-input" onChange={event => onSourceAnnotationTargetChange(selectedSourceAnnotation.id, 'y', event.target.value)} step="1" type="number" value={selectedSourceAnnotation.target?.y ?? selectedSourceAnnotation.y} />
							  </label>
							</div>
						  ) : null}
						</div>
						<div className="drawing-panel-actions">
						  <button className="drawing-action-btn" onClick={() => onSelectSourceAnnotation(null)} type="button">
							<span>Clear selection</span>
						  </button>
						  <button className="drawing-action-btn danger" onClick={() => onDeleteSourceAnnotation(selectedSourceAnnotation.id)} type="button">
							<Trash2 size={16} />
							<span>Delete source annotation</span>
						  </button>
						</div>
					</>
				) : (
					<div className="drawing-empty-state">
						Select a source note or dimension from the active saved view to edit the overlay that appears inside its placed sheet viewports.
					</div>
				)}
			</section>
		</aside>
	)
}

