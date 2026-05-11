import { useMemo } from 'react'
import { CalendarClock, CircleCheckBig, ListTodo, Users } from 'lucide-react'
import PmTaskCard from '../components/PmTaskCard'
import { usePmJobOutlet } from '../hooks/usePmOutlet'
import { dueDateState } from '../utils/dates'
import { getPmStageLabel } from '../utils/stageLabels'

export default function PmJobDashboardPage() {
  const { user, jobId, tasks, stages, members, openTask } = usePmJobOutlet()
  const activeTasks = tasks.filter(task => !task.isArchived)
  const openTasks = activeTasks.filter(task => !task.completedAt)
  const completedTasks = activeTasks.filter(task => Boolean(task.completedAt))
  const overdueCount = openTasks.filter(task => dueDateState(task.dueDate) === 'overdue').length
  const stagesById = useMemo(() => Object.fromEntries(stages.map(stage => [stage.id, stage])), [stages])
  const membersByUid = useMemo(() => Object.fromEntries(members.map(member => [member.uid, member])), [members])
  const dueNextTasks = useMemo(() => {
    return [...openTasks].sort((left, right) => {
      const leftValue = left.dueDate?.toDate?.()?.getTime?.() ?? Number.MAX_SAFE_INTEGER
      const rightValue = right.dueDate?.toDate?.()?.getTime?.() ?? Number.MAX_SAFE_INTEGER
      return leftValue - rightValue
    }).slice(0, 6)
  }, [openTasks])

  return (
    <div className="pm-page">
      <div className="pm-stat-grid">
        <article className="pm-stat-card"><span className="pm-stat-card__label">Open tasks</span><strong className="pm-stat-card__value">{openTasks.length}</strong></article>
        <article className="pm-stat-card"><span className="pm-stat-card__label">Completed</span><strong className="pm-stat-card__value">{completedTasks.length}</strong></article>
        <article className="pm-stat-card is-warning"><span className="pm-stat-card__label">Overdue</span><strong className="pm-stat-card__value">{overdueCount}</strong></article>
        <article className="pm-stat-card"><span className="pm-stat-card__label">Collaborators</span><strong className="pm-stat-card__value">{members.length}</strong></article>
      </div>

      <div className="pm-page-grid">
        <section className="pm-panel">
          <div className="pm-panel__title"><ListTodo size={16} /> Stage distribution</div>
          <div className="pm-stage-meter-list">
            {stages.map(stage => {
                const count = activeTasks.filter(task => task.stageId === stage.id).length
                const ratio = activeTasks.length ? Math.max(10, Math.round((count / activeTasks.length) * 100)) : 0
              return (
                <div key={stage.id} className="pm-stage-meter">
	                  <div className="pm-stage-meter__label"><span>{getPmStageLabel(stage.id, stage.name)}</span><strong>{count}</strong></div>
                  <div className="pm-stage-meter__track"><div className="pm-stage-meter__fill" style={{ width: `${ratio}%` }} /></div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="pm-panel">
          <div className="pm-panel__title"><CalendarClock size={16} /> Due next</div>
          <div className="pm-card-stack">
            {dueNextTasks.map(task => (
              <PmTaskCard
                key={task.id}
                task={task}
                user={user}
	                stageName={getPmStageLabel(task.stageId, stagesById[task.stageId]?.name)}
                assigneeName={task.assigneeUid ? membersByUid[task.assigneeUid]?.displayName || membersByUid[task.assigneeUid]?.email : 'Unassigned'}
                stage={stagesById[task.stageId]}
                onClick={() => openTask({ jobId, taskId: task.id })}
              />
            ))}
            {!openTasks.length ? <div className="pm-empty-state pm-empty-state--compact">No open tasks in this job.</div> : null}
          </div>
        </section>

        <section className="pm-panel">
          <div className="pm-panel__title"><CircleCheckBig size={16} /> Completion signal</div>
          <p className="pm-muted-copy">{activeTasks.length ? `${Math.round((completedTasks.length / activeTasks.length) * 100)}% of active tasks are complete.` : 'Start by adding tasks to measure completion.'}</p>
        </section>

        <section className="pm-panel">
          <div className="pm-panel__title"><Users size={16} /> Coordination note</div>
          <p className="pm-muted-copy">Use this dashboard as a lightweight executive summary while the board and list remain the operational surfaces.</p>
        </section>
      </div>
    </div>
  )
}