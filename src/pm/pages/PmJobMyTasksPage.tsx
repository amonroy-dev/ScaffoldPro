import { useMemo } from 'react'
import { UserRoundCheck } from 'lucide-react'
import PmTaskCard from '../components/PmTaskCard'
import { usePmJobOutlet } from '../hooks/usePmOutlet'

export default function PmJobMyTasksPage() {
  const { user, jobId, tasks, members, stages, taskView, openTask } = usePmJobOutlet()
  const myTasks = tasks.filter(task => task.assigneeUid === user.uid && (taskView === 'archived' ? task.isArchived : !task.isArchived))
  const membersByUid = useMemo(() => Object.fromEntries(members.map(member => [member.uid, member])), [members])
  const stagesById = useMemo(() => Object.fromEntries(stages.map(stage => [stage.id, stage])), [stages])

  return (
    <div className="pm-page">
      <section className="pm-panel">
        <div className="pm-panel__header">
          <div>
            <div className="pm-panel__title"><UserRoundCheck size={16} /> My tasks in this job</div>
            <div className="pm-panel__subtitle">Everything assigned to you for this specific scaffold job.</div>
          </div>
          <span className="pm-panel__meta">{myTasks.length}</span>
        </div>

        <div className="pm-card-stack">
          {myTasks.length ? (
            myTasks.map(task => (
              <PmTaskCard
                key={task.id}
                task={task}
                user={user}
                assigneeName={task.assigneeUid ? membersByUid[task.assigneeUid]?.displayName || membersByUid[task.assigneeUid]?.email : 'Unassigned'}
                stageName={stagesById[task.stageId]?.name}
                stage={stagesById[task.stageId]}
                onClick={() => openTask({ jobId, taskId: task.id })}
              />
            ))
          ) : (
            <div className="pm-empty-state">Nothing in this job is currently assigned to you.</div>
          )}
        </div>
      </section>
    </div>
  )
}