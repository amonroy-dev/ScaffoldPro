/**
 * DrawingSourceViewCanvas — Renders a saved view's 2D projection with source annotations.
 * Extracted from DrawingsWorkspace.tsx as part of CAD-style decomposition.
 */
import { useMemo, type PointerEvent as ReactPointerEvent } from 'react'
import type { DerivedScaffoldGeometry } from '../scaffold/bomDerivation'
import type { useTool } from '../../contexts/ToolContext'
import type {
	DrawingDisplayPreset,
	DrawingSavedView,
	DrawingSectionDefinition,
	DrawingSourceAnnotation,
} from '../../drawings/drawingDocument'
import { buildViewportRenderData } from '../../drawings/viewportRendering'

// ── Geometry helpers ──

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

// ── Component ──

export function DrawingSourceViewCanvas({
	canvasRef,
	view,
	section,
	displayPreset,
	objects,
	scaffoldGeometry,
	sourceAnnotations,
	selectedSourceAnnotationId,
	draggingAnnotationId,
	onBackgroundPointerDown,
	onNotePointerDown,
	onDimensionPointerDown,
	onDimensionStartHandlePointerDown,
	onDimensionEndHandlePointerDown,
}: {
	canvasRef: React.MutableRefObject<HTMLDivElement | null>
	view: DrawingSavedView
	section: DrawingSectionDefinition | null
	displayPreset: DrawingDisplayPreset | null
	objects: ReturnType<typeof useTool>['objects']
	scaffoldGeometry: DerivedScaffoldGeometry
	sourceAnnotations: DrawingSourceAnnotation[]
	selectedSourceAnnotationId: string | null
	draggingAnnotationId: string | null
	onBackgroundPointerDown: () => void
	onNotePointerDown: (event: ReactPointerEvent<HTMLButtonElement>, annotation: DrawingSourceAnnotation) => void
	onDimensionPointerDown: (event: ReactPointerEvent<SVGElement>, annotation: DrawingSourceAnnotation) => void
	onDimensionStartHandlePointerDown: (event: ReactPointerEvent<SVGElement>, annotation: DrawingSourceAnnotation) => void
	onDimensionEndHandlePointerDown: (event: ReactPointerEvent<SVGElement>, annotation: DrawingSourceAnnotation) => void
}) {
	const renderData = useMemo(
		() => buildViewportRenderData({ objects, scaffoldGeometry, view, section, displayPreset }),
		[displayPreset, objects, scaffoldGeometry, section, view],
	)
	const canvasClassName = `drawing-source-view-canvas style-${displayPreset?.visualStyle ?? 'technical'} ${renderData.emptyMessage ? 'is-empty' : 'has-graphics'}`
	const pochePatternId = `drawing-source-view-poche-${view.id}`
	const sourceNotes = sourceAnnotations.filter(annotation => annotation.kind === 'note')
	const sourceDimensions = sourceAnnotations.filter(annotation => annotation.kind === 'dimension' && annotation.target)

	return (
		<div
			className={canvasClassName}
			onPointerDown={onBackgroundPointerDown}
			ref={node => {
				canvasRef.current = node
			}}
		>
			<svg className="drawing-source-view-graphic" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img">
				<defs>
					<pattern id={pochePatternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
						<path d="M 0 0 L 0 6" className="drawing-viewport-graphic-pattern-line" />
					</pattern>
				</defs>
				{renderData.paths.map(path => (
					<path
						key={path.id}
						className={`drawing-viewport-graphic-path ${path.tone}${path.fill ? ' filled' : ''}`}
						d={pointsToSvgPath(path.points, path.closed)}
						style={path.tone === 'poche' && path.fill ? { fill: `url(#${pochePatternId})` } : undefined}
					/>
				))}
			</svg>
			{renderData.emptyMessage ? <div className="drawing-source-view-empty">{renderData.emptyMessage}</div> : null}
			<div className="drawing-source-view-overlay" aria-hidden="true">
				<svg className="drawing-source-view-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
					{sourceDimensions.map(annotation => {
						const target = annotation.target!
						const midX = (annotation.x + target.x) / 2
						const midY = (annotation.y + target.y) / 2
						const isSelected = annotation.id === selectedSourceAnnotationId
						const isDragging = annotation.id === draggingAnnotationId
						return (
							<g
								key={annotation.id}
								className={`drawing-source-view-dimension ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
							>
								<line className="drawing-source-view-dimension-hit" x1={annotation.x} x2={target.x} y1={annotation.y} y2={target.y} onPointerDown={event => onDimensionPointerDown(event, annotation)} />
								<line className="drawing-source-view-dimension-line" x1={annotation.x} x2={target.x} y1={annotation.y} y2={target.y} />
								<circle className="drawing-source-view-dimension-handle" cx={annotation.x} cy={annotation.y} r={1.75} onPointerDown={event => onDimensionStartHandlePointerDown(event, annotation)} />
								<circle className="drawing-source-view-dimension-handle" cx={target.x} cy={target.y} r={1.75} onPointerDown={event => onDimensionEndHandlePointerDown(event, annotation)} />
								<text className="drawing-source-view-dimension-label" x={midX} y={Math.max(6, midY - 2.2)} onPointerDown={event => onDimensionPointerDown(event, annotation)}>
									{annotation.text}
								</text>
							</g>
						)
					})}
				</svg>
				{sourceNotes.map(annotation => (
					<button
						key={annotation.id}
						className={`drawing-source-view-note ${annotation.id === selectedSourceAnnotationId ? 'selected' : ''} ${annotation.id === draggingAnnotationId ? 'dragging' : ''}`}
						onPointerDown={event => onNotePointerDown(event, annotation)}
						style={{
							left: `${clampSourceNoteX(annotation.x, annotation.width)}%`,
							top: `${clampSourceNoteY(annotation.y)}%`,
							width: `${clampSourceAnnotationWidth(annotation.width)}%`,
						}}
						type="button"
					>
						<div className="drawing-source-view-note-badge">Note</div>
						<div className="drawing-source-view-note-text">{annotation.text}</div>
					</button>
				))}
			</div>
		</div>
	)
}

