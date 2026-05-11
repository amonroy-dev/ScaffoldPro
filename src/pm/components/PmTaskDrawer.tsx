import { useEffect, useMemo, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { CheckCircle2, Clock3, MessageSquare, PanelRightClose, Send, Subtitles, UserCircle2 } from 'lucide-react'
import {
  addPmComment,
  addPmSubtask,
  archiveTask,
  listenPmActivity,
  listenPmComments,
  listenPmSubtasks,
  listenPmTask,
  renamePmTask,
  restoreTask,
  togglePmTaskComplete,
  updatePmSubtask,
  updatePmTaskAssignee,
  updatePmTaskDescription,
  updatePmTaskDueDate,
  updatePmTaskPriority,
} from '../data/pmFirestore'
import type { PmActivityEvent, PmDrawerTarget, PmMember, PmSubtask, PmTask, PmTaskPriority } from '../types'
import { formatDateTimeLabel, toDateInputValue } from '../utils/dates'

type PmTaskDrawerProps = {
  target: PmDrawerTarget | null
  user: User
  members: PmMember[]
  onClose: () => void
}

const PRIORITIES: PmTaskPriority[] = ['low', 'normal', 'high', 'critical']

function formatActivityLabel(event: PmActivityEvent) {
  switch (event.type) {
    case 'task.created':
      return 'created this task'
    case 'task.stage_changed':
      return `moved the task to ${String(event.payloadSmall?.stageId ?? 'a new stage')}`
    case 'task.title_changed':
      return 'renamed the task'
    case 'task.description_changed':
      return 'updated the description'
    case 'task.due_date_changed':
      return 'changed the due date'
    case 'task.due_date_set':
      return 'set the due date'
    case 'task.due_date_cleared':
      return 'cleared the due date'
    case 'task.assignee_changed':
      return 'changed the assignee'
    case 'task.completed':
      return 'completed the task'
    case 'task.reopened':
      return 'reopened the task'
    case 'task.archived':
      return 'archived the task'
    case 'task.restored':
      return 'restored the task'
    case 'task.subtask_added':
      return 'added a subtask'
    case 'task.subtask_completed':
      return 'completed a subtask'
    case 'task.subtask_uncompleted':
      return 'reopened a subtask'
    case 'task.comment_added':
      return 'left a comment'
    default:
      return event.type.split('.').join(' ')
  }
}

export default function PmTaskDrawer({ target, user, members, onClose }: PmTaskDrawerProps) {
  const [task, setTask] = useState<PmTask | null>(null)
  const [subtasks, setSubtasks] = useState<PmSubtask[]>([])
  const [comments, setComments] = useState<Array<{ id: string; authorUid: string; body: string; createdAt?: unknown }>>([])
  const [activity, setActivity] = useState<PmActivityEvent[]>([])
  const [titleDraft, setTitleDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [subtaskDraft, setSubtaskDraft] = useState('')
  const [commentDraft, setCommentDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const subtaskInputRef = useRef<HTMLInputElement>(null)

  const membersByUid = useMemo(() => {
    return Object.fromEntries(members.map(member => [member.uid, member]))
  }, [members])

  useEffect(() => {
    if (!target) {
      setTask(null)
      setSubtasks([])
      setComments([])
      setActivity([])
      setError('')
      return
    }

    const cleanups = [
      listenPmTask(target.jobId, target.taskId, nextTask => {
        setTask(nextTask)
      }),
      listenPmSubtasks(target.jobId, target.taskId, setSubtasks),
      listenPmComments(target.jobId, target.taskId, nextComments => {
        setComments(nextComments as Array<{ id: string; authorUid: string; body: string; createdAt?: unknown }>)
      }),
      listenPmActivity(target.jobId, target.taskId, setActivity),
    ]

    return () => {
      cleanups.forEach(cleanup => cleanup())
    }
  }, [target])

  useEffect(() => {
    setTitleDraft(task?.title ?? '')
    setDescriptionDraft(task?.description ?? '')
  }, [task?.id, task?.title, task?.description])

  useEffect(() => {
    if (!target) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, target])

  useEffect(() => {
    if (!target?.focusSubtaskComposer) return undefined

    const frameId = window.requestAnimationFrame(() => {
      subtaskInputRef.current?.focus()
      subtaskInputRef.current?.select()
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [target?.focusSubtaskComposer, target?.jobId, target?.taskId])

  if (!target) return null

  const runMutation = async (callback: () => Promise<void>) => {
    try {
      setBusy(true)
      setError('')
      await callback()
    } catch (mutationError) {
      console.error('[PmTaskDrawer] mutation failed', mutationError)
      setError(mutationError instanceof Error ? mutationError.message : 'Unable to update task')
    } finally {
      setBusy(false)
    }
  }

  const saveTitle = async () => {
    if (!task) return
    const nextTitle = titleDraft.trim() || 'Untitled task'
    if (nextTitle === task.title) return
    await runMutation(async () => {
      await renamePmTask(target.jobId, target.taskId, nextTitle, user)
    })
  }

  const saveDescription = async () => {
    if (!task || descriptionDraft === task.description) return
    await runMutation(async () => {
      await updatePmTaskDescription(target.jobId, target.taskId, descriptionDraft, user)
    })
  }

  const handleSubtaskAdd = async () => {
    const nextTitle = subtaskDraft.trim()
    if (!nextTitle) return
    await runMutation(async () => {
      const lastSubtask = subtasks[subtasks.length - 1]
      await addPmSubtask(target.jobId, target.taskId, nextTitle, user, lastSubtask?.sortKey ?? null)
      setSubtaskDraft('')
    })
  }

  const handleCommentAdd = async () => {
    const nextBody = commentDraft.trim()
    if (!nextBody) return
    await runMutation(async () => {
      await addPmComment(target.jobId, target.taskId, nextBody, user)
      setCommentDraft('')
    })
  }

  return (
    <aside className="pm-task-drawer" aria-label="Task details drawer">
      <div className="pm-task-drawer__header">
        <div>
          <div className="pm-section-eyebrow">Task details</div>
          <div className="pm-task-drawer__subhead">{task ? 'Live from Firestore' : 'Loading task…'}</div>
        </div>
        <button className="pm-icon-btn" type="button" onClick={onClose} aria-label="Close task drawer">
          <PanelRightClose size={18} />
        </button>
      </div>

      <div className="pm-task-drawer__scroll">
        <section className="pm-panel pm-task-drawer__panel">
          <label className="pm-field-label" htmlFor="pm-task-title">Title</label>
          <input
            id="pm-task-title"
            className="pm-input"
            value={titleDraft}
            onChange={event => setTitleDraft(event.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void saveTitle()
                event.currentTarget.blur()
              }
            }}
            placeholder="Untitled task"
          />

          <div className="pm-task-drawer__field-grid">
            <div>
              <label className="pm-field-label" htmlFor="pm-task-assignee">Assignee</label>
              <select
                id="pm-task-assignee"
                className="pm-select"
                value={task?.assigneeUid ?? ''}
                onChange={event => {
                  void runMutation(async () => {
                    await updatePmTaskAssignee(target.jobId, target.taskId, event.target.value || null, user)
                  })
                }}
              >
                <option value="">Unassigned</option>
                {members.map(member => (
                  <option key={member.uid} value={member.uid}>
                    {member.displayName || member.email}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="pm-field-label" htmlFor="pm-task-priority">Priority</label>
              <select
                id="pm-task-priority"
                className="pm-select"
                value={task?.priority ?? 'normal'}
                onChange={event => {
                  void runMutation(async () => {
                    await updatePmTaskPriority(target.jobId, target.taskId, event.target.value as PmTaskPriority, user)
                  })
                }}
              >
                {PRIORITIES.map(priority => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="pm-field-label" htmlFor="pm-task-due-date">Due date</label>
              <input
                id="pm-task-due-date"
                className="pm-input"
                type="date"
                value={toDateInputValue(task?.dueDate ?? null)}
                onChange={event => {
                  void runMutation(async () => {
                    await updatePmTaskDueDate(
                      target.jobId,
                      target.taskId,
                      event.target.value ? new Date(`${event.target.value}T12:00:00`) : null,
                      user,
                    )
                  })
                }}
              />
            </div>

            <div>
              <label className="pm-field-label" htmlFor="pm-task-complete">Status</label>
              <button
                id="pm-task-complete"
                className={`pm-secondary-btn ${task?.completedAt ? 'is-success' : ''}`.trim()}
                type="button"
                onClick={() => {
                  void runMutation(async () => {
                    await togglePmTaskComplete(target.jobId, target.taskId, !task?.completedAt, user)
                  })
                }}
              >
                <CheckCircle2 size={16} />
                {task?.completedAt ? 'Mark incomplete' : 'Mark complete'}
              </button>
            </div>

            <div>
              <label className="pm-field-label" htmlFor="pm-task-archive">Archive</label>
              <button
                id="pm-task-archive"
                className="pm-secondary-btn"
                type="button"
                disabled={!task?.isArchived && !task?.completedAt}
                onClick={() => {
                  if (!task) return
                  void runMutation(async () => {
                    if (task.isArchived) {
                      await restoreTask(target.jobId, target.taskId, user)
                      return
                    }
                    await archiveTask({ jobId: target.jobId, task, user, canArchive: Boolean(task.completedAt) })
                  })
                }}
              >
                {task?.isArchived ? 'Restore task' : 'Archive task'}
              </button>
              {!task?.isArchived && !task?.completedAt ? <div className="pm-inline-hint">Complete the task before archiving it from the drawer.</div> : null}
            </div>
          </div>

          <label className="pm-field-label" htmlFor="pm-task-description">Description</label>
          <textarea
            id="pm-task-description"
            className="pm-textarea"
            rows={6}
            value={descriptionDraft}
            onChange={event => setDescriptionDraft(event.target.value)}
            onBlur={() => void saveDescription()}
            placeholder="Scope, notes, blockers, fabrication details…"
          />

          {error ? <div className="pm-inline-error">{error}</div> : null}
          {busy ? <div className="pm-inline-hint">Saving…</div> : null}
        </section>

        <section className="pm-panel pm-task-drawer__panel">
          <div className="pm-panel__header">
            <div className="pm-panel__title">
              <Subtitles size={16} />
              Subtasks
            </div>
            <span className="pm-panel__meta">{subtasks.length}</span>
          </div>

          <div className="pm-stack-list">
            {subtasks.map(subtask => (
              <div key={subtask.id} className="pm-subtask-row">
                <input
                  className="pm-checkbox"
                  type="checkbox"
                  checked={subtask.completed}
                  onChange={() => {
                    void runMutation(async () => {
                      await updatePmSubtask(target.jobId, target.taskId, subtask.id, { completed: !subtask.completed }, user)
                    })
                  }}
                />
                <input
                  className="pm-input pm-input--inline"
                  defaultValue={subtask.title}
                  onBlur={event => {
                    const nextTitle = event.target.value.trim() || 'Untitled subtask'
                    if (nextTitle === subtask.title) return
                    void runMutation(async () => {
                      await updatePmSubtask(target.jobId, target.taskId, subtask.id, { title: nextTitle }, user)
                    })
                  }}
                />
              </div>
            ))}
          </div>

          <div className="pm-inline-form">
            <input
              ref={subtaskInputRef}
              className="pm-input"
              value={subtaskDraft}
              onChange={event => setSubtaskDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleSubtaskAdd()
                }
              }}
              placeholder="Add a subtask"
            />
            <button className="pm-primary-btn" type="button" onClick={() => void handleSubtaskAdd()}>
              Add
            </button>
          </div>
        </section>

        <section className="pm-panel pm-task-drawer__panel">
          <div className="pm-panel__header">
            <div className="pm-panel__title">
              <MessageSquare size={16} />
              Comments
            </div>
            <span className="pm-panel__meta">{comments.length}</span>
          </div>

          <div className="pm-comment-list">
            {comments.map(comment => {
              const author = membersByUid[comment.authorUid]
              return (
                <article key={comment.id} className="pm-comment-item">
                  <div className="pm-comment-item__head">
                    <span>{author?.displayName || author?.email || comment.authorUid}</span>
                    <span>{formatDateTimeLabel(comment.createdAt as never)}</span>
                  </div>
                  <div>{comment.body}</div>
                </article>
              )
            })}
          </div>

          <textarea
            className="pm-textarea"
            rows={4}
            value={commentDraft}
            onChange={event => setCommentDraft(event.target.value)}
            placeholder="Leave a coordination note, approval update, or blocker…"
          />
          <button className="pm-primary-btn" type="button" onClick={() => void handleCommentAdd()}>
            <Send size={15} />
            Post comment
          </button>
        </section>

        <section className="pm-panel pm-task-drawer__panel">
          <div className="pm-panel__header">
            <div className="pm-panel__title">
              <Clock3 size={16} />
              Activity
            </div>
            <span className="pm-panel__meta">latest 25</span>
          </div>

          <div className="pm-activity-list">
            {activity.map(event => {
              const actor = membersByUid[event.actorUid]
              return (
                <div key={event.id} className="pm-activity-item">
                  <div className="pm-activity-item__icon">
                    <UserCircle2 size={16} />
                  </div>
                  <div>
                    <div className="pm-activity-item__text">
                      <strong>{actor?.displayName || actor?.email || event.actorUid}</strong> {formatActivityLabel(event)}
                    </div>
                    <div className="pm-activity-item__time">{formatDateTimeLabel(event.createdAt)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </aside>
  )
}