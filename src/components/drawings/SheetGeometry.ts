/**
 * SheetGeometry — Layout calculator for 8.5 × 11 in (Letter) drawing sheets.
 *
 * This is the only supported print/export format.  All geometry is tuned
 * specifically for letter-size output so preview matches PDF export exactly.
 *
 * The sheet renders at a fixed 1080 px CSS width; the px-per-inch conversion
 * factor is derived from the 11" width.
 */

// ── Fixed 8.5 × 11 parameters (inches) ──────────────────────────────────────

/** Canonical sheet width (landscape Letter). */
export const SHEET_WIDTH_IN = 11
/** Canonical sheet height (landscape Letter). */
export const SHEET_HEIGHT_IN = 8.5
const SHEET_RENDER_WIDTH_PX = 1080

/** Distance from page edge to the heavy outer border (inches). */
const OUTER_BORDER_INSET_IN = 0.15

/** Height of the "NOT FOR CONSTRUCTION" header band (inches). */
const HEADER_BAND_HEIGHT_IN = 0.15

/** Width of the right-hand title block strip (inches). */
const TITLE_BLOCK_WIDTH_IN = 1.05

/** Height of the bottom footer / notes band (inches). */
const FOOTER_BAND_HEIGHT_IN = 2.10

/** Gap between the footer right edge and the title block (inches). */
const TITLE_BLOCK_GAP_IN = 0

// ── Inner-frame insets from outer border ────────────────────────────────────

const MARGIN_LEFT_IN = 0
const MARGIN_TOP_IN = 0
const MARGIN_BOTTOM_IN = 0
const MARGIN_RIGHT_IN = 0

// ── Types ────────────────────────────────────────────────────────────────────

export interface Rect {
	top: number
	left: number
	width: number
	height: number
	right: number
	bottom: number
}

export interface SheetGeometryResult {
	/** px-per-inch conversion at the 1080 px render width */
	pxPerIn: number
	/** Template dimensions (inches) */
	pageWidthIn: number
	pageHeightIn: number
	/** Resolved margin (inches) */
	marginIn: number
	/** Derived rectangles (all in px) */
	outerBorder: Rect
	innerBorder: Rect
	headerBand: Rect
	titleBlock: Rect
	footerBand: Rect
	contentArea: Rect
	/**
	 * Content area expressed in inches — the authoritative boundary for
	 * viewport/annotation placement, snapping, and clamping.
	 * All positioning logic MUST use these boundaries, NOT raw marginIn.
	 */
	contentAreaIn: Rect
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRect(top: number, left: number, width: number, height: number): Rect {
	return { top, left, width, height, right: left + width, bottom: top + height }
}

// ── Main calculator ──────────────────────────────────────────────────────────

/**
 * Compute sheet geometry for the fixed 8.5 × 11 letter format.
 *
 * The `widthIn`, `heightIn`, and `marginIn` parameters are accepted for
 * backward compatibility with the DrawingTemplate interface but are ignored —
 * all geometry is derived from the hardcoded 8.5 × 11 constants above.
 */
export function computeSheetGeometry(_widthIn?: number, _heightIn?: number, _marginIn?: number): SheetGeometryResult {
	const widthIn = SHEET_WIDTH_IN
	const heightIn = SHEET_HEIGHT_IN

	const pxPerIn = SHEET_RENDER_WIDTH_PX / widthIn
	const pageW = SHEET_RENDER_WIDTH_PX
	const pageH = heightIn * pxPerIn

	// ── Outer border (absolute inset from page edge) ─────────────────────────
	const outerInsetPx = OUTER_BORDER_INSET_IN * pxPerIn
	const outerBorder = makeRect(outerInsetPx, outerInsetPx, pageW - 2 * outerInsetPx, pageH - 2 * outerInsetPx)

	// ── Inner border (asymmetric margins for 8.5 × 11) ──────────────────────
	const innerTopPx = (OUTER_BORDER_INSET_IN + MARGIN_TOP_IN) * pxPerIn
	const innerBottomPx = (OUTER_BORDER_INSET_IN + MARGIN_BOTTOM_IN) * pxPerIn
	const innerLeftPx = (OUTER_BORDER_INSET_IN + MARGIN_LEFT_IN) * pxPerIn
	const innerRightPx = (OUTER_BORDER_INSET_IN + MARGIN_RIGHT_IN) * pxPerIn
	const innerBorder = makeRect(
		innerTopPx,
		innerLeftPx,
		pageW - innerLeftPx - innerRightPx,
		pageH - innerTopPx - innerBottomPx,
	)

	// ── Header band (inside inner border, full width minus title block) ──────
	const headerH = HEADER_BAND_HEIGHT_IN * pxPerIn
	const tbW = TITLE_BLOCK_WIDTH_IN * pxPerIn
	const headerBand = makeRect(innerTopPx, innerLeftPx, innerBorder.width - tbW, headerH)

	// ── Title block (right strip, full height from outer border top to bottom)
	const titleBlock = makeRect(
		outerInsetPx,
		pageW - innerRightPx - tbW,
		tbW,
		outerBorder.height,
	)

	// ── Footer band (bottom strip, left of title block) ──────────────────────
	const footerH = FOOTER_BAND_HEIGHT_IN * pxPerIn
	const tbGapPx = TITLE_BLOCK_GAP_IN * pxPerIn
	const footerBand = makeRect(
		pageH - innerBottomPx - footerH,
		innerLeftPx,
		innerBorder.width - tbW - tbGapPx,
		footerH,
	)

	// ── Raw content region (between header, footer, title block) ────────────
	const rawContentArea = makeRect(
		innerTopPx + headerH,
		innerLeftPx,
		innerBorder.width - tbW - tbGapPx,
		innerBorder.height - headerH - footerH,
	)

	// ── Viewport work area — uniform inset on all 4 sides ────────────────
	const VIEWPORT_WORKAREA_PAD_IN = 0.32
	const padPx = VIEWPORT_WORKAREA_PAD_IN * pxPerIn
	const contentArea = makeRect(
		rawContentArea.top + padPx,
		rawContentArea.left + padPx,
		rawContentArea.width - 2 * padPx,
		rawContentArea.height - 2 * padPx,
	)

	// ── Content area in inches (authoritative placement boundaries) ─────────
	const contentAreaIn = makeRect(
		contentArea.top / pxPerIn,
		contentArea.left / pxPerIn,
		contentArea.width / pxPerIn,
		contentArea.height / pxPerIn,
	)

	return {
		pxPerIn,
		pageWidthIn: widthIn,
		pageHeightIn: heightIn,
		marginIn: MARGIN_LEFT_IN,
		outerBorder,
		innerBorder,
		headerBand,
		titleBlock,
		footerBand,
		contentArea,
		contentAreaIn,
	}
}

// ── CSS custom properties ────────────────────────────────────────────────────

/** Returns a style object that sets CSS custom properties for all geometry values. */
export function sheetGeometryCSSVars(geo: SheetGeometryResult): Record<string, string> {
	const px = (v: number) => `${v.toFixed(2)}px`
	const pageW = geo.pxPerIn * geo.pageWidthIn
	const pageH = geo.pxPerIn * geo.pageHeightIn
	return {
		'--geo-outer-inset': px(geo.outerBorder.top),
		// Per-side inner border insets (asymmetric margins)
		'--geo-inner-top': px(geo.innerBorder.top),
		'--geo-inner-left': px(geo.innerBorder.left),
		'--geo-inner-right': px(pageW - geo.innerBorder.right),
		'--geo-inner-bottom': px(pageH - geo.innerBorder.bottom),
		// Legacy single value kept for any external consumers
		'--geo-inner-inset': px(geo.innerBorder.top),
		'--geo-header-top': px(geo.headerBand.top),
		'--geo-header-left': px(geo.headerBand.left),
		'--geo-header-width': px(geo.headerBand.width),
		'--geo-header-height': px(geo.headerBand.height),
		'--geo-titleblock-top': px(geo.titleBlock.top),
		'--geo-titleblock-left': px(geo.titleBlock.left),
		'--geo-titleblock-width': px(geo.titleBlock.width),
		'--geo-titleblock-height': px(geo.titleBlock.height),
		'--geo-footer-top': px(geo.footerBand.top),
		'--geo-footer-left': px(geo.footerBand.left),
		'--geo-footer-width': px(geo.footerBand.width),
		'--geo-footer-height': px(geo.footerBand.height),
		'--geo-content-top': px(geo.contentArea.top),
		'--geo-content-left': px(geo.contentArea.left),
		'--geo-content-width': px(geo.contentArea.width),
		'--geo-content-height': px(geo.contentArea.height),
	}
}

