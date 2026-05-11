import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import type { User } from 'firebase/auth'
import {
  AlertCircle,
  Archive,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Copy,
  Ellipsis,
  Flag,
  GripVertical,
  ListTodo,
  MessageSquare,
  Trash2,
} from 'lucide-react'
import { createFollowUpTask, deletePmTask, duplicatePmTask, updatePmTaskDueDate } from '../data/pmFirestore'
import { usePmShellOutlet } from '../hooks/usePmOutlet'
import type { PmStage, PmTask } from '../types'
import { dueDateState, formatDateLabel, formatTaskDueDate, toDateInputValue } from '../utils/dates'

type PmTaskCardProps = {
  task: PmTask
  user?: User
  assigneeName?: string
  stageName?: string
  stage?: Pick<PmStage, 'isClosedStage'> | null
  subtle?: boolean
  interactive?: boolean
  dragHandleProps?: ButtonHTMLAttributes<HTMLButtonElement>
} & HTMLAttributes<HTMLDivElement>

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('button,input,select,textarea,a,[data-pm-interactive="true"]'))
}

const CALENDAR_WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function parseDraftDate(value: string) {
  if (!value) return null
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function startOfCalendarMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1)
}

function shiftCalendarMonth(value: Date, offset: number) {
  return new Date(value.getFullYear(), value.getMonth() + offset, 1)
}

function shiftCalendarDay(value: Date, offset: number) {
  const next = new Date(value)
  next.setDate(next.getDate() + offset)
  return next
}

function buildCalendarDays(monthValue: Date, selectedValue: string) {
  const monthStart = startOfCalendarMonth(monthValue)
  const firstVisibleDay = new Date(monthStart)
  firstVisibleDay.setDate(monthStart.getDate() - monthStart.getDay())
  const todayValue = toDateInputValue(new Date())

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstVisibleDay)
    date.setDate(firstVisibleDay.getDate() + index)
    const value = toDateInputValue(date)
    return {
      key: `${value}-${index}`,
      value,
      label: date.getDate(),
      fullLabel: date.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
      isCurrentMonth: date.getMonth() === monthStart.getMonth(),
      isToday: value === todayValue,
      isSelected: value === selectedValue,
    }
  })
}

const CONTEXT_MENU_WIDTH = 248
const CONTEXT_MENU_HEIGHT = 260
const CONTEXT_MENU_MARGIN = 12

function getClampedContextMenuPosition(left: number, top: number) {
  if (typeof window === 'undefined') return { left, top }
  return {
    left: Math.max(CONTEXT_MENU_MARGIN, Math.min(left, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_MARGIN)),
    top: Math.max(CONTEXT_MENU_MARGIN, Math.min(top, window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_MARGIN)),
  }
}

export default function PmTaskCard(props: PmTaskCardProps) {
  const {
    task,
    user,
    assigneeName,
    stageName,
    stage,
    subtle = false,
    interactive = true,
    dragHandleProps,
    className = '',
    onClick,
    onContextMenu,
    onKeyDown,
    role,
    tabIndex,
    ...cardProps
  } = props
  const { activeTask, closeTask, openTask } = usePmShellOutlet()

  const [dueDateDraft, setDueDateDraft] = useState(toDateInputValue(task.dueDate))
  const [dueOpen, setDueOpen] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ left: number; top: number } | null>(null)
  const [busyAction, setBusyAction] = useState<'due' | 'duplicate' | 'followUp' | 'delete' | null>(null)
  const [error, setError] = useState('')

  const cardRef = useRef<HTMLDivElement>(null)
  const dueBtnRef = useRef<HTMLButtonElement>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const duePopoverRef = useRef<HTMLDivElement>(null)
  const menuPopoverRef = useRef<HTMLDivElement>(null)
  const [dueCalendarMonth, setDueCalendarMonth] = useState(() => startOfCalendarMonth(new Date()))

  const selectedDueDate = useMemo(() => parseDraftDate(dueDateDraft), [dueDateDraft])
  const currentDate = new Date()
  const todayValue = toDateInputValue(currentDate)
  const tomorrowValue = toDateInputValue(shiftCalendarDay(currentDate, 1))
  const dueMonthLabel = useMemo(
    () => dueCalendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    [dueCalendarMonth],
  )
  const dueCalendarDays = useMemo(() => buildCalendarDays(dueCalendarMonth, dueDateDraft), [dueCalendarMonth, dueDateDraft])

  const duePopoverStyle: React.CSSProperties = (() => {
    if (!dueOpen || !dueBtnRef.current) return {}
    const rect = dueBtnRef.current.getBoundingClientRect()
    const margin = 12
    const popoverWidth = Math.min(304, window.innerWidth - margin * 2)
    const preferredHeight = 366
    const left = Math.min(
      Math.max(margin, rect.right - popoverWidth),
      Math.max(margin, window.innerWidth - popoverWidth - margin),
    )
    const top = window.innerHeight - rect.bottom >= preferredHeight
      ? rect.bottom + 8
      : Math.max(margin, rect.top - preferredHeight - 8)

    return {
      position: 'fixed' as const,
      top,
      left,
      width: popoverWidth,
      zIndex: 9999,
    }
  })()

  const contextMenuOpen = Boolean(contextMenuPosition)
  const contextMenuStyle: React.CSSProperties = contextMenuPosition
    ? {
        position: 'fixed',
        top: contextMenuPosition.top,
        left: contextMenuPosition.left,
        zIndex: 9999,
      }
    : {}

  const dueState = dueDateState(task.dueDate)
  const dueClass = dueState === 'overdue' ? 'is-overdue' : dueState === 'today' ? 'is-today' : ''
  const dueLabel = formatTaskDueDate(task.dueDate) || 'No due date'
  const actionAllowed = interactive && Boolean(user)
  const menuAvailable = interactive && actionAllowed
  const { onClick: onDragHandleClick, className: dragHandleClassName = '', ...dragButtonProps } = dragHandleProps ?? {}
  const taskNumberSeed = task.id.replace(/[^a-z0-9]/gi, '')
  const taskNumber = `TK-${(taskNumberSeed.slice(-6) || task.id.slice(0, 6)).toUpperCase()}`
  const taskStateLabel = task.isArchived ? 'Archived' : task.completedAt ? 'Completed' : 'Live'
  const isElevated = dueOpen || contextMenuOpen

  useEffect(() => {
    setDueDateDraft(toDateInputValue(task.dueDate))
  }, [task.dueDate])

  useEffect(() => {
    if (!dueOpen) return
    setDueCalendarMonth(startOfCalendarMonth(selectedDueDate ?? new Date()))
  }, [dueOpen, selectedDueDate])

  useEffect(() => {
    if (!dueOpen && !contextMenuOpen) return undefined

    const closeMenus = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (cardRef.current?.contains(target)) return
      if (duePopoverRef.current?.contains(target)) return
      if (menuPopoverRef.current?.contains(target)) return
      setDueOpen(false)
      setContextMenuPosition(null)
    }

    window.addEventListener('pointerdown', closeMenus)
    return () => window.removeEventListener('pointerdown', closeMenus)
  }, [contextMenuOpen, dueOpen])

  useEffect(() => {
    if (!dueOpen && !contextMenuOpen) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setDueOpen(false)
      setContextMenuPosition(null)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [contextMenuOpen, dueOpen])

  const closeContextMenu = () => setContextMenuPosition(null)

  const openContextMenuAt = (left: number, top: number) => {
    setDueOpen(false)
    setContextMenuPosition(getClampedContextMenuPosition(left, top))
  }

  const openContextMenuFromButton = () => {
    if (!moreBtnRef.current) return
    const rect = moreBtnRef.current.getBoundingClientRect()
    const top = window.innerHeight - rect.bottom >= CONTEXT_MENU_HEIGHT
      ? rect.bottom + 8
      : rect.top - CONTEXT_MENU_HEIGHT - 8
    openContextMenuAt(rect.right - CONTEXT_MENU_WIDTH, top)
  }

  const runMutation = async (action: 'due' | 'duplicate' | 'followUp' | 'delete', callback: () => Promise<void>, onDone?: () => void) => {
    try {
      setBusyAction(action)
      setError('')
      await callback()
      onDone?.()
    } catch (mutationError) {
      console.error('[PmTaskCard] quick action failed', mutationError)
      setError(mutationError instanceof Error ? mutationError.message : 'Unable to update task')
    } finally {
      setBusyAction(null)
    }
  }

  const handleDueDateSave = async (value: string) => {
    if (!user) return
    setDueDateDraft(value)
    await runMutation(
      'due',
      () => updatePmTaskDueDate(task.jobId, task.id, value ? new Date(`${value}T12:00:00`) : null, user, task.dueDate),
      () => setDueOpen(false),
    )
  }

  const handleOpenDetails = (focusSubtaskComposer = false) => {
    closeContextMenu()
    setDueOpen(false)
    openTask({ jobId: task.jobId, taskId: task.id, ...(focusSubtaskComposer ? { focusSubtaskComposer: true } : {}) })
  }

  const handleDuplicate = async () => {
    if (!user) return
    await runMutation('duplicate', async () => {
      await duplicatePmTask(task, user)
    }, closeContextMenu)
  }

  const handleCreateFollowUp = async () => {
    if (!user) return
    await runMutation('followUp', async () => {
      await createFollowUpTask(task, user)
    }, closeContextMenu)
  }

  const handleDelete = async () => {
    if (!user) return
    const confirmed = typeof window === 'undefined'
      ? true
      : window.confirm(`Delete "${task.title}"? This will permanently remove the task and its subtasks, comments, and activity.`)
    if (!confirmed) return

    await runMutation('delete', async () => {
      await deletePmTask(task.jobId, task.id, user)
    }, () => {
      closeContextMenu()
      setDueOpen(false)
      if (activeTask?.jobId === task.jobId && activeTask.taskId === task.id) {
        closeTask()
      }
    })
  }

  return (
    <div
      ref={cardRef}
      className={`pm-task-card ${subtle ? 'is-subtle' : ''} ${task.isArchived ? 'is-archived' : ''} ${interactive ? '' : 'is-static'} ${isElevated ? 'is-elevated' : ''} ${className}`.trim()}
      role={role ?? (onClick ? 'button' : undefined)}
      tabIndex={tabIndex ?? (onClick ? 0 : undefined)}
      onClick={event => {
        if (isInteractiveTarget(event.target)) return
        setDueOpen(false)
        closeContextMenu()
        onClick?.(event)
      }}
      onContextMenu={event => {
        onContextMenu?.(event)
        if (event.defaultPrevented || !actionAllowed || isInteractiveTarget(event.target)) return
        event.preventDefault()
        event.stopPropagation()
        openContextMenuAt(event.clientX, event.clientY)
      }}
      onKeyDown={event => {
        onKeyDown?.(event)
        if (event.defaultPrevented) return
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault()
          const rect = cardRef.current?.getBoundingClientRect()
          if (rect) openContextMenuAt(rect.left + 20, rect.top + 48)
          return
        }
        if (!onClick) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.currentTarget.click()
        }
      }}
      {...cardProps}
    >
      <div className="pm-task-card__header">
        <div className="pm-task-card__header-copy">
          <div className="pm-task-card__eyebrow">
            <span className="pm-task-card__number">{taskNumber}</span>
            <span className="pm-task-card__eyebrow-separator" />
            <span className="pm-task-card__status">{taskStateLabel}</span>
          </div>

          <div className={`pm-task-card__title ${task.completedAt ? 'is-complete' : ''}`}>{task.title}</div>
        </div>

        {interactive ? (
          <div className="pm-task-card__actions" data-pm-interactive="true">
            {dragHandleProps ? (
              <button
                type="button"
                className={`pm-task-card__action pm-task-card__action--drag ${dragHandleClassName}`.trim()}
                aria-label={`Drag ${task.title}`}
                data-pm-interactive="true"
                onClick={event => {
                  event.stopPropagation()
                  onDragHandleClick?.(event)
                }}
                {...dragButtonProps}
              >
                <GripVertical size={14} />
              </button>
            ) : null}

            {actionAllowed ? (
              <div className="pm-task-card__popover-wrap" data-pm-interactive="true">
                <button
                  ref={dueBtnRef}
                  type="button"
                  className="pm-task-card__action"
                  aria-label={`Quick due date for ${task.title}`}
                  aria-haspopup="dialog"
                  aria-expanded={dueOpen}
                  data-pm-interactive="true"
                  onClick={event => {
                    event.stopPropagation()
                    setDueOpen(value => !value)
                    closeContextMenu()
                  }}
                >
                  <CalendarClock size={14} />
                </button>
                {dueOpen && typeof document !== 'undefined'
                  ? createPortal(
                      <div
                        ref={duePopoverRef}
                        className="pm-task-card__popover pm-task-card__popover--fixed pm-task-card__popover--calendar"
                        role="dialog"
                        aria-label={`Due date picker for ${task.title}`}
                        data-pm-interactive="true"
                        style={duePopoverStyle}
                      >
                        <div className="pm-task-card__calendar-head">
                          <div>
                            <div className="pm-field-label">Due date</div>
                            <div className="pm-task-card__calendar-title">{dueMonthLabel}</div>
                          </div>
                          <div className="pm-task-card__calendar-nav" data-pm-interactive="true">
                            <button
                              type="button"
                              className="pm-task-card__action pm-task-card__calendar-nav-btn"
                              aria-label="Previous month"
                              onClick={() => setDueCalendarMonth(value => shiftCalendarMonth(value, -1))}
                            >
                              <ChevronLeft size={14} />
                            </button>
                            <button
                              type="button"
                              className="pm-task-card__action pm-task-card__calendar-nav-btn"
                              aria-label="Next month"
                              onClick={() => setDueCalendarMonth(value => shiftCalendarMonth(value, 1))}
                            >
                              <ChevronRight size={14} />
                            </button>
                          </div>
                        </div>

                        <div className="pm-task-card__calendar-shortcuts" data-pm-interactive="true">
                          <button
                            type="button"
                            className={`pm-task-card__calendar-shortcut ${dueDateDraft === todayValue ? 'is-selected' : ''}`.trim()}
                            aria-pressed={dueDateDraft === todayValue}
                            disabled={busyAction === 'due'}
                            onClick={() => void handleDueDateSave(todayValue)}
                          >
                            Today
                          </button>
                          <button
                            type="button"
                            className={`pm-task-card__calendar-shortcut ${dueDateDraft === tomorrowValue ? 'is-selected' : ''}`.trim()}
                            aria-pressed={dueDateDraft === tomorrowValue}
                            disabled={busyAction === 'due'}
                            onClick={() => void handleDueDateSave(tomorrowValue)}
                          >
                            Tomorrow
                          </button>
                        </div>

                        <div className="pm-task-card__calendar-weekdays" aria-hidden="true">
                          {CALENDAR_WEEKDAY_LABELS.map(label => <span key={label}>{label}</span>)}
                        </div>

                        <div className="pm-task-card__calendar-grid" data-pm-interactive="true">
                          {dueCalendarDays.map(day => (
                            <button
                              key={day.key}
                              type="button"
                              className={`pm-task-card__calendar-day ${day.isCurrentMonth ? '' : 'is-outside'} ${day.isToday ? 'is-today' : ''} ${day.isSelected ? 'is-selected' : ''}`.trim()}
                              aria-label={day.fullLabel}
                              aria-pressed={day.isSelected}
                              disabled={busyAction === 'due'}
                              onClick={() => void handleDueDateSave(day.value)}
                            >
                              {day.label}
                            </button>
                          ))}
                        </div>

                        <div className="pm-task-card__calendar-footer">
                          <span className="pm-task-card__calendar-caption">
                            {selectedDueDate ? formatDateLabel(selectedDueDate) : 'No due date selected'}
                          </span>
                          <button
                            className="pm-text-link pm-task-card__calendar-clear"
                            type="button"
                            disabled={busyAction === 'due' || !dueDateDraft}
                            onClick={event => {
                              event.stopPropagation()
                              void handleDueDateSave('')
                            }}
                          >
                            Clear date
                          </button>
                        </div>
                      </div>,
                      document.body,
                    )
                  : null}
              </div>
            ) : null}

            {menuAvailable ? (
              <button
                ref={moreBtnRef}
                type="button"
                className="pm-task-card__action"
                aria-label={`More actions for ${task.title}`}
                aria-haspopup="menu"
                aria-expanded={contextMenuOpen}
                data-pm-interactive="true"
                onClick={event => {
                  event.stopPropagation()
                  if (contextMenuOpen) {
                    closeContextMenu()
                    return
                  }
                  openContextMenuFromButton()
                }}
              >
                <Ellipsis size={14} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {task.description ? <div className="pm-task-card__description">{task.description}</div> : null}

      <div className="pm-task-card__meta">
        <span className={`pm-priority-pill priority-${task.priority}`.trim()}>
          <Flag size={12} />
          {task.priority}
        </span>
        <span className={`pm-task-card__meta-item ${dueClass}`.trim()} title={formatDateLabel(task.dueDate)}>
          {dueState === 'overdue' ? <AlertCircle size={13} /> : <CalendarClock size={13} />}
          {dueLabel}
        </span>
        {stageName ? <span className="pm-task-card__meta-item">{stageName}</span> : null}
        {assigneeName ? <span className="pm-task-card__meta-item">{assigneeName}</span> : null}
      </div>

      <div className="pm-task-card__stats">
        <span className="pm-task-card__meta-item">
          <ListTodo size={13} />
          {task.subtaskCount}
        </span>
        <span className="pm-task-card__meta-item">
          <MessageSquare size={13} />
          {task.commentCount}
        </span>
        {task.completedAt ? (
          <span className="pm-task-card__meta-item is-complete">
            <CheckCircle2 size={13} />
            Complete
          </span>
        ) : null}
        {task.isArchived ? (
          <span className="pm-task-card__meta-item is-archived">
            <Archive size={13} />
            Archived
          </span>
        ) : null}
      </div>

      {contextMenuOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuPopoverRef}
              className="pm-context-menu"
              role="menu"
              aria-label={`Task actions for ${task.title}`}
              data-pm-interactive="true"
              style={contextMenuStyle}
            >
              <button className="pm-context-menu__item" type="button" disabled={Boolean(busyAction)} onClick={() => void handleDuplicate()}>
                <Copy size={14} />
                Duplicate task
              </button>
              <button className="pm-context-menu__item" type="button" disabled={Boolean(busyAction)} onClick={() => void handleCreateFollowUp()}>
                <ArrowRight size={14} />
                Create follow-up task
              </button>
              <button className="pm-context-menu__item" type="button" disabled={Boolean(busyAction)} onClick={() => handleOpenDetails(true)}>
                <ListTodo size={14} />
                Add subtask
              </button>
              <button className="pm-context-menu__item" type="button" disabled={Boolean(busyAction)} onClick={() => handleOpenDetails(false)}>
                <ArrowUpRight size={14} />
                Open task details
              </button>
              <div className="pm-context-menu__divider" role="separator" />
              <button className="pm-context-menu__item is-danger" type="button" disabled={Boolean(busyAction)} onClick={() => void handleDelete()}>
                <Trash2 size={14} />
                Delete task
              </button>
            </div>,
            document.body,
          )
        : null}

      {busyAction ? <div className="pm-inline-hint">Saving…</div> : null}
      {error ? <div className="pm-inline-error">{error}</div> : null}
    </div>
  )
}