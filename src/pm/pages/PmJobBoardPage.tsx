import { Fragment, useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import {
  type CollisionDetection,
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus } from 'lucide-react'
import PmTaskCard from '../components/PmTaskCard'
import { movePmTask } from '../data/pmFirestore'
import { usePmJobOutlet } from '../hooks/usePmOutlet'
import type { PmStage, PmTask } from '../types'
import { getMidpointSortKey } from '../utils/sortKey'
import { getPmStageCode, getPmStageLabel } from '../utils/stageLabels'

const SLOT_PREFIX = 'slot:'

function hasTouches(event: Event): event is Event & { touches: TouchList } {
  return 'touches' in event
}

function hasChangedTouches(event: Event): event is Event & { changedTouches: TouchList } {
  return 'changedTouches' in event
}

function hasClientCoordinates(event: Event): event is MouseEvent | PointerEvent {
  return 'clientX' in event && 'clientY' in event
}

function getEventClientCoordinates(event: Event | null) {
  if (!event) return null

  if (hasTouches(event) && event.touches.length) {
    const touch = event.touches[0]
    return { x: touch.clientX, y: touch.clientY }
  }

  if (hasChangedTouches(event) && event.changedTouches.length) {
    const touch = event.changedTouches[0]
    return { x: touch.clientX, y: touch.clientY }
  }

  if (hasClientCoordinates(event)) {
    return { x: event.clientX, y: event.clientY }
  }

  return null
}

const centerDragOverlayToCursor: Modifier = ({ activatorEvent, activeNodeRect, overlayNodeRect, transform }) => {
  const startCoordinates = getEventClientCoordinates(activatorEvent)
  if (!startCoordinates || !activeNodeRect || !overlayNodeRect) return transform

  const pointerOffsetX = startCoordinates.x - activeNodeRect.left
  const pointerOffsetY = startCoordinates.y - activeNodeRect.top

  return {
    ...transform,
    x: transform.x + pointerOffsetX - overlayNodeRect.width / 2,
    y: transform.y + pointerOffsetY - overlayNodeRect.height / 2,
  }
}

const dragOverlayModifiers: Modifier[] = [centerDragOverlayToCursor]

function getStageSlotId(stageId: string, index: number) {
  return `${SLOT_PREFIX}${stageId}:${index}`
}

function parseStageSlotId(id: string) {
  if (!id.startsWith(SLOT_PREFIX)) return null
  const slotValue = id.slice(SLOT_PREFIX.length)
  const separatorIndex = slotValue.lastIndexOf(':')
  if (separatorIndex === -1) return null
  const stageId = slotValue.slice(0, separatorIndex)
  const index = Number(slotValue.slice(separatorIndex + 1))
  if (!stageId || Number.isNaN(index)) return null
  return { stageId, index }
}

const boardCollisionDetection: CollisionDetection = args => {
  const pointerCollisions = pointerWithin(args)
  return pointerCollisions.length ? pointerCollisions : closestCenter(args)
}

type ColumnProps = {
  stage: PmStage
  tasks: PmTask[]
  user: User
  canEdit: boolean
  canDrag: boolean
  isDragActive: boolean
  isDropTarget: boolean
  taskView: 'active' | 'archived'
  onOpenTask: (task: PmTask) => void
  onCreateTask: (title: string, stageId: string) => Promise<void>
}

function BoardDropSlot({ stageId, index }: { stageId: string; index: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: getStageSlotId(stageId, index) })
  return (
    <div ref={setNodeRef} className={`pm-board-drop-slot ${isOver ? 'is-over' : 'is-visible'}`.trim()} aria-hidden="true">
      <div className="pm-board-drop-slot__surface">
        <div className="pm-board-drop-slot__ghost">
          <span className="pm-board-drop-slot__label">Drop task</span>
          <span className="pm-board-drop-slot__ghost-line pm-board-drop-slot__ghost-line--title" />
          <span className="pm-board-drop-slot__ghost-line" />
        </div>
      </div>
    </div>
  )
}

function SortableTaskCard({
  task,
  stage,
  canDrag,
  onOpenTask,
  user,
}: {
  task: PmTask
  stage: PmStage
  canDrag: boolean
  onOpenTask: (task: PmTask) => void
  user: User
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !canDrag,
    transition: {
      duration: 300,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    },
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`pm-sortable-card ${isDragging ? 'is-dragging' : ''}`.trim()}
      {...(canDrag ? attributes : {})}
      {...(canDrag ? listeners : {})}
    >
      <PmTaskCard
        task={task}
        user={user}
        stage={stage}
        dragHandleProps={canDrag ? { ...attributes, ...listeners } : undefined}
        onClick={() => onOpenTask(task)}
      />
    </div>
  )
}

function BoardColumn({ stage, tasks, user, canEdit, canDrag, isDragActive, isDropTarget, taskView, onOpenTask, onCreateTask }: ColumnProps) {
	  const [draft, setDraft] = useState('')
	  const [isAdding, setIsAdding] = useState(false)
	  const { setNodeRef } = useDroppable({ id: `stage:${stage.id}` })
	  const stageLabel = getPmStageLabel(stage.id, stage.name)
  const columnMeta = taskView === 'archived'
    ? 'Archived record set'
    : stage.isClosedStage
      ? 'Completed work and handoff'
      : canDrag
        ? 'Drop into any open box in this lane'
        : 'Read only lane'

  return (
	    <section
	      ref={setNodeRef}
	      className={`pm-board-column ${isDropTarget ? 'is-over' : ''} ${isDragActive ? 'is-sorting' : ''}`.trim()}
	      data-stage-tone={stage.colorToken}
	    >
      <div className="pm-board-column__header">
	        <div className="pm-board-column__header-copy">
	          <div className="pm-board-column__eyebrow">
	            <span className="pm-board-column__status-dot" />
	            <span>{getPmStageCode(stage.id, stageLabel)}</span>
	          </div>
	          <div className="pm-board-column__title-line">
	            <div className="pm-board-column__title">{stageLabel}</div>
	            <span className="pm-board-column__count">{tasks.length}</span>
	          </div>
	          <div className="pm-board-column__meta">{columnMeta}</div>
        </div>
      </div>

	      <SortableContext items={tasks.map(task => task.id)} strategy={verticalListSortingStrategy}>
	        <div className="pm-board-column__stack">
	          {isDragActive ? <BoardDropSlot stageId={stage.id} index={0} /> : null}
	          {tasks.map((task, index) => (
	            <Fragment key={task.id}>
	              <SortableTaskCard task={task} stage={stage} canDrag={canDrag} user={user} onOpenTask={onOpenTask} />
	              {isDragActive ? <BoardDropSlot stageId={stage.id} index={index + 1} /> : null}
	            </Fragment>
	          ))}
	        </div>
	      </SortableContext>

	      {canEdit ? (
	        <div className="pm-add-task" data-pm-add-task="true">
	          {isAdding ? (
	            <form
	              className="pm-add-task__card"
	              onSubmit={event => {
	                event.preventDefault()
	                const title = draft.trim()
	                if (!title) return
	                void onCreateTask(title, stage.id).then(() => {
	                  setDraft('')
	                })
	              }}
	            >
	              <input
	                className="pm-add-task__input"
	                value={draft}
	                onChange={event => setDraft(event.target.value)}
	                placeholder="Write a task name"
	                autoFocus
	                onKeyDown={event => {
	                  if (event.key === 'Escape') {
	                    event.preventDefault()
	                    setDraft('')
	                    setIsAdding(false)
	                  }
	                }}
	              />
	            </form>
	          ) : null}

	          <button
	            type="button"
	            className="pm-add-task__button"
	            onClick={() => {
	              setIsAdding(true)
	            }}
	          >
	            <Plus size={14} />
	            Add task
	          </button>
	        </div>
	      ) : null}
    </section>
  )
}

export default function PmJobBoardPage() {
  const { user, job, jobId, stages, tasks, taskView, createTask, openTask } = usePmJobOutlet()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [optimisticTasks, setOptimisticTasks] = useState<PmTask[] | null>(null)

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 3 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
  )
  const boardTasks = optimisticTasks ?? tasks
  const visibleTasks = useMemo(() => boardTasks.filter(task => (taskView === 'archived' ? task.isArchived : !task.isArchived)), [boardTasks, taskView])
  const canEdit = taskView === 'active' && job?.status !== 'archived'
  const canDrag = canEdit
  const completedCount = useMemo(() => visibleTasks.filter(task => Boolean(task.completedAt)).length, [visibleTasks])
  const tasksByStage = useMemo(() => {
    return Object.fromEntries(stages.map(stage => [stage.id, visibleTasks.filter(task => task.stageId === stage.id).sort((a, b) => a.sortKey - b.sortKey)]))
  }, [stages, visibleTasks])
  const tasksById = useMemo(() => Object.fromEntries(visibleTasks.map(task => [task.id, task])), [visibleTasks])
  const activeTask = activeId ? tasksById[activeId] : null
  const overStageId = useMemo(() => {
    if (!overId) return null
    const slotTarget = parseStageSlotId(overId)
    if (slotTarget) return slotTarget.stageId
    if (overId.startsWith('stage:')) return overId.replace('stage:', '')
    return tasksById[overId]?.stageId ?? null
  }, [overId, tasksById])

  useEffect(() => {
    setOptimisticTasks(null)
  }, [tasks])

  const handleCreateTask = async (title: string, stageId: string) => {
    await createTask({ stageId, title })
  }

  const handleDragStart = (event: DragStartEvent) => {
    if (!canDrag) return
    setActiveId(String(event.active.id))
  }

  const handleDragOver = (event: DragOverEvent) => {
    if (!canDrag) return
    setOverId(event.over?.id ? String(event.over.id) : null)
  }

  const handleDragCancel = (_event: DragCancelEvent) => {
    setActiveId(null)
    setOverId(null)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!canDrag) {
      setActiveId(null)
      setOverId(null)
      return
    }

    const activeTaskId = String(event.active.id)
    const overId = event.over?.id ? String(event.over.id) : ''
    if (!overId || activeTaskId === overId) {
      setActiveId(null)
      setOverId(null)
      return
    }

    const draggedTask = tasksById[activeTaskId]
    if (!draggedTask) {
      setActiveId(null)
      setOverId(null)
      return
    }

    const slotTarget = parseStageSlotId(overId)
    const sourceTasks = tasksByStage[draggedTask.stageId] ?? []
    const sourceIndex = sourceTasks.findIndex(task => task.id === draggedTask.id)
    const targetStageId = slotTarget?.stageId ?? (overId.startsWith('stage:') ? overId.replace('stage:', '') : tasksById[overId]?.stageId)
    if (!targetStageId) {
      setActiveId(null)
      setOverId(null)
      return
    }

    const targetTasks = (tasksByStage[targetStageId] ?? []).filter(task => task.id !== draggedTask.id)
    const overTask = tasksById[overId]
    let insertIndex = targetTasks.length

    if (slotTarget) {
      const adjustedIndex = draggedTask.stageId === targetStageId && sourceIndex !== -1 && sourceIndex < slotTarget.index
        ? slotTarget.index - 1
        : slotTarget.index
      insertIndex = Math.max(0, Math.min(adjustedIndex, targetTasks.length))
    } else if (overTask) {
      const overIndex = targetTasks.findIndex(task => task.id === overTask.id)
      insertIndex = draggedTask.stageId === targetStageId && sourceIndex < overIndex ? overIndex + 1 : overIndex
    }

    const orderedTargetTasks = [...targetTasks]
    orderedTargetTasks.splice(insertIndex, 0, draggedTask)

    const nextIndex = orderedTargetTasks.findIndex(task => task.id === draggedTask.id)
    const before = orderedTargetTasks[nextIndex - 1] ?? null
    const after = orderedTargetTasks[nextIndex + 1] ?? null
    const sortKey = getMidpointSortKey(before?.sortKey ?? null, after?.sortKey ?? null)

    setOptimisticTasks(boardTasks.map(task => (task.id === draggedTask.id ? { ...task, stageId: targetStageId, sortKey } : task)))
    setActiveId(null)
    setOverId(null)

    try {
      await movePmTask({ jobId, taskId: draggedTask.id, stageId: targetStageId, sortKey, user })
    } catch (error) {
      setOptimisticTasks(null)
      throw error
    }
  }

  return (
    <div className="pm-page pm-job-board-page">
	      <DndContext
	        sensors={sensors}
	        collisionDetection={boardCollisionDetection}
	        onDragStart={handleDragStart}
	        onDragOver={handleDragOver}
	        onDragCancel={handleDragCancel}
	        onDragEnd={event => void handleDragEnd(event)}
	      >
	        <section className="pm-board-overview">
	          <div className="pm-board-overview__copy-block">
	            <div className="pm-section-eyebrow">Execution board</div>
	            <div className="pm-board-overview__title">{taskView === 'archived' ? 'Archived task register' : 'Live coordination lanes'}</div>
	            <p className="pm-board-overview__copy">
	              {taskView === 'archived'
	                ? 'Reference completed and archived work across the full delivery sequence.'
	                : canDrag
	                  ? 'Move work across live lanes with insertion boxes that open between every task as you drag.'
	                  : 'Board is visible for review while editing is disabled for this job state.'}
	            </p>
	          </div>
	          <div className="pm-board-overview__stats">
	            <div className="pm-board-overview__stat">
	              <strong>{visibleTasks.length}</strong>
	              <span>{taskView === 'archived' ? 'Archived tasks' : 'Tasks in scope'}</span>
	            </div>
	            <div className="pm-board-overview__stat">
	              <strong>{stages.length}</strong>
	              <span>Workflow lanes</span>
	            </div>
	            <div className="pm-board-overview__stat">
	              <strong>{completedCount}</strong>
	              <span>{taskView === 'archived' ? 'Completed records' : 'Marked complete'}</span>
	            </div>
	          </div>
	        </section>

        <div className="pm-board-grid">
          {stages.map(stage => (
            <BoardColumn
              key={stage.id}
              stage={stage}
              tasks={tasksByStage[stage.id] ?? []}
              user={user}
              canEdit={canEdit}
              canDrag={canDrag}
	              isDragActive={Boolean(activeId)}
	              isDropTarget={overStageId === stage.id}
              taskView={taskView}
              onOpenTask={task => openTask({ jobId, taskId: task.id })}
              onCreateTask={handleCreateTask}
            />
          ))}
        </div>

	        <DragOverlay modifiers={dragOverlayModifiers} dropAnimation={null}>
          {activeTask ? (
            <div className="pm-drag-overlay">
              <PmTaskCard task={activeTask} interactive={false} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}