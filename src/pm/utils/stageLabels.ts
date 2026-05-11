const PM_STAGE_LABELS: Record<string, string> = {
  intake: 'Backlog',
  engineering: 'To do',
  approval: 'In progress',
  fabrication: 'Review',
  complete: 'Done',
}

function titleCaseStageId(stageId: string) {
  return stageId
    .split(/[-_]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function getPmStageLabel(stageId?: string | null, fallbackName?: string | null) {
  const normalizedStageId = stageId?.trim().toLowerCase() || ''
  if (normalizedStageId && PM_STAGE_LABELS[normalizedStageId]) return PM_STAGE_LABELS[normalizedStageId]
  if (fallbackName?.trim()) return fallbackName.trim()
  return normalizedStageId ? titleCaseStageId(normalizedStageId) : 'Unscheduled'
}

export function getPmStageCode(stageId?: string | null, fallbackName?: string | null) {
  const label = getPmStageLabel(stageId, fallbackName)
  const initials = label
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map(part => part.charAt(0))
    .join('')
    .toUpperCase()

  if (initials.length >= 2) return initials.slice(0, 4)
  return label.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'LANE'
}