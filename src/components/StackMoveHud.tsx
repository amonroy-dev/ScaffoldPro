import { useTool } from '../contexts/ToolContext'
import './StackMoveHud.css'

export function StackMoveHud() {
	const { stackMoveStep, stackCadHud, stackOrthoLocked } = useTool()
	if (stackMoveStep !== 'place' || !stackCadHud) return null

	const { distance, angle, field, distanceInput, angleInput, lockedAngleDeg } = stackCadHud
	const distDisplay = distanceInput !== '' ? distanceInput : distance.toFixed(2)
	const angleDisplay = angleInput !== '' ? angleInput : angle.toFixed(0)
	const isAngleLocked = lockedAngleDeg !== null || stackOrthoLocked

	return (
		<div className="stack-move-hud">
			<div className={`hud-field${field === 'distance' ? ' hud-field--active' : ''}`}>
				<span className="hud-label">dist</span>
				<span className="hud-value">
					{distDisplay}
					{field === 'distance' && <span className="hud-cursor" />}
					{' ft'}
				</span>
			</div>
			<span className="hud-sep">·</span>
			<div className={`hud-field${field === 'angle' ? ' hud-field--active' : ''}${isAngleLocked ? ' hud-field--locked' : ''}`}>
				<span className="hud-label">angle</span>
				<span className="hud-value">
					{angleDisplay}
					{field === 'angle' && <span className="hud-cursor" />}
					{'°'}
					{isAngleLocked && <span className="hud-lock-icon">🔒</span>}
				</span>
			</div>
			<span className="hud-hint">Tab ⇌ &nbsp;·&nbsp; Enter places &nbsp;·&nbsp; F8 ortho &nbsp;·&nbsp; Esc cancels</span>
		</div>
	)
}
