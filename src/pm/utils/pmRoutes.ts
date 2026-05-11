export function homePath() {
  return '/home'
}

export function jobsPath() {
  return '/jobs'
}

export function inboxPath() {
  return '/inbox'
}

export function jobPath(jobId: string) {
  return `/jobs/${jobId}`
}

export function jobCanvasPath(jobId: string) {
  return `/jobs/${jobId}/canvas`
}

export function jobDrawingsPath(jobId: string) {
  return `/jobs/${jobId}/drawings`
}

export function jobBomPath(jobId: string) {
  return `/jobs/${jobId}/bom`
}

export function jobPmPath(jobId: string) {
  return `/jobs/${jobId}/pm`
}

export function jobFilesPath(jobId: string) {
  return `/jobs/${jobId}/files`
}

export function jobSettingsPath(jobId: string) {
  return `/jobs/${jobId}/settings`
}

/** @deprecated Use jobPmPath */
export function jobTasksPath(jobId: string) {
  return jobPmPath(jobId)
}

export function jobTasksBoardPath(jobId: string) {
  return `/jobs/${jobId}/pm/board`
}

export function jobTasksListPath(jobId: string) {
  return `/jobs/${jobId}/pm/list`
}

export function jobTasksMyTasksPath(jobId: string) {
  return `/jobs/${jobId}/pm/my-tasks`
}

export function jobTasksDashboardPath(jobId: string) {
  return `/jobs/${jobId}/pm/dashboard`
}

export function pmJobBoardPath(jobId: string) {
  return jobTasksBoardPath(jobId)
}

export function pmJobListPath(jobId: string) {
  return jobTasksListPath(jobId)
}

export function pmJobMyTasksPath(jobId: string) {
  return jobTasksMyTasksPath(jobId)
}

export function pmJobDashboardPath(jobId: string) {
  return jobTasksDashboardPath(jobId)
}