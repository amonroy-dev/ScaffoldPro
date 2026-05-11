import { useMemo, useState } from 'react'
import { Boxes, FileDown, Search, X } from 'lucide-react'
import { formatDisplayWeight, getGenericPartDisplayName } from '../catalog/scaffoldDisplay'
import { useCatalogSelection } from '../contexts/CatalogContext'
import { useScaffoldBaseSettings } from '../contexts/ScaffoldBaseSettings'
import { useTool } from '../contexts/ToolContext'
import { deriveScaffoldBom, type BomCategory, type BomLineItem } from './scaffold/bomDerivation'
import './BomDrawer.css'

interface BomDrawerProps {
  isOpen: boolean
  onClose: () => void
  /**
   * drawer: fixed overlay drawer (used inside the 3D canvas AppContent)
   * page: embedded full-page BOM (used for /jobs/:jobId/bom)
   */
  variant?: 'drawer' | 'page'
}

const CATEGORY_ORDER: BomCategory[] = ['Standards', 'Bases', 'Ledgers', 'Trusses', 'Diagonals', 'Planks']
type BomViewMode = 'grouped' | 'flat'

function formatInteger(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

function formatWeight(value: number | null) {
  return formatDisplayWeight(value)
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`
}

function sourceLabel(source: 'catalog' | 'fallback' | 'system' | 'missing') {
  switch (source) {
    case 'catalog':
      return 'Profile'
    case 'fallback':
      return 'Matched'
    case 'system':
      return 'System'
    default:
      return 'Missing'
  }
}

function detailLabel(item: BomLineItem) {
  if (item.weightSource === 'missing') return 'Weight data pending'

  switch (item.metadataSource) {
    case 'catalog':
      return 'Profile-aligned component'
    case 'fallback':
      return 'Matched from scaffold geometry'
    case 'system':
      return 'Derived system component'
    default:
      return 'Derived from scaffold geometry'
  }
}

function orderedCategories(categories: BomCategory[]) {
  return CATEGORY_ORDER.filter((category) => categories.includes(category))
}

function toCsvCell(value: string | number | null) {
  const text = value == null ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function getBomComponentName(item: BomLineItem) {
  if (item.partNumber) return getGenericPartDisplayName(item.partNumber)
  return item.description
}

function buildBomCsv(items: BomLineItem[]) {
  const header = ['Category', 'Component', 'Quantity', 'Unit Weight (lb)', 'Total Weight (lb)', 'Metadata Source', 'Weight Source']
  const rows = items.map((item) => [
    item.category,
    getBomComponentName(item),
    item.quantity,
    formatWeight(item.unitWeightLb),
    formatWeight(item.totalWeightLb),
    sourceLabel(item.metadataSource),
    sourceLabel(item.weightSource),
  ])

  return [header, ...rows].map((row) => row.map(toCsvCell).join(',')).join('\r\n')
}

function sanitizeFileNamePart(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || 'profile'
}

function buildSearchText(item: BomLineItem) {
  return [
    item.category,
    getBomComponentName(item),
    item.partNumber,
    item.description,
    detailLabel(item),
    sourceLabel(item.metadataSource),
    sourceLabel(item.weightSource),
  ].join(' ').toLowerCase()
}

function deriveStackIdsForObjectId(objectId: string) {
  if (objectId.startsWith('standard-')) {
    const payload = objectId.slice('standard-'.length)
    const at = payload.indexOf('@')
    return [at >= 0 ? payload.slice(0, at) : payload]
  }
  if (objectId.startsWith('wood-sill-')) return [objectId.slice('wood-sill-'.length)]
  if (objectId.startsWith('screw-jack-')) return [objectId.slice('screw-jack-'.length)]
  if (objectId.startsWith('base-collar-')) return [objectId.slice('base-collar-'.length)]
  return []
}

export function BomDrawer({ isOpen, onClose, variant = 'drawer' }: BomDrawerProps) {
  const {
    scaffoldStacks,
    ledgerConnections,
    manualPlankPlacements,
    scaffoldBlocks,
    selectedObjectId,
    selectedStackIds,
    setSelectedObjectId,
    setSelectedStackIds,
    setSelectedBlockId,
  } = useTool()
  const { baseSettings } = useScaffoldBaseSettings()
  const { selectedManufacturer } = useCatalogSelection()
  const [viewMode, setViewMode] = useState<BomViewMode>('grouped')
  const [selectedCategories, setSelectedCategories] = useState<BomCategory[] | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const bom = useMemo(() => deriveScaffoldBom({
    scaffoldStacks,
    ledgerConnections,
    manualPlankPlacements,
    scaffoldBlocks,
    baseSettings,
    selectedManufacturer,
  }), [scaffoldStacks, ledgerConnections, manualPlankPlacements, scaffoldBlocks, baseSettings, selectedManufacturer])

  const availableCategories = useMemo(() => CATEGORY_ORDER
    .filter((category) => bom.lineItems.some((item) => item.category === category)), [bom.lineItems])

  const activeCategories = useMemo(() => {
    const next = selectedCategories?.filter((category) => availableCategories.includes(category)) ?? availableCategories
    return next.length > 0 ? next : availableCategories
  }, [selectedCategories, availableCategories])

  const normalizedSearchQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery])

  const filteredLineItems = useMemo(() => bom.lineItems
    .filter((item) => activeCategories.includes(item.category))
    .filter((item) => normalizedSearchQuery.length === 0 || buildSearchText(item).includes(normalizedSearchQuery)), [bom.lineItems, activeCategories, normalizedSearchQuery])

  const categoryStats = useMemo(() => new Map(
    availableCategories.map((category) => {
      const items = bom.lineItems.filter((item) => item.category === category)
      return [category, {
        lineItemCount: items.length,
        quantity: items.reduce((sum, item) => sum + item.quantity, 0),
      }] as const
    }),
  ), [availableCategories, bom.lineItems])

  const groups = useMemo(() => CATEGORY_ORDER
    .map((category) => {
      const items = filteredLineItems.filter((item) => item.category === category)
      return {
        category,
        items,
        quantity: items.reduce((sum, item) => sum + item.quantity, 0),
        totalWeightLb: items.reduce((sum, item) => sum + (item.totalWeightLb ?? 0), 0),
      }
    })
    .filter((group) => group.items.length > 0), [filteredLineItems])

  const filteredSummary = useMemo(() => ({
    lineItemCount: filteredLineItems.length,
    totalQuantity: filteredLineItems.reduce((sum, item) => sum + item.quantity, 0),
    totalWeightLb: filteredLineItems.reduce((sum, item) => sum + (item.totalWeightLb ?? 0), 0),
    weightedLineItemCount: filteredLineItems.filter((item) => item.totalWeightLb != null).length,
    nonCatalogLineItemCount: filteredLineItems.filter((item) => item.metadataSource !== 'catalog' || item.weightSource !== 'catalog').length,
    missingWeightLineItemCount: filteredLineItems.filter((item) => item.totalWeightLb == null).length,
  }), [filteredLineItems])

  if (!isOpen) return null

  const coverage = filteredSummary.lineItemCount > 0
    ? (filteredSummary.weightedLineItemCount / filteredSummary.lineItemCount) * 100
    : 100
  const allCategoriesSelected = activeCategories.length === availableCategories.length
  const hasSearchQuery = normalizedSearchQuery.length > 0

  const handleSelectAllCategories = () => {
    setSelectedCategories(null)
  }

  const handleToggleCategory = (category: BomCategory) => {
    setSelectedCategories((current) => {
      const normalized = current?.filter((value) => availableCategories.includes(value)) ?? availableCategories
      const isSelected = normalized.includes(category)

      if (isSelected) {
        const next = normalized.filter((value) => value !== category)
        if (next.length === 0) return current ?? null
        return next.length === availableCategories.length ? null : orderedCategories(next)
      }

      const next = orderedCategories([...normalized, category])
      return next.length === availableCategories.length ? null : next
    })
  }

  const handleExportCsv = () => {
    if (filteredLineItems.length === 0) return

    const csv = buildBomCsv(filteredLineItems)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `${sanitizeFileNamePart(selectedManufacturer.name)}-bom-${viewMode}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const handleRowClick = (item: BomLineItem) => {
    const objectIds = item.selection.objectIds
    const currentIndex = selectedObjectId ? objectIds.indexOf(selectedObjectId) : -1
    const nextObjectId = objectIds.length === 0
      ? item.selection.primaryObjectId
      : currentIndex >= 0
        ? objectIds[(currentIndex + 1) % objectIds.length]
        : item.selection.primaryObjectId && objectIds.includes(item.selection.primaryObjectId)
          ? item.selection.primaryObjectId
          : objectIds[0]

    const nextStackIds = nextObjectId
      ? deriveStackIdsForObjectId(nextObjectId)
      : item.selection.stackIds.slice(0, 1)

    setSelectedBlockId(null)
    setSelectedStackIds(nextStackIds)
    setSelectedObjectId(nextObjectId ?? null)
  }

  const isRowInteractive = (item: BomLineItem) => item.selection.objectIds.length > 0 || item.selection.stackIds.length > 0

  const isRowActive = (item: BomLineItem) => (
    (selectedObjectId != null && item.selection.objectIds.includes(selectedObjectId))
    || selectedStackIds.some((stackId) => item.selection.stackIds.includes(stackId))
  )

  const renderRow = (item: BomLineItem, showCategory: boolean) => {
    const interactive = isRowInteractive(item)
    const active = isRowActive(item)

    return (
      <button
        className={[
          'bom-table',
          'bom-table-row',
          showCategory ? 'bom-table--flat' : 'bom-table--grouped',
          interactive ? 'is-interactive' : '',
          active ? 'is-active' : '',
        ].filter(Boolean).join(' ')}
        key={item.id}
        type="button"
        onClick={interactive ? () => handleRowClick(item) : undefined}
        disabled={!interactive}
        aria-pressed={active}
        title={interactive ? 'Click to locate matching scaffold members in the model' : 'No linked scaffold members available'}
      >
        {showCategory ? <span className="bom-category-cell">{item.category}</span> : null}
        <div className="bom-component-cell">
          <strong>{getBomComponentName(item)}</strong>
          <div className="bom-component-meta">
            {item.partNumber ? <span className="bom-part-number">{item.partNumber}</span> : null}
            <span className="bom-component-note">{detailLabel(item)}</span>
          </div>
        </div>
        <span className="bom-table-value bom-table-value--qty">{formatInteger(item.quantity)}</span>
        <span className="bom-table-value bom-table-value--unit-weight">{formatWeight(item.unitWeightLb)}</span>
        <span className="bom-table-value bom-table-value--total-weight">{formatWeight(item.totalWeightLb)}</span>
        <span className={`bom-source-badge ${item.weightSource === 'missing' ? 'missing' : item.metadataSource}`}>
          {sourceLabel(item.weightSource === 'missing' ? 'missing' : item.metadataSource)}
        </span>
      </button>
    )
  }

  const overlayClassName = ['bom-overlay', variant === 'page' ? 'bom-overlay--page' : ''].filter(Boolean).join(' ')

  return (
    <div className={overlayClassName} onClick={variant === 'drawer' ? onClose : undefined}>
      <aside className="bom-drawer" onClick={variant === 'drawer' ? (e) => e.stopPropagation() : undefined}>
        <div className="bom-header">
          <div className="bom-header-copy">
            <div className="bom-kicker">Live takeoff</div>
            <h2><Boxes size={20} /> Bill of Materials</h2>
            <p>{selectedManufacturer.name} profile calibrated with scaffold-derived fallback data for estimating and procurement.</p>
            <div className="bom-hero-metrics">
              <div className="bom-hero-metric bom-hero-metric--rows">
                <strong>{formatInteger(filteredSummary.lineItemCount)}</strong>
                <span>{filteredSummary.lineItemCount === 1 ? 'Active row' : 'Active rows'}</span>
              </div>
              <div className="bom-hero-metric bom-hero-metric--pieces">
                <strong>{formatInteger(filteredSummary.totalQuantity)}</strong>
                <span>Total pieces</span>
              </div>
              <div className="bom-hero-metric bom-hero-metric--weight">
                <strong>{formatWeight(filteredSummary.totalWeightLb)}</strong>
                <span>Current takeoff weight</span>
              </div>
            </div>
          </div>

          <div className="bom-header-actions">
            <span className="bom-pill">Live model</span>
            <button
              className="bom-export-btn"
              onClick={handleExportCsv}
              type="button"
              disabled={filteredLineItems.length === 0}
            >
              <FileDown size={16} />
              <span>Export CSV</span>
            </button>
            <button className="bom-close-btn" onClick={onClose} type="button" aria-label="Close bill of materials">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="bom-body">
          {bom.summary.modelItemCount === 0 ? (
            <div className="bom-empty-state">
              <div className="bom-empty-icon"><Boxes size={28} /></div>
              <h3>No scaffold components yet</h3>
              <p>Place standards, ledgers, blocks, braces, or planks and the BOM will populate automatically.</p>
            </div>
          ) : (
            <>
              <div className="bom-summary-grid">
                <div className="bom-summary-card bom-summary-card--rows">
                  <span className="bom-summary-label">Line items</span>
                  <strong>{formatInteger(filteredSummary.lineItemCount)}</strong>
                  <small>{allCategoriesSelected ? 'Distinct bill rows' : 'Rows in filtered scope'}</small>
                </div>
                <div className="bom-summary-card bom-summary-card--pieces">
                  <span className="bom-summary-label">Total pieces</span>
                  <strong>{formatInteger(filteredSummary.totalQuantity)}</strong>
                  <small>All counted members</small>
                </div>
                <div className="bom-summary-card bom-summary-card--weight">
                  <span className="bom-summary-label">Total weight</span>
                  <strong>{formatWeight(filteredSummary.totalWeightLb)}</strong>
                  <small>Known + inferred where available</small>
                </div>
                <div className="bom-summary-card bom-summary-card--coverage">
                  <span className="bom-summary-label">Weight coverage</span>
                  <strong>{formatPercent(coverage)}</strong>
                  <small>{filteredSummary.missingWeightLineItemCount === 0 ? 'Fully weighted' : `${filteredSummary.missingWeightLineItemCount} rows need weights`}</small>
                </div>
              </div>

              <div className="bom-controls">
                <div className="bom-controls-top">
                  <div className="bom-view-toggle" role="tablist" aria-label="BOM view mode">
                    <button
                      className={`bom-toggle-btn ${viewMode === 'grouped' ? 'active' : ''}`}
                      onClick={() => setViewMode('grouped')}
                      type="button"
                      aria-pressed={viewMode === 'grouped'}
                    >
                      Grouped
                    </button>
                    <button
                      className={`bom-toggle-btn ${viewMode === 'flat' ? 'active' : ''}`}
                      onClick={() => setViewMode('flat')}
                      type="button"
                      aria-pressed={viewMode === 'flat'}
                    >
                      Flat
                    </button>
                  </div>

                  <div className="bom-controls-copy">
                    <strong>
                      {hasSearchQuery
                        ? `${formatInteger(filteredSummary.lineItemCount)} matching rows`
                        : allCategoriesSelected
                          ? 'Full scaffold takeoff'
                          : `${activeCategories.length} categories selected`}
                    </strong>
                    <span>
                      {hasSearchQuery
                        ? 'Search by component, category, source, or part number, then click a row to locate it in the model'
                        : viewMode === 'grouped'
                          ? `${groups.length} structured schedules for estimating review · click rows to locate them in the model`
                          : 'Procurement view across active categories · click rows to locate them in the model'}
                    </span>
                  </div>
                </div>

                <div className="bom-search-row">
                  <label className="bom-search-field" htmlFor="bom-search-input">
                    <Search size={16} />
                    <input
                      id="bom-search-input"
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search component, category, or source"
                    />
                  </label>

                  {hasSearchQuery ? (
                    <button
                      className="bom-search-clear"
                      onClick={() => setSearchQuery('')}
                      type="button"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>

                <div className="bom-filter-row" aria-label="BOM category filters">
                  <button
                    className={`bom-filter-chip ${allCategoriesSelected ? 'active' : ''}`}
                    onClick={handleSelectAllCategories}
                    type="button"
                    aria-pressed={allCategoriesSelected}
                  >
                    <span>All</span>
                  </button>

                  {availableCategories.map((category) => {
                    const stats = categoryStats.get(category)
                    const isActive = activeCategories.includes(category)

                    return (
                      <button
                        className={`bom-filter-chip ${isActive ? 'active' : ''}`}
                        onClick={() => handleToggleCategory(category)}
                        type="button"
                        aria-pressed={isActive}
                        key={category}
                      >
                        <span>{category}</span>
                        <strong>{formatInteger(stats?.quantity ?? 0)}</strong>
                      </button>
                    )
                  })}
                </div>
              </div>

              {filteredLineItems.length === 0 ? (
                <div className="bom-empty-state bom-empty-state--filtered">
                  <div className="bom-empty-icon"><Search size={28} /></div>
                  <h3>No BOM rows match this view</h3>
                  <p>
                    {hasSearchQuery
                      ? 'Try a broader search term or clear the active filters.'
                      : 'Adjust the active category filters to bring rows back into scope.'}
                  </p>
                </div>
              ) : (
                <>
                  {(filteredSummary.nonCatalogLineItemCount > 0 || filteredSummary.missingWeightLineItemCount > 0) && (
                    <div className="bom-notice">
                      <strong>Data note</strong>
                      <span>
                        {filteredSummary.nonCatalogLineItemCount > 0
                          ? `${formatInteger(filteredSummary.nonCatalogLineItemCount)} rows use fallback or system metadata. `
                          : ''}
                        {filteredSummary.missingWeightLineItemCount > 0
                          ? `${formatInteger(filteredSummary.missingWeightLineItemCount)} rows are missing unit weight data.`
                          : 'All visible rows include weight data.'}
                      </span>
                    </div>
                  )}

                  {viewMode === 'grouped' ? (
                    <div className="bom-sections">
                      {groups.map((group) => (
                        <section className="bom-section" key={group.category}>
                          <div className="bom-section-header">
                            <div className="bom-section-copy">
                              <span className="bom-section-kicker">Category schedule</span>
                              <h3>{group.category}</h3>
                              <p>{formatInteger(group.quantity)} pcs · {formatWeight(group.totalWeightLb)}</p>
                            </div>
                            <span className="bom-section-meta">{formatInteger(group.items.length)} rows</span>
                          </div>

                          <div className="bom-table-shell">
                            <div className="bom-table bom-table-head bom-table--grouped">
                              <span className="bom-table-col bom-table-col--component">Component</span>
                              <span className="bom-table-col bom-table-col--qty">Qty</span>
                              <span className="bom-table-col bom-table-col--unit-weight">Unit wt</span>
                              <span className="bom-table-col bom-table-col--total-weight">Total wt</span>
                              <span className="bom-table-col bom-table-col--source">Source</span>
                            </div>

                            {group.items.map((item) => renderRow(item, false))}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <section className="bom-section bom-section--flat">
                      <div className="bom-section-header">
                        <div className="bom-section-copy">
                          <span className="bom-section-kicker">Procurement schedule</span>
                          <h3>Flat procurement view</h3>
                          <p>{formatInteger(filteredSummary.totalQuantity)} pcs · {formatWeight(filteredSummary.totalWeightLb)}</p>
                        </div>
                        <span className="bom-section-meta">{formatInteger(filteredSummary.lineItemCount)} rows</span>
                      </div>

                      <div className="bom-table-shell">
                        <div className="bom-table bom-table-head bom-table--flat">
                          <span className="bom-table-col bom-table-col--category">Category</span>
                          <span className="bom-table-col bom-table-col--component">Component</span>
                          <span className="bom-table-col bom-table-col--qty">Qty</span>
                          <span className="bom-table-col bom-table-col--unit-weight">Unit wt</span>
                          <span className="bom-table-col bom-table-col--total-weight">Total wt</span>
                          <span className="bom-table-col bom-table-col--source">Source</span>
                        </div>

                        {filteredLineItems.map((item) => renderRow(item, true))}
                      </div>
                    </section>
                  )}

                  <div className="bom-footer">
                    <div className="bom-footer-copy">
                      <span className="bom-summary-label">Current scope</span>
                      <strong>{allCategoriesSelected && !hasSearchQuery ? 'Full scaffold takeoff' : 'Filtered scaffold takeoff'}</strong>
                    </div>
                    <div className="bom-footer-metrics">
                      <span>{formatInteger(filteredSummary.lineItemCount)} rows</span>
                      <span>{formatInteger(filteredSummary.totalQuantity)} pcs</span>
                      <span>{formatWeight(filteredSummary.totalWeightLb)}</span>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
