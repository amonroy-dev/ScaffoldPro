export function getMidpointSortKey(before?: number | null, after?: number | null) {
  if (before == null && after == null) return 1024
  if (before == null) return (after ?? 1024) / 2
  if (after == null) return before + 1024

  const midpoint = before + (after - before) / 2
  if (Number.isFinite(midpoint) && Math.abs(after - before) > 0.00001) return midpoint
  return before + 0.5
}

export function rebalanceSortKeys<T extends { id: string }>(items: T[]) {
  return items.map((item, index) => ({ id: item.id, sortKey: (index + 1) * 1024 }))
}