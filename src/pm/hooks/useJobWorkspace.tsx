import { createContext, useContext } from 'react'
import type { PmJob } from '../types'

export type JobWorkspaceValue = {
  jobId: string
  projectId: string
  job: PmJob | null
  /**
   * Job-scoped "home" route (the hub for this specific job).
   * Note: /jobs/:jobId currently redirects to /jobs/:jobId/pm/board.
   */
  jobHomePath: string
  jobsPath: string
  canvasPath: string
  drawingsPath: string
  bomPath: string
  tasksPath: string
  pmPath: string
  filesPath: string
  settingsPath: string
}

export const JobWorkspaceContext = createContext<JobWorkspaceValue | null>(null)

export function useJobWorkspace() {
  return useContext(JobWorkspaceContext)
}