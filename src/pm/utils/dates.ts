import type { Timestamp } from 'firebase/firestore'

export type PmDueDateState = 'none' | 'overdue' | 'today' | 'tomorrow' | 'upcoming-week' | 'future'

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function toDate(value?: Timestamp | Date | string | null) {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') return new Date(value)
  if (typeof value?.toDate === 'function') return value.toDate()
  return null
}

export function toDateInputValue(value?: Timestamp | Date | string | null) {
  const date = toDate(value)
  if (!date || Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export function dueDateState(value?: Timestamp | Date | string | null) {
  const date = toDate(value)
  if (!date) return 'none'
  const todayDate = startOfDay(new Date())
  const today = todayDate.getTime()
  const tomorrow = new Date(todayDate)
  tomorrow.setDate(todayDate.getDate() + 1)
  const endOfWeek = new Date(todayDate)
  endOfWeek.setDate(todayDate.getDate() + 6)
  const target = startOfDay(date).getTime()
  if (target < today) return 'overdue'
  if (target === today) return 'today'
  if (target === tomorrow.getTime()) return 'tomorrow'
  if (target <= endOfWeek.getTime()) return 'upcoming-week'
  return 'future'
}

export function formatTaskDueDate(value?: Timestamp | Date | string | null) {
  const date = toDate(value)
  if (!date) return null

  const state = dueDateState(date)
  if (state === 'today') return 'Today'
  if (state === 'tomorrow') return 'Tomorrow'
  if (state === 'upcoming-week') {
    return date.toLocaleDateString(undefined, { weekday: 'short' })
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateLabel(value?: Timestamp | Date | string | null) {
  const date = toDate(value)
  if (!date) return 'No due date'
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

export function formatDateTimeLabel(value?: Timestamp | Date | string | null) {
  const date = toDate(value)
  if (!date) return '—'
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  })
}