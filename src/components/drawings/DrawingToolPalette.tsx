/**
 * DrawingToolPalette — Chief Architect–style left tool palette.
 * Shows a flat list of tools for the currently active ribbon family.
 */
import {
	ArrowLeft, Box, KanbanSquare, Printer, Undo2, Redo2, X, Trash2,
	FilePlus, Copy, Layout, Square, AlignVerticalJustifyStart, Scissors, Scan,
	Rotate3d, Image, MessageSquare, Type, AlignLeft, Megaphone, MapPin, StickyNote,
	MoveHorizontal, MoveDiagonal, CornerUpRight, GitBranch, GitMerge, Triangle,
	Link, ExternalLink, Move, ZoomIn, Maximize, Grid3x3, CircleDot, GitCommit,
	Crosshair, Target, Hash,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { DrawingToolId, DrawingToolState, SnapMode } from './drawingConstants'
import { TOOL_FAMILIES } from './drawingConstants'

const ICON: Record<string, ReactNode> = {
	'arrow-left': <ArrowLeft size={14} />,
	'box': <Box size={14} />,
	'kanban': <KanbanSquare size={14} />,
	'printer': <Printer size={14} />,
	'undo': <Undo2 size={14} />,
	'redo': <Redo2 size={14} />,
	'x': <X size={14} />,
	'trash': <Trash2 size={14} />,
	'file-plus': <FilePlus size={14} />,
	'copy': <Copy size={14} />,
	'layout': <Layout size={14} />,
	'square': <Square size={14} />,
	'align-vertical-justify-start': <AlignVerticalJustifyStart size={14} />,
	'scissors': <Scissors size={14} />,
	'scan': <Scan size={14} />,
	'rotate-3d': <Rotate3d size={14} />,
	'image': <Image size={14} />,
	'message-square': <MessageSquare size={14} />,
	'type': <Type size={14} />,
	'align-left': <AlignLeft size={14} />,
	'megaphone': <Megaphone size={14} />,
	'map-pin': <MapPin size={14} />,
	'sticky-note': <StickyNote size={14} />,
	'move-horizontal': <MoveHorizontal size={14} />,
	'move-diagonal': <MoveDiagonal size={14} />,
	'corner-up-right': <CornerUpRight size={14} />,
	'git-branch': <GitBranch size={14} />,
	'git-merge': <GitMerge size={14} />,
	'triangle': <Triangle size={14} />,
	'link': <Link size={14} />,
	'external-link': <ExternalLink size={14} />,
	'move': <Move size={14} />,
	'zoom-in': <ZoomIn size={14} />,
	'maximize': <Maximize size={14} />,
	'grid': <Grid3x3 size={14} />,
	'circle-dot': <CircleDot size={14} />,
	'git-commit': <GitCommit size={14} />,
	'crosshair': <Crosshair size={14} />,
	'target': <Target size={14} />,
	'hash': <Hash size={14} />,
}

export type DrawingToolPaletteProps = {
	toolState: DrawingToolState
	onSelectTool: (toolId: DrawingToolId) => void
}

export function DrawingToolPalette({ toolState, onSelectTool }: DrawingToolPaletteProps) {
	const activeFamily = TOOL_FAMILIES.find(f => f.id === toolState.activeFamily)
	if (!activeFamily) return null

	return (
		<aside className="cad-tool-palette">
			<div className="cad-tool-palette-header">Tool Palette</div>
			<div className="cad-tool-palette-list">
				{activeFamily.tools.map(tool => {
					const isSnapToggle = tool.toggle && tool.id.startsWith('snap-')
					const isGridToggle = tool.id === 'grid-toggle'
					const isActive = isSnapToggle
						? toolState.activeSnaps.has(tool.id as SnapMode)
						: isGridToggle
							? toolState.gridVisible
							: toolState.activeTool === tool.id
					return (
						<button
							key={tool.id}
							className={`cad-tool-palette-item ${isActive ? 'active' : ''}`}
							onClick={() => onSelectTool(tool.id)}
							title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
							type="button"
						>
							<span className="cad-tool-palette-icon">{ICON[tool.icon] ?? null}</span>
							<span className="cad-tool-palette-label">{tool.label}</span>
						</button>
					)
				})}
			</div>
		</aside>
	)
}

