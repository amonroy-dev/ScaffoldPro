import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { archiveTask, restoreTask } from '../data/pmFirestore'
import { usePmJobOutlet } from '../hooks/usePmOutlet'
import { canArchiveTask } from '../utils/archive'
import { formatDateLabel } from '../utils/dates'
import { getPmStageLabel } from '../utils/stageLabels'

export default function PmJobListPage() {
  const { user, jobId, stages, tasks, members, taskView, createTask, openTask } = usePmJobOutlet()
  const [draftTitle, setDraftTitle] = useState('')
  const [draftStageId, setDraftStageId] = useState(() => stages[0]?.id || '')

  const membersByUid = useMemo(() => Object.fromEntries(members.map(member => [member.uid, member])), [members])
  const stageMap = useMemo(() => Object.fromEntries(stages.map(stage => [stage.id, stage])), [stages])
  const visibleTasks = useMemo(() => tasks.filter(task => (taskView === 'archived' ? task.isArchived : !task.isArchived)), [taskView, tasks])

  useEffect(() => {
    if (!stages.length) return
    if (!draftStageId || !stages.some(stage => stage.id === draftStageId)) {
      setDraftStageId(stages[0].id)
    }
  }, [draftStageId, stages])

  return (
    <div className="pm-page">
      <section className="pm-panel">
        <div className="pm-panel__header">
          <div>
            <div className="pm-panel__title">Job task list</div>
              <div className="pm-panel__subtitle">A dense operational view for coordinators who want sortable detail over the board.</div>
          </div>
        </div>

          {taskView === 'active' ? (
            <form
              className="pm-inline-form pm-inline-form--list"
              onSubmit={event => {
                event.preventDefault()
                const title = draftTitle.trim()
                if (!title || !draftStageId) return
                void createTask({ stageId: draftStageId, title }).then(() => setDraftTitle(''))
              }}
            >
              <input className="pm-input" value={draftTitle} onChange={event => setDraftTitle(event.target.value)} placeholder="Add a task from list view" />
              <select className="pm-select" value={draftStageId} onChange={event => setDraftStageId(event.target.value)}>
	                {stages.map(stage => <option key={stage.id} value={stage.id}>{getPmStageLabel(stage.id, stage.name)}</option>)}
              </select>
              <button className="pm-primary-btn" type="submit" disabled={!stages.length}>
                <Plus size={14} /> Add
              </button>
            </form>
          ) : null}

        <div className="pm-table-wrap">
          <table className="pm-table pm-table--tasks">
            <thead>
              <tr>
                <th>Task</th>
                <th>Stage</th>
                <th>Assignee</th>
                <th>Priority</th>
                <th>Due</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map(task => (
                <tr key={task.id} className="pm-table__row-clickable" onClick={() => openTask({ jobId, taskId: task.id })}>
                  <td>
                    <div className="pm-table__primary">{task.title}</div>
                    <div className="pm-table__secondary">{task.description || 'No description yet'}</div>
                  </td>
	                  <td>{getPmStageLabel(task.stageId, stageMap[task.stageId]?.name)}</td>
                  <td>{task.assigneeUid ? membersByUid[task.assigneeUid]?.displayName || membersByUid[task.assigneeUid]?.email : 'Unassigned'}</td>
                  <td><span className={`pm-priority-pill priority-${task.priority}`}>{task.priority}</span></td>
                  <td>{formatDateLabel(task.dueDate)}</td>
                  <td>{task.isArchived ? 'Archived' : task.completedAt ? 'Complete' : 'Open'}</td>
                  <td>
                    <div className="pm-table__actions">
                      {task.isArchived ? (
                        <button
                          className="pm-text-link"
                          type="button"
                          onClick={event => {
                            event.stopPropagation()
                            void restoreTask(jobId, task.id, user)
                          }}
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          className="pm-text-link"
                          type="button"
                          disabled={!canArchiveTask(task, stageMap[task.stageId])}
                          onClick={event => {
                            event.stopPropagation()
                            void archiveTask({ jobId, task, user, canArchive: canArchiveTask(task, stageMap[task.stageId]) })
                          }}
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}