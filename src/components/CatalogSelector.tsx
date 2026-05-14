import { useMemo, type RefObject } from 'react'
import { ChevronDown, Package } from 'lucide-react'
import { useCatalogSelection } from '../contexts/CatalogContext'
import type { CatalogCategoryKey, CatalogManufacturerId } from '../catalog/catalogSchema'
import { getCatalogPartDisplayName, getCatalogPartSpecLabel } from '../catalog/scaffoldDisplay'
import './CatalogSelector.css'

type Props = {
  open: boolean
  onToggle: () => void
  onClose: () => void
  containerRef: RefObject<HTMLDivElement>
}

const CATEGORY_LABEL: Record<CatalogCategoryKey, string> = {
  standards: 'Standards',
  ledgers: 'Ledgers',
  braces: 'Braces',
  trusses: 'Trusses',
  sideBrackets: 'Side Brackets',
  planks: 'Plank',
  liveLoads: 'Live Load',
} as const

const CATALOG_CATEGORY_KEYS: CatalogCategoryKey[] = (
  Object.keys(CATEGORY_LABEL) as CatalogCategoryKey[]
).filter((key) => key !== 'liveLoads')

const AUTO_SELECT_CATEGORIES: Set<CatalogCategoryKey> = new Set(['ledgers', 'braces', 'trusses', 'sideBrackets', 'planks', 'liveLoads'])

export function CatalogSelector({ open, onToggle, onClose, containerRef }: Props) {
  const {
    manufacturers,
    manufacturerId,
    categoryKey,
    partId,
    selectedManufacturer,
    selectedCategory,
    parts,
    selectedPart,
    setManufacturerId,
    setCategoryKey,
    setPartId,
  } = useCatalogSelection()

  const isAutoSelectCategory = categoryKey !== 'liveLoads' && AUTO_SELECT_CATEGORIES.has(categoryKey)
  const hasMultipleManufacturers = manufacturers.length > 1
  const triggerText = isAutoSelectCategory
    ? CATEGORY_LABEL[categoryKey]
    : (categoryKey === 'liveLoads' ? 'Catalog' : (selectedPart ? getCatalogPartDisplayName(categoryKey, selectedPart) : 'Catalog'))

  const triggerTitle = useMemo(() => {
    const profile = selectedManufacturer?.name ?? '-'
    const category = selectedCategory?.name ?? '-'
    const part = selectedPart ? getCatalogPartDisplayName(categoryKey, selectedPart) : '-'
    return `Catalog: ${profile} · ${category} · ${part}`
  }, [categoryKey, selectedCategory?.name, selectedManufacturer?.name, selectedPart])

  const autoSelectDescription = useMemo(() => {
    if (categoryKey === 'planks') {
      return 'Click a ledger to place a deck set. The layout will be calculated automatically from the clicked ledger and opposite support.'
    }
    if (categoryKey === 'liveLoads') {
      return 'Click a ledger to place a one-way live load bay. The load spans to the opposite parallel support on the hovered side.'
    }
    return `Click a connection point to place a ${CATEGORY_LABEL[categoryKey].toLowerCase().replace(/s$/, '')}. The correct part size will be selected automatically based on the distance.`
  }, [categoryKey])

  const autoSelectSummary = useMemo(() => {
    if (categoryKey === 'planks') {
      return 'Layout will be auto-generated from the clicked ledger. Hold Shift to preview and place a multi-bay run.'
    }
    if (categoryKey === 'liveLoads') {
      return 'One-way bay load. Hold Shift to preview and place a continuous run, then select a load to edit its psf.'
    }
    return 'Component size will be auto-selected from the connection distance.'
  }, [categoryKey])

  const onPickManufacturer = (id: CatalogManufacturerId) => {
    setManufacturerId(id)
  }

  const onPickCategory = (key: CatalogCategoryKey) => {
    setCategoryKey(key)
  }

  const onPickPart = (id: string) => {
    setPartId(id)
    onClose()
  }

  return (
    <div className="dropdown-container" ref={containerRef}>
      <button
        className={`toolbar-btn dropdown-trigger ${open ? 'active' : ''}`}
        onClick={onToggle}
        title={triggerTitle}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Package size={18} />
        <span className="catalog-trigger-text">{triggerText}</span>
        <ChevronDown size={12} className="dropdown-arrow" />
      </button>

      {open && (
        <div className="dropdown-menu catalog-menu" role="menu" aria-label="Catalog selector">
          <div className="dropdown-header">
            {hasMultipleManufacturers ? 'Scaffold Catalog' : `${selectedManufacturer.name} Catalog`}
          </div>

          {hasMultipleManufacturers && (
            <div className="catalog-section">
              <div className="catalog-section-title">Profile</div>
              <div className="catalog-pill-row" role="group" aria-label="Profiles">
                {manufacturers.map((manufacturer) => (
                  <button
                    key={manufacturer.id}
                    className={`catalog-pill ${manufacturerId === manufacturer.id ? 'active' : ''}`}
                    onClick={() => onPickManufacturer(manufacturer.id)}
                    type="button"
                  >
                    {manufacturer.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="catalog-section">
            <div className="catalog-section-title">Category</div>
            <div className="catalog-pill-row" role="group" aria-label="Categories">
              {CATALOG_CATEGORY_KEYS.map((key) => (
                <button
                  key={key}
                  className={`catalog-pill ${categoryKey === key ? 'active' : ''}`}
                  onClick={() => onPickCategory(key)}
                  type="button"
                >
                  {CATEGORY_LABEL[key]}
                </button>
              ))}
            </div>
          </div>

          <div className="catalog-section">
            <div className="catalog-section-title">Parts</div>
            <div className="catalog-parts" role="listbox" aria-label="Parts">
              {isAutoSelectCategory ? (
                <div className="catalog-auto-select">
                  <div className="catalog-auto-select-title">Auto-Select Mode</div>
                  <div className="catalog-auto-select-desc">{autoSelectDescription}</div>
                </div>
              ) : parts.length === 0 ? (
                <div className="catalog-empty">No parts in this category yet.</div>
              ) : (
                parts.map((part) => {
                  const active = partId === part.id
                  return (
                    <button
                      key={part.id}
                      className={`catalog-part ${active ? 'active' : ''}`}
                      onClick={() => onPickPart(part.id)}
                      type="button"
                      role="option"
                      aria-selected={active}
                    >
                      <div className="catalog-part-primary">{getCatalogPartDisplayName(categoryKey, part)}</div>
                      <div className="catalog-part-secondary">{getCatalogPartSpecLabel(categoryKey, part)}</div>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {(selectedPart || isAutoSelectCategory) && (
            <div className="catalog-summary" aria-label="Selected part summary">
              <div className="catalog-summary-title">{isAutoSelectCategory ? 'Ready to Place' : 'Selected'}</div>
              <div className="catalog-summary-row">
                <span className="catalog-summary-strong">{selectedManufacturer.name}</span>
                <span className="catalog-summary-muted">{isAutoSelectCategory ? CATEGORY_LABEL[categoryKey] : selectedCategory.name}</span>
                {selectedPart ? (
                  <span className="catalog-summary-strong">{getCatalogPartDisplayName(categoryKey, selectedPart)}</span>
                ) : null}
                {isAutoSelectCategory && !selectedPart ? <span className="catalog-summary-muted">(auto)</span> : null}
              </div>
              <div className="catalog-summary-sub">
                {isAutoSelectCategory
                  ? autoSelectSummary
                  : (selectedPart?.description ?? 'Generic scaffold component')}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
