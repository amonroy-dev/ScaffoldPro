import type { Timestamp } from 'firebase/firestore'

export type PmMember = {
  uid: string
  displayName: string
  email: string
  role: 'owner' | 'manager' | 'member'
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

export type PmOrg = {
  name: string
  slug: string
  personal: boolean
  createdBy: string
  updatedBy: string
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

export type PmJob = {
  id: string
  orgId: string
  title: string
  customer?: string
  siteAddress?: string
  stageId: string
  status: 'active' | 'completed' | 'archived'
  keyDates?: Record<string, string>
  latestDesignRevId?: string
  archivedAt: Timestamp | null
  archivedBy: string | null
  createdBy: string
  updatedBy: string
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

export type PmStage = {
  id: string
  name: string
  order: number
  colorToken: string
  isClosedStage?: boolean
}

export type PmTaskPriority = 'low' | 'normal' | 'high' | 'critical'

export type PmTaskView = 'active' | 'archived'

export type PmTask = {
  id: string
  orgId: string
  jobId: string
  title: string
  description: string
  stageId: string
  assigneeUid: string | null
  dueDate: Timestamp | null
  priority: PmTaskPriority
  completedAt: Timestamp | null
  isArchived: boolean
  archivedAt: Timestamp | null
  archivedBy: string | null
  sortKey: number
  groupKey?: string | null
  subtaskCount: number
  commentCount: number
  createdBy: string
  updatedBy: string
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

export type PmSubtask = {
  id: string
  title: string
  completed: boolean
  sortKey: number
  createdBy: string
  updatedBy: string
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

export type PmComment = {
  id: string
  authorUid: string
  body: string
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

export type PmActivityEvent = {
  id: string
  type: string
  actorUid: string
  payloadSmall?: Record<string, unknown>
  createdAt?: Timestamp
}

export type PmHomeData = {
  dueSoon: PmTask[]
  overdue: PmTask[]
  recentJobs: PmJob[]
  jobsByStage: Array<{ stageId: string; count: number }>
  upcomingDeliveries: PmJob[]
}

export type PmDrawerTarget = {
  jobId: string
  taskId: string
  focusSubtaskComposer?: boolean
}