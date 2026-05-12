import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl, {
  type GeoJSONFeature,
  NavigationControl,
  type GeoJSONSource,
  type Map as MapboxMap,
} from 'mapbox-gl'
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import {
  Building2,
  Loader2,
  MapPinned,
  MoveDiagonal2,
  Search,
  X,
} from 'lucide-react'
import {
  DEFAULT_MAP_IMPORT_VIEW,
  resolveImportedFootprintFromFeatures,
  type ImportedMapFootprint,
} from '../utils/mapImport'
import 'mapbox-gl/dist/mapbox-gl.css'
import './MapImportDialog.css'

type SearchResult = {
  id: string
  label: string
  center: [number, number]
}

type MapImportDialogProps = {
  isOpen: boolean
  onClose: () => void
  onImport: (footprint: ImportedMapFootprint, heightFt: number) => void
}

const SELECTION_SOURCE_ID = 'scaffoldpro-map-import-selection'
const SELECTION_FILL_ID = 'scaffoldpro-map-import-selection-fill'
const SELECTION_LINE_ID = 'scaffoldpro-map-import-selection-line'
const SELECTION_EXTRUSION_ID = 'scaffoldpro-map-import-selection-extrusion'
const BUILDING_FILL_LAYER_ID = 'scaffoldpro-map-import-building-fill'
const BUILDING_EXTRUSION_LAYER_ID = 'scaffoldpro-map-import-building-extrusion'
const METERS_PER_FOOT = 0.3048

function getFirstSymbolLayerId(map: MapboxMap): string | undefined {
  const layers = map.getStyle().layers ?? []
  return layers.find(layer => layer.type === 'symbol')?.id
}

function emptyFeatureCollection(): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: [],
  }
}

function selectionToGeoJson(footprint: ImportedMapFootprint | null): FeatureCollection<Polygon> {
  if (!footprint) return emptyFeatureCollection()
  const closeRing = (ring: [number, number][]) => {
    if (ring.length === 0) return ring
    const first = ring[0]!
    const last = ring[ring.length - 1]!
    if (Math.abs(first[0] - last[0]) <= 1e-9 && Math.abs(first[1] - last[1]) <= 1e-9) return ring
    return [...ring, first]
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            closeRing(footprint.outerRing),
            ...footprint.holes.map(hole => closeRing(hole)),
          ],
        },
        properties: {
          heightM: Math.max(4, footprint.suggestedHeightFt * METERS_PER_FOOT),
        },
      },
    ],
  }
}

function isPolygonalBuildingFeature(feature: GeoJSONFeature): boolean {
  if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') return false
  const layerId = String(feature.layer?.id ?? '').toLowerCase()
  const sourceLayer = String((feature as { sourceLayer?: string }).sourceLayer ?? '').toLowerCase()
  return layerId.includes('building') || sourceLayer.includes('building')
}

function getInteractiveBuildingLayerIds(): string[] {
  return [BUILDING_EXTRUSION_LAYER_ID, BUILDING_FILL_LAYER_ID]
}

function ensureInteractiveBuildingLayers(map: MapboxMap) {
  const labelLayerId = getFirstSymbolLayerId(map)
  if (!map.getLayer(BUILDING_FILL_LAYER_ID)) {
    map.addLayer({
      id: BUILDING_FILL_LAYER_ID,
      type: 'fill',
      source: 'composite',
      'source-layer': 'building',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color': '#e5e7eb',
        'fill-opacity': 0.6,
      },
    }, labelLayerId)
  }
  if (!map.getLayer(BUILDING_EXTRUSION_LAYER_ID)) {
    map.addLayer({
      id: BUILDING_EXTRUSION_LAYER_ID,
      type: 'fill-extrusion',
      source: 'composite',
      'source-layer': 'building',
      filter: ['==', ['geometry-type'], 'Polygon'],
      minzoom: 14,
      paint: {
        'fill-extrusion-color': '#d6d3d1',
        'fill-extrusion-height': ['coalesce', ['to-number', ['get', 'height']], 12],
        'fill-extrusion-base': ['coalesce', ['to-number', ['get', 'min_height']], 0],
        'fill-extrusion-opacity': 0.88,
      },
    }, labelLayerId)
  }
}

export function MapImportDialog({ isOpen, onClose, onImport }: MapImportDialogProps) {
  const token = useMemo(() => import.meta.env.VITE_MAPBOX_TOKEN || '', [])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const buildingLayerIdsRef = useRef<string[]>([])

  const [query, setQuery] = useState('Pittsburgh, PA')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [statusMessage, setStatusMessage] = useState<string>('Click a building footprint to select it.')
  const [selectedFootprint, setSelectedFootprint] = useState<ImportedMapFootprint | null>(null)
  const [heightFt, setHeightFt] = useState('25')
  const [mapReady, setMapReady] = useState(false)

  const updateSelectionSource = useCallback((footprint: ImportedMapFootprint | null) => {
    const map = mapRef.current
    if (!map) return
    const source = map.getSource(SELECTION_SOURCE_ID) as GeoJSONSource | undefined
    if (!source) return
    source.setData(selectionToGeoJson(footprint))
  }, [])

  useEffect(() => {
    if (!isOpen) return undefined
    if (!containerRef.current) return undefined
    if (!token) return undefined

    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
    }
    containerRef.current.replaceChildren()

    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [DEFAULT_MAP_IMPORT_VIEW.lng, DEFAULT_MAP_IMPORT_VIEW.lat],
      zoom: DEFAULT_MAP_IMPORT_VIEW.zoom,
      pitch: 58,
      bearing: -18,
      antialias: true,
      attributionControl: false,
      cooperativeGestures: true,
    })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')

    const handleLoad = () => {
      ensureInteractiveBuildingLayers(map)
      buildingLayerIdsRef.current = getInteractiveBuildingLayerIds()
      if (!map.getSource(SELECTION_SOURCE_ID)) {
        map.addSource(SELECTION_SOURCE_ID, {
          type: 'geojson',
          data: emptyFeatureCollection(),
        })
      }
      if (!map.getLayer(SELECTION_FILL_ID)) {
        map.addLayer({
          id: SELECTION_FILL_ID,
          type: 'fill',
          source: SELECTION_SOURCE_ID,
          paint: {
            'fill-color': '#4a9eff',
            'fill-opacity': 0.22,
          },
        })
      }
      if (!map.getLayer(SELECTION_EXTRUSION_ID)) {
        map.addLayer({
          id: SELECTION_EXTRUSION_ID,
          type: 'fill-extrusion',
          source: SELECTION_SOURCE_ID,
          paint: {
            'fill-extrusion-color': '#4a9eff',
            'fill-extrusion-height': ['coalesce', ['to-number', ['get', 'heightM']], 8],
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.22,
          },
        })
      }
      if (!map.getLayer(SELECTION_LINE_ID)) {
        map.addLayer({
          id: SELECTION_LINE_ID,
          type: 'line',
          source: SELECTION_SOURCE_ID,
          paint: {
            'line-color': '#1f5fbf',
            'line-width': 3,
            'line-opacity': 0.85,
          },
        })
      }
      setMapReady(true)
      setStatusMessage('Click a building to select it.')
      window.requestAnimationFrame(() => map.resize())
    }

    const handleMove = (event: mapboxgl.MapMouseEvent) => {
      const query = buildingLayerIdsRef.current.length > 0
        ? { layers: buildingLayerIdsRef.current }
        : undefined
      const features = map.queryRenderedFeatures(event.point, query)
      map.getCanvas().style.cursor = features.some(isPolygonalBuildingFeature) ? 'pointer' : ''
    }

    const handleClick = (event: mapboxgl.MapMouseEvent) => {
      const query = buildingLayerIdsRef.current.length > 0
        ? { layers: buildingLayerIdsRef.current }
        : undefined
      const directFeatures = map.queryRenderedFeatures(event.point, query).filter(isPolygonalBuildingFeature)
      const nearbyFeatures = directFeatures.length > 0
        ? directFeatures
        : map.queryRenderedFeatures([
          [event.point.x - 6, event.point.y - 6],
          [event.point.x + 6, event.point.y + 6],
        ], query).filter(isPolygonalBuildingFeature)
      const footprint = resolveImportedFootprintFromFeatures(
        nearbyFeatures.map(feature => ({
          geometry: feature.geometry as Polygon | MultiPolygon,
          properties: (feature.properties ?? {}) as Record<string, unknown>,
        })),
        [event.lngLat.lng, event.lngLat.lat],
      )
      if (!footprint) {
        setSelectedFootprint(null)
        updateSelectionSource(null)
        setStatusMessage('No building found there yet. Zoom in a little more and click again.')
        return
      }
      setSelectedFootprint(footprint)
      setHeightFt(String(footprint.suggestedHeightFt))
      updateSelectionSource(footprint)
      setStatusMessage(
        footprint.hasInteriorHoles
          ? 'Selected. Courtyard openings will import as a clean outer mass.'
          : 'Selected. Touching building pieces were merged automatically.',
      )
    }

    map.on('load', handleLoad)
    map.on('mousemove', handleMove)
    map.on('click', handleClick)

    return () => {
      setMapReady(false)
      buildingLayerIdsRef.current = []
      map.off('load', handleLoad)
      map.off('mousemove', handleMove)
      map.off('click', handleClick)
        map.remove()
        mapRef.current = null
    }
  }, [isOpen, token, updateSelectionSource])

  useEffect(() => {
    if (!isOpen) return
    if (!selectedFootprint) return
    updateSelectionSource(selectedFootprint)
  }, [isOpen, selectedFootprint, updateSelectionSource])

  const runSearch = useCallback(async (nextQuery?: string) => {
    const searchTerm = (nextQuery ?? query).trim()
    if (!searchTerm || !token) return
    setSearching(true)
    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchTerm)}.json?access_token=${encodeURIComponent(token)}&autocomplete=true&limit=5&types=place,address,neighborhood,poi&proximity=${DEFAULT_MAP_IMPORT_VIEW.lng},${DEFAULT_MAP_IMPORT_VIEW.lat}`,
      )
      if (!response.ok) throw new Error(`Search failed with ${response.status}`)
      const payload = await response.json() as {
        features?: Array<{
          id: string
          place_name: string
          center?: [number, number]
        }>
      }
      const results = (payload.features ?? [])
        .filter(feature => Array.isArray(feature.center) && feature.center.length >= 2)
        .map(feature => ({
          id: feature.id,
          label: feature.place_name,
          center: [feature.center![0], feature.center![1]] as [number, number],
        }))
      setSearchResults(results)
      if (results[0] && mapRef.current) {
        mapRef.current.flyTo({ center: results[0].center, zoom: 17, pitch: 58, bearing: -18, essential: true })
      }
    } catch (error) {
      console.error('[MapImportDialog] Search failed', error)
      setStatusMessage('Map search failed. Check the token and try again.')
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }, [query, token])

  const handleImport = useCallback(() => {
    const parsedHeight = Number(heightFt)
    if (!selectedFootprint || !Number.isFinite(parsedHeight) || parsedHeight <= 0) return
    onImport(selectedFootprint, parsedHeight)
    onClose()
  }, [heightFt, onClose, onImport, selectedFootprint])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const canImport = selectedFootprint !== null && Number.isFinite(Number(heightFt)) && Number(heightFt) > 0

  return createPortal(
    <div
      className="map-import-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="map-import-title"
      data-scaffoldpro-modal="map-import"
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="map-import-modal"
        onMouseDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
      >
        <aside className="map-import-sidebar">
          <div className="map-import-header">
            <div>
              <div className="map-import-kicker">Insert From Map</div>
              <h2 className="map-import-title" id="map-import-title">Import a footprint into the canvas</h2>
              <p className="map-import-subtitle">Search or click a building in the 3D map.</p>
            </div>
            <button type="button" className="map-import-close" onClick={onClose} aria-label="Close map import">
              <X size={18} />
            </button>
          </div>

          <form
            className="map-import-search"
            onSubmit={event => {
              event.preventDefault()
              void runSearch()
            }}
          >
            <label htmlFor="map-import-search-input" className="map-import-label">Search location</label>
            <div className="map-import-search-row">
              <input
                id="map-import-search-input"
                className="map-import-input"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search city, address, or landmark"
              />
              <button type="submit" className="map-import-search-button">
                {searching ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
              </button>
            </div>
          </form>

          {searchResults.length > 0 && (
            <div className="map-import-results">
              {searchResults.map(result => (
                <button
                  key={result.id}
                  type="button"
                  className="map-import-result"
                  onClick={() => {
                    mapRef.current?.flyTo({ center: result.center, zoom: 17, essential: true })
                    setQuery(result.label)
                    setSearchResults([])
                  }}
                >
                  <MapPinned size={14} />
                  <span>{result.label}</span>
                </button>
              ))}
            </div>
          )}

          <div className="map-import-selection-panel">
            <div className="map-import-section-title">Selection</div>
            {selectedFootprint ? (
              <>
                <div className="map-import-metrics">
                  <div className="map-import-metric">
                    <span>Area</span>
                    <strong>{selectedFootprint.areaSqFt.toLocaleString()} sq ft</strong>
                  </div>
                  <div className="map-import-metric">
                    <span>Source pieces</span>
                    <strong>{selectedFootprint.sourceFeatureCount}</strong>
                  </div>
                </div>
                <div className="map-import-chip-row">
                  <span className="map-import-chip"><MoveDiagonal2 size={12} /> Auto-aligned</span>
                  <span className="map-import-chip"><Building2 size={12} /> Imported as one footprint</span>
                </div>
                {selectedFootprint.hasInteriorHoles && (
                  <div className="map-import-warning">
                    Courtyard openings are simplified right now, so the imported mass uses the clean outer footprint.
                  </div>
                )}
              </>
            ) : (
              <div className="map-import-empty">
                <Building2 size={16} />
                <span>No footprint selected yet.</span>
              </div>
            )}
          </div>

          <div className="map-import-field">
            <label htmlFor="map-import-height">Imported height (ft)</label>
            <input
              id="map-import-height"
              className="map-import-input"
              type="number"
              min="1"
              step="1"
              value={heightFt}
              onChange={event => setHeightFt(event.target.value)}
            />
          </div>

          <div className="map-import-status" aria-live="polite">
            {statusMessage}
          </div>

          <div className="map-import-actions">
            <button type="button" className="map-import-button map-import-button-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="map-import-button map-import-button-primary"
              onClick={handleImport}
              disabled={!canImport}
            >
              Insert Shape
            </button>
          </div>
        </aside>

        <div className="map-import-map-shell">
          {!token && (
            <div className="map-import-map-placeholder">
              Add `VITE_MAPBOX_TOKEN` to use map import.
            </div>
          )}
          <div ref={containerRef} className="map-import-map" />
          {!mapReady && token && (
            <div className="map-import-map-loading">
              <Loader2 size={18} className="spin" />
              <span>Loading map…</span>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
