import {
	cloneElement,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type ReactElement,
	type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import './Tooltip.css'

type Side = 'top' | 'bottom'
type Align = 'start' | 'center' | 'end'

type Props = {
	content: ReactNode
	children: ReactElement
	side?: Side
	align?: Align
	offset?: number
	delayMs?: number
}

type Pos = { top: number; left: number; transform: string }

/**
 * Small, dependency-free tooltip styled to match the app UI.
 * - Shows on hover + focus
 * - Uses a portal (avoids clipping)
 * - Pointer-events: none (no hover traps)
 */
export function Tooltip({
	content,
	children,
	side = 'bottom',
	align = 'center',
	offset = 10,
	delayMs = 220,
}: Props) {
	const id = useId()
	const triggerRef = useRef<HTMLElement | null>(null)
	const tooltipRef = useRef<HTMLDivElement | null>(null)
	const showTimerRef = useRef<number | null>(null)
	const hideTimerRef = useRef<number | null>(null)
	const [open, setOpen] = useState(false)
	const [renderSide, setRenderSide] = useState<Side>(side)
	const [pos, setPos] = useState<Pos>({ top: 0, left: 0, transform: 'translateX(-50%)' })

	const clearTimers = () => {
		if (showTimerRef.current) window.clearTimeout(showTimerRef.current)
		if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
		showTimerRef.current = null
		hideTimerRef.current = null
	}

	const computePosition = () => {
		const trigger = triggerRef.current
		const tooltip = tooltipRef.current
		if (!trigger || !tooltip) return

		const r = trigger.getBoundingClientRect()
		const tr = tooltip.getBoundingClientRect()

		const transform =
			align === 'start' ? 'translateX(0)' : align === 'end' ? 'translateX(-100%)' : 'translateX(-50%)'
		const rawLeft = align === 'start' ? r.left : align === 'end' ? r.right : r.left + r.width / 2

		let left = rawLeft
		// Clamp horizontally (using anchor + transform assumptions)
		const pad = 8
		if (align === 'center') {
			left = Math.min(Math.max(left, pad + tr.width / 2), window.innerWidth - pad - tr.width / 2)
		} else if (align === 'start') {
			left = Math.min(Math.max(left, pad), window.innerWidth - pad - tr.width)
		} else {
			// end
			left = Math.min(Math.max(left, pad + tr.width), window.innerWidth - pad)
		}

		let actualSide: Side = side
		let top = side === 'bottom' ? r.bottom + offset : r.top - offset - tr.height
		// If offscreen, flip.
		if (top < pad) {
			actualSide = 'bottom'
			top = r.bottom + offset
		}
		if (top + tr.height > window.innerHeight - pad) {
			actualSide = 'top'
			top = Math.max(pad, r.top - offset - tr.height)
		}

		setPos({ top, left, transform })
		setRenderSide(actualSide)
	}

	const show = () => {
		clearTimers()
		showTimerRef.current = window.setTimeout(() => setOpen(true), delayMs)
	}

	const hide = () => {
		clearTimers()
		// small grace period prevents flicker
		hideTimerRef.current = window.setTimeout(() => setOpen(false), 80)
	}

	useLayoutEffect(() => {
		if (!open) return
		computePosition()
		// Second pass after paint for more stable measurements
		const raf = window.requestAnimationFrame(() => computePosition())
		return () => window.cancelAnimationFrame(raf)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, side, align, offset, content])

	useEffect(() => {
		if (!open) return
		const onReflow = () => computePosition()
		window.addEventListener('resize', onReflow)
		// capture=true catches scroll on nested containers
		window.addEventListener('scroll', onReflow, true)
		return () => {
			window.removeEventListener('resize', onReflow)
			window.removeEventListener('scroll', onReflow, true)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open])

	useEffect(() => {
		return () => clearTimers()
	}, [])

	const child = cloneElement(children, {
		...children.props,
		ref: (node: HTMLElement | null) => {
			triggerRef.current = node
			const originalRef = (children as any).ref
			if (typeof originalRef === 'function') originalRef(node)
			else if (originalRef && typeof originalRef === 'object') originalRef.current = node
		},
		onMouseEnter: (e: any) => {
			children.props.onMouseEnter?.(e)
			show()
		},
		onMouseLeave: (e: any) => {
			children.props.onMouseLeave?.(e)
			hide()
		},
		onFocus: (e: any) => {
			children.props.onFocus?.(e)
			show()
		},
		onBlur: (e: any) => {
			children.props.onBlur?.(e)
			hide()
		},
		onKeyDown: (e: any) => {
			children.props.onKeyDown?.(e)
			if (e.key === 'Escape') setOpen(false)
		},
		'aria-describedby': open ? id : undefined,
	})

	return (
		<>
			{child}
			{open
				? createPortal(
						<div
							ref={tooltipRef}
							id={id}
							role="tooltip"
							className="ui-tooltip"
							data-side={renderSide}
							style={{ top: pos.top, left: pos.left, transform: pos.transform }}
						>
							<div className="ui-tooltip-pop">
								<div className="ui-tooltip-inner">{content}</div>
								<div className="ui-tooltip-arrow" />
							</div>
						</div>,
						document.body,
					)
				: null}
		</>
	)
}
