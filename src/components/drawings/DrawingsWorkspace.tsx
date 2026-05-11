import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { useNavigate } from 'react-router-dom'
import { deriveScaffoldGeometry, type DerivedScaffoldGeometry } from '../scaffold/bomDerivation'
import { useCatalogSelection } from '../../contexts/CatalogContext'
import { useProjectSession } from '../../contexts/ProjectSessionContext'
	import { useJobWorkspace } from '../../pm/hooks/useJobWorkspace'
import { useScaffoldBaseSettings } from '../../contexts/ScaffoldBaseSettings'
import { useTool } from '../../contexts/ToolContext'
import { useModelStore } from '../../store/useModelStore'
import { buildViewportRenderData } from '../../drawings/viewportRendering'
import {
	createDefaultDrawingSheetTitleBlockText,
	createDefaultFirstPageFooterSmartText,
	createDrawingEntityId,
	type DrawingAnnotation,
	type DrawingAnnotationKind,
	type DrawingDisplayPreset,
	type DrawingSavedView,
	type DrawingSourceAnnotation,
	type DrawingSourceAnnotationKind,
	type DrawingSectionDefinition,
	type DrawingSheet,
	type DrawingSheetTitleBlockText,
	type DrawingViewport,
} from '../../drawings/drawingDocument'
import { DrawingRibbon } from './DrawingRibbon'
import { DrawingToolPalette } from './DrawingToolPalette'
import { DrawingSourceViewCanvas } from './DrawingSourceViewCanvas'
import { getDefaultToolState, type ToolFamilyId, type DrawingToolId, type DrawingToolState, type SnapMode } from './drawingConstants'
import { computeSheetGeometry, sheetGeometryCSSVars, type Rect } from './SheetGeometry'
import './DrawingsWorkspace.css'

type AnnotationDragSession =
	| {
		kind: 'annotation'
		annotationId: string
		originClientX: number
		originClientY: number
		startXIn: number
		startYIn: number
		widthIn: number
		leaderTo?: { xIn: number; yIn: number }
	  }
	| {
		kind: 'leader'
		annotationId: string
		originClientX: number
		originClientY: number
		startXIn: number
		startYIn: number
		widthIn: number
		leaderTo: { xIn: number; yIn: number }
	  }

type AnnotationDragPreview = {
	annotationId: string
	xIn: number
	yIn: number
	leaderTo?: { xIn: number; yIn: number }
}

type ViewportDragSession = {
	viewportId: string
	originClientX: number
	originClientY: number
	startXIn: number
	startYIn: number
	widthIn: number
	heightIn: number
}

type ViewportDragPreview = {
	viewportId: string
	xIn: number
	yIn: number
}

type ViewportResizeHandle = 'nw' | 'ne' | 'sw' | 'se'

type ViewportResizeSession = {
	viewportId: string
	handle: ViewportResizeHandle
	originClientX: number
	originClientY: number
	startXIn: number
	startYIn: number
	startWidthIn: number
	startHeightIn: number
}

type ViewportResizePreview = {
	viewportId: string
	xIn: number
	yIn: number
	widthIn: number
	heightIn: number
}

type ViewportContentPanSession = {
	viewportId: string
	originClientX: number
	originClientY: number
	startContentOffsetXIn: number
	startContentOffsetYIn: number
	widthIn: number
	heightIn: number
}

type ViewportContentPanPreview = {
	viewportId: string
	contentOffsetXIn: number
	contentOffsetYIn: number
}

type SheetMarqueeSelectionSession = {
	originClientX: number
	originClientY: number
	startXIn: number
	startYIn: number
	baseViewportIds: string[]
	baseAnnotationIds: string[]
	multiSelect: boolean
}

type SheetMarqueeSelectionPreview = {
	currentClientX: number
	currentClientY: number
	currentXIn: number
	currentYIn: number
}

type SheetSelectionBounds = {
	leftIn: number
	topIn: number
	rightIn: number
	bottomIn: number
}

type SourceAnnotationDragSession =
	| {
		kind: 'note'
		annotationId: string
		originClientX: number
		originClientY: number
		startX: number
		startY: number
		width: number
	  }
	| {
		kind: 'dimension'
		annotationId: string
		originClientX: number
		originClientY: number
		startX: number
		startY: number
		startTargetX: number
		startTargetY: number
	  }
	| {
		kind: 'dimension-start'
		annotationId: string
		originClientX: number
		originClientY: number
		startX: number
		startY: number
		startTargetX: number
		startTargetY: number
	  }
	| {
		kind: 'dimension-end'
		annotationId: string
		originClientX: number
		originClientY: number
		startX: number
		startY: number
		startTargetX: number
		startTargetY: number
	  }

type SourceAnnotationDragPreview = {
	annotationId: string
	x: number
	y: number
	target?: { x: number; y: number }
}

type LayoutSnapSubject = 'viewport' | 'annotation'
type LayoutSnapAxis = 'x' | 'y'
type LayoutSnapGuideKind = 'margin' | 'centerline' | 'peer'
type LayoutSnapAnchor = 'start' | 'center' | 'end'

type LayoutSnapGuide = {
	axis: LayoutSnapAxis
	positionIn: number
	kind: LayoutSnapGuideKind
}

type LayoutSnapFeedback = {
	subject: LayoutSnapSubject
	guides: LayoutSnapGuide[]
	xHint: string | null
	yHint: string | null
}

type LayoutSnapLine = {
	positionIn: number
	kind: LayoutSnapGuideKind
	label: string
}

type SheetAlignmentAction = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom'
type ViewportTidyAxis = 'x' | 'y'
type TopbarMenuId = 'file' | 'edit' | 'sheet' | 'insert' | 'view' | 'annotate' | 'sections'
type PaletteMode = 'sheet' | 'insert' | 'view' | 'annotate' | 'sections'
type TitleBlockTextFieldKey = keyof DrawingSheetTitleBlockText
type ViewportTitleFieldId = `viewportTitle:${string}`
type TitleBlockEditableFieldId = TitleBlockTextFieldKey | 'sheetNumberValue' | 'sheetName' | ViewportTitleFieldId

type TitleBlockEditorState = {
	fieldId: TitleBlockEditableFieldId
	label: string
	value: string
}


// getPaletteModeForMenu removed — replaced by paletteModeForFamily in drawingConstants.ts


function hasSelectionModifier(event: { ctrlKey: boolean; metaKey: boolean }) {
	return event.ctrlKey || event.metaKey
}

function isViewportTitleFieldId(fieldId: TitleBlockEditableFieldId): fieldId is ViewportTitleFieldId {
	return fieldId.startsWith('viewportTitle:')
}

function toggleSelectionId(ids: string[], id: string) {
	return ids.includes(id) ? ids.filter(existingId => existingId !== id) : [...ids, id]
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

function formatSavedStamp(date: Date) {
  const now = new Date()
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return now.toDateString() === date.toDateString() ? time : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

function cloneSheet(sheet: DrawingSheet): DrawingSheet {
  return JSON.parse(JSON.stringify(sheet)) as DrawingSheet
}

function getNextSheetNumber(sheets: DrawingSheet[]): string {
	const usedSheetNumbers = new Set(sheets.map(sheet => sheet.number))
	let offset = sheets.length + 1
	let nextSheetNumber = `A${100 + offset}`
	while (usedSheetNumbers.has(nextSheetNumber)) {
		offset += 1
		nextSheetNumber = `A${100 + offset}`
	}
	return nextSheetNumber
}

function formatProjectionLabel(projection: 'orthographic' | 'perspective'): string {
  return projection === 'orthographic' ? 'Ortho' : 'Perspective'
}

function formatViewportKindLabel(kind: DrawingSavedView['kind'] | null | undefined): string {
	switch (kind) {
		case 'plan':
			return 'Plan'
		case 'elevation':
			return 'Elevation'
		case 'section':
			return 'Section'
		case 'iso':
			return 'ISO'
		default:
			return 'View'
	}
}


function formatIssueDate(date: Date | null | undefined): string {
	const value = date ?? new Date()
	return value.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function resolveDrawingSheetTitleBlockText(
	titleBlockText: DrawingSheet['titleBlockText'] | undefined,
	projectName: string,
	issueDateLabel: string,
): DrawingSheetTitleBlockText {
	const defaults = createDefaultDrawingSheetTitleBlockText()
	const next = {
		...defaults,
		...titleBlockText,
	}
	if (next.projectName.trim().length === 0) next.projectName = projectName
	if (next.issuedValue.trim().length === 0) next.issuedValue = issueDateLabel
	return next
}

function renderTitleBlockTextValue(value: string): string {
	return value.trim().length > 0 ? value : ' '
}

function formatViewportReference(detailNumber: number, sheetNumber: string): string {
	return `${detailNumber}/${sheetNumber}`
}


function pointsToSvgPath(points: Array<{ x: number; y: number }>, closed: boolean) {
	if (points.length === 0) return ''
	const commands = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
	return `${commands.join(' ')}${closed ? ' Z' : ''}`
}

function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max)
}

function clampSourceAnnotationWidth(width: number) {
	return clamp(width, 8, 72)
}

function clampSourceNoteX(x: number, width: number) {
	return clamp(x, 2, Math.max(2, 98 - clampSourceAnnotationWidth(width)))
}

function clampSourceNoteY(y: number) {
	return clamp(y, 4, 92)
}

function clampSourceDimensionPoint(value: number) {
	return clamp(value, 2, 98)
}

function translateSourceDimensionPoints(params: {
	x: number
	y: number
	targetX: number
	targetY: number
	deltaX: number
	deltaY: number
}) {
	const { x, y, targetX, targetY, deltaX, deltaY } = params
	const minX = Math.min(x, targetX)
	const maxX = Math.max(x, targetX)
	const minY = Math.min(y, targetY)
	const maxY = Math.max(y, targetY)
	const clampedDeltaX = clamp(deltaX, 2 - minX, 98 - maxX)
	const clampedDeltaY = clamp(deltaY, 2 - minY, 98 - maxY)
	return {
		x: clampSourceDimensionPoint(x + clampedDeltaX),
		y: clampSourceDimensionPoint(y + clampedDeltaY),
		target: {
			x: clampSourceDimensionPoint(targetX + clampedDeltaX),
			y: clampSourceDimensionPoint(targetY + clampedDeltaY),
		},
	}
}

function getDefaultViewportSize(kind: DrawingSavedView['kind']): { widthIn: number; heightIn: number } {
	// Sized to fit within the 8.5 × 11 Letter content area
	switch (kind) {
		case 'plan':
		case 'section':
			return { widthIn: 6.5, heightIn: 5.0 }
		case 'elevation':
			return { widthIn: 6.5, heightIn: 3.5 }
		case 'iso':
		default:
			return { widthIn: 5.5, heightIn: 4.0 }
	}
}

function getPreferredViewportSize(
	view: DrawingSavedView,
	existingViewports: DrawingViewport[],
	viewLookup: ReadonlyMap<string, DrawingSavedView>,
): { widthIn: number; heightIn: number } {
	for (let index = existingViewports.length - 1; index >= 0; index -= 1) {
		const viewport = existingViewports[index]
		if (!viewport) continue
		const existingView = viewLookup.get(viewport.viewId)
		if (existingView?.kind === view.kind) {
			return { widthIn: viewport.widthIn, heightIn: viewport.heightIn }
		}
	}
	return getDefaultViewportSize(view.kind)
}

function getNextViewportPlacement(params: {
	existingViewports: DrawingViewport[]
	contentAreaIn: Rect
	widthIn: number
	heightIn: number
}) {
	const { existingViewports, contentAreaIn: ca, widthIn, heightIn } = params
	const minX = ca.left + 0.3
	const minY = ca.top + 0.25
	const xMax = Math.max(ca.left, ca.right - widthIn)
	const yMax = Math.max(ca.top, ca.bottom - heightIn)
	if (existingViewports.length === 0) {
		return {
			xIn: clamp(minX, ca.left, xMax),
			yIn: clamp(minY, ca.top, yMax),
		}
	}

	const lastViewport = existingViewports[existingViewports.length - 1]!
	const rightX = lastViewport.xIn + lastViewport.widthIn + 0.9
	if (rightX + widthIn <= ca.right) {
		return {
			xIn: rightX,
			yIn: clamp(lastViewport.yIn, ca.top, yMax),
		}
	}

	const belowY = lastViewport.yIn + lastViewport.heightIn + 0.9
	if (belowY + heightIn <= ca.bottom) {
		return {
			xIn: clamp(lastViewport.xIn, ca.left, xMax),
			yIn: belowY,
		}
	}

	const diagonalOffset = Math.min(existingViewports.length, 6) * 0.72
	return {
		xIn: clamp(minX + diagonalOffset, ca.left, xMax),
		yIn: clamp(minY + diagonalOffset, ca.top, yMax),
	}
}

function getCalloutLeaderPoints(annotation: DrawingAnnotation) {
	if (!annotation.leaderTo) return null
	const noteCenterX = annotation.xIn + annotation.widthIn / 2
	const anchorX = annotation.leaderTo.xIn >= noteCenterX ? annotation.xIn + annotation.widthIn : annotation.xIn
	const anchorY = annotation.yIn + 0.52
	return [
		{ x: annotation.leaderTo.xIn, y: annotation.leaderTo.yIn },
		{ x: annotation.leaderTo.xIn, y: anchorY },
		{ x: anchorX, y: anchorY },
	]
}

const MIN_VIEWPORT_WIDTH_IN = 1
const MIN_VIEWPORT_HEIGHT_IN = 0.75
const APPROX_ANNOTATION_HEIGHT_IN = 0.8
const LAYOUT_SNAP_THRESHOLD_IN = 0.18
const SHEET_MARQUEE_DRAG_THRESHOLD_PX = 4

const VIEWPORT_RESIZE_HANDLES: ReadonlyArray<{ key: ViewportResizeHandle; label: string }> = [
	{ key: 'nw', label: 'top left' },
	{ key: 'ne', label: 'top right' },
	{ key: 'sw', label: 'bottom left' },
	{ key: 'se', label: 'bottom right' },
]

const VIEWPORT_SCALE_PRESET_OPTIONS = [
	'NTS',
	'3/4" = 1\'-0"',
	'1/2" = 1\'-0"',
	'3/8" = 1\'-0"',
	'1/4" = 1\'-0"',
	'3/16" = 1\'-0"',
	'1/8" = 1\'-0"',
	'1/16" = 1\'-0"',
] as const

const VIEWPORT_HORIZONTAL_ALIGNMENT_ACTIONS: ReadonlyArray<{
	action: SheetAlignmentAction
	label: string
	shortLabel: string
}> = [
	{ action: 'left', label: 'Align left', shortLabel: 'L' },
	{ action: 'center-x', label: 'Align center horizontally', shortLabel: 'C' },
	{ action: 'right', label: 'Align right', shortLabel: 'R' },
]

const VIEWPORT_VERTICAL_ALIGNMENT_ACTIONS: ReadonlyArray<{
	action: SheetAlignmentAction
	label: string
	shortLabel: string
}> = [
	{ action: 'top', label: 'Align top', shortLabel: 'T' },
	{ action: 'center-y', label: 'Align middle vertically', shortLabel: 'M' },
	{ action: 'bottom', label: 'Align bottom', shortLabel: 'B' },
]

const VIEWPORT_TIDY_ACTIONS: ReadonlyArray<{
	axis: ViewportTidyAxis
	label: string
	shortLabel: string
}> = [
	{ axis: 'x', label: 'Tidy horizontal spacing', shortLabel: 'H' },
	{ axis: 'y', label: 'Tidy vertical spacing', shortLabel: 'V' },
]

function getSheetPointFromClientPosition(params: {
	clientX: number
	clientY: number
	sheetElement: HTMLDivElement
	coordinateSpaceIn: Rect
}) {
	const { clientX, clientY, sheetElement, coordinateSpaceIn } = params
	const rect = sheetElement.getBoundingClientRect()
	if (rect.width <= 0 || rect.height <= 0) return null
	return {
		xIn: clamp(coordinateSpaceIn.left + ((clientX - rect.left) / rect.width) * coordinateSpaceIn.width, coordinateSpaceIn.left, coordinateSpaceIn.right),
		yIn: clamp(coordinateSpaceIn.top + ((clientY - rect.top) / rect.height) * coordinateSpaceIn.height, coordinateSpaceIn.top, coordinateSpaceIn.bottom),
	}
}

function getSheetCoordinateSpaceIn(params: {
	coordinateElement: HTMLDivElement
	contentElement: HTMLDivElement | null
	contentAreaIn: Rect
	templateWidth: number
	templateHeight: number
}): Rect {
	const { coordinateElement, contentElement, contentAreaIn, templateWidth, templateHeight } = params
	if (coordinateElement === contentElement) return contentAreaIn
	return {
		top: 0,
		left: 0,
		width: templateWidth,
		height: templateHeight,
		right: templateWidth,
		bottom: templateHeight,
	}
}

function getCoordinateSpacePercentX(xIn: number, coordinateSpaceIn: Rect) {
	return ((xIn - coordinateSpaceIn.left) / coordinateSpaceIn.width) * 100
}

function getCoordinateSpacePercentY(yIn: number, coordinateSpaceIn: Rect) {
	return ((yIn - coordinateSpaceIn.top) / coordinateSpaceIn.height) * 100
}

function getCoordinateSpaceWidthPercent(widthIn: number, coordinateSpaceIn: Rect) {
	return (widthIn / coordinateSpaceIn.width) * 100
}

function getCoordinateSpaceHeightPercent(heightIn: number, coordinateSpaceIn: Rect) {
	return (heightIn / coordinateSpaceIn.height) * 100
}

function getNormalizedSheetSelectionBounds(startXIn: number, startYIn: number, endXIn: number, endYIn: number): SheetSelectionBounds {
	return {
		leftIn: Math.min(startXIn, endXIn),
		topIn: Math.min(startYIn, endYIn),
		rightIn: Math.max(startXIn, endXIn),
		bottomIn: Math.max(startYIn, endYIn),
	}
}

function getViewportSelectionBounds(viewport: DrawingViewport): SheetSelectionBounds {
	return {
		leftIn: viewport.xIn,
		topIn: viewport.yIn,
		rightIn: viewport.xIn + viewport.widthIn,
		bottomIn: viewport.yIn + viewport.heightIn,
	}
}

function getAnnotationSelectionBounds(annotation: DrawingAnnotation): SheetSelectionBounds {
	const baseBounds = {
		leftIn: annotation.xIn,
		topIn: annotation.yIn,
		rightIn: annotation.xIn + annotation.widthIn,
		bottomIn: annotation.yIn + APPROX_ANNOTATION_HEIGHT_IN,
	}
	if (!annotation.leaderTo) return baseBounds
	return {
		leftIn: Math.min(baseBounds.leftIn, annotation.leaderTo.xIn),
		topIn: Math.min(baseBounds.topIn, annotation.leaderTo.yIn),
		rightIn: Math.max(baseBounds.rightIn, annotation.leaderTo.xIn),
		bottomIn: Math.max(baseBounds.bottomIn, annotation.leaderTo.yIn),
	}
}

function doSheetSelectionBoundsIntersect(a: SheetSelectionBounds, b: SheetSelectionBounds) {
	return a.leftIn <= b.rightIn && a.rightIn >= b.leftIn && a.topIn <= b.bottomIn && a.bottomIn >= b.topIn
}

function hasSheetMarqueeExceededDragThreshold(session: SheetMarqueeSelectionSession, preview: SheetMarqueeSelectionPreview) {
	return Math.hypot(preview.currentClientX - session.originClientX, preview.currentClientY - session.originClientY) >= SHEET_MARQUEE_DRAG_THRESHOLD_PX
}

function toggleMarqueeSelection(baseIds: string[], hitIds: string[]) {
	const baseIdsSet = new Set(baseIds)
	const hitIdsSet = new Set(hitIds)
	return [
		...baseIds.filter(id => !hitIdsSet.has(id)),
		...hitIds.filter(id => !baseIdsSet.has(id)),
	]
}

function resolveSheetMarqueeSelection(params: {
	marqueeBounds: SheetSelectionBounds
	viewports: DrawingViewport[]
	annotations: DrawingAnnotation[]
	baseViewportIds: string[]
	baseAnnotationIds: string[]
	multiSelect: boolean
}) {
	const hitViewportIds = params.viewports
		.filter(viewport => doSheetSelectionBoundsIntersect(params.marqueeBounds, getViewportSelectionBounds(viewport)))
		.map(viewport => viewport.id)
	const hitAnnotationIds = params.annotations
		.filter(annotation => doSheetSelectionBoundsIntersect(params.marqueeBounds, getAnnotationSelectionBounds(annotation)))
		.map(annotation => annotation.id)

	if (!params.multiSelect) {
		return {
			viewportIds: hitViewportIds,
			annotationIds: hitAnnotationIds,
		}
	}

	return {
		viewportIds: toggleMarqueeSelection(params.baseViewportIds, hitViewportIds),
		annotationIds: toggleMarqueeSelection(params.baseAnnotationIds, hitAnnotationIds),
	}
}

function getViewportContentOffsetLimitIn(sizeIn: number) {
	return Math.max(0.75, sizeIn * 0.45)
}

function clampViewportContentOffsetX(contentOffsetXIn: number, widthIn: number) {
	const limit = getViewportContentOffsetLimitIn(widthIn)
	return clamp(contentOffsetXIn, -limit, limit)
}

function clampViewportContentOffsetY(contentOffsetYIn: number, heightIn: number) {
	const limit = getViewportContentOffsetLimitIn(heightIn)
	return clamp(contentOffsetYIn, -limit, limit)
}

function shortenLayoutLabel(label: string, fallback: string) {
	const normalized = label.replace(/\s+/g, ' ').trim()
	if (!normalized) return fallback
	return normalized.length > 22 ? `${normalized.slice(0, 22).trimEnd()}…` : normalized
}

function getLayoutSnapAnchorLabel(axis: LayoutSnapAxis, anchor: LayoutSnapAnchor) {
	if (axis === 'x') {
		switch (anchor) {
			case 'start':
				return 'Left edge'
			case 'center':
				return 'Centerline'
			case 'end':
				return 'Right edge'
		}
	}
	switch (anchor) {
		case 'start':
			return 'Top edge'
		case 'center':
			return 'Centerline'
		case 'end':
			return 'Bottom edge'
	}
}

function getLayoutSnapKindPriority(kind: LayoutSnapGuideKind) {
	switch (kind) {
		case 'margin':
			return 0
		case 'centerline':
			return 1
		case 'peer':
		default:
			return 2
	}
}

function getViewportLayoutSnapLines(viewport: DrawingViewport): { x: LayoutSnapLine[]; y: LayoutSnapLine[] } {
	const label = shortenLayoutLabel(viewport.title, 'Viewport')
	return {
		x: [
			{ positionIn: viewport.xIn, kind: 'peer', label: `${label} left edge` },
			{ positionIn: viewport.xIn + viewport.widthIn / 2, kind: 'peer', label: `${label} center` },
			{ positionIn: viewport.xIn + viewport.widthIn, kind: 'peer', label: `${label} right edge` },
		],
		y: [
			{ positionIn: viewport.yIn, kind: 'peer', label: `${label} top edge` },
			{ positionIn: viewport.yIn + viewport.heightIn / 2, kind: 'peer', label: `${label} center` },
			{ positionIn: viewport.yIn + viewport.heightIn, kind: 'peer', label: `${label} bottom edge` },
		],
	}
}

function getAnnotationLayoutSnapLines(annotation: DrawingAnnotation): { x: LayoutSnapLine[]; y: LayoutSnapLine[] } {
	const fallback = annotation.kind === 'callout' ? 'Callout' : 'Note'
	const label = shortenLayoutLabel(annotation.text.split('\n')[0] ?? '', fallback)
	return {
		x: [
			{ positionIn: annotation.xIn, kind: 'peer', label: `${label} left edge` },
			{ positionIn: annotation.xIn + annotation.widthIn / 2, kind: 'peer', label: `${label} center` },
			{ positionIn: annotation.xIn + annotation.widthIn, kind: 'peer', label: `${label} right edge` },
		],
		y: [
			{ positionIn: annotation.yIn, kind: 'peer', label: `${label} top edge` },
			{ positionIn: annotation.yIn + APPROX_ANNOTATION_HEIGHT_IN / 2, kind: 'peer', label: `${label} center` },
			{ positionIn: annotation.yIn + APPROX_ANNOTATION_HEIGHT_IN, kind: 'peer', label: `${label} bottom edge` },
		],
	}
}

function buildSheetLayoutSnapLines(params: {
	contentAreaIn: Rect
	templateWidth: number
	templateHeight: number
	peerViewports: DrawingViewport[]
	peerAnnotations: DrawingAnnotation[]
}) {
	const { contentAreaIn, templateWidth, templateHeight, peerViewports, peerAnnotations } = params
	const xLines: LayoutSnapLine[] = [
		{ positionIn: contentAreaIn.left, kind: 'margin', label: 'content left' },
		{ positionIn: contentAreaIn.right, kind: 'margin', label: 'content right' },
		{ positionIn: contentAreaIn.left + contentAreaIn.width / 2, kind: 'centerline', label: 'content centerline' },
	]
	const yLines: LayoutSnapLine[] = [
		{ positionIn: contentAreaIn.top, kind: 'margin', label: 'content top' },
		{ positionIn: contentAreaIn.bottom, kind: 'margin', label: 'content bottom' },
		{ positionIn: contentAreaIn.top + contentAreaIn.height / 2, kind: 'centerline', label: 'content centerline' },
	]
	peerViewports.forEach(viewport => {
		const lines = getViewportLayoutSnapLines(viewport)
		xLines.push(...lines.x)
		yLines.push(...lines.y)
	})
	peerAnnotations.forEach(annotation => {
		const lines = getAnnotationLayoutSnapLines(annotation)
		xLines.push(...lines.x)
		yLines.push(...lines.y)
	})
	return { xLines, yLines }
}

function resolveLayoutSnapAxis(params: {
	axis: LayoutSnapAxis
	startIn: number
	sizeIn: number
	minIn: number
	maxIn: number
	lines: LayoutSnapLine[]
}) {
	const { axis, sizeIn, minIn, maxIn, lines } = params
	const rawStartIn = clamp(params.startIn, minIn, maxIn)
	const anchors: ReadonlyArray<{ key: LayoutSnapAnchor; offsetIn: number }> = [
		{ key: 'start', offsetIn: 0 },
		{ key: 'center', offsetIn: sizeIn / 2 },
		{ key: 'end', offsetIn: sizeIn },
	]
	let bestMatch:
		| {
			startIn: number
			guide: LayoutSnapGuide
			hint: string
			distanceIn: number
			priority: number
		  }
		| null = null

	for (const line of lines) {
		for (const anchor of anchors) {
			const snappedStartIn = line.positionIn - anchor.offsetIn
			if (snappedStartIn < minIn - 0.001 || snappedStartIn > maxIn + 0.001) continue
			const distanceIn = Math.abs(rawStartIn + anchor.offsetIn - line.positionIn)
			if (distanceIn > LAYOUT_SNAP_THRESHOLD_IN) continue
			const candidate = {
				startIn: clamp(snappedStartIn, minIn, maxIn),
				guide: { axis, positionIn: line.positionIn, kind: line.kind },
				hint: `${getLayoutSnapAnchorLabel(axis, anchor.key)} → ${line.label}`,
				distanceIn,
				priority: getLayoutSnapKindPriority(line.kind),
			}
			if (
				!bestMatch ||
				candidate.distanceIn < bestMatch.distanceIn ||
				(Math.abs(candidate.distanceIn - bestMatch.distanceIn) < 0.0001 && candidate.priority < bestMatch.priority)
			) {
				bestMatch = candidate
			}
		}
	}

	if (bestMatch) {
		return {
			startIn: bestMatch.startIn,
			guide: bestMatch.guide,
			hint: bestMatch.hint,
		}
	}

	return { startIn: rawStartIn, guide: null, hint: null }
}

function applySheetLayoutSnapping(params: {
	subject: LayoutSnapSubject
	xIn: number
	yIn: number
	widthIn: number
	heightIn: number
	contentAreaIn: Rect
	templateWidth: number
	templateHeight: number
	maxYIn?: number
	peerViewports: DrawingViewport[]
	peerAnnotations: DrawingAnnotation[]
}) {
	const { contentAreaIn } = params
	// Allow viewports/annotations to be placed anywhere on the sheet (no boundary clamping).
	// Snap guides still reference contentAreaIn edges for alignment suggestions.
	const xMin = -params.templateWidth
	const xMax = params.templateWidth * 2
	const yMin = -params.templateHeight
	const yMax = params.maxYIn ?? params.templateHeight * 2
	const xIn = params.xIn
	const yIn = params.yIn
	const { xLines, yLines } = buildSheetLayoutSnapLines({
		contentAreaIn,
		templateWidth: params.templateWidth,
		templateHeight: params.templateHeight,
		peerViewports: params.peerViewports,
		peerAnnotations: params.peerAnnotations,
	})
	const snappedX = resolveLayoutSnapAxis({
		axis: 'x',
		startIn: xIn,
		sizeIn: params.widthIn,
		minIn: xMin,
		maxIn: xMax,
		lines: xLines,
	})
	const snappedY = resolveLayoutSnapAxis({
		axis: 'y',
		startIn: yIn,
		sizeIn: params.heightIn,
		minIn: yMin,
		maxIn: yMax,
		lines: yLines,
	})
	const guides = [snappedX.guide, snappedY.guide].filter((guide): guide is LayoutSnapGuide => !!guide)
	return {
		xIn: snappedX.startIn,
		yIn: snappedY.startIn,
		feedback: guides.length > 0
			? {
				subject: params.subject,
				guides,
				xHint: snappedX.hint,
				yHint: snappedY.hint,
			  }
			: null,
	}
}

function getSheetAlignedPlacement(params: {
	action: SheetAlignmentAction
	xIn: number
	yIn: number
	widthIn: number
	heightIn: number
	contentAreaIn: Rect
}) {
	const { contentAreaIn } = params
	let xIn = params.xIn
	let yIn = params.yIn

	switch (params.action) {
		case 'left':
			xIn = contentAreaIn.left
			break
		case 'center-x':
			xIn = contentAreaIn.left + contentAreaIn.width / 2 - params.widthIn / 2
			break
		case 'right':
			xIn = Math.max(contentAreaIn.left, contentAreaIn.right - params.widthIn)
			break
		case 'top':
			yIn = contentAreaIn.top
			break
		case 'center-y':
			yIn = contentAreaIn.top + contentAreaIn.height / 2 - params.heightIn / 2
			break
		case 'bottom':
			yIn = Math.max(contentAreaIn.top, contentAreaIn.bottom - params.heightIn)
			break
	}

	return { xIn, yIn }
}

function clampViewportPlacementToContentArea(params: {
	xIn: number
	yIn: number
	widthIn: number
	heightIn: number
	contentAreaIn: Rect
}) {
	const widthIn = clamp(params.widthIn, MIN_VIEWPORT_WIDTH_IN, params.contentAreaIn.width)
	const heightIn = clamp(params.heightIn, MIN_VIEWPORT_HEIGHT_IN, params.contentAreaIn.height)
	return {
		widthIn,
		heightIn,
		xIn: clamp(params.xIn, params.contentAreaIn.left, Math.max(params.contentAreaIn.left, params.contentAreaIn.right - widthIn)),
		yIn: clamp(params.yIn, params.contentAreaIn.top, Math.max(params.contentAreaIn.top, params.contentAreaIn.bottom - heightIn)),
	}
}

function resolveViewportActionSelectionIds(viewportId: string, selectedViewportIds: string[]) {
	return selectedViewportIds.includes(viewportId) ? selectedViewportIds : [viewportId]
}

function resolveViewportActionAnchorId(viewportId: string, selectedViewportIds: string[], selectedViewportAnchorId: string | null) {
	if (!selectedViewportIds.includes(viewportId)) return viewportId
	return selectedViewportAnchorId ?? viewportId
}

function getViewportCollectionBounds(viewports: ReadonlyArray<DrawingViewport>) {
	if (viewports.length === 0) return null
	const left = Math.min(...viewports.map(viewport => viewport.xIn))
	const top = Math.min(...viewports.map(viewport => viewport.yIn))
	const right = Math.max(...viewports.map(viewport => viewport.xIn + viewport.widthIn))
	const bottom = Math.max(...viewports.map(viewport => viewport.yIn + viewport.heightIn))
	return {
		left,
		top,
		right,
		bottom,
		width: right - left,
		height: bottom - top,
	}
}

function distributeViewportsByAxis(viewports: ReadonlyArray<DrawingViewport>, axis: ViewportTidyAxis) {
	const positions = new Map<string, { xIn: number; yIn: number }>()
	if (viewports.length === 0) return positions

	const ordered = [...viewports].sort((a, b) => (axis === 'x' ? a.xIn - b.xIn : a.yIn - b.yIn))
	const totalSizeIn = ordered.reduce(
		(total, viewport) => total + (axis === 'x' ? viewport.widthIn : viewport.heightIn),
		0,
	)
	const firstViewport = ordered[0]!
	const lastViewport = ordered[ordered.length - 1]!
	const startIn = axis === 'x' ? firstViewport.xIn : firstViewport.yIn
	const endIn = axis === 'x'
		? lastViewport.xIn + lastViewport.widthIn
		: lastViewport.yIn + lastViewport.heightIn
	const gapIn = ordered.length > 1 ? (endIn - startIn - totalSizeIn) / (ordered.length - 1) : 0

	let cursorIn = startIn
	ordered.forEach(viewport => {
		positions.set(
			viewport.id,
			axis === 'x'
				? { xIn: cursorIn, yIn: viewport.yIn }
				: { xIn: viewport.xIn, yIn: cursorIn },
		)
		cursorIn += (axis === 'x' ? viewport.widthIn : viewport.heightIn) + gapIn
	})

	return positions
}



function DrawingSheetViewport({
	viewport,
	view,
	section,
	displayPreset,
	sourceAnnotations,
	detailReferenceLabel,
	contentAreaIn,
	objects,
	scaffoldGeometry,
	isSelected,
	showActionCapsule,
	selectionCount,
	selectionAllLocked,
	selectionHasLocked,
	showScaleControl,
	canTidy,
	isLocked,
	isDragging,
	isResizing,
	onFramePointerDown,
	onCaptionPointerDown,
	onOpenView,
	onDuplicate,
	onMatchSize,
	onMatchScale,
	onAlignToSheet,
	onTidy,
	onToggleLock,
	onScaleChange,
	onDoubleClick,
	onTitleDoubleClick,
	onResizeHandlePointerDown,
}: {
	viewport: DrawingViewport
	view: DrawingSavedView | null
	section: DrawingSectionDefinition | null
	displayPreset: DrawingDisplayPreset | null
	sourceAnnotations?: DrawingSourceAnnotation[] | null
	detailReferenceLabel: string
	contentAreaIn: Rect
	objects: ReturnType<typeof useTool>['objects']
	scaffoldGeometry: DerivedScaffoldGeometry
	isSelected: boolean
	showActionCapsule: boolean
	selectionCount: number
	selectionAllLocked: boolean
	selectionHasLocked: boolean
	showScaleControl: boolean
	canTidy: boolean
	isLocked: boolean
	isDragging: boolean
	isResizing: boolean
	onFramePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
	onCaptionPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
	onOpenView: () => void
	onDuplicate: () => void
	onMatchSize: () => void
	onMatchScale: () => void
	onAlignToSheet: (action: SheetAlignmentAction) => void
	onTidy: (axis: ViewportTidyAxis) => void
	onToggleLock: () => void
	onScaleChange: (scaleLabel: string) => void
	onDoubleClick: () => void
	onTitleDoubleClick: (event: ReactPointerEvent<HTMLButtonElement>) => void
	onResizeHandlePointerDown: (event: ReactPointerEvent<HTMLButtonElement>, handle: ViewportResizeHandle) => void
}) {
	const renderData = useMemo(
		() => buildViewportRenderData({ objects, scaffoldGeometry, view, section, displayPreset }),
		[displayPreset, objects, scaffoldGeometry, section, view],
	)
	const viewportClassName = `drawing-viewport style-${displayPreset?.visualStyle ?? 'technical'} ${renderData.emptyMessage ? 'is-empty' : 'has-graphics'} ${isSelected ? 'selected' : ''} ${isLocked ? 'locked' : ''} ${isDragging ? 'dragging' : ''} ${isResizing ? 'resizing' : ''}`
	const pochePatternId = `drawing-viewport-poche-${viewport.id}`
	const resolvedSourceAnnotations = sourceAnnotations ?? view?.sourceAnnotations ?? []
	const hasSourceAnnotations = resolvedSourceAnnotations.length > 0
	const sourceNotes = resolvedSourceAnnotations.filter(annotation => annotation.kind === 'note')
	const sourceDimensions = resolvedSourceAnnotations.filter(annotation => annotation.kind === 'dimension' && annotation.target)
	const contentShiftXPercent = viewport.widthIn > 0 ? (viewport.contentOffsetXIn / viewport.widthIn) * 100 : 0
	const contentShiftYPercent = viewport.heightIn > 0 ? (viewport.contentOffsetYIn / viewport.heightIn) * 100 : 0
	const contentTransform = `translate(${contentShiftXPercent.toFixed(3)} ${contentShiftYPercent.toFixed(3)})`

	// Caption row height is allocated outside the viewport frame via a wrapper
	const captionTitle = viewport.title || view?.name || 'Untitled'
	const captionScale = view?.scaleLabel ?? viewport.scaleLabel ?? ''
	const scaleOptions = captionScale && !VIEWPORT_SCALE_PRESET_OPTIONS.some(option => option === captionScale)
		? [captionScale, ...VIEWPORT_SCALE_PRESET_OPTIONS]
		: [...VIEWPORT_SCALE_PRESET_OPTIONS]
	const lockButtonLabel = selectionCount > 1
		? (selectionAllLocked ? 'Unlock All' : 'Lock All')
		: (isLocked ? 'Unlock' : 'Lock')

	return (
		<div
			className="drawing-viewport-wrapper"
			style={{
					left: `${getCoordinateSpacePercentX(viewport.xIn, contentAreaIn)}%`,
					top: `${getCoordinateSpacePercentY(viewport.yIn, contentAreaIn)}%`,
					width: `${getCoordinateSpaceWidthPercent(viewport.widthIn, contentAreaIn)}%`,
					height: `${getCoordinateSpaceHeightPercent(viewport.heightIn, contentAreaIn)}%`,
			}}
		>
			{showActionCapsule ? (
				<div className="drawing-viewport-action-capsule" onPointerDown={event => event.stopPropagation()}>
					{selectionCount > 1 ? <div className="drawing-viewport-action-pill">{selectionCount} selected</div> : null}
					<button className="drawing-viewport-action-btn primary" onClick={onOpenView} type="button">
						Open
					</button>
					<button className="drawing-viewport-action-btn" onClick={onDuplicate} type="button">
						Copy
					</button>
					{selectionCount > 1 ? (
						<div aria-label="Viewport match tools" className="drawing-viewport-action-segment" role="group">
							<button
								aria-label="Same Size"
								className="drawing-viewport-action-segment-btn"
								disabled={selectionHasLocked}
								onClick={onMatchSize}
								title="Match selected viewport sizes to the anchor viewport"
								type="button"
							>
								Sz
							</button>
							<button
								aria-label="Same Scale"
								className="drawing-viewport-action-segment-btn"
								disabled={selectionHasLocked}
								onClick={onMatchScale}
								title="Match selected viewport scales to the anchor viewport"
								type="button"
							>
								Sc
							</button>
						</div>
					) : null}
					{showScaleControl ? (
						<label className="drawing-viewport-action-select-shell">
							<span className="sr-only">Viewport scale</span>
							<select className="drawing-viewport-action-select" onChange={event => onScaleChange(event.target.value)} value={captionScale || scaleOptions[0]}>
								{scaleOptions.map(option => (
									<option key={option} value={option}>{option}</option>
								))}
							</select>
						</label>
					) : null}
					<div aria-label="Horizontal viewport alignment" className="drawing-viewport-action-segment" role="group">
						{VIEWPORT_HORIZONTAL_ALIGNMENT_ACTIONS.map(option => (
							<button
								key={option.action}
								className="drawing-viewport-action-segment-btn"
								disabled={selectionHasLocked}
								onClick={() => onAlignToSheet(option.action)}
								title={option.label}
								type="button"
							>
								{option.shortLabel}
							</button>
						))}
					</div>
					<div aria-label="Vertical viewport alignment" className="drawing-viewport-action-segment" role="group">
						{VIEWPORT_VERTICAL_ALIGNMENT_ACTIONS.map(option => (
							<button
								key={option.action}
								className="drawing-viewport-action-segment-btn"
								disabled={selectionHasLocked}
								onClick={() => onAlignToSheet(option.action)}
								title={option.label}
								type="button"
							>
								{option.shortLabel}
							</button>
						))}
					</div>
					<div aria-label="Viewport tidy distribution" className="drawing-viewport-action-segment" role="group">
						{VIEWPORT_TIDY_ACTIONS.map(option => (
							<button
								key={option.axis}
								className="drawing-viewport-action-segment-btn"
								disabled={!canTidy}
								onClick={() => onTidy(option.axis)}
								title={option.label}
								type="button"
							>
								{option.shortLabel}
							</button>
						))}
					</div>
					<button className={`drawing-viewport-action-btn${selectionAllLocked ? ' active' : ''}`} onClick={onToggleLock} type="button">
						{lockButtonLabel}
					</button>
				</div>
			) : null}
			{/* ── Viewport frame: contains ONLY the view ── */}
			<div
				className={viewportClassName}
					onPointerDown={onFramePointerDown}
				onDoubleClick={onDoubleClick}
			>
				{renderData.emptyMessage ? (
					<div className="drawing-viewport-empty">{renderData.emptyMessage}</div>
				) : (
					<>
						<svg className="drawing-viewport-graphic" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img">
							<defs>
								<pattern id={pochePatternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
									<path d="M 0 0 L 0 6" className="drawing-viewport-graphic-pattern-line" />
								</pattern>
							</defs>
							<g transform={contentTransform}>
								{renderData.paths.map(path => (
									<path
										key={path.id}
										className={`drawing-viewport-graphic-path ${path.tone}${path.fill ? ' filled' : ''}`}
										d={pointsToSvgPath(path.points, path.closed)}
										style={path.tone === 'poche' && path.fill ? { fill: `url(#${pochePatternId})` } : undefined}
									/>
								))}
							</g>
						</svg>
						{hasSourceAnnotations ? (
							<div className="drawing-viewport-source-layer" aria-hidden="true">
								<svg className="drawing-viewport-source-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
									<g transform={contentTransform}>
										{sourceDimensions.map(annotation => {
											const target = annotation.target!
											const midX = (annotation.x + target.x) / 2
											const midY = (annotation.y + target.y) / 2
											return (
												<g key={annotation.id} className="drawing-viewport-source-dimension">
													<line className="drawing-viewport-source-dimension-line" x1={annotation.x} x2={target.x} y1={annotation.y} y2={target.y} />
													<circle className="drawing-viewport-source-dimension-cap" cx={annotation.x} cy={annotation.y} r={1} />
													<circle className="drawing-viewport-source-dimension-cap" cx={target.x} cy={target.y} r={1} />
													<text className="drawing-viewport-source-dimension-label" x={midX} y={Math.max(5, midY - 1.8)}>
														{annotation.text}
													</text>
												</g>
											)
										})}
									</g>
								</svg>
								{sourceNotes.map(annotation => (
									<div
										key={annotation.id}
										className="drawing-viewport-source-note"
										style={{
											left: `calc(${clamp(annotation.x, 2, 88)}% + ${contentShiftXPercent.toFixed(3)}%)`,
											top: `calc(${clamp(annotation.y, 2, 88)}% + ${contentShiftYPercent.toFixed(3)}%)`,
											width: `${clamp(annotation.width, 8, 72)}%`,
										}}
									>
										<div className="drawing-viewport-source-note-text">{annotation.text}</div>
									</div>
								))}
							</div>
						) : null}
					</>
				)}
					{isSelected && !isLocked
					? VIEWPORT_RESIZE_HANDLES.map(handle => (
						<button
							key={handle.key}
							className={`drawing-viewport-resize-handle ${handle.key}`}
							onPointerDown={event => onResizeHandlePointerDown(event, handle.key)}
							type="button"
						>
							<span className="sr-only">Resize viewport from the {handle.label}</span>
						</button>
					))
					: null}
			</div>
			{/* ── External caption row ── */}
			<div className={`drawing-viewport-caption-row${isDragging ? ' dragging' : ''}${isLocked ? ' locked' : ''}`} onPointerDown={onCaptionPointerDown}>
				<button className="drawing-viewport-caption-title drawing-viewport-caption-title-btn" onDoubleClick={onTitleDoubleClick} onPointerDown={event => event.stopPropagation()} title="Double-click to edit viewport title" type="button">
					{captionTitle}
				</button>
				<span className="drawing-viewport-caption-scale">{captionScale}</span>
					{isLocked ? <span className="drawing-viewport-caption-state">Locked</span> : null}
				<span className="drawing-viewport-caption-ref">{detailReferenceLabel}</span>
			</div>
		</div>
	)
}


export function DrawingsWorkspace() {
  const navigate = useNavigate()
  const projectSession = useProjectSession()
	const jobWorkspace = useJobWorkspace()
  const topbarMenuRef = useRef<HTMLDivElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
	  const sourceCanvasRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const annotationDragDraftRef = useRef<AnnotationDragPreview | null>(null)
  const viewportDragDraftRef = useRef<ViewportDragPreview | null>(null)
	const viewportResizeDraftRef = useRef<ViewportResizePreview | null>(null)
	const viewportContentPanDraftRef = useRef<ViewportContentPanPreview | null>(null)
  const sourceAnnotationDragDraftRef = useRef<SourceAnnotationDragPreview | null>(null)
  const { selectedManufacturer } = useCatalogSelection()
  const { baseSettings } = useScaffoldBaseSettings()
  const {
    objects,
    scaffoldStacks,
    ledgerConnections,
    manualPlankPlacements,
    scaffoldBlocks,
    undo,
    redo,
    canUndo,
    canRedo,
    liveCameraState,
    captureCurrentModelAsDrawingView,
	    createDrawingViewFromLiveModel,
	    createLinkedDrawingViewFromActiveSection,
    requestApplyDrawingView,
	  } = useTool()

	  // ── Drawing state from Zustand Model Store (direct, bypasses ToolContext) ──
	  const drawingPackage = useModelStore(s => s.drawingPackage)
	  const setDrawingPackage = useModelStore(s => s.setDrawingPackage)
	  const activeDrawingSectionId = useModelStore(s => s.activeSectionId)
	  const setActiveDrawingSectionId = useModelStore(s => s.setActiveSectionId)
		  const [selectedViewportIds, setSelectedViewportIds] = useState<string[]>([])
	  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<string[]>([])
	  const [selectedSourceAnnotationId, setSelectedSourceAnnotationId] = useState<string | null>(null)
		  // newSheetTemplateId removed — always uses the single Letter template
		  const [, setActiveTopbarMenu] = useState<TopbarMenuId | null>(null)
			const [activePaletteMode, setActivePaletteMode] = useState<PaletteMode>('sheet')
		const [toolState, setToolState] = useState<DrawingToolState>(getDefaultToolState)

		const handleSelectFamily = useCallback((familyId: ToolFamilyId) => {
			setToolState(prev => ({ ...prev, activeFamily: familyId, activeTool: null, commandPhase: 'idle' }))
		}, [])

		// Tool dispatch is defined after all handlers are declared — see handleSelectToolDispatch below

		const [sheetMarqueeSelectionSession, setSheetMarqueeSelectionSession] = useState<SheetMarqueeSelectionSession | null>(null)
		const [sheetMarqueeSelectionPreview, setSheetMarqueeSelectionPreview] = useState<SheetMarqueeSelectionPreview | null>(null)
	  const [viewportDragSession, setViewportDragSession] = useState<ViewportDragSession | null>(null)
	  const [viewportDragPreview, setViewportDragPreview] = useState<ViewportDragPreview | null>(null)
	const [viewportResizeSession, setViewportResizeSession] = useState<ViewportResizeSession | null>(null)
	const [viewportResizePreview, setViewportResizePreview] = useState<ViewportResizePreview | null>(null)
	const [viewportContentPanSession, setViewportContentPanSession] = useState<ViewportContentPanSession | null>(null)
	const [viewportContentPanPreview, setViewportContentPanPreview] = useState<ViewportContentPanPreview | null>(null)
		const [reframeViewportId, setReframeViewportId] = useState<string | null>(null)
  const [annotationDragSession, setAnnotationDragSession] = useState<AnnotationDragSession | null>(null)
  const [annotationDragPreview, setAnnotationDragPreview] = useState<AnnotationDragPreview | null>(null)
	const [layoutSnapFeedback, setLayoutSnapFeedback] = useState<LayoutSnapFeedback | null>(null)
	  const [sourceAnnotationDragSession, setSourceAnnotationDragSession] = useState<SourceAnnotationDragSession | null>(null)
	  const [sourceAnnotationDragPreview, setSourceAnnotationDragPreview] = useState<SourceAnnotationDragPreview | null>(null)
	  const [titleBlockEditor, setTitleBlockEditor] = useState<TitleBlockEditorState | null>(null)
	  const [titleBlockEditorValue, setTitleBlockEditorValue] = useState('')
	  const titleBlockEditorInputRef = useRef<HTMLInputElement | null>(null)

	  // ── Workspace canvas tabs (sheet + opened source views) ──
	  const [openSourceViewTabIds, setOpenSourceViewTabIds] = useState<string[]>([])
	  const [activeCanvasViewId, setActiveCanvasViewId] = useState<string | null>(null)

  // ── Canvas zoom & pan state ──
  const [canvasZoom, setCanvasZoom] = useState(1)
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)

  const MIN_ZOOM = 0.15
  const MAX_ZOOM = 5

  // ── Refs so native listeners always read latest state ──
  const canvasOffsetRef = useRef(canvasOffset)
  canvasOffsetRef.current = canvasOffset

  // ── Native wheel zoom (passive: false so preventDefault works) ──
  // React's onWheel is passive and cannot call preventDefault,
  // causing "Unable to preventDefault inside passive event listener" errors.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setCanvasZoom(prev => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev * delta))
        const scale = next / prev
        setCanvasOffset(o => ({
          x: mouseX - scale * (mouseX - o.x),
          y: mouseY - scale * (mouseY - o.y),
        }))
        return next
      })
    }

    const onContextMenu = (e: MouseEvent) => e.preventDefault()

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('contextmenu', onContextMenu)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('contextmenu', onContextMenu)
    }
  }, [])

  // ── Sheet pan via native pointer listeners (capture phase) ──
  // Middle mouse is reserved for stage pan everywhere on the sheet,
  // including when the pointer starts over a viewport or annotation.
  // Native capture-phase listeners ensure we intercept before any
  // child element can start its own interaction.

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    let panActive = false
    let panOriginX = 0
    let panOriginY = 0
    let panStartOX = 0
    let panStartOY = 0

    const onMouseDown = (e: MouseEvent) => {
      if (panActive || e.button !== 1) return
      e.preventDefault()
      e.stopPropagation()
      panActive = true
      panOriginX = e.clientX
      panOriginY = e.clientY
      panStartOX = canvasOffsetRef.current.x
      panStartOY = canvasOffsetRef.current.y
      setIsPanning(true)
    }

    const onDocumentMouseDown = (e: MouseEvent) => {
      if (e.button !== 1) return
      const target = e.target
      if (!(target instanceof Node) || !stage.contains(target)) return
      onMouseDown(e)
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!panActive) return
      setCanvasOffset({
        x: panStartOX + (e.clientX - panOriginX),
        y: panStartOY + (e.clientY - panOriginY),
      })
    }

    const onMouseUp = (e: MouseEvent) => {
      if (!panActive || e.button !== 1) return
      panActive = false
      setIsPanning(false)
    }

    const cancelPan = () => {
      if (!panActive) return
      panActive = false
      setIsPanning(false)
    }

    document.addEventListener('mousedown', onDocumentMouseDown, { capture: true })
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', cancelPan)

    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown, true)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', cancelPan)
    }
  }, [])

  useEffect(() => {
    document.body.classList.add('workspace-drawing')
    return () => {
      document.body.classList.remove('workspace-drawing')
    }
  }, [])

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as Node
			if (topbarMenuRef.current?.contains(target)) return
			setActiveTopbarMenu(null)
		}

		const handleEscapeKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setActiveTopbarMenu(null)
			}
		}

		document.addEventListener('mousedown', handleClickOutside)
		window.addEventListener('keydown', handleEscapeKey)

		return () => {
			document.removeEventListener('mousedown', handleClickOutside)
			window.removeEventListener('keydown', handleEscapeKey)
		}
	}, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented || e.altKey) return
      if (isTextInputTarget(e.target)) return
      if (!(e.ctrlKey || e.metaKey)) return

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

  const activeSheet = useMemo(
    () => drawingPackage.sheets.find(sheet => sheet.id === drawingPackage.activeSheetId) ?? drawingPackage.sheets[0] ?? null,
    [drawingPackage],
  )
  const sortedSheets = useMemo(
    () => [...drawingPackage.sheets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [drawingPackage.sheets],
  )
	  const activeSheetIndex = useMemo(
		() => (activeSheet ? sortedSheets.findIndex(sheet => sheet.id === activeSheet.id) : -1),
		[activeSheet, sortedSheets],
	  )
	  const isActiveSheetFirstPage = activeSheetIndex === 0
  const isActiveSheetLastPage = activeSheetIndex === sortedSheets.length - 1
	  const templateMap = useMemo(() => new Map(drawingPackage.templates.map(template => [template.id, template])), [drawingPackage.templates])
  const activeTemplate = useMemo(
	    () => (activeSheet?.templateId ? templateMap.get(activeSheet.templateId) : null) ?? drawingPackage.templates[0] ?? null,
	    [activeSheet, drawingPackage.templates, templateMap],
  )

  const templateWidth = activeTemplate?.widthIn ?? 11
  const templateHeight = activeTemplate?.heightIn ?? 8.5
  const sheetGeometry = useMemo(
    () => computeSheetGeometry(templateWidth, templateHeight, activeTemplate?.marginIn ?? 0.5),
    [templateWidth, templateHeight, activeTemplate?.marginIn],
  )
  const sheetGeoStyle = useMemo(() => sheetGeometryCSSVars(sheetGeometry), [sheetGeometry])
  const activeView = useMemo(
    () => drawingPackage.savedViews.find(view => view.id === drawingPackage.activeViewId) ?? drawingPackage.savedViews[0] ?? null,
    [drawingPackage],
  )
  const viewMap = useMemo(() => new Map(drawingPackage.savedViews.map(view => [view.id, view])), [drawingPackage.savedViews])
	  const sectionMap = useMemo(() => new Map(drawingPackage.sections.map(section => [section.id, section])), [drawingPackage.sections])
	  const displayPresetMap = useMemo(() => new Map(drawingPackage.displayPresets.map(preset => [preset.id, preset])), [drawingPackage.displayPresets])
		const activeCanvasView = activeCanvasViewId ? viewMap.get(activeCanvasViewId) ?? null : null
		const openSourceViews = useMemo(
			() => openSourceViewTabIds.map(viewId => viewMap.get(viewId)).filter((view): view is DrawingSavedView => !!view),
			[openSourceViewTabIds, viewMap],
		)
	  const activeSourceSection = useMemo(
		() => (activeView?.sectionId ? sectionMap.get(activeView.sectionId) ?? null : null),
		[activeView, sectionMap],
	  )
	  const activeSourceDisplayPreset = useMemo(
		() => (activeView ? displayPresetMap.get(activeView.displayPresetId) ?? null : null),
		[activeView, displayPresetMap],
	  )
	  const sectionViewMap = useMemo(() => {
		const map = new Map<string, DrawingSavedView>()
		drawingPackage.savedViews.forEach(view => {
			if (view.sectionId && !map.has(view.sectionId)) {
				map.set(view.sectionId, view)
			}
		})
		return map
	  }, [drawingPackage.savedViews])
	  const viewSheetNumbersMap = useMemo(() => {
		const placements = new Map<string, string[]>()
		drawingPackage.sheets.forEach(sheet => {
			sheet.viewports.forEach(viewport => {
				const existing = placements.get(viewport.viewId)
				if (existing) {
					if (!existing.includes(sheet.number)) existing.push(sheet.number)
					return
				}
				placements.set(viewport.viewId, [sheet.number])
			})
		})
		return placements
	  }, [drawingPackage.sheets])
	  const sectionSheetNumbersMap = useMemo(() => {
		const placements = new Map<string, string[]>()
		drawingPackage.savedViews.forEach(view => {
			if (!view.sectionId) return
			const existing = placements.get(view.sectionId) ?? []
			;(viewSheetNumbersMap.get(view.id) ?? []).forEach(sheetNumber => {
				if (!existing.includes(sheetNumber)) existing.push(sheetNumber)
			})
			placements.set(view.sectionId, existing)
		})
		return placements
	  }, [drawingPackage.savedViews, viewSheetNumbersMap])
  const scaffoldGeometry = useMemo(
		() => deriveScaffoldGeometry({
			scaffoldStacks,
			ledgerConnections,
			manualPlankPlacements,
			scaffoldBlocks,
			baseSettings,
			selectedManufacturer,
		}),
		[baseSettings, ledgerConnections, manualPlankPlacements, scaffoldBlocks, scaffoldStacks, selectedManufacturer],
	)

  const projectId = projectSession?.projectId ?? ''
  const projectName = projectSession?.projectName ?? 'Untitled project'
  const saveStatus = projectSession?.saveStatus ?? 'idle'
  const lastSavedAt = projectSession?.lastSavedAt ?? null
		const workspaceBackPath = jobWorkspace?.jobHomePath ?? '/projects'
	  const modelWorkspacePath = jobWorkspace?.canvasPath ?? (projectId ? `/app/${projectId}` : '')
		  const tasksWorkspacePath = jobWorkspace?.tasksPath ?? ''
  const saveLabel = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Not saved' : lastSavedAt ? `Saved • ${formatSavedStamp(lastSavedAt)}` : 'Saved'
	  const canCreateSourceViewFromModel = !!liveCameraState
	  const canCreateSectionLinkedView = !!liveCameraState && !!drawingPackage.activeSectionId
  const canCaptureLiveModel = !!liveCameraState && !!activeView
	  const canOpenActiveViewInModel = !!activeView && !!modelWorkspacePath
	  const canActivateSectionInModel = !!drawingPackage.activeSectionId && !!modelWorkspacePath
	  const canSendActiveViewToSheet = !!activeView && !!activeTemplate
		const canInsertViewsToSheet = !!activeSheet && !!activeTemplate
	  const issueDateLabel = formatIssueDate(lastSavedAt)
		  const activeSheetTitleBlockText = useMemo(
			() => (activeSheet ? resolveDrawingSheetTitleBlockText(activeSheet.titleBlockText, projectName, issueDateLabel) : null),
			[activeSheet, issueDateLabel, projectName],
		  )
		const activeViewPlacementPreview = useMemo(() => {
			if (!activeView || !activeSheet || !activeTemplate) return null
			const preferredSize = getPreferredViewportSize(activeView, activeSheet.viewports, viewMap)
			const placement = getNextViewportPlacement({
				existingViewports: activeSheet.viewports,
				contentAreaIn: sheetGeometry.contentAreaIn,
				widthIn: preferredSize.widthIn,
				heightIn: preferredSize.heightIn,
			})
			return {
				sizeLabel: `${preferredSize.widthIn.toFixed(1)} × ${preferredSize.heightIn.toFixed(1)} in`,
				placementLabel: `Next placement ${placement.xIn.toFixed(1)} · ${placement.yIn.toFixed(1)} in`,
			}
		}, [activeSheet, activeTemplate, activeView, sheetGeometry.contentAreaIn, viewMap])

	  const activeSheetViewportReferences = useMemo(() => {
		if (!activeSheet) return []
		return activeSheet.viewports.map((viewport, index) => {
			const view = viewMap.get(viewport.viewId) ?? null
			const section = view?.sectionId ? sectionMap.get(view.sectionId) ?? null : null
			return {
				id: viewport.id,
				referenceLabel: formatViewportReference(index + 1, activeSheet.number),
				title: viewport.title,
				viewName: view?.name ?? 'Saved view missing',
				kindLabel: formatViewportKindLabel(view?.kind),
				sectionMarker: section?.markerLabel ?? null,
			}
		})
	  }, [activeSheet, sectionMap, viewMap])
	const clearLayoutSnapFeedback = useCallback(() => {
		setLayoutSnapFeedback(null)
	}, [])

	const clearViewportInteractionState = useCallback(() => {
		viewportDragDraftRef.current = null
		viewportResizeDraftRef.current = null
		viewportContentPanDraftRef.current = null
		clearLayoutSnapFeedback()
		setViewportDragPreview(null)
		setViewportDragSession(null)
		setViewportResizePreview(null)
		setViewportResizeSession(null)
		setViewportContentPanPreview(null)
		setViewportContentPanSession(null)
	}, [clearLayoutSnapFeedback])

	const clearAnnotationInteractionState = useCallback(() => {
		annotationDragDraftRef.current = null
		clearLayoutSnapFeedback()
		setAnnotationDragPreview(null)
		setAnnotationDragSession(null)
	}, [clearLayoutSnapFeedback])

	const clearSourceAnnotationInteractionState = useCallback(() => {
		sourceAnnotationDragDraftRef.current = null
		clearLayoutSnapFeedback()
		setSourceAnnotationDragPreview(null)
		setSourceAnnotationDragSession(null)
	}, [clearLayoutSnapFeedback])

	const clearSheetSelection = useCallback(() => {
		setSelectedViewportIds([])
		setSelectedAnnotationIds([])
	}, [])

	// toggleTopbarMenu / runTopbarMenuAction removed — replaced by Command Ribbon tool dispatch

		const clearCurrentSelection = useCallback(() => {
			clearViewportInteractionState()
			clearAnnotationInteractionState()
			clearSourceAnnotationInteractionState()
			clearSheetSelection()
			setSelectedSourceAnnotationId(null)
		}, [clearAnnotationInteractionState, clearSheetSelection, clearSourceAnnotationInteractionState, clearViewportInteractionState])

	const selectSingleViewport = useCallback((viewportId: string) => {
		setSelectedViewportIds([viewportId])
		setSelectedAnnotationIds([])
	}, [])

	const selectSingleAnnotation = useCallback((annotationId: string) => {
		setSelectedViewportIds([])
		setSelectedAnnotationIds([annotationId])
	}, [])

	const handleViewportSelection = useCallback((viewportId: string, multiSelect: boolean) => {
		if (!multiSelect) {
			selectSingleViewport(viewportId)
			return
		}
		setSelectedViewportIds(current => toggleSelectionId(current, viewportId))
	}, [selectSingleViewport])

	const handleAnnotationSelection = useCallback((annotationId: string, multiSelect: boolean) => {
		if (!multiSelect) {
			selectSingleAnnotation(annotationId)
			return
		}
		setSelectedAnnotationIds(current => toggleSelectionId(current, annotationId))
	}, [selectSingleAnnotation])



	  const displayedViewports = useMemo(() => {
		if (!activeSheet) return []
		return activeSheet.viewports.map(viewport => {
			let nextViewport = viewport
			if (viewportDragPreview?.viewportId === viewport.id) {
				nextViewport = {
					...nextViewport,
					xIn: viewportDragPreview.xIn,
					yIn: viewportDragPreview.yIn,
				}
			}
			if (viewportResizePreview?.viewportId === viewport.id) {
				nextViewport = {
					...nextViewport,
					xIn: viewportResizePreview.xIn,
					yIn: viewportResizePreview.yIn,
					widthIn: viewportResizePreview.widthIn,
					heightIn: viewportResizePreview.heightIn,
				}
			}
			if (viewportContentPanPreview?.viewportId === viewport.id) {
				nextViewport = {
					...nextViewport,
					contentOffsetXIn: viewportContentPanPreview.contentOffsetXIn,
					contentOffsetYIn: viewportContentPanPreview.contentOffsetYIn,
				}
			}
			return nextViewport
		})
	  }, [activeSheet, viewportContentPanPreview, viewportDragPreview, viewportResizePreview])

  const displayedAnnotations = useMemo(() => {
	if (!activeSheet) return []
	return activeSheet.annotations.map(annotation => {
		let nextAnnotation = annotation
			if (annotationDragPreview?.annotationId === annotation.id) {
			nextAnnotation = {
				...nextAnnotation,
				xIn: annotationDragPreview.xIn,
				yIn: annotationDragPreview.yIn,
				leaderTo: annotationDragPreview.leaderTo ?? annotation.leaderTo,
			}
		}
		return nextAnnotation
	})
	  }, [activeSheet, annotationDragPreview])

	  const displayedSourceAnnotations = useMemo(() => {
		if (!activeView) return []
		return activeView.sourceAnnotations.map(annotation => {
			if (sourceAnnotationDragPreview?.annotationId !== annotation.id) return annotation
			return {
				...annotation,
				x: sourceAnnotationDragPreview.x,
				y: sourceAnnotationDragPreview.y,
				target: sourceAnnotationDragPreview.target ?? annotation.target,
			}
		})
	  }, [activeView, sourceAnnotationDragPreview])

	  const selectedSheetItemCount = selectedViewportIds.length + selectedAnnotationIds.length
	  const selectedViewportCount = selectedViewportIds.length
	  const selectedAnnotationCount = selectedAnnotationIds.length

	  const selectedAnnotation = useMemo(
		() => (selectedSheetItemCount === 1 && selectedAnnotationIds.length === 1
			? displayedAnnotations.find(annotation => annotation.id === selectedAnnotationIds[0]) ?? null
			: null),
		[displayedAnnotations, selectedAnnotationIds, selectedSheetItemCount],
	  )

		const selectedViewport = useMemo(
			() => (selectedSheetItemCount === 1 && selectedViewportIds.length === 1
				? displayedViewports.find(viewport => viewport.id === selectedViewportIds[0]) ?? null
				: null),
			[displayedViewports, selectedSheetItemCount, selectedViewportIds],
		)

	const selectedViewportView = selectedViewport ? viewMap.get(selectedViewport.viewId) ?? null : null
	const selectedViewportSection = selectedViewportView?.sectionId ? sectionMap.get(selectedViewportView.sectionId) ?? null : null
	const hasViewportSelectionSummary = !selectedViewport && selectedViewportCount > 0
	const hasAnnotationSelectionSummary = !selectedAnnotation && selectedAnnotationCount > 0
	const selectedViewportIdSet = useMemo(() => new Set(selectedViewportIds), [selectedViewportIds])
	const selectedViewports = useMemo(
		() => displayedViewports.filter(viewport => selectedViewportIdSet.has(viewport.id)),
		[displayedViewports, selectedViewportIdSet],
	)
	const selectedViewportAnchorId = selectedViewportIds[selectedViewportIds.length - 1] ?? null
	const selectedViewportHasLocked = selectedViewports.some(viewport => viewport.isLocked)
	const selectedViewportAllLocked = selectedViewports.length > 0 && selectedViewports.every(viewport => viewport.isLocked)

	const sheetMarqueeSelectionBounds = useMemo(() => {
		if (!sheetMarqueeSelectionSession || !sheetMarqueeSelectionPreview) return null
		if (!hasSheetMarqueeExceededDragThreshold(sheetMarqueeSelectionSession, sheetMarqueeSelectionPreview)) return null
		return getNormalizedSheetSelectionBounds(
			sheetMarqueeSelectionSession.startXIn,
			sheetMarqueeSelectionSession.startYIn,
			sheetMarqueeSelectionPreview.currentXIn,
			sheetMarqueeSelectionPreview.currentYIn,
		)
	}, [sheetMarqueeSelectionPreview, sheetMarqueeSelectionSession])

	  const selectedSourceAnnotation = useMemo(
		() => displayedSourceAnnotations.find(annotation => annotation.id === selectedSourceAnnotationId) ?? null,
		[displayedSourceAnnotations, selectedSourceAnnotationId],
	  )

		  const updateSavedView = useCallback(
			(viewId: string, updater: (view: DrawingSavedView) => DrawingSavedView) => {
				setDrawingPackage(prev => ({
					...prev,
					savedViews: prev.savedViews.map(view => (view.id === viewId ? updater(view) : view)),
				}))
			},
			[setDrawingPackage],
		  )

		  const updateActiveView = useCallback(
			(updater: (view: DrawingSavedView) => DrawingSavedView) => {
				if (!drawingPackage.activeViewId) return
				updateSavedView(drawingPackage.activeViewId, updater)
			},
			[drawingPackage.activeViewId, updateSavedView],
		  )

	  const updateSourceAnnotation = useCallback(
		(annotationId: string, updater: (annotation: DrawingSourceAnnotation) => DrawingSourceAnnotation) => {
			updateActiveView(view => ({
				...view,
				sourceAnnotations: view.sourceAnnotations.map(annotation => (annotation.id === annotationId ? updater(annotation) : annotation)),
			}))
		},
		[updateActiveView],
	  )

  const updateActiveSheet = useCallback(
	(updater: (sheet: DrawingSheet) => DrawingSheet) => {
		setDrawingPackage(prev => ({
			...prev,
			sheets: prev.sheets.map(sheet => (sheet.id === prev.activeSheetId ? updater(sheet) : sheet)),
		}))
	},
	[setDrawingPackage],
  )

	  const closeTitleBlockEditor = useCallback(() => {
		setTitleBlockEditor(null)
		setTitleBlockEditorValue('')
	  }, [])

	  const openTitleBlockEditor = useCallback((fieldId: TitleBlockEditableFieldId, label: string, value: string) => {
		setTitleBlockEditor({ fieldId, label, value })
		setTitleBlockEditorValue(value)
	  }, [])

	  const handleSaveTitleBlockEditor = useCallback(() => {
		if (!titleBlockEditor) return
		const nextValue = titleBlockEditorValue.replace(/\r\n/g, '\n').trim()

		updateActiveSheet(sheet => {
			if (titleBlockEditor.fieldId === 'sheetNumberValue') {
				return {
					...sheet,
					number: nextValue || sheet.number,
				}
			}

			if (titleBlockEditor.fieldId === 'sheetName') {
				return {
					...sheet,
					name: nextValue || sheet.name,
				}
			}

			if (isViewportTitleFieldId(titleBlockEditor.fieldId)) {
				const viewportId = titleBlockEditor.fieldId.slice('viewportTitle:'.length)
				return {
					...sheet,
					viewports: sheet.viewports.map(viewport => (
						viewport.id === viewportId
							? { ...viewport, title: nextValue }
							: viewport
					)),
				}
			}

			const fieldId = titleBlockEditor.fieldId as TitleBlockTextFieldKey
			return {
				...sheet,
				titleBlockText: {
					...resolveDrawingSheetTitleBlockText(sheet.titleBlockText, projectName, issueDateLabel),
					[fieldId]: nextValue,
				},
			}
		})

		closeTitleBlockEditor()
	  }, [closeTitleBlockEditor, issueDateLabel, projectName, titleBlockEditor, titleBlockEditorValue, updateActiveSheet])

  const updateAnnotation = useCallback(
	(annotationId: string, updater: (annotation: DrawingAnnotation) => DrawingAnnotation) => {
		updateActiveSheet(sheet => ({
			...sheet,
			annotations: sheet.annotations.map(annotation => (annotation.id === annotationId ? updater(annotation) : annotation)),
		}))
	},
	[updateActiveSheet],
  )

	  const updateViewport = useCallback(
		(viewportId: string, updater: (viewport: DrawingViewport) => DrawingViewport) => {
			updateActiveSheet(sheet => ({
				...sheet,
				viewports: sheet.viewports.map(viewport => (viewport.id === viewportId ? updater(viewport) : viewport)),
			}))
		},
		[updateActiveSheet],
	  )

		const handleMatchViewportScale = useCallback((viewportId: string) => {
			const targetIds = resolveViewportActionSelectionIds(viewportId, selectedViewportIds)
			if (targetIds.length < 2) return

			const anchorId = resolveViewportActionAnchorId(viewportId, selectedViewportIds, selectedViewportAnchorId)
			const targetIdSet = new Set(targetIds)
			const targetViewports = displayedViewports.filter(viewport => targetIdSet.has(viewport.id))
			if (targetViewports.length < 2 || targetViewports.some(viewport => viewport.isLocked)) return

			const anchorViewport = targetViewports.find(viewport => viewport.id === anchorId)
			if (!anchorViewport) return

			const nextScaleLabel = (viewMap.get(anchorViewport.viewId)?.scaleLabel ?? anchorViewport.scaleLabel ?? '').trim()
			if (!nextScaleLabel) return

			const targetViewIdSet = new Set(targetViewports.map(viewport => viewport.viewId))
			setDrawingPackage(prev => ({
				...prev,
				savedViews: prev.savedViews.map(view => (
					targetViewIdSet.has(view.id)
						? { ...view, scaleLabel: nextScaleLabel }
						: view
				)),
				sheets: prev.sheets.map(sheet => ({
					...sheet,
					viewports: sheet.viewports.map(currentViewport => (
						targetViewIdSet.has(currentViewport.viewId)
							? { ...currentViewport, scaleLabel: nextScaleLabel }
							: currentViewport
					)),
				})),
			}))
		}, [displayedViewports, selectedViewportAnchorId, selectedViewportIds, setDrawingPackage, viewMap])

		const handleViewportScaleChange = useCallback((viewport: DrawingViewport, scaleLabel: string) => {
			const nextScaleLabel = scaleLabel.trim()
			if (!nextScaleLabel) return
			setDrawingPackage(prev => ({
				...prev,
				savedViews: prev.savedViews.map(view => (view.id === viewport.viewId ? { ...view, scaleLabel: nextScaleLabel } : view)),
				sheets: prev.sheets.map(sheet => ({
					...sheet,
					viewports: sheet.viewports.map(currentViewport => (
						currentViewport.viewId === viewport.viewId
							? { ...currentViewport, scaleLabel: nextScaleLabel }
							: currentViewport
					)),
				})),
			}))
		}, [setDrawingPackage])

		const handleViewportLockToggle = useCallback((viewport: DrawingViewport) => {
			const targetIds = resolveViewportActionSelectionIds(viewport.id, selectedViewportIds)
			const targetIdSet = new Set(targetIds)
			const targetViewports = displayedViewports.filter(currentViewport => targetIdSet.has(currentViewport.id))
			if (targetViewports.length === 0) return

			const nextLocked = !targetViewports.every(currentViewport => currentViewport.isLocked)
			if (nextLocked) {
				clearViewportInteractionState()
				setReframeViewportId(current => (current && targetIdSet.has(current) ? null : current))
			}

			updateActiveSheet(sheet => ({
				...sheet,
				viewports: sheet.viewports.map(currentViewport => (
					targetIdSet.has(currentViewport.id)
						? { ...currentViewport, isLocked: nextLocked }
						: currentViewport
				)),
			}))
		}, [clearViewportInteractionState, displayedViewports, selectedViewportIds, updateActiveSheet])

		const handleViewportReframeToggle = useCallback((viewport: DrawingViewport) => {
			if (viewport.isLocked) return
			clearViewportInteractionState()
			clearAnnotationInteractionState()
			clearSourceAnnotationInteractionState()
			selectSingleViewport(viewport.id)
			setSelectedSourceAnnotationId(null)
			setReframeViewportId(current => (current === viewport.id ? null : viewport.id))
		}, [clearAnnotationInteractionState, clearSourceAnnotationInteractionState, clearViewportInteractionState, selectSingleViewport])

  useEffect(() => {
	if (!activeSheet) {
			clearSheetSelection()
			clearViewportInteractionState()
			clearAnnotationInteractionState()
		return
	}
		setSelectedAnnotationIds(current => current.filter(annotationId => activeSheet.annotations.some(annotation => annotation.id === annotationId)))
		setSelectedViewportIds(current => current.filter(viewportId => activeSheet.viewports.some(viewport => viewport.id === viewportId)))
		  }, [activeSheet, clearAnnotationInteractionState, clearSheetSelection, clearViewportInteractionState])

		useEffect(() => {
			if (!reframeViewportId) return
			if (selectedViewportIds.length !== 1 || selectedViewportIds[0] !== reframeViewportId) {
				setReframeViewportId(null)
				return
			}
			const reframedViewport = displayedViewports.find(viewport => viewport.id === reframeViewportId)
			if (!reframedViewport || reframedViewport.isLocked) {
				setReframeViewportId(null)
			}
		}, [displayedViewports, reframeViewportId, selectedViewportIds])

	  useEffect(() => {
		closeTitleBlockEditor()
	  }, [activeSheet?.id, closeTitleBlockEditor])

	  useEffect(() => {
		if (!titleBlockEditor) return undefined
		const animationFrame = window.requestAnimationFrame(() => {
			titleBlockEditorInputRef.current?.focus()
			titleBlockEditorInputRef.current?.select()
		})
		return () => window.cancelAnimationFrame(animationFrame)
	  }, [titleBlockEditor])

	  useEffect(() => {
		if (!titleBlockEditor) return undefined
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			event.preventDefault()
			closeTitleBlockEditor()
		}
		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	  }, [closeTitleBlockEditor, titleBlockEditor])

	  useEffect(() => {
		if (!activeView) {
			setSelectedSourceAnnotationId(null)
			clearSourceAnnotationInteractionState()
			return
		}
		if (selectedSourceAnnotationId && !activeView.sourceAnnotations.some(annotation => annotation.id === selectedSourceAnnotationId)) {
			setSelectedSourceAnnotationId(null)
		}
	  }, [activeView, clearSourceAnnotationInteractionState, selectedSourceAnnotationId])

	  useEffect(() => {
		clearSourceAnnotationInteractionState()
	  }, [activeView?.id, clearSourceAnnotationInteractionState])

	  useEffect(() => {
		if (!viewportDragSession) return undefined

		const marginIn = activeTemplate?.marginIn ?? 0.5
		const peerViewports = activeSheet?.viewports.filter(viewport => viewport.id !== viewportDragSession.viewportId) ?? []
		const peerAnnotations = activeSheet?.annotations ?? []

		const commitDrag = () => {
			const draft = viewportDragDraftRef.current
			if (draft) {
				updateViewport(draft.viewportId, viewport => ({
					...viewport,
					xIn: draft.xIn,
					yIn: draft.yIn,
				}))
			}
			viewportDragDraftRef.current = null
			clearLayoutSnapFeedback()
			setViewportDragPreview(null)
			setViewportDragSession(null)
		}

		const handlePointerMove = (event: PointerEvent) => {
			const el = contentRef.current ?? sheetRef.current
			if (!el) return
			const rect = el.getBoundingClientRect()
			if (rect.width <= 0 || rect.height <= 0) return
			const coordinateSpaceIn = getSheetCoordinateSpaceIn({
				coordinateElement: el,
				contentElement: contentRef.current,
				contentAreaIn: sheetGeometry.contentAreaIn,
				templateWidth,
				templateHeight,
			})

			const deltaXIn = ((event.clientX - viewportDragSession.originClientX) / rect.width) * coordinateSpaceIn.width
			const deltaYIn = ((event.clientY - viewportDragSession.originClientY) / rect.height) * coordinateSpaceIn.height
			const snappedPlacement = applySheetLayoutSnapping({
				subject: 'viewport',
				xIn: viewportDragSession.startXIn + deltaXIn,
				yIn: viewportDragSession.startYIn + deltaYIn,
				widthIn: viewportDragSession.widthIn,
				heightIn: viewportDragSession.heightIn,
				contentAreaIn: sheetGeometry.contentAreaIn,
				templateWidth,
				templateHeight,
				peerViewports,
				peerAnnotations,
			})
			const nextPreview: ViewportDragPreview = {
				viewportId: viewportDragSession.viewportId,
				xIn: snappedPlacement.xIn,
				yIn: snappedPlacement.yIn,
			}
			viewportDragDraftRef.current = nextPreview
			setLayoutSnapFeedback(snappedPlacement.feedback)
			setViewportDragPreview(nextPreview)
		}

		window.addEventListener('pointermove', handlePointerMove)
		window.addEventListener('pointerup', commitDrag)
		window.addEventListener('pointercancel', commitDrag)

		return () => {
			window.removeEventListener('pointermove', handlePointerMove)
			window.removeEventListener('pointerup', commitDrag)
			window.removeEventListener('pointercancel', commitDrag)
		}
	  }, [activeSheet, activeTemplate?.marginIn, clearLayoutSnapFeedback, sheetGeometry.contentAreaIn, templateHeight, templateWidth, updateViewport, viewportDragSession])

	useEffect(() => {
		if (!viewportResizeSession) return undefined

		const contentAreaIn = sheetGeometry.contentAreaIn

		const commitResize = () => {
			const draft = viewportResizeDraftRef.current
			if (draft) {
				updateViewport(draft.viewportId, viewport => ({
					...viewport,
					xIn: draft.xIn,
					yIn: draft.yIn,
					widthIn: draft.widthIn,
					heightIn: draft.heightIn,
					contentOffsetXIn: clampViewportContentOffsetX(viewport.contentOffsetXIn, draft.widthIn),
					contentOffsetYIn: clampViewportContentOffsetY(viewport.contentOffsetYIn, draft.heightIn),
				}))
			}
			viewportResizeDraftRef.current = null
			setViewportResizePreview(null)
			setViewportResizeSession(null)
		}

		const handlePointerMove = (event: PointerEvent) => {
				// Resize needs to use the same content-area coordinate space as the
				// rendered viewport wrapper. Using the full sheet causes shrink/drag
				// deltas to under-respond after the A101 content-area rebase.
				const el = contentRef.current ?? sheetRef.current
				if (!el) return
				const rect = el.getBoundingClientRect()
				if (rect.width <= 0 || rect.height <= 0) return
				const coordinateSpaceIn = getSheetCoordinateSpaceIn({
					coordinateElement: el,
					contentElement: contentRef.current,
					contentAreaIn: sheetGeometry.contentAreaIn,
					templateWidth,
					templateHeight,
				})

				const deltaXIn = ((event.clientX - viewportResizeSession.originClientX) / rect.width) * coordinateSpaceIn.width
				const deltaYIn = ((event.clientY - viewportResizeSession.originClientY) / rect.height) * coordinateSpaceIn.height
			const startRight = viewportResizeSession.startXIn + viewportResizeSession.startWidthIn
			const startBottom = viewportResizeSession.startYIn + viewportResizeSession.startHeightIn

			let xIn = viewportResizeSession.startXIn
			let yIn = viewportResizeSession.startYIn
			let widthIn = viewportResizeSession.startWidthIn
			let heightIn = viewportResizeSession.startHeightIn

			if (viewportResizeSession.handle === 'nw' || viewportResizeSession.handle === 'sw') {
				xIn = Math.min(viewportResizeSession.startXIn + deltaXIn, startRight - MIN_VIEWPORT_WIDTH_IN)
				widthIn = startRight - xIn
			} else {
				widthIn = Math.max(viewportResizeSession.startWidthIn + deltaXIn, MIN_VIEWPORT_WIDTH_IN)
			}

			if (viewportResizeSession.handle === 'nw' || viewportResizeSession.handle === 'ne') {
				yIn = Math.min(viewportResizeSession.startYIn + deltaYIn, startBottom - MIN_VIEWPORT_HEIGHT_IN)
				heightIn = startBottom - yIn
			} else {
				heightIn = Math.max(viewportResizeSession.startHeightIn + deltaYIn, MIN_VIEWPORT_HEIGHT_IN)
			}

			const nextPreview: ViewportResizePreview = {
				viewportId: viewportResizeSession.viewportId,
				xIn,
				yIn,
				widthIn,
				heightIn,
			}
			viewportResizeDraftRef.current = nextPreview
			setViewportResizePreview(nextPreview)
		}

		window.addEventListener('pointermove', handlePointerMove)
		window.addEventListener('pointerup', commitResize)
		window.addEventListener('pointercancel', commitResize)

		return () => {
			window.removeEventListener('pointermove', handlePointerMove)
			window.removeEventListener('pointerup', commitResize)
			window.removeEventListener('pointercancel', commitResize)
		}
		}, [sheetGeometry.contentAreaIn, templateHeight, templateWidth, updateViewport, viewportResizeSession])

	useEffect(() => {
		if (!viewportContentPanSession) return undefined

		const commitPan = () => {
			const draft = viewportContentPanDraftRef.current
			if (draft) {
				updateViewport(draft.viewportId, viewport => ({
					...viewport,
					contentOffsetXIn: draft.contentOffsetXIn,
					contentOffsetYIn: draft.contentOffsetYIn,
				}))
			}
			viewportContentPanDraftRef.current = null
			setViewportContentPanPreview(null)
			setViewportContentPanSession(null)
		}

		const handlePointerMove = (event: PointerEvent) => {
			const el = contentRef.current ?? sheetRef.current
			if (!el) return
			const rect = el.getBoundingClientRect()
			if (rect.width <= 0 || rect.height <= 0) return
				const coordinateSpaceIn = getSheetCoordinateSpaceIn({
					coordinateElement: el,
					contentElement: contentRef.current,
					contentAreaIn: sheetGeometry.contentAreaIn,
					templateWidth,
					templateHeight,
				})

				const deltaXIn = ((event.clientX - viewportContentPanSession.originClientX) / rect.width) * coordinateSpaceIn.width
				const deltaYIn = ((event.clientY - viewportContentPanSession.originClientY) / rect.height) * coordinateSpaceIn.height
			const nextPreview: ViewportContentPanPreview = {
				viewportId: viewportContentPanSession.viewportId,
				contentOffsetXIn: clampViewportContentOffsetX(viewportContentPanSession.startContentOffsetXIn + deltaXIn, viewportContentPanSession.widthIn),
				contentOffsetYIn: clampViewportContentOffsetY(viewportContentPanSession.startContentOffsetYIn + deltaYIn, viewportContentPanSession.heightIn),
			}
			viewportContentPanDraftRef.current = nextPreview
			setViewportContentPanPreview(nextPreview)
		}

		window.addEventListener('pointermove', handlePointerMove)
		window.addEventListener('pointerup', commitPan)
		window.addEventListener('pointercancel', commitPan)

		return () => {
			window.removeEventListener('pointermove', handlePointerMove)
			window.removeEventListener('pointerup', commitPan)
			window.removeEventListener('pointercancel', commitPan)
		}
		}, [sheetGeometry.contentAreaIn, templateHeight, templateWidth, updateViewport, viewportContentPanSession])

  useEffect(() => {
		if (!annotationDragSession) return undefined

	const marginIn = activeTemplate?.marginIn ?? 0.5
	const contentAreaIn = sheetGeometry.contentAreaIn
	const maxAnnotationY = Math.max(contentAreaIn.top, contentAreaIn.bottom - 0.8)
	const peerViewports = activeSheet?.viewports ?? []
	const peerAnnotations = activeSheet?.annotations.filter(annotation => annotation.id !== annotationDragSession.annotationId) ?? []

	const commitDrag = () => {
			const draft = annotationDragDraftRef.current
		if (draft) {
			updateAnnotation(draft.annotationId, annotation => ({
				...annotation,
				xIn: draft.xIn,
				yIn: draft.yIn,
				leaderTo: draft.leaderTo ?? annotation.leaderTo,
			}))
		}
			annotationDragDraftRef.current = null
			clearLayoutSnapFeedback()
			setAnnotationDragPreview(null)
			setAnnotationDragSession(null)
	}

	const handlePointerMove = (event: PointerEvent) => {
		const el = contentRef.current ?? sheetRef.current
		if (!el) return
		const rect = el.getBoundingClientRect()
		if (rect.width <= 0 || rect.height <= 0) return
			const coordinateSpaceIn = getSheetCoordinateSpaceIn({
				coordinateElement: el,
				contentElement: contentRef.current,
				contentAreaIn,
				templateWidth,
				templateHeight,
			})

			const deltaXIn = ((event.clientX - annotationDragSession.originClientX) / rect.width) * coordinateSpaceIn.width
			const deltaYIn = ((event.clientY - annotationDragSession.originClientY) / rect.height) * coordinateSpaceIn.height

			if (annotationDragSession.kind === 'annotation') {
				const snappedPlacement = applySheetLayoutSnapping({
					subject: 'annotation',
					xIn: annotationDragSession.startXIn + deltaXIn,
					yIn: annotationDragSession.startYIn + deltaYIn,
					widthIn: annotationDragSession.widthIn,
					heightIn: APPROX_ANNOTATION_HEIGHT_IN,
					contentAreaIn,
					templateWidth,
					templateHeight,
					maxYIn: maxAnnotationY,
					peerViewports,
					peerAnnotations,
				})
				const nextPreview: AnnotationDragPreview = {
					annotationId: annotationDragSession.annotationId,
					xIn: snappedPlacement.xIn,
					yIn: snappedPlacement.yIn,
					leaderTo: annotationDragSession.leaderTo,
				}
				annotationDragDraftRef.current = nextPreview
				setLayoutSnapFeedback(snappedPlacement.feedback)
				setAnnotationDragPreview(nextPreview)
				return
			}

		setLayoutSnapFeedback(null)

		const nextPreview: AnnotationDragPreview = {
				annotationId: annotationDragSession.annotationId,
				xIn: annotationDragSession.startXIn,
				yIn: annotationDragSession.startYIn,
			leaderTo: {
					xIn: clamp(annotationDragSession.leaderTo.xIn + deltaXIn, contentAreaIn.left, contentAreaIn.right),
					yIn: clamp(annotationDragSession.leaderTo.yIn + deltaYIn, contentAreaIn.top, contentAreaIn.bottom),
				},
		}
			annotationDragDraftRef.current = nextPreview
			setAnnotationDragPreview(nextPreview)
		}

	window.addEventListener('pointermove', handlePointerMove)
	window.addEventListener('pointerup', commitDrag)
	window.addEventListener('pointercancel', commitDrag)

	return () => {
		window.removeEventListener('pointermove', handlePointerMove)
		window.removeEventListener('pointerup', commitDrag)
		window.removeEventListener('pointercancel', commitDrag)
	}
	  }, [activeSheet, activeTemplate?.marginIn, annotationDragSession, clearLayoutSnapFeedback, sheetGeometry.contentAreaIn, templateHeight, templateWidth, updateAnnotation])

	  useEffect(() => {
		if (!sourceAnnotationDragSession) return undefined

		const commitDrag = () => {
			const draft = sourceAnnotationDragDraftRef.current
			if (draft) {
				updateSourceAnnotation(draft.annotationId, annotation => ({
					...annotation,
					x: draft.x,
					y: draft.y,
					target: draft.target ?? annotation.target,
				}))
			}
			sourceAnnotationDragDraftRef.current = null
			setSourceAnnotationDragPreview(null)
			setSourceAnnotationDragSession(null)
		}

		const handlePointerMove = (event: PointerEvent) => {
			if (!sourceCanvasRef.current) return
			const rect = sourceCanvasRef.current.getBoundingClientRect()
			if (rect.width <= 0 || rect.height <= 0) return

			const deltaX = ((event.clientX - sourceAnnotationDragSession.originClientX) / rect.width) * 100
			const deltaY = ((event.clientY - sourceAnnotationDragSession.originClientY) / rect.height) * 100
			let nextPreview: SourceAnnotationDragPreview

			if (sourceAnnotationDragSession.kind === 'note') {
				nextPreview = {
					annotationId: sourceAnnotationDragSession.annotationId,
					x: clampSourceNoteX(sourceAnnotationDragSession.startX + deltaX, sourceAnnotationDragSession.width),
					y: clampSourceNoteY(sourceAnnotationDragSession.startY + deltaY),
				}
			} else if (sourceAnnotationDragSession.kind === 'dimension') {
				const translated = translateSourceDimensionPoints({
					x: sourceAnnotationDragSession.startX,
					y: sourceAnnotationDragSession.startY,
					targetX: sourceAnnotationDragSession.startTargetX,
					targetY: sourceAnnotationDragSession.startTargetY,
					deltaX,
					deltaY,
				})
				nextPreview = {
					annotationId: sourceAnnotationDragSession.annotationId,
					...translated,
				}
			} else if (sourceAnnotationDragSession.kind === 'dimension-start') {
				nextPreview = {
					annotationId: sourceAnnotationDragSession.annotationId,
					x: clampSourceDimensionPoint(sourceAnnotationDragSession.startX + deltaX),
					y: clampSourceDimensionPoint(sourceAnnotationDragSession.startY + deltaY),
					target: {
						x: sourceAnnotationDragSession.startTargetX,
						y: sourceAnnotationDragSession.startTargetY,
					},
				}
			} else {
				nextPreview = {
					annotationId: sourceAnnotationDragSession.annotationId,
					x: sourceAnnotationDragSession.startX,
					y: sourceAnnotationDragSession.startY,
					target: {
						x: clampSourceDimensionPoint(sourceAnnotationDragSession.startTargetX + deltaX),
						y: clampSourceDimensionPoint(sourceAnnotationDragSession.startTargetY + deltaY),
					},
				}
			}

			sourceAnnotationDragDraftRef.current = nextPreview
			setSourceAnnotationDragPreview(nextPreview)
		}

		window.addEventListener('pointermove', handlePointerMove)
		window.addEventListener('pointerup', commitDrag)
		window.addEventListener('pointercancel', commitDrag)

		return () => {
			window.removeEventListener('pointermove', handlePointerMove)
			window.removeEventListener('pointerup', commitDrag)
			window.removeEventListener('pointercancel', commitDrag)
		}
	  }, [sourceAnnotationDragSession, updateSourceAnnotation])

	useEffect(() => {
		if (!sheetMarqueeSelectionSession) return undefined

		const clearMarqueeSelection = () => {
			setSheetMarqueeSelectionPreview(null)
			setSheetMarqueeSelectionSession(null)
		}

		const handlePointerMove = (event: PointerEvent) => {
			const el = contentRef.current ?? sheetRef.current
			if (!el) return
				const coordinateSpaceIn = getSheetCoordinateSpaceIn({
					coordinateElement: el,
					contentElement: contentRef.current,
					contentAreaIn: sheetGeometry.contentAreaIn,
					templateWidth,
					templateHeight,
				})
			const point = getSheetPointFromClientPosition({
				clientX: event.clientX,
				clientY: event.clientY,
				sheetElement: el,
					coordinateSpaceIn,
			})
			if (!point) return

			const nextPreview: SheetMarqueeSelectionPreview = {
				currentClientX: event.clientX,
				currentClientY: event.clientY,
				currentXIn: point.xIn,
				currentYIn: point.yIn,
			}
			setSheetMarqueeSelectionPreview(nextPreview)

			if (!hasSheetMarqueeExceededDragThreshold(sheetMarqueeSelectionSession, nextPreview)) return

			const nextSelection = resolveSheetMarqueeSelection({
				marqueeBounds: getNormalizedSheetSelectionBounds(
					sheetMarqueeSelectionSession.startXIn,
					sheetMarqueeSelectionSession.startYIn,
					nextPreview.currentXIn,
					nextPreview.currentYIn,
				),
				viewports: displayedViewports,
				annotations: displayedAnnotations,
				baseViewportIds: sheetMarqueeSelectionSession.baseViewportIds,
				baseAnnotationIds: sheetMarqueeSelectionSession.baseAnnotationIds,
				multiSelect: sheetMarqueeSelectionSession.multiSelect,
			})
			setSelectedViewportIds(nextSelection.viewportIds)
			setSelectedAnnotationIds(nextSelection.annotationIds)
		}

		window.addEventListener('pointermove', handlePointerMove)
		window.addEventListener('pointerup', clearMarqueeSelection)
		window.addEventListener('pointercancel', clearMarqueeSelection)

		return () => {
			window.removeEventListener('pointermove', handlePointerMove)
			window.removeEventListener('pointerup', clearMarqueeSelection)
			window.removeEventListener('pointercancel', clearMarqueeSelection)
		}
		}, [displayedAnnotations, displayedViewports, sheetGeometry.contentAreaIn, sheetMarqueeSelectionSession, templateHeight, templateWidth])

  const handleSelectSheet = useCallback((sheetId: string) => {
	  clearViewportInteractionState()
	  clearAnnotationInteractionState()
	  clearSourceAnnotationInteractionState()
		    clearSheetSelection()
	  setSelectedSourceAnnotationId(null)
		setActiveCanvasViewId(null)
    setDrawingPackage(prev => ({ ...prev, activeSheetId: sheetId }))
	  }, [clearAnnotationInteractionState, clearSheetSelection, clearSourceAnnotationInteractionState, clearViewportInteractionState, setDrawingPackage])

	  const handleSelectView = (viewId: string) => {
		clearViewportInteractionState()
		clearAnnotationInteractionState()
		clearSourceAnnotationInteractionState()
			clearSheetSelection()
		setSelectedSourceAnnotationId(null)
			if (activeCanvasViewId) {
				setOpenSourceViewTabIds(current => (current.includes(viewId) ? current : [...current, viewId]))
				setActiveCanvasViewId(viewId)
			}
    setDrawingPackage(prev => ({ ...prev, activeViewId: viewId }))
  }

  const handleSelectSection = (sectionId: string) => {
    setDrawingPackage(prev => ({ ...prev, activeSectionId: sectionId }))
  }

	  // Template switching removed — 8.5 × 11 is the only supported format.

	  const handleCreateSheetFromTemplate = useCallback(() => {
		clearViewportInteractionState()
		clearAnnotationInteractionState()
		clearSourceAnnotationInteractionState()
			clearSheetSelection()
		setSelectedSourceAnnotationId(null)
		setDrawingPackage(prev => {
			const fallbackTemplateId = prev.sheets.find(sheet => sheet.id === prev.activeSheetId)?.templateId ?? prev.templates[0]?.id
			const template = prev.templates.find(entry => entry.id === fallbackTemplateId) ?? prev.templates[0]
			if (!template) return prev

			const sheetId = createDrawingEntityId('sheet')
			const sheetNumber = getNextSheetNumber(prev.sheets)
			const maxOrder = prev.sheets.reduce((max, s) => Math.max(max, s.order ?? 0), -1)
			const sheet: DrawingSheet = {
				id: sheetId,
				number: sheetNumber,
				name: 'New Layout Sheet',
				order: maxOrder + 1,
				templateId: template.id,
				viewports: [],
				annotations: [],
					footerSmartText: prev.sheets.length === 0 ? createDefaultFirstPageFooterSmartText() : undefined,
					titleBlockText: resolveDrawingSheetTitleBlockText(undefined, projectName, issueDateLabel),
			}

			return {
				...prev,
				activeSheetId: sheetId,
				sheets: [...prev.sheets, sheet],
			}
		})
		  }, [clearAnnotationInteractionState, clearSheetSelection, clearSourceAnnotationInteractionState, clearViewportInteractionState, issueDateLabel, projectName, setDrawingPackage])

  const handleDuplicateSheet = () => {
    setDrawingPackage(prev => {
      const source = prev.sheets.find(sheet => sheet.id === prev.activeSheetId) ?? prev.sheets[prev.sheets.length - 1]
      if (!source) return prev

      const sheetCopy = cloneSheet(source)
	      const sheetNumber = getNextSheetNumber(prev.sheets)
      const maxOrder = prev.sheets.reduce((max, s) => Math.max(max, s.order ?? 0), -1)
      sheetCopy.id = createDrawingEntityId('sheet')
      sheetCopy.number = sheetNumber
      sheetCopy.name = `${source.name} Copy`
      sheetCopy.order = maxOrder + 1
			sheetCopy.footerSmartText = undefined
				sheetCopy.titleBlockText = resolveDrawingSheetTitleBlockText(sheetCopy.titleBlockText, projectName, issueDateLabel)
      sheetCopy.viewports = sheetCopy.viewports.map(viewport => ({ ...viewport, id: createDrawingEntityId('viewport') }))
      sheetCopy.annotations = [
        ...sheetCopy.annotations.map(annotation => ({ ...annotation, id: createDrawingEntityId('annotation') })),
        {
          id: createDrawingEntityId('annotation'),
          kind: 'text',
          text: 'Duplicated from the active premium layout. Replace with detail-specific notes or alternate section placements.',
          xIn: 1.25,
          yIn: 18.1,
          widthIn: 13,
        },
      ]

      return {
        ...prev,
        activeSheetId: sheetCopy.id,
        sheets: [...prev.sheets, sheetCopy],
      }
    })
	  }

  const handleNavigateSheetPrev = useCallback(() => {
    if (activeSheetIndex <= 0) return
    const prevSheet = sortedSheets[activeSheetIndex - 1]
    if (prevSheet) handleSelectSheet(prevSheet.id)
  }, [activeSheetIndex, sortedSheets, handleSelectSheet])

  const handleNavigateSheetNext = useCallback(() => {
    if (activeSheetIndex < 0 || activeSheetIndex >= sortedSheets.length - 1) return
    const nextSheet = sortedSheets[activeSheetIndex + 1]
    if (nextSheet) handleSelectSheet(nextSheet.id)
  }, [activeSheetIndex, sortedSheets, handleSelectSheet])

  const handleDeleteSheet = useCallback(() => {
    if (!activeSheet) return
    if (sortedSheets.length <= 1) {
      window.alert('Cannot delete the last remaining sheet.')
      return
    }
    const confirmed = window.confirm(`Delete sheet "${activeSheet.number} – ${activeSheet.name}"?`)
    if (!confirmed) return

    const deletedIndex = activeSheetIndex
    const deletedId = activeSheet.id

    // Determine fallback sheet: prefer next, else previous
    const fallbackSheet = sortedSheets[deletedIndex + 1] ?? sortedSheets[deletedIndex - 1] ?? sortedSheets[0]

    clearViewportInteractionState()
    clearAnnotationInteractionState()
    clearSourceAnnotationInteractionState()
    clearSheetSelection()
    setSelectedSourceAnnotationId(null)
		setActiveCanvasViewId(null)

    setDrawingPackage(prev => ({
      ...prev,
      activeSheetId: fallbackSheet?.id ?? prev.activeSheetId,
      sheets: prev.sheets.filter(sheet => sheet.id !== deletedId),
    }))
  }, [activeSheet, activeSheetIndex, clearAnnotationInteractionState, clearSheetSelection, clearSourceAnnotationInteractionState, clearViewportInteractionState, setDrawingPackage, sortedSheets])

  const handleAddAnnotation = useCallback((kind: DrawingAnnotationKind) => {
	if (!activeSheet || !activeTemplate) return
	const annotationId = createDrawingEntityId('annotation')
	const noteCount = activeSheet.annotations.length
	const ca = sheetGeometry.contentAreaIn
	const nextY = clamp(ca.bottom - 1.5 - noteCount * 0.95, ca.top, ca.bottom - 1.2)
	const annotation: DrawingAnnotation =
		kind === 'callout'
			? {
				id: annotationId,
				kind,
				text: `Callout ${noteCount + 1}: tag critical access, tie-in, or clearance information for the issue set.`,
				xIn: clamp(ca.right - 10.5, ca.left, ca.right - 8.8),
				yIn: nextY,
				widthIn: 8.8,
				leaderTo: {
					xIn: clamp(ca.right - 14.5, ca.left, ca.right),
					yIn: clamp(nextY - 2.1, ca.top, ca.bottom),
				},
			}
			: {
				id: annotationId,
				kind,
				text: `General note ${noteCount + 1}: refine viewport extents, tags, and callouts for issue set output.`,
				xIn: ca.left + 0.75,
				yIn: nextY,
				widthIn: 15.2,
			}

	updateActiveSheet(sheet => ({
		...sheet,
		annotations: [...sheet.annotations, annotation],
	}))
		clearViewportInteractionState()
		clearAnnotationInteractionState()
		clearSourceAnnotationInteractionState()
		setSelectedSourceAnnotationId(null)
			selectSingleAnnotation(annotationId)
		  }, [activeSheet, activeTemplate, clearAnnotationInteractionState, clearSourceAnnotationInteractionState, clearViewportInteractionState, selectSingleAnnotation, templateHeight, templateWidth, updateActiveSheet])

  const handleAddNote = () => {
	handleAddAnnotation('text')
  }

  const handleAddCallout = () => {
	handleAddAnnotation('callout')
  }


  const handleDeleteAnnotation = useCallback((annotationId: string) => {
	updateActiveSheet(sheet => ({
		...sheet,
		annotations: sheet.annotations.filter(annotation => annotation.id !== annotationId),
	}))
		setSelectedAnnotationIds(current => current.filter(currentId => currentId !== annotationId))
  }, [updateActiveSheet])

	  const handleDeleteViewport = useCallback((viewportId: string) => {
		clearViewportInteractionState()
		updateActiveSheet(sheet => ({
			...sheet,
			viewports: sheet.viewports.filter(viewport => viewport.id !== viewportId),
		}))
		setSelectedViewportIds(current => current.filter(currentId => currentId !== viewportId))
	  }, [clearViewportInteractionState, updateActiveSheet])

  const handleAnnotationKindChange = useCallback((annotationId: string, kind: DrawingAnnotationKind) => {
	const ca = sheetGeometry.contentAreaIn
	updateAnnotation(annotationId, annotation => ({
		...annotation,
		kind,
		widthIn: kind === 'callout' ? Math.min(Math.max(annotation.widthIn, 6.5), 10.5) : annotation.widthIn,
		leaderTo:
			kind === 'callout'
				? annotation.leaderTo ?? {
					xIn: clamp(annotation.xIn - 4, ca.left, ca.right),
					yIn: clamp(annotation.yIn - 1.4, ca.top, ca.bottom),
				}
				: undefined,
	}))
  }, [sheetGeometry.contentAreaIn, updateAnnotation])

  const handleAnnotationTextChange = useCallback((annotationId: string, text: string) => {
	updateAnnotation(annotationId, annotation => ({ ...annotation, text }))
  }, [updateAnnotation])

  const handleAnnotationPlacementChange = useCallback((annotationId: string, field: 'xIn' | 'yIn' | 'widthIn', rawValue: string) => {
	const value = Number.parseFloat(rawValue)
	if (!Number.isFinite(value)) return
	const ca = sheetGeometry.contentAreaIn
	updateAnnotation(annotationId, annotation => {
		if (field === 'widthIn') {
			return {
				...annotation,
				widthIn: clamp(value, 2.5, Math.max(2.5, ca.right - annotation.xIn)),
			}
		}
		if (field === 'xIn') {
			return {
				...annotation,
				xIn: clamp(value, ca.left, Math.max(ca.left, ca.right - annotation.widthIn)),
			}
		}
		return {
			...annotation,
			yIn: clamp(value, ca.top, Math.max(ca.top, ca.bottom - 0.8)),
		}
	})
  }, [sheetGeometry.contentAreaIn, updateAnnotation])

  const handleAnnotationLeaderChange = useCallback((annotationId: string, axis: 'xIn' | 'yIn', rawValue: string) => {
	const value = Number.parseFloat(rawValue)
	if (!Number.isFinite(value)) return
	const ca = sheetGeometry.contentAreaIn
	updateAnnotation(annotationId, annotation => {
		const currentLeader = annotation.leaderTo ?? { xIn: annotation.xIn - 4, yIn: annotation.yIn - 1.4 }
		return {
			...annotation,
			leaderTo: {
				...currentLeader,
				[axis]: clamp(value, axis === 'xIn' ? ca.left : ca.top, axis === 'xIn' ? ca.right : ca.bottom),
			},
		}
	})
  }, [sheetGeometry.contentAreaIn, updateAnnotation])

	const handleViewportPlacementChange = useCallback((viewportId: string, field: 'xIn' | 'yIn' | 'widthIn' | 'heightIn', rawValue: string) => {
		const value = Number.parseFloat(rawValue)
		if (!Number.isFinite(value)) return
		updateViewport(viewportId, viewport => {
			if (field === 'xIn') {
				return { ...viewport, xIn: value }
			}
			if (field === 'yIn') {
				return { ...viewport, yIn: value }
			}

			const widthIn = field === 'widthIn'
				? Math.max(value, MIN_VIEWPORT_WIDTH_IN)
				: viewport.widthIn
			const heightIn = field === 'heightIn'
				? Math.max(value, MIN_VIEWPORT_HEIGHT_IN)
				: viewport.heightIn

			return {
				...viewport,
				widthIn,
				heightIn,
				contentOffsetXIn: clampViewportContentOffsetX(viewport.contentOffsetXIn, widthIn),
				contentOffsetYIn: clampViewportContentOffsetY(viewport.contentOffsetYIn, heightIn),
			}
		})
	}, [updateViewport])

	const handleViewportContentOffsetChange = useCallback((viewportId: string, field: 'contentOffsetXIn' | 'contentOffsetYIn', rawValue: string) => {
		const value = Number.parseFloat(rawValue)
		if (!Number.isFinite(value)) return
		updateViewport(viewportId, viewport => ({
			...viewport,
			contentOffsetXIn:
				field === 'contentOffsetXIn'
					? clampViewportContentOffsetX(value, viewport.widthIn)
					: viewport.contentOffsetXIn,
			contentOffsetYIn:
				field === 'contentOffsetYIn'
					? clampViewportContentOffsetY(value, viewport.heightIn)
					: viewport.contentOffsetYIn,
		}))
	}, [updateViewport])

	const handleResetViewportFraming = useCallback((viewportId: string) => {
		updateViewport(viewportId, viewport => ({
			...viewport,
			contentOffsetXIn: 0,
			contentOffsetYIn: 0,
		}))
	}, [updateViewport])

	const handleViewportAlignToSheet = useCallback((viewportId: string, action: SheetAlignmentAction) => {
		clearViewportInteractionState()
		clearAnnotationInteractionState()
		clearSourceAnnotationInteractionState()
			const targetIds = resolveViewportActionSelectionIds(viewportId, selectedViewportIds)
			const targetIdSet = new Set(targetIds)
			const targetViewports = displayedViewports.filter(viewport => targetIdSet.has(viewport.id))
			if (targetViewports.length === 0 || targetViewports.some(viewport => viewport.isLocked)) return

			const selectionBounds = getViewportCollectionBounds(targetViewports)
			if (!selectionBounds) return

			const nextPlacement = getSheetAlignedPlacement({
				action,
				xIn: selectionBounds.left,
				yIn: selectionBounds.top,
				widthIn: selectionBounds.width,
				heightIn: selectionBounds.height,
				contentAreaIn: sheetGeometry.contentAreaIn,
			})
			const deltaXIn = nextPlacement.xIn - selectionBounds.left
			const deltaYIn = nextPlacement.yIn - selectionBounds.top

			updateActiveSheet(sheet => ({
				...sheet,
				viewports: sheet.viewports.map(viewport => (
					targetIdSet.has(viewport.id)
						? {
							...viewport,
							xIn: viewport.xIn + deltaXIn,
							yIn: viewport.yIn + deltaYIn,
						}
						: viewport
				)),
			}))
		}, [clearAnnotationInteractionState, clearSourceAnnotationInteractionState, clearViewportInteractionState, displayedViewports, selectedViewportIds, sheetGeometry.contentAreaIn, updateActiveSheet])

		const handleViewportTidy = useCallback((viewportId: string, axis: ViewportTidyAxis) => {
			const targetIds = resolveViewportActionSelectionIds(viewportId, selectedViewportIds)
			if (targetIds.length < 3) return

			clearViewportInteractionState()
			clearAnnotationInteractionState()
			clearSourceAnnotationInteractionState()

			const targetIdSet = new Set(targetIds)
			const targetViewports = displayedViewports.filter(viewport => targetIdSet.has(viewport.id))
			if (targetViewports.length < 3 || targetViewports.some(viewport => viewport.isLocked)) return

			const nextPositions = distributeViewportsByAxis(targetViewports, axis)
			updateActiveSheet(sheet => ({
				...sheet,
				viewports: sheet.viewports.map(viewport => {
					const nextPosition = nextPositions.get(viewport.id)
					return nextPosition ? { ...viewport, ...nextPosition } : viewport
				}),
			}))
		}, [clearAnnotationInteractionState, clearSourceAnnotationInteractionState, clearViewportInteractionState, displayedViewports, selectedViewportIds, updateActiveSheet])

		const handleMatchViewportSize = useCallback((viewportId: string) => {
			const targetIds = resolveViewportActionSelectionIds(viewportId, selectedViewportIds)
			if (targetIds.length < 2) return

			clearViewportInteractionState()
			clearAnnotationInteractionState()
			clearSourceAnnotationInteractionState()

			const anchorId = resolveViewportActionAnchorId(viewportId, selectedViewportIds, selectedViewportAnchorId)
			const targetIdSet = new Set(targetIds)
			const targetViewports = displayedViewports.filter(viewport => targetIdSet.has(viewport.id))
			if (targetViewports.length < 2 || targetViewports.some(viewport => viewport.isLocked)) return

			const anchorViewport = targetViewports.find(viewport => viewport.id === anchorId)
			if (!anchorViewport) return

			const anchorPlacement = clampViewportPlacementToContentArea({
				xIn: anchorViewport.xIn,
				yIn: anchorViewport.yIn,
				widthIn: anchorViewport.widthIn,
				heightIn: anchorViewport.heightIn,
				contentAreaIn: sheetGeometry.contentAreaIn,
			})

			updateActiveSheet(sheet => ({
				...sheet,
				viewports: sheet.viewports.map(viewport => {
					if (!targetIdSet.has(viewport.id)) return viewport

					const nextPlacement = clampViewportPlacementToContentArea({
						xIn: viewport.xIn,
						yIn: viewport.yIn,
						widthIn: anchorPlacement.widthIn,
						heightIn: anchorPlacement.heightIn,
						contentAreaIn: sheetGeometry.contentAreaIn,
					})

					return {
						...viewport,
						...nextPlacement,
						contentOffsetXIn: clampViewportContentOffsetX(viewport.contentOffsetXIn, nextPlacement.widthIn),
						contentOffsetYIn: clampViewportContentOffsetY(viewport.contentOffsetYIn, nextPlacement.heightIn),
					}
				}),
			}))
		}, [clearAnnotationInteractionState, clearSourceAnnotationInteractionState, clearViewportInteractionState, displayedViewports, selectedViewportAnchorId, selectedViewportIds, sheetGeometry.contentAreaIn, updateActiveSheet])

		const handleDuplicateViewport = useCallback((viewportId: string) => {
			const targetIds = resolveViewportActionSelectionIds(viewportId, selectedViewportIds)
			const targetIdSet = new Set(targetIds)
			const sourceViewports = displayedViewports.filter(viewport => targetIdSet.has(viewport.id))
			if (sourceViewports.length === 0) return

			const selectionBounds = getViewportCollectionBounds(sourceViewports)
			if (!selectionBounds) return

			clearViewportInteractionState()
			clearAnnotationInteractionState()
			clearSourceAnnotationInteractionState()
			setSelectedSourceAnnotationId(null)

			let offsetXIn = 0.35
			let offsetYIn = 0.35
			if (selectionBounds.right + offsetXIn > sheetGeometry.contentAreaIn.right) {
				offsetXIn = sheetGeometry.contentAreaIn.right - selectionBounds.right
			}
			if (selectionBounds.left + offsetXIn < sheetGeometry.contentAreaIn.left) {
				offsetXIn = sheetGeometry.contentAreaIn.left - selectionBounds.left
			}
			if (selectionBounds.bottom + offsetYIn > sheetGeometry.contentAreaIn.bottom) {
				offsetYIn = sheetGeometry.contentAreaIn.bottom - selectionBounds.bottom
			}
			if (selectionBounds.top + offsetYIn < sheetGeometry.contentAreaIn.top) {
				offsetYIn = sheetGeometry.contentAreaIn.top - selectionBounds.top
			}

			const orderedSourceViewports = displayedViewports.filter(viewport => targetIdSet.has(viewport.id))
			const duplicatedViewports = orderedSourceViewports.map(viewport => ({
				...viewport,
				id: createDrawingEntityId('viewport'),
				xIn: viewport.xIn + offsetXIn,
				yIn: viewport.yIn + offsetYIn,
			}))

			updateActiveSheet(sheet => ({
				...sheet,
				viewports: [...sheet.viewports, ...duplicatedViewports],
			}))
			setSelectedViewportIds(duplicatedViewports.map(viewport => viewport.id))
			setReframeViewportId(null)
		}, [clearAnnotationInteractionState, clearSourceAnnotationInteractionState, clearViewportInteractionState, displayedViewports, selectedViewportIds, sheetGeometry.contentAreaIn, updateActiveSheet])

	const handleAnnotationAlignToSheet = useCallback((annotationId: string, action: SheetAlignmentAction) => {
		clearViewportInteractionState()
		clearAnnotationInteractionState()
		clearSourceAnnotationInteractionState()
		updateAnnotation(annotationId, annotation => {
			const nextPlacement = getSheetAlignedPlacement({
				action,
				xIn: annotation.xIn,
				yIn: annotation.yIn,
				widthIn: annotation.widthIn,
				heightIn: APPROX_ANNOTATION_HEIGHT_IN,
				contentAreaIn: sheetGeometry.contentAreaIn,
			})
			return {
				...annotation,
				...nextPlacement,
			}
		})
	}, [clearAnnotationInteractionState, clearSourceAnnotationInteractionState, clearViewportInteractionState, sheetGeometry.contentAreaIn, updateAnnotation])

	  const handleCreateSourceViewFromModel = useCallback(() => {
		const createdId = createDrawingViewFromLiveModel()
		if (!createdId) return
			clearViewportInteractionState()
			clearAnnotationInteractionState()
			clearSourceAnnotationInteractionState()
			clearSheetSelection()
		setSelectedSourceAnnotationId(null)
		  }, [clearAnnotationInteractionState, clearSheetSelection, clearSourceAnnotationInteractionState, clearViewportInteractionState, createDrawingViewFromLiveModel])

	  const handleCreateLinkedViewFromSection = useCallback(() => {
		const createdId = createLinkedDrawingViewFromActiveSection()
		if (!createdId) return
			clearViewportInteractionState()
			clearAnnotationInteractionState()
			clearSourceAnnotationInteractionState()
			clearSheetSelection()
		setSelectedSourceAnnotationId(null)
		  }, [clearAnnotationInteractionState, clearSheetSelection, clearSourceAnnotationInteractionState, clearViewportInteractionState, createLinkedDrawingViewFromActiveSection])

	  const handleAddSourceAnnotation = useCallback((kind: DrawingSourceAnnotationKind) => {
		if (!activeView) return
		const annotationId = createDrawingEntityId('source-annotation')
		const index = activeView.sourceAnnotations.length
		const annotation: DrawingSourceAnnotation =
			kind === 'dimension'
				? {
					id: annotationId,
					kind,
					text: `${12 + index}'-0"`,
					x: clampSourceDimensionPoint(18),
					y: clampSourceDimensionPoint(78 - index * 7),
					width: clampSourceAnnotationWidth(24),
					target: { x: clampSourceDimensionPoint(66), y: clampSourceDimensionPoint(78 - index * 7) },
				}
				: {
					id: annotationId,
					kind,
					text: `Source note ${index + 1}`,
					x: clampSourceNoteX(10 + (index % 4) * 10, 28),
					y: clampSourceNoteY(12 + index * 8),
					width: clampSourceAnnotationWidth(28),
				}

		updateActiveView(view => ({
			...view,
			sourceAnnotations: [...view.sourceAnnotations, annotation],
		}))
			clearViewportInteractionState()
			clearAnnotationInteractionState()
			clearSourceAnnotationInteractionState()
			clearSheetSelection()
		setSelectedSourceAnnotationId(annotationId)
		  }, [activeView, clearAnnotationInteractionState, clearSheetSelection, clearSourceAnnotationInteractionState, clearViewportInteractionState, updateActiveView])

	  const handleDeleteSourceAnnotation = useCallback((annotationId: string) => {
		updateActiveView(view => ({
			...view,
			sourceAnnotations: view.sourceAnnotations.filter(annotation => annotation.id !== annotationId),
		}))
		setSelectedSourceAnnotationId(current => (current === annotationId ? null : current))
	  }, [updateActiveView])

	  const handleSourceAnnotationTextChange = useCallback((annotationId: string, text: string) => {
		updateSourceAnnotation(annotationId, annotation => ({ ...annotation, text }))
	  }, [updateSourceAnnotation])

	  const handleSourceAnnotationPlacementChange = useCallback((annotationId: string, field: 'x' | 'y' | 'width', rawValue: string) => {
		const value = Number.parseFloat(rawValue)
		if (!Number.isFinite(value)) return
		updateSourceAnnotation(annotationId, annotation => {
			if (field === 'width') {
				const nextWidth = clampSourceAnnotationWidth(value)
				return {
					...annotation,
					width: nextWidth,
					x: annotation.kind === 'note' ? clampSourceNoteX(annotation.x, nextWidth) : annotation.x,
				}
			}
			if (field === 'x') {
				return {
					...annotation,
					x: annotation.kind === 'note' ? clampSourceNoteX(value, annotation.width) : clampSourceDimensionPoint(value),
				}
			}
			return {
				...annotation,
				y: annotation.kind === 'note' ? clampSourceNoteY(value) : clampSourceDimensionPoint(value),
			}
		})
	  }, [updateSourceAnnotation])

	  const handleSourceAnnotationTargetChange = useCallback((annotationId: string, axis: 'x' | 'y', rawValue: string) => {
		const value = Number.parseFloat(rawValue)
		if (!Number.isFinite(value)) return
		updateSourceAnnotation(annotationId, annotation => ({
			...annotation,
			target: {
				x: annotation.target?.x ?? clampSourceDimensionPoint(annotation.x + 18),
				y: annotation.target?.y ?? clampSourceDimensionPoint(annotation.y),
				[axis]: clampSourceDimensionPoint(value),
			},
		}))
	  }, [updateSourceAnnotation])

	  const beginSourceNoteDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>, annotation: DrawingSourceAnnotation) => {
		event.stopPropagation()
		event.preventDefault()
			clearViewportInteractionState()
			clearAnnotationInteractionState()
			clearSourceAnnotationInteractionState()
			clearSheetSelection()
		setSelectedSourceAnnotationId(annotation.id)
		setSourceAnnotationDragSession({
			kind: 'note',
			annotationId: annotation.id,
			originClientX: event.clientX,
			originClientY: event.clientY,
			startX: annotation.x,
			startY: annotation.y,
			width: annotation.width,
		})
		  }, [clearAnnotationInteractionState, clearSheetSelection, clearSourceAnnotationInteractionState, clearViewportInteractionState])

	  const beginSourceDimensionDrag = useCallback((event: ReactPointerEvent<SVGElement>, annotation: DrawingSourceAnnotation) => {
		if (!annotation.target) return
		event.stopPropagation()
		event.preventDefault()
			clearViewportInteractionState()
			clearAnnotationInteractionState()
			clearSourceAnnotationInteractionState()
			clearSheetSelection()
		setSelectedSourceAnnotationId(annotation.id)
		setSourceAnnotationDragSession({
			kind: 'dimension',
			annotationId: annotation.id,
			originClientX: event.clientX,
			originClientY: event.clientY,
			startX: annotation.x,
			startY: annotation.y,
			startTargetX: annotation.target.x,
			startTargetY: annotation.target.y,
		})
		  }, [clearAnnotationInteractionState, clearSheetSelection, clearSourceAnnotationInteractionState, clearViewportInteractionState])

	  const beginSourceDimensionHandleDrag = useCallback((
		event: ReactPointerEvent<SVGElement>,
		annotation: DrawingSourceAnnotation,
		kind: 'dimension-start' | 'dimension-end',
	  ) => {
		if (!annotation.target) return
		event.stopPropagation()
		event.preventDefault()
			clearViewportInteractionState()
			clearAnnotationInteractionState()
			clearSourceAnnotationInteractionState()
			clearSheetSelection()
		setSelectedSourceAnnotationId(annotation.id)
		setSourceAnnotationDragSession({
			kind,
			annotationId: annotation.id,
			originClientX: event.clientX,
			originClientY: event.clientY,
			startX: annotation.x,
			startY: annotation.y,
			startTargetX: annotation.target.x,
			startTargetY: annotation.target.y,
		})
		  }, [clearAnnotationInteractionState, clearSheetSelection, clearSourceAnnotationInteractionState, clearViewportInteractionState])

	const beginSheetMarqueeSelection = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return
		event.preventDefault()
		clearViewportInteractionState()
		clearAnnotationInteractionState()
		clearSourceAnnotationInteractionState()
		setSelectedSourceAnnotationId(null)

		const coordElement = contentRef.current ?? sheetRef.current
		if (!coordElement) {
			clearSheetSelection()
			return
		}

		const point = getSheetPointFromClientPosition({
			clientX: event.clientX,
			clientY: event.clientY,
			sheetElement: coordElement,
				coordinateSpaceIn: getSheetCoordinateSpaceIn({
					coordinateElement: coordElement,
					contentElement: contentRef.current,
					contentAreaIn: sheetGeometry.contentAreaIn,
					templateWidth,
					templateHeight,
				}),
		})
		if (!point) {
			clearSheetSelection()
			return
		}

		const multiSelect = hasSelectionModifier(event)
		const baseViewportIds = multiSelect ? selectedViewportIds : []
		const baseAnnotationIds = multiSelect ? selectedAnnotationIds : []

		if (!multiSelect) {
			clearSheetSelection()
		}

		setSheetMarqueeSelectionSession({
			originClientX: event.clientX,
			originClientY: event.clientY,
			startXIn: point.xIn,
			startYIn: point.yIn,
			baseViewportIds,
			baseAnnotationIds,
			multiSelect,
		})
		setSheetMarqueeSelectionPreview({
			currentClientX: event.clientX,
			currentClientY: event.clientY,
			currentXIn: point.xIn,
			currentYIn: point.yIn,
		})
		}, [clearAnnotationInteractionState, clearSheetSelection, clearSourceAnnotationInteractionState, clearViewportInteractionState, selectedAnnotationIds, selectedViewportIds, sheetGeometry.contentAreaIn, templateHeight, templateWidth])

	  const handleActivateSheetTab = useCallback(() => {
		clearSourceAnnotationInteractionState()
		setSelectedSourceAnnotationId(null)
		setActiveCanvasViewId(null)
	  }, [clearSourceAnnotationInteractionState])

	  const handleOpenSourceViewTab = useCallback((viewId: string) => {
		clearViewportInteractionState()
		clearAnnotationInteractionState()
		clearSourceAnnotationInteractionState()
		clearSheetSelection()
		setSelectedSourceAnnotationId(null)
		setOpenSourceViewTabIds(current => (current.includes(viewId) ? current : [...current, viewId]))
		setActiveCanvasViewId(viewId)
		setDrawingPackage(prev => ({ ...prev, activeViewId: viewId }))
	  }, [clearAnnotationInteractionState, clearSheetSelection, clearSourceAnnotationInteractionState, clearViewportInteractionState, setDrawingPackage])

	  const handleCloseSourceViewTab = useCallback((viewId: string) => {
		const remainingViewIds = openSourceViewTabIds.filter(currentId => currentId !== viewId)
		const nextActiveViewId = activeCanvasViewId === viewId ? remainingViewIds[remainingViewIds.length - 1] ?? null : activeCanvasViewId
		setOpenSourceViewTabIds(remainingViewIds)
		setActiveCanvasViewId(nextActiveViewId)
		clearSourceAnnotationInteractionState()
		setSelectedSourceAnnotationId(null)
		if (nextActiveViewId) {
			setDrawingPackage(prev => ({ ...prev, activeViewId: nextActiveViewId }))
		}
	  }, [activeCanvasViewId, clearSourceAnnotationInteractionState, openSourceViewTabIds, setDrawingPackage])

	  const handleActivateSourceViewTab = useCallback((viewId: string) => {
		clearSourceAnnotationInteractionState()
		setSelectedSourceAnnotationId(null)
		setActiveCanvasViewId(viewId)
		setDrawingPackage(prev => ({ ...prev, activeViewId: viewId }))
	  }, [clearSourceAnnotationInteractionState, setDrawingPackage])

	  const handleViewportPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>, viewport: DrawingViewport) => {
		if (event.button !== 0) return
		event.stopPropagation()
		event.preventDefault()
		clearViewportInteractionState()
		clearAnnotationInteractionState()
		clearSourceAnnotationInteractionState()
		setSelectedSourceAnnotationId(null)
		if (hasSelectionModifier(event)) {
			handleViewportSelection(viewport.id, true)
			return
		}
			if (reframeViewportId === viewport.id && !viewport.isLocked) {
				selectSingleViewport(viewport.id)
				setViewportContentPanSession({
					viewportId: viewport.id,
					originClientX: event.clientX,
					originClientY: event.clientY,
					startContentOffsetXIn: viewport.contentOffsetXIn,
					startContentOffsetYIn: viewport.contentOffsetYIn,
					widthIn: viewport.widthIn,
					heightIn: viewport.heightIn,
				})
				return
			}
		selectSingleViewport(viewport.id)
		  }, [clearAnnotationInteractionState, clearSourceAnnotationInteractionState, clearViewportInteractionState, handleViewportSelection, reframeViewportId, selectSingleViewport])

	  const beginViewportDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, viewport: DrawingViewport) => {
		if (event.button !== 0) return
		event.stopPropagation()
		event.preventDefault()
			if (hasSelectionModifier(event)) {
				clearViewportInteractionState()
				clearAnnotationInteractionState()
				clearSourceAnnotationInteractionState()
				setSelectedSourceAnnotationId(null)
				handleViewportSelection(viewport.id, true)
				return
			}
			clearViewportInteractionState()
			clearAnnotationInteractionState()
			clearSourceAnnotationInteractionState()
			selectSingleViewport(viewport.id)
			setSelectedSourceAnnotationId(null)
			if (viewport.isLocked) return
		setViewportDragSession({
			viewportId: viewport.id,
			originClientX: event.clientX,
			originClientY: event.clientY,
			startXIn: viewport.xIn,
			startYIn: viewport.yIn,
			widthIn: viewport.widthIn,
			heightIn: viewport.heightIn,
		})
			  }, [clearAnnotationInteractionState, clearSourceAnnotationInteractionState, clearViewportInteractionState, handleViewportSelection, selectSingleViewport])

	const beginViewportResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>, viewport: DrawingViewport, handle: ViewportResizeHandle) => {
		if (event.button !== 0) return
		event.stopPropagation()
		event.preventDefault()
		clearViewportInteractionState()
		clearAnnotationInteractionState()
		clearSourceAnnotationInteractionState()
			selectSingleViewport(viewport.id)
		setSelectedSourceAnnotationId(null)
			if (viewport.isLocked) return
		setViewportResizeSession({
			viewportId: viewport.id,
			handle,
			originClientX: event.clientX,
			originClientY: event.clientY,
			startXIn: viewport.xIn,
			startYIn: viewport.yIn,
			startWidthIn: viewport.widthIn,
			startHeightIn: viewport.heightIn,
		})
		}, [clearAnnotationInteractionState, clearSourceAnnotationInteractionState, clearViewportInteractionState, selectSingleViewport])

	  const beginAnnotationDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, annotation: DrawingAnnotation) => {
	if (event.button !== 0) return
	event.stopPropagation()
	event.preventDefault()
			if (hasSelectionModifier(event)) {
				clearViewportInteractionState()
				clearAnnotationInteractionState()
				clearSourceAnnotationInteractionState()
				setSelectedSourceAnnotationId(null)
				handleAnnotationSelection(annotation.id, true)
				return
			}
		clearViewportInteractionState()
		clearAnnotationInteractionState()
		clearSourceAnnotationInteractionState()
			selectSingleAnnotation(annotation.id)
		setSelectedSourceAnnotationId(null)
		setAnnotationDragSession({
		kind: 'annotation',
		annotationId: annotation.id,
		originClientX: event.clientX,
		originClientY: event.clientY,
		startXIn: annotation.xIn,
		startYIn: annotation.yIn,
		widthIn: annotation.widthIn,
		leaderTo: annotation.leaderTo,
	})
		  }, [clearAnnotationInteractionState, clearSourceAnnotationInteractionState, clearViewportInteractionState, handleAnnotationSelection, selectSingleAnnotation])

  const beginLeaderDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>, annotation: DrawingAnnotation) => {
	if (event.button !== 0) return
	if (!annotation.leaderTo) return
	event.stopPropagation()
	event.preventDefault()
		clearViewportInteractionState()
		clearAnnotationInteractionState()
		clearSourceAnnotationInteractionState()
			selectSingleAnnotation(annotation.id)
		setSelectedSourceAnnotationId(null)
		setAnnotationDragSession({
		kind: 'leader',
		annotationId: annotation.id,
		originClientX: event.clientX,
		originClientY: event.clientY,
		startXIn: annotation.xIn,
		startYIn: annotation.yIn,
		widthIn: annotation.widthIn,
		leaderTo: annotation.leaderTo,
	})
		  }, [clearAnnotationInteractionState, clearSourceAnnotationInteractionState, clearViewportInteractionState, selectSingleAnnotation])

	  const handleSendViewToSheet = useCallback((viewId: string) => {
			const sourceView = viewMap.get(viewId)
		    if (!sourceView || !activeTemplate) return
		const viewportId = createDrawingEntityId('viewport')
		clearViewportInteractionState()
			clearAnnotationInteractionState()
			clearSourceAnnotationInteractionState()

    setDrawingPackage(prev => ({
      ...prev,
				activeViewId: viewId,
      sheets: prev.sheets.map(sheet => {
        if (sheet.id !== prev.activeSheetId) return sheet
				const preferredSize = getPreferredViewportSize(sourceView, sheet.viewports, viewMap)
			const placement = getNextViewportPlacement({
				existingViewports: sheet.viewports,
				contentAreaIn: sheetGeometry.contentAreaIn,
				widthIn: preferredSize.widthIn,
				heightIn: preferredSize.heightIn,
			})

        return {
          ...sheet,
	          viewports: [
				...sheet.viewports,
				{
					id: viewportId,
						viewId,
						sourceViewId: viewId,
						title: sourceView.name,
					xIn: placement.xIn,
					yIn: placement.yIn,
					widthIn: preferredSize.widthIn,
					heightIn: preferredSize.heightIn,
						scaleLabel: sourceView.scaleLabel,
					placementMode: 'free',
					contentOffsetXIn: 0,
					contentOffsetYIn: 0,
				},
	          ],
        }
      }),
    }))
			setSelectedSourceAnnotationId(null)
			selectSingleViewport(viewportId)
	  }, [activeTemplate, clearAnnotationInteractionState, clearSourceAnnotationInteractionState, clearViewportInteractionState, selectSingleViewport, setDrawingPackage, sheetGeometry.contentAreaIn, viewMap])

	  const handleSendActiveViewToSheet = useCallback(() => {
			if (!activeView) return
			handleSendViewToSheet(activeView.id)
	  }, [activeView, handleSendViewToSheet])

  /** Place a viewport on the active sheet by matching a saved-view kind (plan, elevation, section, iso).
   *  Like Chief Architect: picks the first unplaced view of the requested kind, or the first of that kind if all are placed. */
  const handlePlaceViewportByKind = useCallback((kind: DrawingSavedView['kind']) => {
    if (!activeSheet || !activeTemplate) return
    const placedViewIds = new Set(activeSheet.viewports.map(vp => vp.viewId))
    const candidates = drawingPackage.savedViews.filter(v => v.kind === kind)
    const preferred = candidates.find(v => !placedViewIds.has(v.id)) ?? candidates[0]
    if (!preferred) {
      alert(`No saved ${kind} view available. Create one in the Model workspace first.`)
      return
    }
    handleSendViewToSheet(preferred.id)
  }, [activeSheet, activeTemplate, drawingPackage.savedViews, handleSendViewToSheet])

  /** Add a source dimension annotation to the active view (used by dim-* tools). */
  const handleAddDimension = useCallback(() => {
    handleAddSourceAnnotation('dimension')
  }, [handleAddSourceAnnotation])

  /** Add a source note to the active view (used by marker tool). */
  const handleAddSourceNote = useCallback(() => {
    handleAddSourceAnnotation('note')
  }, [handleAddSourceAnnotation])

  /** Fit-All: reset zoom/pan so the full sheet is centered and visible in the stage area. */
  const handleFitAll = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    const stageRect = stage.getBoundingClientRect()
    // Use base sheet dimensions (not zoomed) since CSS zoom affects offsetWidth
    const sheetW = 1080
    const sheetH = 1080 * (templateHeight / templateWidth)
    const padFraction = 0.92
    const fitZoom = Math.min(
      (stageRect.width * padFraction) / sheetW,
      (stageRect.height * padFraction) / sheetH,
      5,
    )
    const clampedZoom = Math.max(0.15, fitZoom)
    const offsetX = (stageRect.width - sheetW * clampedZoom) / 2
    const offsetY = (stageRect.height - sheetH * clampedZoom) / 2
    setCanvasZoom(clampedZoom)
    setCanvasOffset({ x: offsetX, y: offsetY })
  }, [templateHeight, templateWidth])


		const handleDeleteSelectedViewport = useCallback(() => {
			if (!selectedViewport) return
			handleDeleteViewport(selectedViewport.id)
		}, [handleDeleteViewport, selectedViewport])

		const handleDeleteSelectedSheetItems = useCallback(() => {
			if (selectedViewportIds.length === 0 && selectedAnnotationIds.length === 0) return
			const vpIds = new Set(selectedViewportIds)
			const anIds = new Set(selectedAnnotationIds)
			clearViewportInteractionState()
			clearAnnotationInteractionState()
			updateActiveSheet(sheet => ({
				...sheet,
				viewports: sheet.viewports.filter(v => !vpIds.has(v.id)),
				annotations: sheet.annotations.filter(a => !anIds.has(a.id)),
			}))
			setSelectedViewportIds([])
			setSelectedAnnotationIds([])
		}, [selectedViewportIds, selectedAnnotationIds, clearViewportInteractionState, clearAnnotationInteractionState, updateActiveSheet])

	  /** Double-click a viewport to open its linked source view tab. */
  const handleViewportDoubleClick = useCallback((viewport: DrawingViewport) => {
    const viewId = viewport.viewId ?? viewport.sourceViewId
    if (!viewId) return
		handleOpenSourceViewTab(viewId)
	  }, [handleOpenSourceViewTab])

	const handleViewportTitleDoubleClick = useCallback((event: ReactPointerEvent<HTMLButtonElement>, viewport: DrawingViewport) => {
		event.stopPropagation()
		event.preventDefault()
		const titleValue = viewport.title || viewMap.get(viewport.viewId)?.name || ''
		openTitleBlockEditor(`viewportTitle:${viewport.id}`, 'Viewport title', titleValue)
	}, [openTitleBlockEditor, viewMap])

	  /** Return to the sheet tab. */
  const handleExitSourceViewEditor = useCallback(() => {
		handleActivateSheetTab()
	  }, [handleActivateSheetTab])

  const handleCaptureActiveViewFromModel = () => {
    if (!activeView || !liveCameraState) return
    captureCurrentModelAsDrawingView(activeView.id)
  }

  const handleOpenViewInModel = (viewId = activeView?.id, options?: { activateSection?: boolean }) => {
	    if (!viewId || !modelWorkspacePath) return
    requestApplyDrawingView(viewId, { activateSection: options?.activateSection ?? true })
	    navigate(modelWorkspacePath)
  }

  const handleActivateSectionInModel = (sectionId = drawingPackage.activeSectionId) => {
	    if (!sectionId || !modelWorkspacePath) return

    setDrawingPackage(prev => ({ ...prev, activeSectionId: sectionId }))
    setActiveDrawingSectionId(sectionId)

    const linkedView = drawingPackage.savedViews.find(view => view.sectionId === sectionId)
    if (linkedView) {
      requestApplyDrawingView(linkedView.id, { activateSection: true })
    }

	    navigate(modelWorkspacePath)
  }

  // ── Tool dispatch ──────────────────────────────────────────────────────────
  const handleSelectTool = useCallback((toolId: DrawingToolId) => {
    // ── Immediate-action tools (fire once, don't toggle) ──
    switch (toolId) {
      // File
      case 'back-to-jobs': navigate(workspaceBackPath); return
      case 'open-model': navigate(modelWorkspacePath); return
      case 'open-tasks': if (tasksWorkspacePath) navigate(tasksWorkspacePath); return
      case 'print': window.print(); return
      // Edit
      case 'undo': undo(); return
      case 'redo': redo(); return
      case 'clear-selection': clearCurrentSelection(); return
      case 'delete-selected': handleDeleteSelectedViewport(); return
      // Sheet
      case 'new-sheet': handleCreateSheetFromTemplate(); return
      case 'duplicate-sheet': handleDuplicateSheet(); return
      case 'delete-sheet': handleDeleteSheet(); return
      // 'change-template' removed — 8.5×11 is the only supported format
      // Viewport placement — by kind
      case 'place-plan': handlePlaceViewportByKind('plan'); return
      case 'place-elevation': handlePlaceViewportByKind('elevation'); return
      case 'place-section': handlePlaceViewportByKind('section'); return
      case 'place-detail': handlePlaceViewportByKind('section'); return   // detail ≈ section view
      case 'place-iso': handlePlaceViewportByKind('iso'); return
      case 'place-saved-view': handleSendActiveViewToSheet(); return
      // Annotate — paper-space annotations
      case 'leader-note': handleAddNote(); return
      case 'note': handleAddNote(); return
      case 'rich-text': handleAddNote(); return       // rich-text → text annotation
      case 'plain-text': handleAddNote(); return      // plain-text → text annotation
      case 'callout': handleAddCallout(); return
      case 'marker': handleAddCallout(); return       // marker → callout with leader
      // Dimensions — source annotations on active view
      case 'dim-linear':
      case 'dim-aligned':
      case 'dim-angular':
      case 'dim-baseline':
      case 'dim-continuous':
      case 'dim-elevation':
        handleAddDimension(); return
      // Sections
      case 'create-linked-view': handleCreateLinkedViewFromSection(); return
      case 'show-cut-in-model': handleActivateSectionInModel(); return
      // View — canvas controls
      case 'fit': handleFitAll(); return
      case 'grid-toggle':
        setToolState(prev => ({ ...prev, gridVisible: !prev.gridVisible })); return
      // Snap toggles — toggle individual snap modes
      case 'snap-endpoint':
      case 'snap-midpoint':
      case 'snap-intersection':
      case 'snap-center':
      case 'snap-grid': {
        const snapId = toolId as SnapMode
        setToolState(prev => {
          const next = new Set(prev.activeSnaps)
          if (next.has(snapId)) next.delete(snapId); else next.add(snapId)
          return { ...prev, activeSnaps: next }
        })
        return
      }
    }
    // ── Stateful / toggle tools (pan, zoom, etc.) ──
    setToolState(prev => {
      const deactivating = prev.activeTool === toolId
      const cursorForTool = toolId === 'pan' ? 'grab' : toolId === 'zoom' ? 'crosshair' : 'crosshair'
      return {
        ...prev,
        activeTool: deactivating ? null : toolId,
        commandPhase: deactivating ? 'idle' : 'preview',
        cursorMode: deactivating ? 'default' : cursorForTool,
      }
    })
  }, [navigate, workspaceBackPath, modelWorkspacePath, tasksWorkspacePath,
      undo, redo, clearCurrentSelection, handleDeleteSelectedViewport,
      handleCreateSheetFromTemplate, handleDuplicateSheet, handleDeleteSheet, setActivePaletteMode,
      handlePlaceViewportByKind, handleSendActiveViewToSheet,
      handleAddNote, handleAddCallout, handleAddDimension,
      handleCreateLinkedViewFromSection, handleActivateSectionInModel,
      handleFitAll])

  // ── Delete key handler for selected viewports & annotations ──
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (event.repeat || event.defaultPrevented) return
      if (isTextInputTarget(event.target)) return
      // Don't intercept if a modal/dialog is open
      if (titleBlockEditor) return
	      if (activeCanvasViewId) return

      if (selectedViewportIds.length > 0 || selectedAnnotationIds.length > 0) {
        event.preventDefault()
        handleDeleteSelectedSheetItems()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
	  }, [activeCanvasViewId, handleDeleteSelectedSheetItems, selectedViewportIds, selectedAnnotationIds, titleBlockEditor])

  return (
    <div className="drawing-workspace">
      <DrawingRibbon
        navigate={navigate}
        workspaceBackPath={workspaceBackPath}
        projectName={projectName}
        saveLabel={saveLabel}
        saveStatus={saveStatus}
        canUndo={canUndo}
        canRedo={canRedo}
        undo={undo}
        redo={redo}
        activeSheet={activeSheet}
        activeTemplate={activeTemplate}
        toolState={toolState}
        onSelectFamily={handleSelectFamily}
        sheetIndex={activeSheetIndex}
        sheetCount={sortedSheets.length}
        isFirstSheet={isActiveSheetFirstPage}
        isLastSheet={isActiveSheetLastPage}
        onPrevSheet={handleNavigateSheetPrev}
        onNextSheet={handleNavigateSheetNext}
      />

      <div className="drawing-body">
        {/* ─── Left Tool Palette ─── */}
        <DrawingToolPalette toolState={toolState} onSelectTool={handleSelectTool} />

        <main className="drawing-canvas-area">
				<div className="drawing-workspace-tabs" role="tablist" aria-label="Drawing canvas tabs">
					<button
						className={`drawing-workspace-tab${activeCanvasView ? '' : ' active'}`}
						onClick={handleActivateSheetTab}
						role="tab"
						aria-selected={!activeCanvasView}
						type="button"
					>
						Sheet {activeSheet?.number ?? ''}
					</button>
					{openSourceViews.map(view => (
						<div className={`drawing-workspace-tab-shell${activeCanvasView?.id === view.id ? ' active' : ''}`} key={view.id}>
							<button
								className={`drawing-workspace-tab${activeCanvasView?.id === view.id ? ' active' : ''}`}
								onClick={() => handleActivateSourceViewTab(view.id)}
								role="tab"
								aria-selected={activeCanvasView?.id === view.id}
								type="button"
							>
								{view.name}
							</button>
							<button
								className="drawing-workspace-tab-close"
								onClick={() => handleCloseSourceViewTab(view.id)}
								type="button"
							>
								×
							</button>
						</div>
					))}
				</div>

		          {/* ── Source View Editor (peer tab to the drawing sheet) ── */}
		          {activeCanvasView ? (
            <div className="drawing-source-editor">
              <div className="drawing-source-editor-breadcrumb">
                <button className="drawing-source-editor-back" onClick={handleExitSourceViewEditor} type="button">
                  ← Sheet {activeSheet?.number ?? ''}
                </button>
                <span className="drawing-source-editor-separator">›</span>
		                <span className="drawing-source-editor-view-name">{activeCanvasView.name}</span>
		                <span className="drawing-source-editor-scale">{activeCanvasView.scaleLabel}</span>
              </div>
              <div className="drawing-source-editor-canvas-area">
                <DrawingSourceViewCanvas
                  canvasRef={sourceCanvasRef}
		                  view={activeCanvasView}
		                  section={activeCanvasView.sectionId ? sectionMap.get(activeCanvasView.sectionId) ?? null : null}
		                  displayPreset={displayPresetMap.get(activeCanvasView.displayPresetId) ?? null}
                  objects={objects}
                  scaffoldGeometry={scaffoldGeometry}
		                  sourceAnnotations={activeCanvasView.id === activeView?.id ? displayedSourceAnnotations : activeCanvasView.sourceAnnotations}
                  selectedSourceAnnotationId={selectedSourceAnnotationId}
                  draggingAnnotationId={sourceAnnotationDragSession?.annotationId ?? null}
                  onBackgroundPointerDown={() => {
                    clearSourceAnnotationInteractionState()
                    setSelectedSourceAnnotationId(null)
                  }}
                  onNotePointerDown={(event, annotation) => beginSourceNoteDrag(event, annotation)}
                  onDimensionPointerDown={(event, annotation) => beginSourceDimensionDrag(event, annotation)}
                  onDimensionStartHandlePointerDown={(event, annotation) => beginSourceDimensionHandleDrag(event, annotation, 'dimension-start')}
                  onDimensionEndHandlePointerDown={(event, annotation) => beginSourceDimensionHandleDrag(event, annotation, 'dimension-end')}
                />
              </div>
              <div className="drawing-source-editor-toolbar">
                <button className="drawing-source-editor-tool" onClick={() => handleAddSourceAnnotation('dimension')} type="button">+ Dimension</button>
                <button className="drawing-source-editor-tool" onClick={() => handleAddSourceAnnotation('note')} type="button">+ Note</button>
                <span className="drawing-source-editor-spacer" />
                <button className="drawing-source-editor-done" onClick={handleExitSourceViewEditor} type="button">Return to Sheet</button>
              </div>
            </div>
          ) : null}

		          {/* ── Sheet Stage ── */}
		          {!activeCanvasView ? (
		          <div
		            className={`drawing-sheet-stage${isPanning ? ' is-panning' : ''}${toolState.gridVisible ? ' show-grid' : ''}`}
		            ref={stageRef}
		          >
            {activeSheet && activeTemplate ? (
              <div
                className="drawing-sheet-transform-layer"
                style={{
                  zoom: canvasZoom,
                  transform: `translate(${canvasOffset.x / canvasZoom}px, ${canvasOffset.y / canvasZoom}px)`,
                }}
              >
              <div
				className="drawing-sheet"
				ref={sheetRef}
						onPointerDown={beginSheetMarqueeSelection}
				style={{ aspectRatio: `${templateWidth} / ${templateHeight}`, ...sheetGeoStyle } as React.CSSProperties}
			>
					<div className="drawing-sheet-banner">NOT FOR CONSTRUCTION</div>
					{layoutSnapFeedback?.guides.length ? (
						<svg className="drawing-layout-guide-overlay" viewBox={`0 0 ${templateWidth} ${templateHeight}`} preserveAspectRatio="none" aria-hidden="true">
							{layoutSnapFeedback.guides.map((guide, index) => (
								guide.axis === 'x' ? (
									<line
										key={`${guide.axis}-${guide.positionIn}-${index}`}
										className={`drawing-layout-guide ${guide.kind}`}
										x1={guide.positionIn}
										x2={guide.positionIn}
										y1={0}
										y2={templateHeight}
									/>
								) : (
									<line
										key={`${guide.axis}-${guide.positionIn}-${index}`}
										className={`drawing-layout-guide ${guide.kind}`}
										x1={0}
										x2={templateWidth}
										y1={guide.positionIn}
										y2={guide.positionIn}
									/>
								)
							))}
						</svg>
					) : null}
					{/* ── Content wrapper: global coordinate rebase ── */}
					<div className="drawing-sheet-content" ref={contentRef}>

						{sheetMarqueeSelectionBounds ? (
							<div
								className="drawing-sheet-marquee"
								aria-hidden="true"
								style={{
									left: `${getCoordinateSpacePercentX(sheetMarqueeSelectionBounds.leftIn, sheetGeometry.contentAreaIn)}%`,
									top: `${getCoordinateSpacePercentY(sheetMarqueeSelectionBounds.topIn, sheetGeometry.contentAreaIn)}%`,
									width: `${getCoordinateSpaceWidthPercent(sheetMarqueeSelectionBounds.rightIn - sheetMarqueeSelectionBounds.leftIn, sheetGeometry.contentAreaIn)}%`,
									height: `${getCoordinateSpaceHeightPercent(sheetMarqueeSelectionBounds.bottomIn - sheetMarqueeSelectionBounds.topIn, sheetGeometry.contentAreaIn)}%`,
								}}
							/>
						) : null}

		                {displayedViewports.map((viewport, index) => {
                  const view = viewMap.get(viewport.viewId)
                  const section = view?.sectionId ? sectionMap.get(view.sectionId) : null
                  const displayPreset = view ? displayPresetMap.get(view.displayPresetId) ?? null : null
							const isViewportSelected = selectedViewportIds.includes(viewport.id)
							const showActionCapsule = isViewportSelected && selectedViewportAnchorId === viewport.id
                  return (
                    <DrawingSheetViewport
                      key={viewport.id}
                      viewport={viewport}
                      view={view ?? null}
                      section={section ?? null}
                      displayPreset={displayPreset}
							  sourceAnnotations={view?.id === activeView?.id ? displayedSourceAnnotations : null}
	                      detailReferenceLabel={formatViewportReference(index + 1, activeSheet.number)}
	                      contentAreaIn={sheetGeometry.contentAreaIn}
                      objects={objects}
                      scaffoldGeometry={scaffoldGeometry}
								  isSelected={isViewportSelected}
								  showActionCapsule={showActionCapsule}
								  selectionCount={isViewportSelected ? selectedViewportCount : 1}
								  selectionAllLocked={isViewportSelected ? selectedViewportAllLocked : viewport.isLocked === true}
								  selectionHasLocked={isViewportSelected ? selectedViewportHasLocked : viewport.isLocked === true}
								  showScaleControl={isViewportSelected ? selectedViewportCount === 1 : true}
								  canTidy={isViewportSelected && selectedViewportCount >= 3 && !selectedViewportHasLocked}
								  isLocked={viewport.isLocked === true}
								  isDragging={viewportDragSession?.viewportId === viewport.id}
								  isResizing={viewportResizeSession?.viewportId === viewport.id}
								  onFramePointerDown={event => handleViewportPointerDown(event, viewport)}
								  onCaptionPointerDown={event => beginViewportDrag(event, viewport)}
								  onOpenView={() => handleOpenSourceViewTab(viewport.viewId)}
								  onDuplicate={() => handleDuplicateViewport(viewport.id)}
								  onMatchSize={() => handleMatchViewportSize(viewport.id)}
								  onMatchScale={() => handleMatchViewportScale(viewport.id)}
								  onAlignToSheet={action => handleViewportAlignToSheet(viewport.id, action)}
								  onTidy={axis => handleViewportTidy(viewport.id, axis)}
								  onToggleLock={() => handleViewportLockToggle(viewport)}
								  onScaleChange={scaleLabel => handleViewportScaleChange(viewport, scaleLabel)}
								  onDoubleClick={() => handleViewportDoubleClick(viewport)}
								  onTitleDoubleClick={event => handleViewportTitleDoubleClick(event, viewport)}
								  onResizeHandlePointerDown={(event, handle) => beginViewportResize(event, viewport, handle)}
                    />
                  )
                })}

	                <svg className="drawing-annotation-overlay" viewBox={`${sheetGeometry.contentAreaIn.left} ${sheetGeometry.contentAreaIn.top} ${sheetGeometry.contentAreaIn.width} ${sheetGeometry.contentAreaIn.height}`} preserveAspectRatio="none" aria-hidden="true">
					{displayedAnnotations.map(annotation => {
						const leaderPoints = annotation.kind === 'callout' ? getCalloutLeaderPoints(annotation) : null
						if (!leaderPoints) return null
						return (
							<g key={`${annotation.id}-leader`}>
								<path
									className={`drawing-annotation-leader ${selectedAnnotationIds.includes(annotation.id) ? 'selected' : ''}`}
									d={pointsToSvgPath(leaderPoints, false)}
								/>
								<circle
									className={`drawing-annotation-target ${selectedAnnotationIds.includes(annotation.id) ? 'selected' : ''}`}
									cx={annotation.leaderTo!.xIn}
									cy={annotation.leaderTo!.yIn}
									r={0.12}
								/>
							</g>
						)
					})}
				</svg>

				{displayedAnnotations.map(annotation => (
                  <div
                    key={annotation.id}
						    className={`drawing-annotation ${annotation.kind} ${selectedAnnotationIds.includes(annotation.id) ? 'selected' : ''} ${annotationDragSession?.annotationId === annotation.id ? 'dragging' : ''}`}
					onPointerDown={event => beginAnnotationDrag(event, annotation)}
                    style={{
	                      left: `${getCoordinateSpacePercentX(annotation.xIn, sheetGeometry.contentAreaIn)}%`,
	                      top: `${getCoordinateSpacePercentY(annotation.yIn, sheetGeometry.contentAreaIn)}%`,
	                      width: `${getCoordinateSpaceWidthPercent(annotation.widthIn, sheetGeometry.contentAreaIn)}%`,
                    }}
                  >
                    <div className="drawing-annotation-badge">{annotation.kind === 'callout' ? 'Callout' : 'Note'}</div>
                    <div className="drawing-annotation-text">{annotation.text}</div>
                  </div>
                ))}

				{displayedAnnotations.map(annotation => {
					if (annotation.kind !== 'callout' || !annotation.leaderTo) return null
					return (
						<button
							key={`${annotation.id}-handle`}
								className={`drawing-callout-handle ${selectedAnnotationIds.includes(annotation.id) ? 'selected' : ''}`}
							onPointerDown={event => beginLeaderDrag(event, annotation)}
							style={{
									left: `${getCoordinateSpacePercentX(annotation.leaderTo.xIn, sheetGeometry.contentAreaIn)}%`,
									top: `${getCoordinateSpacePercentY(annotation.leaderTo.yIn, sheetGeometry.contentAreaIn)}%`,
							}}
							type="button"
						>
							<span className="sr-only">Move callout leader</span>
						</button>
					)
				})}

					</div>{/* end .drawing-sheet-content */}



				                <div className="drawing-titleblock" onPointerDown={event => event.stopPropagation()}>
							{/* ── Panel 1: Sheet Number (compact top) ── */}
							<div className="drawing-titleblock-panel drawing-titleblock-panel-number">
							  <button
								className="drawing-titleblock-editable drawing-titleblock-number-label"
								onDoubleClick={event => {
									event.preventDefault()
									event.stopPropagation()
									openTitleBlockEditor('sheetNumberLabel', 'Sheet number label', activeSheetTitleBlockText?.sheetNumberLabel ?? '')
								}}
								type="button"
							  >
								{renderTitleBlockTextValue(activeSheetTitleBlockText?.sheetNumberLabel ?? '')}
							  </button>
							  <button
								className="drawing-titleblock-editable drawing-titleblock-number-value"
								onDoubleClick={event => {
									event.preventDefault()
									event.stopPropagation()
									openTitleBlockEditor('sheetNumberValue', 'Sheet number', activeSheet.number)
								}}
								type="button"
							  >
								{renderTitleBlockTextValue(activeSheet.number)}
							  </button>
							</div>
							{/* ── Panel 2: SYSTEM TITLE — sheet.name, dominant vertical text ── */}
							<div className="drawing-titleblock-panel drawing-titleblock-panel-title">
							  <button
								className="drawing-titleblock-editable drawing-titleblock-system-title"
								onDoubleClick={event => {
									event.preventDefault()
									event.stopPropagation()
									openTitleBlockEditor('sheetName', 'Sheet title', activeSheet.name)
								}}
								type="button"
							  >
								{renderTitleBlockTextValue(activeSheet.name)}
							  </button>
							</div>
							{/* ── Panel 3: Project Name + User Title ── */}
							<div className="drawing-titleblock-panel drawing-titleblock-panel-split">
							  <div className="drawing-titleblock-vertical-cell subtle">
								<button
									className="drawing-titleblock-editable drawing-titleblock-vertical-button subtle"
									onDoubleClick={event => {
										event.preventDefault()
										event.stopPropagation()
										openTitleBlockEditor('projectName', 'Project name', activeSheetTitleBlockText?.projectName ?? '')
									}}
									type="button"
								>
									{renderTitleBlockTextValue(activeSheetTitleBlockText?.projectName ?? '')}
								</button>
							  </div>
							  <div className="drawing-titleblock-vertical-cell">
								<button
									className="drawing-titleblock-editable drawing-titleblock-vertical-button"
									onDoubleClick={event => {
										event.preventDefault()
										event.stopPropagation()
										openTitleBlockEditor('userTitle', 'User title', activeSheetTitleBlockText?.userTitle ?? '')
									}}
									type="button"
								>
									{renderTitleBlockTextValue(activeSheetTitleBlockText?.userTitle ?? '')}
								</button>
							  </div>
							</div>
							{/* ── Panel 4: Metadata (Scale, Issued, Drawn By) ── */}
							<div className="drawing-titleblock-panel drawing-titleblock-panel-meta">
							  <div className="drawing-titleblock-meta-cell">
								<button
									className="drawing-titleblock-editable drawing-titleblock-meta-value"
									onDoubleClick={event => {
										event.preventDefault()
										event.stopPropagation()
										openTitleBlockEditor('scaleValue', 'Scale value', activeSheetTitleBlockText?.scaleValue ?? '')
									}}
									type="button"
								>
									{renderTitleBlockTextValue(activeSheetTitleBlockText?.scaleValue ?? '')}
								</button>
								<button
									className="drawing-titleblock-editable drawing-titleblock-microcopy"
									onDoubleClick={event => {
										event.preventDefault()
										event.stopPropagation()
										openTitleBlockEditor('scaleLabel', 'Scale label', activeSheetTitleBlockText?.scaleLabel ?? '')
									}}
									type="button"
								>
									{renderTitleBlockTextValue(activeSheetTitleBlockText?.scaleLabel ?? '')}
								</button>
							  </div>
							  <div className="drawing-titleblock-meta-cell">
								<button
									className="drawing-titleblock-editable drawing-titleblock-meta-value"
									onDoubleClick={event => {
										event.preventDefault()
										event.stopPropagation()
										openTitleBlockEditor('issuedValue', 'Issued value', activeSheetTitleBlockText?.issuedValue ?? '')
									}}
									type="button"
								>
									{renderTitleBlockTextValue(activeSheetTitleBlockText?.issuedValue ?? '')}
								</button>
								<button
									className="drawing-titleblock-editable drawing-titleblock-microcopy"
									onDoubleClick={event => {
										event.preventDefault()
										event.stopPropagation()
										openTitleBlockEditor('issuedLabel', 'Issued label', activeSheetTitleBlockText?.issuedLabel ?? '')
									}}
									type="button"
								>
									{renderTitleBlockTextValue(activeSheetTitleBlockText?.issuedLabel ?? '')}
								</button>
							  </div>
							  <div className="drawing-titleblock-meta-cell">
								<button
									className="drawing-titleblock-editable drawing-titleblock-meta-value"
									onDoubleClick={event => {
										event.preventDefault()
										event.stopPropagation()
										openTitleBlockEditor('drawnByValue', 'Drawn by value', activeSheetTitleBlockText?.drawnByValue ?? '')
									}}
									type="button"
								>
									{renderTitleBlockTextValue(activeSheetTitleBlockText?.drawnByValue ?? '')}
								</button>
								<button
									className="drawing-titleblock-editable drawing-titleblock-microcopy"
									onDoubleClick={event => {
										event.preventDefault()
										event.stopPropagation()
										openTitleBlockEditor('drawnByLabel', 'Drawn by label', activeSheetTitleBlockText?.drawnByLabel ?? '')
									}}
									type="button"
								>
									{renderTitleBlockTextValue(activeSheetTitleBlockText?.drawnByLabel ?? '')}
								</button>
							  </div>
							</div>
			                </div>
							{isActiveSheetFirstPage ? (
							  <div className="drawing-sheet-footer" aria-hidden="true">
								{/* ── Left panel: Notice, Disclaimer and Copyright ── */}
								<div className="drawing-sheet-footer-box drawing-sheet-footer-box-left">
									<div className="drawing-sheet-footer-heading">Notice, Disclaimer and Copyright</div>
									<div className="drawing-sheet-footer-body">
										<p>SCAFFOLDPRO MAKES NO WARRANTY WHATSOEVER WITH REGARD TO ITS SCAFFOLD DRAWINGS SOLELY FOR DEMONSTRATIVE, PLANNING, AND COORDINATION PURPOSES. SCAFFOLDPRO MAKES NO WARRANTY THAT THE DIMENSIONS, CONFIGURATIONS, OR TIE‑IN LOCATIONS IN THESE SCAFFOLD DRAWINGS ARE ACCURATE AND FREE OF DISCREPANCIES. SCAFFOLDPRO MAKES NO WARRANTY THAT THESE SCAFFOLD DRAWINGS COMPLY WITH ANY BUILDING CODES, OSHA REGULATIONS, OR ENGINEERING STANDARDS. THESE SCAFFOLD DRAWINGS ARE PROVIDED TO YOU "AS IS," AND SCAFFOLDPRO DISCLAIMS ANY AND ALL WARRANTIES WITH RESPECT TO THESE SCAFFOLD DRAWINGS, WHETHER EXPRESS OR IMPLIED OR ARISING BY CUSTOM OR TRADE USAGE, AND, SPECIFICALLY, MAKES NO WARRANTY OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE.</p>
										<p>UNDER NO CIRCUMSTANCES WILL SCAFFOLDPRO BE LIABLE FOR ANY DAMAGES, WHETHER ARISING FROM TORT OR CONTRACT, INCLUDING LOSS OF DATA, LOST PROFITS, COST OF COVER, OR OTHER SPECIAL, INCIDENTAL, CONSEQUENTIAL OR INDIRECT DAMAGES ARISING OUT OF THE USE OF THESE SCAFFOLD DRAWINGS.</p>
									</div>
								</div>
								{/* ── Center panel: General Scaffold Notes ── */}
								<div className="drawing-sheet-footer-box drawing-sheet-footer-box-center">
									<div className="drawing-sheet-footer-heading">General Scaffold Notes</div>
									<div className="drawing-sheet-footer-body">
										<ol>
											<li>Scaffold shall be erected, used, modified, and dismantled under the supervision of a competent person.</li>
											<li>Scaffold and scaffold components shall not be loaded beyond the maximum intended load or rated capacity.</li>
											<li>Base support conditions, mud sills, and bearing surfaces must be adequate for imposed loads.</li>
											<li>Tie spacing, bracing, guying, and stability requirements shall be installed per approved design and applicable regulations.</li>
											<li>Platforms shall be fully planked/decked as required. Access and fall protection shall comply with applicable rules.</li>
											<li>Inspect scaffold and components before each work shift and after any event that could affect structural integrity.</li>
										</ol>
									</div>
								</div>
								{/* ── Third panel: Project / Drawing Info ── */}
								<div className="drawing-sheet-footer-box drawing-sheet-footer-box-info">
									<div className="drawing-sheet-footer-heading">Project / Drawing Info</div>
									<div className="drawing-sheet-footer-info-grid">
										<span className="drawing-sheet-footer-info-label">Project</span>
										<span className="drawing-sheet-footer-info-value">{projectName}</span>
										<span className="drawing-sheet-footer-info-label">Address</span>
										<span className="drawing-sheet-footer-info-value">—</span>
										<span className="drawing-sheet-footer-info-label">Client</span>
										<span className="drawing-sheet-footer-info-value">—</span>
										<span className="drawing-sheet-footer-info-label">Prepared By</span>
										<span className="drawing-sheet-footer-info-value">{activeSheetTitleBlockText?.drawnByValue || 'ScaffoldPro'}</span>
										<span className="drawing-sheet-footer-info-label">Sheet No.</span>
										<span className="drawing-sheet-footer-info-value">{activeSheet?.number ?? '—'}</span>
										<span className="drawing-sheet-footer-info-label">Revision</span>
										<span className="drawing-sheet-footer-info-value">{activeTemplate?.defaultRevision ?? 'P1'}</span>
										<span className="drawing-sheet-footer-info-label">Date</span>
										<span className="drawing-sheet-footer-info-value">{issueDateLabel}</span>
									</div>
								</div>
								{/* ── Fourth panel: Drawing Index ── */}
								<div className="drawing-sheet-footer-box drawing-sheet-footer-box-index">
									<div className="drawing-sheet-footer-heading">Drawing Index</div>
									<ul className="drawing-sheet-footer-index-list">
										{sortedSheets.map(sheet => (
											<li key={sheet.id} className="drawing-sheet-footer-index-item">
												<span className="drawing-sheet-footer-index-number">{sheet.number}</span>
												<span className="drawing-sheet-footer-index-name">{sheet.name}</span>
											</li>
										))}
									</ul>
								</div>
							  </div>
							) : null}
							{titleBlockEditor ? (
							  <div className="drawing-titleblock-editor-overlay" aria-live="polite">
								<div className="drawing-titleblock-editor-shell" onPointerDown={event => event.stopPropagation()}>
								  <form
									className="drawing-titleblock-editor-card"
									onSubmit={event => {
										event.preventDefault()
										handleSaveTitleBlockEditor()
									}}
								  >
									<div className="drawing-titleblock-editor-card-content">
										<div className="drawing-panel-label">{isViewportTitleFieldId(titleBlockEditor.fieldId) ? 'Edit viewport title' : 'Edit title block'}</div>
									  <label className="drawing-field">
										<span>{titleBlockEditor.label}</span>
										<input
										  ref={titleBlockEditorInputRef}
										  className="drawing-input drawing-titleblock-editor-input"
										  onChange={event => setTitleBlockEditorValue(event.target.value)}
										  type="text"
										  value={titleBlockEditorValue}
										/>
									  </label>
										<p className="drawing-panel-subtle">{isViewportTitleFieldId(titleBlockEditor.fieldId) ? 'Double-clicked viewport titles open here for precise sheet composition.' : 'Double-clicked title-block text opens here in a rotated CAD-style editor.'}</p>
									  <div className="drawing-panel-actions split">
										<button className="drawing-action-btn" onClick={closeTitleBlockEditor} type="button">
										  Cancel
										</button>
										<button className="drawing-action-btn accent" type="submit">
										  Save
										</button>
									  </div>
									</div>
								  </form>
								</div>
								  </div>
								) : null}
	              </div>
	            </div>
	            ) : null}
	          </div>
            ) : null}
        </main>
      </div>
    </div>
  )
}
