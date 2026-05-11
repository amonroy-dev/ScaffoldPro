export type DrawingVector3 = { x: number; y: number; z: number }

export type DrawingViewKind = 'iso' | 'plan' | 'elevation' | 'section'
export type DrawingProjection = 'orthographic' | 'perspective'
export type DrawingVisualStyle = 'technical' | 'presentation' | 'erector'
export type DrawingAnnotationKind = 'text' | 'callout'
export type DrawingViewportPlacementMode = 'free' | 'anchored'
export type DrawingSourceAnnotationKind = 'note' | 'dimension'
export type DrawingSavedViewAuthoringSource = 'live-model' | 'section-linked'

export interface DrawingDisplayPreset {
  id: string
  name: string
  description: string
  visualStyle: DrawingVisualStyle
  showBuilding: boolean
  showScaffold: boolean
}

export interface DrawingSectionDefinition {
  id: string
  name: string
  markerLabel: string
  origin: DrawingVector3
  normal: DrawingVector3
  depthFt: number
  clipMode: 'section' | 'elevation'
}

export interface DrawingSourceAnnotation {
	id: string
	kind: DrawingSourceAnnotationKind
	text: string
	x: number
	y: number
	width: number
	target?: { x: number; y: number }
}

export interface DrawingSavedView {
  id: string
  name: string
  kind: DrawingViewKind
  description?: string
  projection: DrawingProjection
  displayPresetId: string
  camera: {
    position: DrawingVector3
    target: DrawingVector3
    zoom: number
  }
  scaleLabel: string
  directionLabel?: string
  sectionId?: string
	authoringSource: DrawingSavedViewAuthoringSource
	sourceAnnotations: DrawingSourceAnnotation[]
}

export interface DrawingTemplate {
  id: string
  name: string
  paperSizeLabel: string
  widthIn: number
  heightIn: number
  marginIn: number
  titleBlockName: string
  defaultRevision: string
}

export interface DrawingViewport {
  id: string
  viewId: string
  sourceViewId: string
  title: string
  xIn: number
  yIn: number
  widthIn: number
  heightIn: number
  scaleLabel: string
  placementMode: DrawingViewportPlacementMode
  contentOffsetXIn: number
  contentOffsetYIn: number
  isLocked?: boolean
}

export interface DrawingAnnotation {
  id: string
  kind: DrawingAnnotationKind
  text: string
  xIn: number
  yIn: number
  widthIn: number
  leaderTo?: { xIn: number; yIn: number }
}

export interface DrawingSheetFooterSmartText {
	left: string
	center: string
	right: string
}

export interface DrawingSheetTitleBlockText {
	sheetNumberLabel: string
	scaleLabel: string
	scaleValue: string
	issuedLabel: string
	issuedValue: string
	drawnByLabel: string
	drawnByValue: string
	panelTitle: string
	projectName: string
	userTitle: string
}

export interface DrawingSheet {
  id: string
  number: string
  name: string
  order: number
  templateId: string
  viewports: DrawingViewport[]
  annotations: DrawingAnnotation[]
	footerSmartText?: DrawingSheetFooterSmartText
	titleBlockText?: DrawingSheetTitleBlockText
}

export interface DrawingPackageDocument {
  version: 1 | 2 | 3
  activeSheetId: string
  activeViewId: string
  activeSectionId: string
  displayPresets: DrawingDisplayPreset[]
  sections: DrawingSectionDefinition[]
  savedViews: DrawingSavedView[]
  templates: DrawingTemplate[]
  sheets: DrawingSheet[]
}

const DEFAULT_DRAWING_TEMPLATES: DrawingTemplate[] = [
	{ id: 'template-letter', name: 'ScaffoldPro Letter', paperSizeLabel: '8.5 x 11 in', widthIn: 11, heightIn: 8.5, marginIn: 0.5, titleBlockName: 'Standard Layout', defaultRevision: 'P1' },
]

export function createDefaultFirstPageFooterSmartText(): DrawingSheetFooterSmartText {
	return {
		left: '',
		center: '',
		right: '',
	}
}

export function createDefaultDrawingSheetTitleBlockText(): DrawingSheetTitleBlockText {
	return {
		sheetNumberLabel: 'Sheet Number',
		scaleLabel: 'Scale',
		scaleValue: 'As Noted',
		issuedLabel: 'Issued',
		issuedValue: '',
		drawnByLabel: 'Drawn By',
		drawnByValue: 'ScaffoldPro',
		panelTitle: '',
		projectName: '',
		userTitle: '',
	}
}

const DEFAULT_DRAWING_PACKAGE: DrawingPackageDocument = {
  version: 3,
  activeSheetId: 'sheet-a101',
  activeViewId: 'view-plan-overall',
  activeSectionId: 'section-a-a',
  displayPresets: [
    { id: 'preset-technical', name: 'Technical', description: 'High-contrast construction linework.', visualStyle: 'technical', showBuilding: true, showScaffold: true },
    { id: 'preset-presentation', name: 'Presentation', description: 'Client-facing sheet with softer hierarchy.', visualStyle: 'presentation', showBuilding: true, showScaffold: true },
    { id: 'preset-erector', name: 'Erector', description: 'Scaffold-first display for field communication.', visualStyle: 'erector', showBuilding: false, showScaffold: true },
  ],
  sections: [
    { id: 'section-a-a', name: 'Section A-A', markerLabel: 'A-A', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, depthFt: 28, clipMode: 'section' },
  ],
  savedViews: [
    { id: 'view-iso-overall', name: 'Overall Iso', kind: 'iso', description: 'Presentation overview placed on the lead sheet.', projection: 'perspective', displayPresetId: 'preset-presentation', camera: { position: { x: 22, y: -18, z: 16 }, target: { x: 0, y: 0, z: 8 }, zoom: 1 }, scaleLabel: 'NTS', authoringSource: 'live-model', sourceAnnotations: [] },
    { id: 'view-plan-overall', name: 'Plan View', kind: 'plan', description: 'Primary orthographic plan for layout coordination.', projection: 'orthographic', displayPresetId: 'preset-technical', camera: { position: { x: 0, y: 0, z: 44 }, target: { x: 0, y: 0, z: 0 }, zoom: 24 }, scaleLabel: "1/4\" = 1'-0\"", authoringSource: 'live-model', sourceAnnotations: [] },
	    { id: 'view-elev-north', name: 'North Elevation', kind: 'elevation', description: 'North-facing elevation for lead-sheet composition.', projection: 'orthographic', displayPresetId: 'preset-technical', camera: { position: { x: 0, y: 36, z: 10 }, target: { x: 0, y: 0, z: 8 }, zoom: 20 }, scaleLabel: "1/4\" = 1'-0\"", directionLabel: 'North', authoringSource: 'live-model', sourceAnnotations: [] },
    { id: 'view-elev-south', name: 'South Elevation', kind: 'elevation', description: 'South-facing elevation aligned to field communication.', projection: 'orthographic', displayPresetId: 'preset-technical', camera: { position: { x: 0, y: -36, z: 10 }, target: { x: 0, y: 0, z: 8 }, zoom: 20 }, scaleLabel: "1/4\" = 1'-0\"", directionLabel: 'South', authoringSource: 'live-model', sourceAnnotations: [] },
    { id: 'view-section-aa', name: 'Section A-A', kind: 'section', description: 'Persistent cut definition for the primary section package.', projection: 'orthographic', displayPresetId: 'preset-technical', camera: { position: { x: 0, y: -22, z: 10 }, target: { x: 0, y: 0, z: 9 }, zoom: 18 }, scaleLabel: "1/2\" = 1'-0\"", sectionId: 'section-a-a', authoringSource: 'section-linked', sourceAnnotations: [] },
  ],
	  templates: DEFAULT_DRAWING_TEMPLATES,
  sheets: [
    // ── A101 – Project Summary (order 0) ──
    {
      id: 'sheet-a101',
      number: 'A101',
      name: 'Project Summary',
      order: 0,
      templateId: 'template-letter',
      footerSmartText: createDefaultFirstPageFooterSmartText(),
      titleBlockText: createDefaultDrawingSheetTitleBlockText(),
      viewports: [
	        { id: 'viewport-elev-north-support', viewId: 'view-elev-north', sourceViewId: 'view-elev-north', title: 'North Elevation', xIn: 0.72, yIn: 0.62, widthIn: 3.88, heightIn: 1.46, scaleLabel: "1/4\" = 1'-0\"", placementMode: 'free', contentOffsetXIn: 0, contentOffsetYIn: 0, isLocked: false },
	        { id: 'viewport-elev-south-support', viewId: 'view-elev-south', sourceViewId: 'view-elev-south', title: 'South Elevation', xIn: 5.35, yIn: 0.62, widthIn: 3.88, heightIn: 1.46, scaleLabel: "1/4\" = 1'-0\"", placementMode: 'free', contentOffsetXIn: 0, contentOffsetYIn: 0, isLocked: false },
	        { id: 'viewport-iso-primary', viewId: 'view-iso-overall', sourceViewId: 'view-iso-overall', title: 'Overall Iso', xIn: 1.39, yIn: 2.28, widthIn: 7.17, heightIn: 3.16, scaleLabel: 'NTS', placementMode: 'free', contentOffsetXIn: 0, contentOffsetYIn: 0, isLocked: false },
      ],
	      annotations: [],
    },
    // ── A201 – Front Elevations (order 1) ──
    {
      id: 'sheet-a201',
      number: 'A201',
      name: 'Front Elevations',
      order: 1,
      templateId: 'template-letter',
      titleBlockText: createDefaultDrawingSheetTitleBlockText(),
      viewports: [],
      annotations: [],
    },
    // ── A301 – Side Elevations (order 2) ──
    {
      id: 'sheet-a301',
      number: 'A301',
      name: 'Side Elevations',
      order: 2,
      templateId: 'template-letter',
      titleBlockText: createDefaultDrawingSheetTitleBlockText(),
      viewports: [],
      annotations: [],
    },
    // ── A401 – 3D Sections (order 3) ──
    {
      id: 'sheet-a401',
      number: 'A401',
      name: '3D Sections',
      order: 3,
      templateId: 'template-letter',
      titleBlockText: createDefaultDrawingSheetTitleBlockText(),
      viewports: [],
      annotations: [],
    },
    // ── A501 – Sections & Details (order 4) ──
    {
      id: 'sheet-a501',
      number: 'A501',
      name: 'Sections & Details',
      order: 4,
      templateId: 'template-letter',
      titleBlockText: createDefaultDrawingSheetTitleBlockText(),
      viewports: [
        { id: 'viewport-section-primary', viewId: 'view-section-aa', sourceViewId: 'view-section-aa', title: 'Section A-A', xIn: 0.3, yIn: 0.3, widthIn: 6.5, heightIn: 5.0, scaleLabel: "1/2\" = 1'-0\"", placementMode: 'free', contentOffsetXIn: 0, contentOffsetYIn: 0, isLocked: false },
        { id: 'viewport-plan-key', viewId: 'view-plan-overall', sourceViewId: 'view-plan-overall', title: 'Key Plan', xIn: 7.0, yIn: 0.3, widthIn: 2.8, heightIn: 2.5, scaleLabel: "1/8\" = 1'-0\"", placementMode: 'free', contentOffsetXIn: 0, contentOffsetYIn: 0, isLocked: false },
      ],
      annotations: [
        { id: 'annotation-section-note', kind: 'text', text: 'Section cuts are persisted objects. The next phases will connect these definitions to live clipped linework.', xIn: 0.3, yIn: 5.8, widthIn: 6.5 },
      ],
    },
    // ── A601 – Blank (order 5) ──
    {
      id: 'sheet-a601',
      number: 'A601',
      name: 'Blank',
      order: 5,
      templateId: 'template-letter',
      titleBlockText: createDefaultDrawingSheetTitleBlockText(),
      viewports: [],
      annotations: [],
    },
  ],
}

function isIdArray(value: unknown): value is Array<{ id: string }> {
  return Array.isArray(value) && value.every(item => Boolean(item) && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asOptionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function asTextString(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max)
}

function normalizeDrawingSheetFooterSmartText(
	value: unknown,
	fallback?: DrawingSheetFooterSmartText,
): DrawingSheetFooterSmartText | undefined {
	const raw = (value && typeof value === 'object' ? value : null) as Partial<DrawingSheetFooterSmartText> | null
	if (!raw && !fallback) return undefined
	const defaults = fallback ?? { left: '', center: '', right: '' }
	return {
		left: asTextString(raw?.left, defaults.left),
		center: asTextString(raw?.center, defaults.center),
		right: asTextString(raw?.right, defaults.right),
	}
}

function normalizeDrawingSheetTitleBlockText(
	value: unknown,
	fallback: DrawingSheetTitleBlockText = createDefaultDrawingSheetTitleBlockText(),
): DrawingSheetTitleBlockText {
	const raw = (value && typeof value === 'object' ? value : null) as Partial<DrawingSheetTitleBlockText> | null
	return {
		sheetNumberLabel: asTextString(raw?.sheetNumberLabel, fallback.sheetNumberLabel),
		scaleLabel: asTextString(raw?.scaleLabel, fallback.scaleLabel),
		scaleValue: asTextString(raw?.scaleValue, fallback.scaleValue),
		issuedLabel: asTextString(raw?.issuedLabel, fallback.issuedLabel),
		issuedValue: asTextString(raw?.issuedValue, fallback.issuedValue),
		drawnByLabel: asTextString(raw?.drawnByLabel, fallback.drawnByLabel),
		drawnByValue: asTextString(raw?.drawnByValue, fallback.drawnByValue),
		panelTitle: asTextString(raw?.panelTitle, fallback.panelTitle),
		projectName: asTextString(raw?.projectName, fallback.projectName),
		userTitle: asTextString(raw?.userTitle, fallback.userTitle),
	}
}

function normalizeDrawingSourceAnnotation(value: unknown): DrawingSourceAnnotation {
	const raw = (value && typeof value === 'object' ? value : {}) as Partial<DrawingSourceAnnotation>
	const kind = raw.kind === 'dimension' ? 'dimension' : 'note'
	const x = clamp(asFiniteNumber(raw.x, kind === 'dimension' ? 18 : 12), 0, 100)
	const y = clamp(asFiniteNumber(raw.y, kind === 'dimension' ? 78 : 14), 0, 100)
	const target = raw.target
	return {
		id: asString(raw.id, createDrawingEntityId('source-annotation')),
		kind,
		text: asString(raw.text, kind === 'dimension' ? "12'-0\"" : 'Source note'),
		x,
		y,
		width: clamp(asFiniteNumber(raw.width, 28), 8, 72),
		target:
			target && typeof target === 'object'
				? {
					x: clamp(asFiniteNumber((target as { x?: unknown }).x, x + 18), 0, 100),
					y: clamp(asFiniteNumber((target as { y?: unknown }).y, y), 0, 100),
				}
				: kind === 'dimension'
					? { x: clamp(x + 18, 0, 100), y }
					: undefined,
	}
}

function normalizeDrawingSavedView(value: unknown, fallbackPresetId: string): DrawingSavedView {
	const raw = (value && typeof value === 'object' ? value : {}) as Partial<DrawingSavedView> & {
		authoringSource?: unknown
		sourceAnnotations?: unknown
	}
	const kind = raw.kind === 'plan' || raw.kind === 'elevation' || raw.kind === 'section' ? raw.kind : 'iso'
	const projection = raw.projection === 'orthographic' ? 'orthographic' : raw.projection === 'perspective' ? 'perspective' : 'orthographic'
	const camera = raw.camera
	const sectionId = asOptionalString(raw.sectionId)
	return {
		id: asString(raw.id, createDrawingEntityId('view')),
		name: asString(raw.name, 'Saved View'),
		kind,
		description: asOptionalString(raw.description),
		projection,
		displayPresetId: asString(raw.displayPresetId, fallbackPresetId),
		camera: {
			position: {
				x: asFiniteNumber(camera?.position?.x, 0),
				y: asFiniteNumber(camera?.position?.y, 0),
				z: asFiniteNumber(camera?.position?.z, projection === 'orthographic' ? 24 : 12),
			},
			target: {
				x: asFiniteNumber(camera?.target?.x, 0),
				y: asFiniteNumber(camera?.target?.y, 0),
				z: asFiniteNumber(camera?.target?.z, 0),
			},
			zoom: Math.max(0.1, asFiniteNumber(camera?.zoom, projection === 'orthographic' ? 18 : 1)),
		},
		scaleLabel: asString(raw.scaleLabel, projection === 'orthographic' ? "1/4\" = 1'-0\"" : 'NTS'),
		directionLabel: asOptionalString(raw.directionLabel),
		sectionId,
		authoringSource: raw.authoringSource === 'section-linked' || sectionId ? 'section-linked' : 'live-model',
		sourceAnnotations: Array.isArray(raw.sourceAnnotations) ? raw.sourceAnnotations.map(annotation => normalizeDrawingSourceAnnotation(annotation)) : [],
	}
}

function normalizeDrawingTemplate(value: unknown, fallback: DrawingTemplate): DrawingTemplate {
	const raw = (value && typeof value === 'object' ? value : {}) as Partial<DrawingTemplate>
	const widthIn = Math.max(5, asFiniteNumber(raw.widthIn, fallback.widthIn))
	const heightIn = Math.max(5, asFiniteNumber(raw.heightIn, fallback.heightIn))
	return {
		id: asString(raw.id, fallback.id),
		name: asString(raw.name, fallback.name),
		paperSizeLabel: asString(raw.paperSizeLabel, fallback.paperSizeLabel),
		widthIn,
		heightIn,
		marginIn: clamp(asFiniteNumber(raw.marginIn, fallback.marginIn), 0.25, Math.max(0.25, Math.min(widthIn, heightIn) / 4)),
		titleBlockName: asString(raw.titleBlockName, fallback.titleBlockName),
		defaultRevision: asString(raw.defaultRevision, fallback.defaultRevision),
	}
}

function normalizeDrawingTemplates(_templates: DrawingTemplate[]): DrawingTemplate[] {
	// 8.5 × 11 Letter is the only supported format — discard any saved/custom templates.
	return DEFAULT_DRAWING_TEMPLATES.map(template => ({ ...template }))
}

function normalizeDrawingViewport(
  value: unknown,
  fallbackViewId: string,
  savedViewLookup: ReadonlyMap<string, DrawingSavedView>,
): DrawingViewport {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<DrawingViewport> & {
    sourceViewId?: unknown
    placementMode?: unknown
    contentOffsetXIn?: unknown
    contentOffsetYIn?: unknown
    isLocked?: unknown
  }
  const resolvedViewId = asString(raw.viewId, asString(raw.sourceViewId, fallbackViewId))
  const resolvedView = savedViewLookup.get(resolvedViewId)

  return {
    id: asString(raw.id, createDrawingEntityId('viewport')),
    viewId: resolvedViewId,
    sourceViewId: asString(raw.sourceViewId, resolvedViewId),
    title: asString(raw.title, resolvedView?.name ?? 'Viewport'),
    xIn: asFiniteNumber(raw.xIn, 1.25),
    yIn: asFiniteNumber(raw.yIn, 1.1),
    widthIn: Math.max(2, asFiniteNumber(raw.widthIn, 6.5)),
    heightIn: Math.max(1.5, asFiniteNumber(raw.heightIn, 5)),
    scaleLabel: asString(raw.scaleLabel, resolvedView?.scaleLabel ?? 'NTS'),
    placementMode: raw.placementMode === 'anchored' ? 'anchored' : 'free',
    contentOffsetXIn: asFiniteNumber(raw.contentOffsetXIn, 0),
    contentOffsetYIn: asFiniteNumber(raw.contentOffsetYIn, 0),
    isLocked: raw.isLocked === true,
  }
}

function normalizeDrawingAnnotation(value: unknown): DrawingAnnotation {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<DrawingAnnotation>
  const leader = raw.leaderTo
  return {
    id: asString(raw.id, createDrawingEntityId('annotation')),
    kind: raw.kind === 'callout' ? 'callout' : 'text',
    text: asString(raw.text, 'Untitled note'),
    xIn: asFiniteNumber(raw.xIn, 1.25),
    yIn: asFiniteNumber(raw.yIn, 5.5),
    widthIn: Math.max(1.5, asFiniteNumber(raw.widthIn, 5)),
    leaderTo:
      leader && typeof leader === 'object'
        ? {
            xIn: asFiniteNumber((leader as { xIn?: unknown }).xIn, 1.25),
            yIn: asFiniteNumber((leader as { yIn?: unknown }).yIn, 1.25),
          }
        : undefined,
  }
}

// ── Viewport composition fitting ────────────────────────────────────────────
// Viewport xIn/yIn/widthIn/heightIn are expressed in a coordinate space of
// [0..PAGE_W] × [0..PAGE_H] and rendered as percentages of the content wrapper.
// Legacy data from larger sheets (11×17, 24×36) can have coordinates that
// overflow the content area.  This function uniformly scales and translates
// the entire viewport+annotation composition to fit inside the CONTENT AREA
// (not the full page).
//
// Content area rect (inches) — derived from SheetGeometry constants:
//   outerBorder=0.15  header=0.15  titleBlock=1.05  footer=2.10  pad=0.32
//   raw rect: top=0.30 left=0.15 right=9.80 bottom=6.25
//   after uniform 0.32" inset: top=0.62 left=0.47 right=9.48 bottom=5.93

const CONTENT_LEFT   = 0.47
const CONTENT_TOP    = 0.62
const CONTENT_WIDTH  = 9.01
const CONTENT_HEIGHT = 5.31
const CONTENT_RIGHT  = CONTENT_LEFT + CONTENT_WIDTH   // 9.48
const CONTENT_BOTTOM = CONTENT_TOP  + CONTENT_HEIGHT   // 5.93
const FIT_PADDING    = 0.10 // small inset so content doesn't touch content area edges

export function fitSheetCompositionToPage(sheet: DrawingSheet): DrawingSheet {
  const viewports = sheet.viewports
  const annotations = sheet.annotations
  if (viewports.length === 0 && annotations.length === 0) return sheet

  // Compute bounding box of all placed content
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const vp of viewports) {
    minX = Math.min(minX, vp.xIn)
    minY = Math.min(minY, vp.yIn)
    maxX = Math.max(maxX, vp.xIn + vp.widthIn)
    maxY = Math.max(maxY, vp.yIn + vp.heightIn)
  }
  for (const ann of annotations) {
    minX = Math.min(minX, ann.xIn)
    minY = Math.min(minY, ann.yIn)
    maxX = Math.max(maxX, ann.xIn + ann.widthIn)
    maxY = Math.max(maxY, ann.yIn + 0.8) // approximate annotation height
  }

  const bboxW = maxX - minX
  const bboxH = maxY - minY
  if (bboxW <= 0 || bboxH <= 0) return sheet

  // Target area = contentArea with small padding
  const targetLeft   = CONTENT_LEFT   + FIT_PADDING
  const targetTop    = CONTENT_TOP    + FIT_PADDING
  const targetRight  = CONTENT_RIGHT  - FIT_PADDING
  const targetBottom = CONTENT_BOTTOM - FIT_PADDING
  const availW = targetRight  - targetLeft
  const availH = targetBottom - targetTop

  // If composition already fits inside the content area, no change needed
  if (minX >= CONTENT_LEFT && minY >= CONTENT_TOP && maxX <= CONTENT_RIGHT && maxY <= CONTENT_BOTTOM) return sheet

  // Uniform scale to fit
  const scale = Math.min(1, availW / bboxW, availH / bboxH)

  // Translation: center the scaled composition in the target area
  const scaledW = bboxW * scale
  const scaledH = bboxH * scale
  const offsetX = targetLeft + (availW - scaledW) / 2 - minX * scale
  const offsetY = targetTop  + (availH - scaledH) / 2 - minY * scale

  return {
    ...sheet,
    viewports: viewports.map(vp => ({
      ...vp,
      xIn: vp.xIn * scale + offsetX,
      yIn: vp.yIn * scale + offsetY,
      widthIn: vp.widthIn * scale,
      heightIn: vp.heightIn * scale,
    })),
    annotations: annotations.map(ann => ({
      ...ann,
      xIn: ann.xIn * scale + offsetX,
      yIn: ann.yIn * scale + offsetY,
      widthIn: ann.widthIn * scale,
      ...(ann.leaderTo ? {
        leaderTo: {
          xIn: ann.leaderTo.xIn * scale + offsetX,
          yIn: ann.leaderTo.yIn * scale + offsetY,
        },
      } : {}),
    })),
  }
}

export function cloneDrawingPackage(doc: DrawingPackageDocument): DrawingPackageDocument {
  return JSON.parse(JSON.stringify(doc)) as DrawingPackageDocument
}

export function createDefaultDrawingPackage(): DrawingPackageDocument {
  return cloneDrawingPackage(DEFAULT_DRAWING_PACKAGE)
}

export function createDrawingEntityId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeDrawingPackageDocument(value: unknown): DrawingPackageDocument {
  if (!value || typeof value !== 'object') return createDefaultDrawingPackage()
  const raw = value as Partial<DrawingPackageDocument>
  if (raw.version !== 1 && raw.version !== 2 && raw.version !== 3) return createDefaultDrawingPackage()
  if (!isIdArray(raw.displayPresets) || !isIdArray(raw.sections) || !isIdArray(raw.savedViews) || !isIdArray(raw.templates) || !isIdArray(raw.sheets)) {
    return createDefaultDrawingPackage()
  }

  const next = cloneDrawingPackage(raw as DrawingPackageDocument)
  if (next.displayPresets.length === 0 || next.sheets.length === 0 || next.templates.length === 0 || next.savedViews.length === 0 || next.sections.length === 0) {
    return createDefaultDrawingPackage()
  }

  const fallbackPresetId = next.displayPresets[0]!.id
	next.templates = normalizeDrawingTemplates(next.templates)
	const validTemplateIds = new Set(next.templates.map(template => template.id))
  next.savedViews = next.savedViews.map(view => normalizeDrawingSavedView(view, fallbackPresetId))
  const savedViewLookup = new Map(next.savedViews.map(view => [view.id, view]))
  const fallbackViewId = next.savedViews[0]!.id
  next.version = 3
	  next.sheets = next.sheets.map((sheet, index) => {
    const normalized = {
      ...sheet,
      order: typeof (sheet as { order?: unknown }).order === 'number' ? (sheet as { order: number }).order : index,
      templateId: next.templates[0]!.id, // Force all sheets to the single Letter template
      viewports: Array.isArray(sheet.viewports)
        ? sheet.viewports.map(viewport => normalizeDrawingViewport(viewport, fallbackViewId, savedViewLookup))
        : [],
      annotations: Array.isArray(sheet.annotations) ? sheet.annotations.map(annotation => normalizeDrawingAnnotation(annotation)) : [],
      footerSmartText: normalizeDrawingSheetFooterSmartText(
        sheet.footerSmartText,
        index === 0 ? createDefaultFirstPageFooterSmartText() : undefined,
      ),
      titleBlockText: normalizeDrawingSheetTitleBlockText(sheet.titleBlockText),
    }
    return normalized
  })

  if (!next.sheets.some(sheet => sheet.id === next.activeSheetId)) next.activeSheetId = next.sheets[0]!.id
  if (!next.savedViews.some(view => view.id === next.activeViewId)) next.activeViewId = next.savedViews[0]!.id
  if (!next.sections.some(section => section.id === next.activeSectionId)) next.activeSectionId = next.sections[0]!.id

  return next
}
