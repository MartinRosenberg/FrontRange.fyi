import maplibregl from 'maplibre-gl'
import type { LngLatBoundsLike, Map as MapLibreMap } from 'maplibre-gl'
import { createBasemapMap, watchThemeChanges } from './basemap'
import { boundariesFor, boundaryFor, officialPartsFor, type BoundaryFeature } from './boundaries'
import { BADGE_POPUP_OFFSET, bindRowHover, createMapPopup, settlePopup } from './map-shared'
import { createBadge, spotPopupHtml, stackBadges } from './map-badges'
import { bindLegendCollapse, bindLegendToggles } from './map-legend'
import type { MapSpot } from '../lib/spots'

const BOUNDARY_SOURCE_ID = 'neighborhood-boundary'
const BOUNDARY_FILL_LAYER_ID = 'neighborhood-boundary-fill'
const BOUNDARY_OUTLINE_LAYER_ID = 'neighborhood-boundary-outline'
const PARTS_SOURCE_ID = 'neighborhood-parts'
const PARTS_LINE_LAYER_ID = 'neighborhood-parts-line'
const PARTS_LABEL_LAYER_ID = 'neighborhood-parts-label'

function extendWithGeometry(coordinates: unknown, extend: (point: [number, number]) => void): void {
  if (!Array.isArray(coordinates)) {
    return
  }
  if (coordinates.length === 2 && typeof coordinates[0] === 'number') {
    extend(coordinates as [number, number])

    return
  }
  for (const nested of coordinates) {
    extendWithGeometry(nested, extend)
  }
}

function heroBounds(
  boundary: BoundaryFeature | undefined,
  spots: MapSpot[],
): LngLatBoundsLike | undefined {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  const extend = ([lng, lat]: [number, number]) => {
    west = Math.min(west, lng)
    south = Math.min(south, lat)
    east = Math.max(east, lng)
    north = Math.max(north, lat)
  }

  if (boundary) {
    extendWithGeometry(boundary.geometry.coordinates, extend)
  }
  for (const spot of spots) {
    extend(spot.coords)
  }

  if (!Number.isFinite(west)) {
    return undefined
  }

  return [
    [west, south],
    [east, north],
  ]
}

function readBoundaryColor(token: string): string {
  const styles = getComputedStyle(document.documentElement)

  return styles.getPropertyValue(token).trim() || '#c70f2e'
}

function applyPartsLayers(map: MapLibreMap, parts: BoundaryFeature[], color: string): void {
  const halo = readBoundaryColor('--color-background')

  if (map.getLayer(PARTS_LINE_LAYER_ID)) {
    map.setPaintProperty(PARTS_LINE_LAYER_ID, 'line-color', color)
    map.setPaintProperty(PARTS_LABEL_LAYER_ID, 'text-color', color)
    map.setPaintProperty(PARTS_LABEL_LAYER_ID, 'text-halo-color', halo)

    return
  }

  map.addSource(PARTS_SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: parts } as never,
  })

  map.addLayer({
    id: PARTS_LINE_LAYER_ID,
    type: 'line',
    source: PARTS_SOURCE_ID,
    paint: {
      'line-color': color,
      'line-width': 1.25,
      'line-opacity': 0.7,
      'line-dasharray': [2, 2],
    },
  })

  map.addLayer({
    id: PARTS_LABEL_LAYER_ID,
    type: 'symbol',
    source: PARTS_SOURCE_ID,
    layout: {
      'text-field': ['get', 'NHD_NAME'],
      'text-font': ['Noto Sans Medium'],
      'text-size': 11,
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.08,
      'text-max-width': 8,
    },
    paint: { 'text-color': color, 'text-halo-color': halo, 'text-halo-width': 1.5 },
  })
}

function applyBoundaryLayers(
  map: MapLibreMap,
  boundary: BoundaryFeature,
  parts: BoundaryFeature[],
  token: string,
): void {
  const color = readBoundaryColor(token)

  if (map.getLayer(BOUNDARY_FILL_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_FILL_LAYER_ID, 'fill-color', color)
    map.setPaintProperty(BOUNDARY_OUTLINE_LAYER_ID, 'line-color', color)
  } else {
    map.addSource(BOUNDARY_SOURCE_ID, { type: 'geojson', data: boundary as never })

    map.addLayer({
      id: BOUNDARY_FILL_LAYER_ID,
      type: 'fill',
      source: BOUNDARY_SOURCE_ID,
      paint: { 'fill-color': color, 'fill-opacity': 0.08 },
    })

    map.addLayer({
      id: BOUNDARY_OUTLINE_LAYER_ID,
      type: 'line',
      source: BOUNDARY_SOURCE_ID,
      paint: { 'line-color': color, 'line-width': 2.5, 'line-opacity': 0.85 },
    })
  }

  if (parts.length > 0) {
    applyPartsLayers(map, parts, color)
  }
}

function addSpotMarkers(
  map: MapLibreMap,
  spots: MapSpot[],
  openPopup: (spot: MapSpot, badge: HTMLElement) => void,
): Map<string, HTMLElement> {
  const offsets = stackBadges(spots)
  const badgeByTitle = new Map<string, HTMLElement>()

  for (const spot of spots) {
    const element = createBadge(spot, openPopup)

    new maplibregl.Marker({ element, anchor: 'center', offset: offsets.get(spot) ?? [0, 0] })
      .setLngLat(spot.coords)
      .addTo(map)
    badgeByTitle.set(spot.title, element)
  }

  return badgeByTitle
}

function bindCardHover(badgeByTitle: Map<string, HTMLElement>): void {
  const cards = document.querySelectorAll<HTMLElement>('[data-map-spot]')
  bindRowHover(cards, {
    enter: (card) => badgeByTitle.get(card.dataset.mapSpot ?? '')?.classList.add('is-hovered'),
    leave: (card) => badgeByTitle.get(card.dataset.mapSpot ?? '')?.classList.remove('is-hovered'),
  })
}

function readPayload(root: HTMLElement, selector: string): unknown {
  const holder = root.parentElement?.querySelector(selector)
  if (!holder?.textContent) {
    return undefined
  }

  try {
    return JSON.parse(holder.textContent)
  } catch {
    return undefined
  }
}

function readSpots(root: HTMLElement): MapSpot[] {
  const parsed = readPayload(root, 'script[data-map-pane-spots]')

  return Array.isArray(parsed) ? (parsed as MapSpot[]) : []
}

function readBoundary(root: HTMLElement): BoundaryFeature | undefined {
  return readPayload(root, 'script[data-map-pane-boundary]') as BoundaryFeature | undefined
}

export function initMapPane(): void {
  const root = document.querySelector<HTMLElement>('[data-map-pane]')
  if (!root) {
    return
  }

  const slug = root.dataset.slug ?? ''
  const boundaryToken = root.dataset.boundaryToken ?? '--color-map-accent'
  const spots = readSpots(root)
  const fallbackCoords = (root.dataset.coords ?? '').split(',').map(Number)

  const map = createBasemapMap(root, {
    minZoom: 10,
    maxZoom: 16,
    attributionControl: { compact: true },
    attributionCollapsed: true,
  })

  const popup = createMapPopup(BADGE_POPUP_OFFSET)

  let selectedBadge: HTMLElement | null = null
  popup.on('close', () => {
    selectedBadge?.classList.remove('is-selected')
    selectedBadge = null
  })

  const openSpotPopup = (spot: MapSpot, badge: HTMLElement): void => {
    popup.remove()
    selectedBadge = badge
    badge.classList.add('is-selected')
    popup.setLngLat(spot.coords).setHTML(spotPopupHtml(spot)).addTo(map)
    settlePopup(map, popup)
  }

  map.on('click', () => popup.remove())

  const legend = root.querySelector<HTMLElement>('[data-map-legend]')
  if (legend) {
    bindLegendCollapse(legend)
    bindLegendToggles(legend, (changes) => {
      for (const { key, showing } of changes) {
        for (const badge of root.querySelectorAll<HTMLElement>(
          `.map-badge[data-category="${key}"]`,
        )) {
          badge.hidden = !showing
        }
        if (!showing && selectedBadge?.dataset.category === key) {
          popup.remove()
        }
      }
    })
  }

  const frameView = (bounds: LngLatBoundsLike | undefined): void => {
    if (bounds) {
      const camera = map.cameraForBounds(bounds, { padding: 48 })
      if (camera) {
        map.jumpTo({ center: camera.center, zoom: (camera.zoom ?? 13) - 0.15 })
      }
    } else if (fallbackCoords.length === 2 && fallbackCoords.every(Number.isFinite)) {
      map.jumpTo({ center: [fallbackCoords[1], fallbackCoords[0]], zoom: 12.5 })
    }
  }

  const drawnBoundary = readBoundary(root)
  const boundaryPromise = drawnBoundary ? Promise.resolve(drawnBoundary) : boundaryFor(slug)
  void boundaryPromise.then((boundary) => {
    frameView(heroBounds(boundary, spots))
  })

  const partSlugs = (root.dataset.partSlugs ?? '').split(' ').filter(Boolean)
  const partsPromise = partSlugs.length > 0 ? boundariesFor(partSlugs) : officialPartsFor(slug)

  map.on('load', async () => {
    const [boundary, parts] = await Promise.all([boundaryPromise, partsPromise])
    if (boundary) {
      applyBoundaryLayers(map, boundary, parts, boundaryToken)
    }

    watchThemeChanges(map, () => {
      if (boundary) {
        applyBoundaryLayers(map, boundary, parts, boundaryToken)
      }
    })
  })

  bindCardHover(addSpotMarkers(map, spots, openSpotPopup))
}
