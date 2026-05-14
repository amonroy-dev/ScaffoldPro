import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { CATALOG } from '../catalog/catalogData'
import type { Catalog, CatalogCategoryKey, CatalogManufacturer, CatalogManufacturerId, CatalogPart } from '../catalog/catalogSchema'

/**
 * CatalogContext
 *
 * We split context into:
 * - data context (static catalog, never changes)
 * - selection context (user selection, changes as dropdowns change)
 *
 * This prevents unrelated components from re-rendering when only selection changes.
 */

type CatalogSelectionState = {
  manufacturerId: CatalogManufacturerId
  categoryKey: CatalogCategoryKey
  partId: string | null
  bracePlacementSide: 1 | -1
  bracePlacementDirection: 'ascending' | 'descending'
}

type CatalogSelectionApi = CatalogSelectionState & {
  setManufacturerId: (id: CatalogManufacturerId) => void
  setCategoryKey: (key: CatalogCategoryKey) => void
  setPartId: (id: string | null) => void
  clearSelection: () => void
  setBracePlacementSide: (side: 1 | -1) => void
  setBracePlacementDirection: (dir: 'ascending' | 'descending') => void
}

const CatalogDataContext = createContext<Catalog | null>(null)
const CatalogSelectionContext = createContext<CatalogSelectionApi | null>(null)

function findManufacturer(catalog: Catalog, id: CatalogManufacturerId): CatalogManufacturer {
  const m = catalog.manufacturers.find((x) => x.id === id)
  if (!m) throw new Error(`Catalog is missing manufacturer '${id}'`)
  return m
}



export function CatalogProvider({
  children,
  catalog = CATALOG,
}: {
  children: ReactNode
  /** Allow override for tests or future dynamic catalogs. */
  catalog?: Catalog
}) {
  const defaultManufacturerId = catalog.manufacturers[0]?.id ?? 'universal'
  const [manufacturerId, setManufacturerIdState] = useState<CatalogManufacturerId>(defaultManufacturerId)
  const [categoryKey, setCategoryKeyState] = useState<CatalogCategoryKey>('standards')
	  // Intentionally start with NO part selected so users must explicitly choose a part before placing.
	  const [partId, setPartIdState] = useState<string | null>(null)
  const [bracePlacementSide, setBracePlacementSideState] = useState<1 | -1>(1)
  const [bracePlacementDirection, setBracePlacementDirectionState] = useState<'ascending' | 'descending'>('ascending')

  const clearSelection = useCallback(() => {
    setManufacturerIdState(defaultManufacturerId)
    setCategoryKeyState('standards')
	    setPartIdState(null)
  }, [defaultManufacturerId])

  const setManufacturerId = useCallback(
    (id: CatalogManufacturerId) => {
      setManufacturerIdState(id)
	      // Keep categoryKey, but require an explicit part selection within the new manufacturer.
	      setPartIdState(null)
    },
    [catalog, categoryKey],
  )

  const setCategoryKey = useCallback(
    (key: CatalogCategoryKey) => {
      setCategoryKeyState(key)
	      // Require an explicit part selection within the new category.
	      setPartIdState(null)
    },
    [catalog, manufacturerId],
  )

  const setPartId = useCallback((id: string | null) => {
    setPartIdState(id)
  }, [])

  const setBracePlacementSide = useCallback((side: 1 | -1) => {
    setBracePlacementSideState(side)
  }, [])

  const setBracePlacementDirection = useCallback((dir: 'ascending' | 'descending') => {
    setBracePlacementDirectionState(dir)
  }, [])

  const selectionValue: CatalogSelectionApi = useMemo(
    () => ({
      manufacturerId,
      categoryKey,
      partId,
      bracePlacementSide,
      bracePlacementDirection,
      setManufacturerId,
      setCategoryKey,
      setPartId,
      clearSelection,
      setBracePlacementSide,
      setBracePlacementDirection,
    }),
    [manufacturerId, categoryKey, partId, bracePlacementSide, bracePlacementDirection, setManufacturerId, setCategoryKey, setPartId, clearSelection, setBracePlacementSide, setBracePlacementDirection],
  )

  return (
    <CatalogDataContext.Provider value={catalog}>
      <CatalogSelectionContext.Provider value={selectionValue}>{children}</CatalogSelectionContext.Provider>
    </CatalogDataContext.Provider>
  )
}

export function useCatalogData() {
  const ctx = useContext(CatalogDataContext)
  if (!ctx) throw new Error('useCatalogData must be used within CatalogProvider')
  return ctx
}

export function useCatalogSelection() {
  const catalog = useCatalogData()
  const selection = useContext(CatalogSelectionContext)
  if (!selection) throw new Error('useCatalogSelection must be used within CatalogProvider')

  const selectedManufacturer = useMemo(
    () => findManufacturer(catalog, selection.manufacturerId),
    [catalog, selection.manufacturerId],
  )

  const selectedCategory = useMemo(
    () => selectedManufacturer.categories[selection.categoryKey],
    [selectedManufacturer, selection.categoryKey],
  )

  const selectedPart: CatalogPart | null = useMemo(() => {
    if (!selection.partId) return null
    return selectedCategory.parts.find((p) => p.id === selection.partId) ?? null
  }, [selectedCategory.parts, selection.partId])

  return {
    ...selection,
    manufacturers: catalog.manufacturers,
    selectedManufacturer,
    selectedCategory,
    parts: selectedCategory.parts,
    selectedPart,
  }
}
