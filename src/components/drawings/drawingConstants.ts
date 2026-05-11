/**
 * Shared types, constants, and formatting utilities for the Drawings workspace.
 * CAD-style tool family configuration for Fusion 360 / Onshape interaction model.
 */
import type {
	DrawingSavedView,
	DrawingSheetTitleBlockText,
	DrawingSourceAnnotationKind,
} from '../../drawings/drawingDocument'

// ── Shared Types ──────────────────────────────────────────────────────────────

export type SheetAlignmentAction = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom'
export type TopbarMenuId = 'file' | 'edit' | 'sheet' | 'insert' | 'view' | 'annotate' | 'sections'
export type PaletteMode = 'sheet' | 'insert' | 'view' | 'annotate' | 'sections'
export type TitleBlockTextFieldKey = keyof DrawingSheetTitleBlockText
export type TitleBlockEditableFieldId = TitleBlockTextFieldKey | 'sheetNumberValue' | 'sheetName'

export type TitleBlockEditorState = {
	fieldId: TitleBlockEditableFieldId
	label: string
	value: string
}

// ── CAD Tool System ──────────────────────────────────────────────────────────

export type ToolFamilyId = 'file' | 'edit' | 'sheet' | 'viewports' | 'annotate' | 'dimensions' | 'sections' | 'view' | 'snap'

export type DrawingToolId =
	// File
	| 'back-to-jobs' | 'open-model' | 'open-tasks' | 'print'
	// Edit
	| 'undo' | 'redo' | 'clear-selection' | 'delete-selected'
	// Sheet
	| 'new-sheet' | 'duplicate-sheet' | 'delete-sheet'
	// Viewports
	| 'place-plan' | 'place-elevation' | 'place-section' | 'place-detail' | 'place-iso' | 'place-saved-view'
	// Annotate
	| 'leader-note' | 'rich-text' | 'plain-text' | 'callout' | 'marker' | 'note'
	// Dimensions
	| 'dim-linear' | 'dim-aligned' | 'dim-angular' | 'dim-baseline' | 'dim-continuous' | 'dim-elevation'
	// Sections
	| 'create-linked-view' | 'show-cut-in-model'
	// View
	| 'pan' | 'zoom' | 'fit' | 'grid-toggle'
	// Snap
	| 'snap-endpoint' | 'snap-midpoint' | 'snap-intersection' | 'snap-center' | 'snap-grid'

export type CommandPhase = 'idle' | 'preview' | 'placement' | 'editing'
export type CursorMode = 'default' | 'crosshair' | 'move' | 'text' | 'grab'

export type DrawingTool = {
	id: DrawingToolId
	label: string
	icon: string
	shortcut?: string
	/** If true, this is a toggle tool (snap toggles) rather than a command */
	toggle?: boolean
}

export type ToolFamily = {
	id: ToolFamilyId
	label: string
	tools: DrawingTool[]
}

export type SnapMode = 'snap-endpoint' | 'snap-midpoint' | 'snap-intersection' | 'snap-center' | 'snap-grid'

export type DrawingToolState = {
	activeFamily: ToolFamilyId
	activeTool: DrawingToolId | null
	cursorMode: CursorMode
	commandPhase: CommandPhase
	/** Active snap modes (toggles) */
	activeSnaps: Set<SnapMode>
	/** Whether the drafting grid overlay is visible */
	gridVisible: boolean
}

export const TOOL_FAMILIES: ToolFamily[] = [
	{
		id: 'file', label: 'File', tools: [
			{ id: 'back-to-jobs', label: 'Back to Jobs', icon: 'arrow-left' },
			{ id: 'open-model', label: 'Open Model', icon: 'box' },
			{ id: 'open-tasks', label: 'Open Tasks', icon: 'kanban' },
			{ id: 'print', label: 'Print / PDF', icon: 'printer' },
		],
	},
	{
		id: 'edit', label: 'Edit', tools: [
			{ id: 'undo', label: 'Undo', icon: 'undo', shortcut: 'Ctrl+Z' },
			{ id: 'redo', label: 'Redo', icon: 'redo', shortcut: 'Ctrl+Y' },
			{ id: 'clear-selection', label: 'Clear Selection', icon: 'x' },
			{ id: 'delete-selected', label: 'Delete', icon: 'trash' },
		],
	},
	{
		id: 'sheet', label: 'Sheet', tools: [
			{ id: 'new-sheet', label: 'New Sheet', icon: 'file-plus' },
			{ id: 'duplicate-sheet', label: 'Duplicate', icon: 'copy' },
		],
	},
	{
		id: 'viewports', label: 'Viewports', tools: [
			{ id: 'place-plan', label: 'Plan View', icon: 'square' },
			{ id: 'place-elevation', label: 'Elevation', icon: 'align-vertical-justify-start' },
			{ id: 'place-section', label: 'Section', icon: 'scissors' },
			{ id: 'place-detail', label: 'Detail', icon: 'scan' },
			{ id: 'place-iso', label: 'ISO', icon: 'rotate-3d' },
			{ id: 'place-saved-view', label: 'Saved View', icon: 'image' },
		],
	},
	{
		id: 'annotate', label: 'Annotate', tools: [
			{ id: 'leader-note', label: 'Leader Note', icon: 'message-square' },
			{ id: 'rich-text', label: 'Rich Text', icon: 'type' },
			{ id: 'plain-text', label: 'Plain Text', icon: 'align-left' },
			{ id: 'callout', label: 'Callout', icon: 'megaphone' },
			{ id: 'marker', label: 'Marker', icon: 'map-pin' },
			{ id: 'note', label: 'Note', icon: 'sticky-note' },
		],
	},
	{
		id: 'dimensions', label: 'Dimensions', tools: [
			{ id: 'dim-linear', label: 'Linear', icon: 'move-horizontal' },
			{ id: 'dim-aligned', label: 'Aligned', icon: 'move-diagonal' },
			{ id: 'dim-angular', label: 'Angular', icon: 'corner-up-right' },
			{ id: 'dim-baseline', label: 'Baseline', icon: 'git-branch' },
			{ id: 'dim-continuous', label: 'Continuous', icon: 'git-merge' },
			{ id: 'dim-elevation', label: 'Elevation Marker', icon: 'triangle' },
		],
	},
	{
		id: 'sections', label: 'Sections', tools: [
			{ id: 'create-linked-view', label: 'Linked View', icon: 'link' },
			{ id: 'show-cut-in-model', label: 'Show in Model', icon: 'external-link' },
		],
	},
	{
		id: 'view', label: 'View', tools: [
			{ id: 'pan', label: 'Pan', icon: 'move' },
			{ id: 'zoom', label: 'Zoom', icon: 'zoom-in' },
			{ id: 'fit', label: 'Fit All', icon: 'maximize' },
			{ id: 'grid-toggle', label: 'Grid', icon: 'grid', toggle: true },
		],
	},
	{
		id: 'snap', label: 'Snap', tools: [
			{ id: 'snap-endpoint', label: 'Endpoint', icon: 'circle-dot', toggle: true },
			{ id: 'snap-midpoint', label: 'Midpoint', icon: 'git-commit', toggle: true },
			{ id: 'snap-intersection', label: 'Intersection', icon: 'crosshair', toggle: true },
			{ id: 'snap-center', label: 'Center', icon: 'target', toggle: true },
			{ id: 'snap-grid', label: 'Grid', icon: 'hash', toggle: true },
		],
	},
]

export const TOOL_FAMILY_MAP = new Map(TOOL_FAMILIES.map(f => [f.id, f]))

export function getDefaultToolState(): DrawingToolState {
	return {
		activeFamily: 'sheet',
		activeTool: null,
		cursorMode: 'default',
		commandPhase: 'idle',
		activeSnaps: new Set<SnapMode>(['snap-endpoint', 'snap-grid']),
		gridVisible: false,
	}
}

// ── Legacy Palette Config (kept for backward compat) ─────────────────────────

export const DRAWING_PALETTE_TABS: Array<{ id: PaletteMode; label: string }> = [
	{ id: 'sheet', label: 'Sheet' },
	{ id: 'insert', label: 'Insert' },
	{ id: 'view', label: 'Views' },
	{ id: 'annotate', label: 'Annotate' },
	{ id: 'sections', label: 'Sections' },
]

export const DRAWING_PALETTE_COPY: Record<PaletteMode, { title: string; description: string }> = {
	sheet: {
		title: 'Layout browser',
		description: 'Browse sheets, swap templates, and review the active layout package like a desktop CAD navigator.',
	},
	insert: {
		title: 'Viewport insertion',
		description: 'Choose a saved view, make it active, and place it onto the current sheet without hunting through the inspector.',
	},
	view: {
		title: 'Saved views',
		description: 'Capture, refresh, and reopen source views so the sheet package stays coordinated with model space.',
	},
	annotate: {
		title: 'Paper-space annotation',
		description: 'Add notes and callouts to the active sheet while keeping annotation work grouped in one palette.',
	},
	sections: {
		title: 'Section workflow',
		description: 'Manage linked cuts, authored section views, and model coordination from one dedicated palette.',
	},
}

/** Maps a ToolFamilyId to its corresponding PaletteMode for the left panel */
export function paletteModeForFamily(familyId: ToolFamilyId): PaletteMode | null {
	switch (familyId) {
		case 'sheet': return 'sheet'
		case 'viewports': return 'insert'
		case 'view': return 'view'
		case 'annotate': return 'annotate'
		case 'dimensions': return 'annotate'
		case 'sections': return 'sections'
		default: return null
	}
}

// ── Layout Constants ──────────────────────────────────────────────────────────

export const MIN_VIEWPORT_WIDTH_IN = 1.50
export const MIN_VIEWPORT_HEIGHT_IN = 1.00
export const APPROX_ANNOTATION_HEIGHT_IN = 0.8
export const LAYOUT_SNAP_THRESHOLD_IN = 0.18
export const SHEET_MARQUEE_DRAG_THRESHOLD_PX = 4

export const FIRST_PAGE_FOOTER_SLOT_CLASSES = ['left', 'center', 'right'] as const

export const SHEET_ALIGNMENT_ACTIONS: ReadonlyArray<{ action: SheetAlignmentAction; label: string }> = [
	{ action: 'left', label: 'Left' },
	{ action: 'center-x', label: 'Center X' },
	{ action: 'right', label: 'Right' },
	{ action: 'top', label: 'Top' },
	{ action: 'center-y', label: 'Center Y' },
	{ action: 'bottom', label: 'Bottom' },
]

// ── Formatting Functions ──────────────────────────────────────────────────────

export function getPaletteModeForMenu(menuId: TopbarMenuId): PaletteMode | null {
	switch (menuId) {
		case 'sheet': return 'sheet'
		case 'insert': return 'insert'
		case 'view': return 'view'
		case 'annotate': return 'annotate'
		case 'sections': return 'sections'
		default: return null
	}
}

export function formatViewportKindLabel(kind: DrawingSavedView['kind'] | null | undefined): string {
	switch (kind) {
		case 'plan': return 'Plan'
		case 'elevation': return 'Elevation'
		case 'section': return 'Section'
		case 'iso': return 'ISO'
		default: return 'View'
	}
}

export function formatProjectionLabel(projection: 'orthographic' | 'perspective'): string {
	return projection === 'orthographic' ? 'Ortho' : 'Perspective'
}

export function formatSourceAnnotationKindLabel(kind: DrawingSourceAnnotationKind): string {
	return kind === 'dimension' ? 'Dimension' : 'Note'
}

export function formatAuthoringSourceLabel(source: DrawingSavedView['authoringSource'] | null | undefined): string {
	return source === 'section-linked' ? 'Linked cut / elevation' : 'Live model source'
}

export function formatViewportReference(detailNumber: number, sheetNumber: string): string {
	return `${detailNumber}/${sheetNumber}`
}

export function formatSheetReferenceList(sheetNumbers: string[]): string {
	const uniqueSheetNumbers = Array.from(new Set(sheetNumbers))
	if (uniqueSheetNumbers.length === 0) return 'Unplaced'
	if (uniqueSheetNumbers.length <= 3) return uniqueSheetNumbers.join(' · ')
	return `${uniqueSheetNumbers.slice(0, 3).join(' · ')} +${uniqueSheetNumbers.length - 3}`
}

export function formatSavedStamp(date: Date) {
	const now = new Date()
	const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
	return now.toDateString() === date.toDateString() ? time : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

export function formatIssueDate(date: Date | null | undefined): string {
	const value = date ?? new Date()
	return value.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export function renderTitleBlockTextValue(value: string): string {
	return value.trim().length > 0 ? value : ' '
}

