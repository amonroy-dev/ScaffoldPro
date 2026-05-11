import type { User } from 'firebase/auth'
import { useOutletContext } from 'react-router-dom'
import type { PmDrawerTarget, PmJob, PmMember, PmStage, PmTask, PmTaskView } from '../types'

export type PmShellOutletContext = {
  user: User
  orgId: string
  members: PmMember[]
  jobs: PmJob[]
  loading: boolean
  activeTask: PmDrawerTarget | null
  homeRefreshKey: number
  openTask: (target: PmDrawerTarget) => void
  closeTask: () => void
  openCreateJob: () => void
}

export type CreatePmTaskInput = {
  stageId: string
  title: string
  assigneeUid?: string | null
}

export type PmJobOutletContext = PmShellOutletContext & {
  jobId: string
  job: PmJob | null
  stages: PmStage[]
  tasks: PmTask[]
  taskView: PmTaskView
  setTaskView: (view: PmTaskView) => void
  loadingJob: boolean
  createTask: (input: CreatePmTaskInput) => Promise<string>
}

export function usePmShellOutlet() {
  return useOutletContext<PmShellOutletContext>()
}

export function usePmJobOutlet() {
  return useOutletContext<PmJobOutletContext>()
}