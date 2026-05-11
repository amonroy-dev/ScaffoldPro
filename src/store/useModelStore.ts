/**
 * Single Model Graph Store (Zustand)
 *
 * Central source of truth for:
 *   - Saved Views (shared between 3D Canvas and 2D Drawings)
 *   - Active view / section / sheet selection
 *   - Live camera state published from the 3D Canvas
 *   - Drawing package document
 *
 * Both the Canvas and Drawings reference this store so camera
 * configurations, saved views, and section definitions stay in sync.
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import {
	createDefaultDrawingPackage,
	createDrawingEntityId,
	normalizeDrawingPackageDocument,
	type DrawingPackageDocument,
	type DrawingSavedView,
} from '../drawings/drawingDocument'
import {
	type CameraConfig,
	camerasEqual,
	inferViewKind,
	inferDirectionLabel,
	defaultScaleLabel,
} from '../drawings/cameraUtils'

// ─── Live Camera State (published by the 3D Canvas) ───────────────────────

export interface LiveCamera extends CameraConfig {
	/** Ortho direction hint (for plan/elevation label inference) */
	orthoDirection: { x: number; y: number; z: number } | null
}

// ─── Store Shape ──────────────────────────────────────────────────────────

export interface ModelState {
	// ── Drawing Package (single source of truth) ─────────────────────────
	drawingPackage: DrawingPackageDocument
	setDrawingPackage: (next: DrawingPackageDocument | ((prev: DrawingPackageDocument) => DrawingPackageDocument)) => void

	// ── Live Camera (from 3D Canvas) ─────────────────────────────────────
	liveCamera: LiveCamera | null
	publishLiveCamera: (next: LiveCamera | null) => void

	// ── View Apply Request (Drawings → Canvas) ───────────────────────────
	viewApplyRequest: { requestId: number; viewId: string; activateSection: boolean } | null
	requestApplyView: (viewId: string, options?: { activateSection?: boolean }) => void
	clearViewApplyRequest: () => void

	// ── Active Section Override (for linked section views) ───────────────
	activeSectionId: string | null
	setActiveSectionId: (id: string | null) => void

	// ── Saved-View Actions ───────────────────────────────────────────────

	/** Overwrite a saved view's camera from the current live camera. */
	captureViewFromLiveCamera: (viewId: string) => void

	/** Create a brand-new saved view from the live camera and return its id. */
	createViewFromLiveCamera: () => string | null

	/** Create a section-linked view from the live camera + active section. */
	createLinkedSectionView: () => string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────

let _requestCounter = 0

function createUniqueViewName(existing: DrawingSavedView[], hint: string): string {
	const base = hint || 'Saved View'
	const names = new Set(existing.map(v => v.name))
	if (!names.has(base)) return base
	for (let i = 2; i < 200; i++) {
		const candidate = `${base} ${i}`
		if (!names.has(candidate)) return candidate
	}
	return `${base} ${Date.now().toString(36)}`
}

// ─── Store ────────────────────────────────────────────────────────────────

export const useModelStore = create<ModelState>()(
	subscribeWithSelector((set, get) => ({
		// ── Drawing Package ──────────────────────────────────────────────
		drawingPackage: createDefaultDrawingPackage(),
		setDrawingPackage: (next) => {
			set(state => {
				const resolved = typeof next === 'function' ? next(state.drawingPackage) : next
				return { drawingPackage: normalizeDrawingPackageDocument(resolved) }
			})
		},

		// ── Live Camera ──────────────────────────────────────────────────
		liveCamera: null,
		publishLiveCamera: (next) => {
			const prev = get().liveCamera
			if (prev === next) return
			if (prev && next && camerasEqual(prev, next) && prev.orthoDirection === next.orthoDirection) return
			set({ liveCamera: next })
		},

		// ── View Apply Request ───────────────────────────────────────────
		viewApplyRequest: null,
		requestApplyView: (viewId, options) => {
			_requestCounter += 1
			set({ viewApplyRequest: { requestId: _requestCounter, viewId, activateSection: options?.activateSection ?? false } })
		},
		clearViewApplyRequest: () => set({ viewApplyRequest: null }),

		// ── Active Section ───────────────────────────────────────────────
		activeSectionId: null,
		setActiveSectionId: (id) => set({ activeSectionId: id }),

		// ── Saved-View Actions ───────────────────────────────────────────
		captureViewFromLiveCamera: (viewId) => {
			const { liveCamera, drawingPackage, activeSectionId } = get()
			if (!liveCamera) return
			set({
				drawingPackage: normalizeDrawingPackageDocument({
					...drawingPackage,
					activeViewId: viewId,
					savedViews: drawingPackage.savedViews.map(view => {
						if (view.id !== viewId) return view
						const keepSection = view.kind === 'section' || !!view.sectionId
						return {
							...view,
							kind: keepSection ? 'section' : inferViewKind(liveCamera),
							projection: liveCamera.projection,
							camera: { position: { ...liveCamera.position }, target: { ...liveCamera.target }, zoom: liveCamera.zoom },
							directionLabel: inferDirectionLabel(liveCamera),
							...(keepSection ? { sectionId: activeSectionId ?? view.sectionId } : {}),
						}
					}),
				}),
			})
		},

		createViewFromLiveCamera: () => {
			const { liveCamera, drawingPackage } = get()
			if (!liveCamera) return null
			const template = drawingPackage.savedViews.find(v => v.id === drawingPackage.activeViewId) ?? drawingPackage.savedViews[0]
			const id = createDrawingEntityId('view')
			const newView: DrawingSavedView = {
				id,
				name: createUniqueViewName(drawingPackage.savedViews, inferDirectionLabel(liveCamera) ?? 'Saved View'),
				kind: inferViewKind(liveCamera),
				description: 'Authored from the live model camera.',
				projection: liveCamera.projection,
				displayPresetId: template?.displayPresetId ?? drawingPackage.displayPresets[0]?.id ?? 'preset-technical',
				camera: { position: { ...liveCamera.position }, target: { ...liveCamera.target }, zoom: liveCamera.zoom },
				scaleLabel: defaultScaleLabel(liveCamera.projection),
				directionLabel: inferDirectionLabel(liveCamera),
				authoringSource: 'live-model',
				sourceAnnotations: [],
			}
			set({
				drawingPackage: normalizeDrawingPackageDocument({
					...drawingPackage,
					activeViewId: id,
					savedViews: [...drawingPackage.savedViews, newView],
				}),
			})
			return id
		},

		createLinkedSectionView: () => {
			const { liveCamera, drawingPackage, activeSectionId } = get()
			if (!liveCamera || !activeSectionId) return null
			const section = drawingPackage.sections.find(s => s.id === activeSectionId)
			if (!section) return null
			const template = drawingPackage.savedViews.find(v => v.id === drawingPackage.activeViewId) ?? drawingPackage.savedViews[0]
			const id = createDrawingEntityId('view')
			const newView: DrawingSavedView = {
				id,
				name: createUniqueViewName(drawingPackage.savedViews, section.name),
				kind: section.clipMode === 'elevation' ? 'elevation' : 'section',
				description: `Linked to ${section.markerLabel}.`,
				projection: 'orthographic',
				displayPresetId: template?.displayPresetId ?? drawingPackage.displayPresets[0]?.id ?? 'preset-technical',
				camera: { position: { ...liveCamera.position }, target: { ...liveCamera.target }, zoom: liveCamera.zoom },
				scaleLabel: defaultScaleLabel('orthographic'),
				directionLabel: section.clipMode === 'elevation' ? section.name : section.markerLabel,
				sectionId: section.id,
				authoringSource: 'section-linked',
				sourceAnnotations: [],
			}
			set({
				drawingPackage: normalizeDrawingPackageDocument({
					...drawingPackage,
					activeViewId: id,
					activeSectionId: section.id,
					savedViews: [...drawingPackage.savedViews, newView],
				}),
			})
			return id
		},
	}))
)

