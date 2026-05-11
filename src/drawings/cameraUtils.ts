/**
 * Shared Camera Utilities
 *
 * Bridges the 3D Canvas camera system and the 2D Drawing saved-view system.
 * Both systems share the same camera schema so views created in either
 * workspace are interchangeable.
 */

import type { DrawingProjection, DrawingSavedView, DrawingVector3, DrawingViewKind } from './drawingDocument'

// ─── Camera Types (Firestore-safe, no THREE.js classes) ────────────────────

/** Minimal camera configuration shared between Canvas & Drawings. */
export interface CameraConfig {
	position: DrawingVector3
	target: DrawingVector3
	zoom: number
	projection: DrawingProjection
}

/** Extended camera config with optional metadata. */
export interface CameraSnapshot extends CameraConfig {
	/** Human-readable direction label (e.g. "South", "Top") */
	directionLabel?: string
	/** Timestamp when the snapshot was taken (ISO-8601 or epoch ms) */
	capturedAt?: number
}

// ─── Camera Helpers ────────────────────────────────────────────────────────

/** Extract a CameraConfig from a DrawingSavedView. */
export function cameraFromView(view: DrawingSavedView): CameraConfig {
	return {
		position: { ...view.camera.position },
		target: { ...view.camera.target },
		zoom: view.camera.zoom,
		projection: view.projection,
	}
}

/** Build the camera portion of a DrawingSavedView from a CameraConfig. */
export function viewCameraFromConfig(config: CameraConfig): DrawingSavedView['camera'] {
	return {
		position: { ...config.position },
		target: { ...config.target },
		zoom: config.zoom,
	}
}

/** Deep-equal comparison of two CameraConfig instances. */
export function camerasEqual(a: CameraConfig | null, b: CameraConfig | null): boolean {
	if (a === b) return true
	if (!a || !b) return false
	return (
		a.zoom === b.zoom &&
		a.projection === b.projection &&
		vec3Equal(a.position, b.position) &&
		vec3Equal(a.target, b.target)
	)
}

/** Deep-equal comparison of two DrawingVector3 values. */
export function vec3Equal(a: DrawingVector3 | null | undefined, b: DrawingVector3 | null | undefined): boolean {
	if (a === b) return true
	if (!a || !b) return false
	return a.x === b.x && a.y === b.y && a.z === b.z
}

// ─── View-Kind Inference ───────────────────────────────────────────────────

/**
 * Infer a DrawingViewKind from a camera configuration.
 * Uses the direction from position → target to determine plan/elevation.
 */
export function inferViewKind(config: CameraConfig): DrawingViewKind {
	if (config.projection === 'perspective') return 'iso'
	const dx = config.position.x - config.target.x
	const dy = config.position.y - config.target.y
	const dz = config.position.z - config.target.z
	const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
	if (len < 1e-6) return 'iso'
	const nz = Math.abs(dz / len)
	// Looking straight down → plan
	if (nz > 0.95) return 'plan'
	// Mostly horizontal → elevation
	return 'elevation'
}

/**
 * Get a human-readable direction label for the camera orientation.
 */
export function inferDirectionLabel(config: CameraConfig): string | undefined {
	if (config.projection === 'perspective') return undefined
	const dx = config.position.x - config.target.x
	const dy = config.position.y - config.target.y
	const dz = config.position.z - config.target.z
	const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
	if (len < 1e-6) return undefined
	const nz = Math.abs(dz / len)
	if (nz > 0.95) return dz > 0 ? 'Top' : 'Bottom'
	// Determine cardinal direction from XY
	const angle = Math.atan2(dy, dx) * (180 / Math.PI)
	if (angle >= -45 && angle < 45) return 'East'
	if (angle >= 45 && angle < 135) return 'North'
	if (angle >= -135 && angle < -45) return 'South'
	return 'West'
}

// ─── Scale Utilities ───────────────────────────────────────────────────────

/** Common engineering scale labels for orthographic views. */
export const ENGINEERING_SCALES = [
	'3" = 1\'-0"',
	'1-1/2" = 1\'-0"',
	'1" = 1\'-0"',
	'3/4" = 1\'-0"',
	'1/2" = 1\'-0"',
	'3/8" = 1\'-0"',
	'1/4" = 1\'-0"',
	'3/16" = 1\'-0"',
	'1/8" = 1\'-0"',
	'NTS',
] as const

/** Return the appropriate default scale label for a given projection type. */
export function defaultScaleLabel(projection: DrawingProjection): string {
	return projection === 'orthographic' ? '1/4" = 1\'-0"' : 'NTS'
}

