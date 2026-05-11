import { useCallback, useEffect, useMemo, useState } from 'react'
import { Boxes, KanbanSquare, LayoutDashboard, ListTodo, Plus, Workflow } from 'lucide-react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { archivePmJob, bulkArchiveDoneTasks, createPmTask, listenPmJob, listenPmStages, listenPmTasks, restorePmJob } from '../data/pmFirestore'
import { usePmShellOutlet, type CreatePmTaskInput, type PmJobOutletContext } from '../hooks/usePmOutlet'
import type { PmJob, PmStage, PmTask, PmTaskView } from '../types'
import { canArchiveTask } from '../utils/archive'
import { jobCanvasPath } from '../utils/pmRoutes'
import { getPmStageLabel } from '../utils/stageLabels'

const TAB_ITEMS = [
  { to: 'board', label: 'Board', icon: KanbanSquare },
  { to: 'list', label: 'List', icon: ListTodo },
  { to: 'my-tasks', label: 'My Tasks', icon: Boxes },
  { to: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
] as const

export default function PmJobLayout({ embedded = false }: { embedded?: boolean }) {
  const { jobId = '' } = useParams()
  const shell = usePmShellOutlet()
  const { user, orgId, members } = shell

  const [job, setJob] = useState<PmJob | null>(null)
  const [stages, setStages] = useState<PmStage[]>([])
  const [tasks, setTasks] = useState<PmTask[]>([])
  const [taskView, setTaskView] = useState<PmTaskView>('active')
  const [loadingJob, setLoadingJob] = useState(true)
  const [error, setError] = useState('')
  const [mutationError, setMutationError] = useState('')
  const [actionPending, setActionPending] = useState<'archive-job' | 'restore-job' | 'bulk' | null>(null)

  useEffect(() => {
    if (!jobId) return undefined

    setLoadingJob(true)
    setError('')

    const stopJob = listenPmJob(jobId, nextJob => {
      setJob(nextJob)
      setLoadingJob(false)
    })
    const stopStages = listenPmStages(jobId, setStages)
    const stopTasks = listenPmTasks(jobId, setTasks)

    return () => {
      stopJob()
      stopStages()
      stopTasks()
    }
  }, [jobId])

  useEffect(() => {
    if (!jobId) {
      setError('Missing job id.')
      setLoadingJob(false)
      return
    }
    if (!loadingJob && !job) {
      setError('This PM job could not be found.')
    }
  }, [job, jobId, loadingJob])

  const createTask = useCallback(async (input: CreatePmTaskInput) => {
    const stageTasks = tasks.filter(task => task.stageId === input.stageId).sort((a, b) => a.sortKey - b.sortKey)
    const lastStageTask = stageTasks[stageTasks.length - 1]
    const createdId = await createPmTask({
      jobId,
      orgId,
      stageId: input.stageId,
      title: input.title,
      user,
      assigneeUid: input.assigneeUid ?? null,
      sortKeyBefore: lastStageTask?.sortKey ?? null,
      sortKeyAfter: null,
    })
    shell.openTask({ jobId, taskId: createdId })
    return createdId
  }, [jobId, orgId, shell, tasks, user])

  const memberCount = members.length
  const activeTasks = tasks.filter(task => !task.isArchived)
  const archivedTasks = tasks.filter(task => task.isArchived)
  const openTaskCount = activeTasks.filter(task => !task.completedAt).length
	  const completedActiveTaskCount = activeTasks.filter(task => Boolean(task.completedAt)).length
	  const stageCount = stages.length
  const stagesById = useMemo(() => Object.fromEntries(stages.map(stage => [stage.id, stage])), [stages])
  const archivableTaskCount = tasks.filter(task => canArchiveTask(task, stagesById[task.stageId])).length
	  const workspacePath = jobCanvasPath(jobId)
  const context = useMemo<PmJobOutletContext>(() => ({
    ...shell,
    jobId,
    job,
    stages,
    tasks,
    taskView,
    setTaskView,
    loadingJob,
    createTask,
  }), [createTask, job, jobId, loadingJob, shell, stages, taskView, tasks])

  const runJobMutation = async (
    action: 'archive-job' | 'restore-job' | 'bulk',
    callback: () => Promise<void>,
  ) => {
    try {
      setActionPending(action)
      setMutationError('')
      await callback()
    } catch (mutationErrorValue) {
      console.error('[PmJobLayout] mutation failed', mutationErrorValue)
      setMutationError(mutationErrorValue instanceof Error ? mutationErrorValue.message : 'Unable to update this job')
    } finally {
      setActionPending(null)
    }
  }

  if (error && !job) {
    return <div className="pm-banner pm-banner--error">{error}</div>
  }

  return (
    <div className="pm-job-layout">
	      {!embedded ? (
	        <section className="pm-job-hero">
	          <div className="pm-job-hero__surface">
	            <div className="pm-job-hero__copy">
	              <div className="pm-section-eyebrow">Job operations</div>
	              <h1 className="pm-page-title">{job?.title || 'Loading job…'}</h1>
	              <p className="pm-page-subtitle">{job?.customer || 'Customer TBD'} · {job?.siteAddress || 'Site address TBD'}</p>
	              <div className="pm-job-hero__meta">
		                <span className="pm-badge">{getPmStageLabel(job?.stageId, job?.stageId || 'intake')}</span>
	                <span>{job?.status === 'archived' ? 'Archived job' : 'Live coordination'}</span>
	                <span>{archivedTasks.length} archived records</span>
	              </div>
	            </div>

	            <div className="pm-job-hero__actions">
	              <Link className="pm-secondary-btn" to={workspacePath}>
	                <Workflow size={14} />
	                Open canvas
	              </Link>
	              <button
	                className="pm-primary-btn"
	                type="button"
	                onClick={() => {
	                  if (!stages[0]) return
	                  void createTask({ stageId: stages[0].id, title: 'New coordination task' })
	                }}
	                disabled={!stages.length || taskView === 'archived' || job?.status === 'archived'}
	              >
	                <Plus size={14} />
	                New task
	              </button>
	            </div>

	            <div className="pm-job-hero__stats">
	              <div className="pm-job-hero__stat">
	                <span className="pm-job-hero__stat-label">Open tasks</span>
	                <strong>{openTaskCount}</strong>
	                <small>Awaiting execution</small>
	              </div>
	              <div className="pm-job-hero__stat">
	                <span className="pm-job-hero__stat-label">Completed</span>
	                <strong>{completedActiveTaskCount}</strong>
	                <small>Finished in active scope</small>
	              </div>
	              <div className="pm-job-hero__stat">
	                <span className="pm-job-hero__stat-label">Workflow lanes</span>
	                <strong>{stageCount}</strong>
	                <small>Operational stages</small>
	              </div>
	              <div className="pm-job-hero__stat">
	                <span className="pm-job-hero__stat-label">Team</span>
	                <strong>{memberCount}</strong>
	                <small>Assigned collaborators</small>
	              </div>
	            </div>
	          </div>
	        </section>
	      ) : null}

      <div className="pm-job-toolbar">
        <div className="pm-segmented" role="tablist" aria-label="Task view">
          <button
            type="button"
            className={`pm-segmented__item ${taskView === 'active' ? 'is-active' : ''}`.trim()}
            onClick={() => setTaskView('active')}
          >
            Active
            <span>{activeTasks.length}</span>
          </button>
          <button
            type="button"
            className={`pm-segmented__item ${taskView === 'archived' ? 'is-active' : ''}`.trim()}
            onClick={() => setTaskView('archived')}
          >
            Archived
            <span>{archivedTasks.length}</span>
          </button>
        </div>

        <div className="pm-job-toolbar__actions">
          {taskView === 'active' ? (
            <button
              className="pm-secondary-btn"
              type="button"
              disabled={!archivableTaskCount || actionPending !== null || job?.status === 'archived'}
              onClick={() => {
                void runJobMutation('bulk', async () => {
                  await bulkArchiveDoneTasks({ jobId, tasks, stages, user })
                })
              }}
            >
              Archive done tasks
            </button>
          ) : null}

          {job ? (
            job.status === 'archived' ? (
              <button
                className="pm-secondary-btn"
                type="button"
                disabled={actionPending !== null}
                onClick={() => {
                  void runJobMutation('restore-job', async () => {
                    await restorePmJob(job, user)
                  })
                }}
              >
                Restore job
              </button>
            ) : (
              <button
                className="pm-secondary-btn"
                type="button"
                disabled={actionPending !== null}
                onClick={() => {
                  void runJobMutation('archive-job', async () => {
                    await archivePmJob(job, user)
                  })
                }}
              >
                Archive job
              </button>
            )
          ) : null}
        </div>
      </div>

      {mutationError ? <div className="pm-banner pm-banner--error">{mutationError}</div> : null}

      <nav className="pm-job-tabs" aria-label="PM job tabs">
        {TAB_ITEMS.map(item => {
          const Icon = item.icon
          return (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `pm-job-tabs__link ${isActive ? 'is-active' : ''}`.trim()}>
              <Icon size={14} />
              {item.label}
            </NavLink>
          )
        })}
      </nav>

      <Outlet context={context} />
    </div>
  )
}