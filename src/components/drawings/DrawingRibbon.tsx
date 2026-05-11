/**
 * DrawingRibbon — CAD-style Application Header + Command Ribbon (family tabs only).
 * Tool icons are rendered in the left DrawingToolPalette instead.
 */
import { ArrowLeft, Undo2, Redo2 } from 'lucide-react'
import type { DrawingSheet, DrawingTemplate } from '../../drawings/drawingDocument'
import type { ToolFamilyId, DrawingToolState } from './drawingConstants'
import { TOOL_FAMILIES } from './drawingConstants'

export type DrawingRibbonProps = {
	navigate: (path: string) => void
	workspaceBackPath: string
	projectName: string
	saveLabel: string
	saveStatus: string
	canUndo: boolean
	canRedo: boolean
	undo: () => void
	redo: () => void
	activeSheet: DrawingSheet | null
	activeTemplate: DrawingTemplate | null
	toolState: DrawingToolState
	onSelectFamily: (familyId: ToolFamilyId) => void
	// Sheet navigator
	sheetIndex: number
	sheetCount: number
	isFirstSheet: boolean
	isLastSheet: boolean
	onPrevSheet: () => void
	onNextSheet: () => void
}

export function DrawingRibbon(props: DrawingRibbonProps) {
	const {
		navigate, workspaceBackPath, projectName, saveLabel, saveStatus,
		canUndo, canRedo, undo, redo,
		activeSheet, activeTemplate,
		toolState, onSelectFamily,
		sheetIndex, sheetCount, isFirstSheet, isLastSheet,
		onPrevSheet, onNextSheet,
	} = props

	return (
		<div className="cad-ribbon-wrapper">
			{/* ─── Row 1: Application Header ─── */}
			<header className="cad-app-header">
				<button className="cad-header-btn" onClick={() => navigate(workspaceBackPath)} title="Back" type="button">
					<ArrowLeft size={14} />
				</button>
				<span className="cad-header-divider" />
				<span className="cad-header-project">{projectName}</span>
				<span className="cad-header-divider" />
				<span className="cad-header-sheet">
					{activeSheet ? `${activeSheet.number} · ${activeSheet.name}` : 'No sheet'}
					{activeTemplate ? ` — ${activeTemplate.paperSizeLabel}` : ''}
				</span>
				<span className="cad-header-spacer" />
				<span className={`cad-header-save ${saveStatus}`}>{saveLabel}</span>
				<span className="cad-header-divider" />
				<button className="cad-header-btn" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)" type="button">
					<Undo2 size={14} />
				</button>
				<button className="cad-header-btn" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Y)" type="button">
					<Redo2 size={14} />
				</button>
			</header>

			{/* ─── Row 2: Family tabs + Sheet Navigator ─── */}
			<nav className="cad-command-ribbon">
				<div className="cad-ribbon-families">
					{TOOL_FAMILIES.map(family => (
						<button
							key={family.id}
							className={`cad-ribbon-family-tab ${toolState.activeFamily === family.id ? 'active' : ''}`}
							onClick={() => onSelectFamily(family.id)}
							type="button"
						>
							{family.label}
						</button>
					))}

					{/* ── Sheet Navigator (after Snap tab) ── */}
					{sheetCount > 0 ? (
						<div className="cad-sheet-navigator">
							<button
								className="cad-sheet-nav-btn"
								type="button"
								disabled={isFirstSheet}
								onClick={onPrevSheet}
								title="Previous sheet"
							>
								‹
							</button>
							<span className="cad-sheet-nav-index" title={activeSheet?.name ?? ''}>
								{sheetIndex + 1}
							</span>
							<button
								className="cad-sheet-nav-btn"
								type="button"
								disabled={isLastSheet}
								onClick={onNextSheet}
								title="Next sheet"
							>
								›
							</button>
						</div>
					) : null}
				</div>
			</nav>
		</div>
	)
}
