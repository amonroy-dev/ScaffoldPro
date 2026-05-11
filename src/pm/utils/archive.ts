import type { PmStage, PmTask } from '../types'

export function canArchiveTask(task: PmTask, stage?: Pick<PmStage, 'isClosedStage'> | null) {
  if (task.isArchived) return false
  return Boolean(task.completedAt || stage?.isClosedStage)
}