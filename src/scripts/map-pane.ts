import maplibregl from 'maplibre-gl'
import type { LngLatBoundsLike, Map as MapLibreMap } from 'maplibre-gl'
import { createBasemapMap, watchThemeChanges } from './basemap'
import { boundaryFor, type BoundaryFeature } from './boundaries'
import { buildPopupHtml } from './popup'
import { BADGE_POPUP_OFFSET, bindRowHover, createMapPopup, settlePopup } from './map-shared'
import type { MapSpot } from '../lib/spots'
import { metersBetween } from '../lib/geo'

const BOUNDARY_SOURCE_ID = 'neighborhood-boundary'
const BOUNDARY_FILL_LAYER_ID = 'neighborhood-boundary-fill'
const BOUNDARY_OUTLINE_LAYER_ID = 'neighborhood-boundary-outline'
const STACKED_BADGE_RADIUS = 22
const STACKED_BADGE_DISTANCE_METERS = 45

export function stackBadges(spots: MapSpot[]): Map<MapSpot, [number, number]> {
  const stacks: MapSpot[][] = []
  for (const spot of spots) {
    const stack = stacks.find(
      (candidate) =>
        metersBetween(candidate[0].coords, spot.coords) <= STACKED_BADGE_DISTANCE_METERS,
    )
    if (stack) {
      stack.push(spot)
    } else {
      stacks.push([spot])
    }
  }

  const offsets = new Map<MapSpot, [number, number]>()
  for (const stack of stacks) {
    stack.forEach((spot, index) => {
      if (stack.length <= 1) {
        offsets.set(spot, [0, 0])

        return
      }
      const angle = (Math.PI * 2 * index) / stack.length
      offsets.set(spot, [
        Math.cos(angle) * STACKED_BADGE_RADIUS,
        Math.sin(angle) * STACKED_BADGE_RADIUS,
      ])
    })
  }

  return offsets
}

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

function applyBoundaryLayers(map: MapLibreMap, boundary: BoundaryFeature, token: string): void {
  const color = readBoundaryColor(token)

  if (map.getLayer(BOUNDARY_FILL_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_FILL_LAYER_ID, 'fill-color', color)
    map.setPaintProperty(BOUNDARY_OUTLINE_LAYER_ID, 'line-color', color)

    return
  }

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

export function legendIconFor(root: HTMLElement, category: string): Node | undefined {
  const icon = root.querySelector(`[data-map-legend] [data-legend-category="${category}"] .icon`)

  return icon?.cloneNode(true)
}

export function createBadge(
  root: HTMLElement,
  spot: MapSpot,
  onClick: (spot: MapSpot, badge: HTMLElement) => void,
): HTMLElement {
  const element = spot.url ? document.createElement('a') : document.createElement('button')
  element.className = 'map-badge'
  element.dataset.category = spot.category
  element.setAttribute('aria-label', spot.title)
  if (element instanceof HTMLAnchorElement && spot.url) {
    element.href = spot.url
  }
  if (element instanceof HTMLButtonElement) {
    element.type = 'button'
  }

  const body = document.createElement('span')
  body.className = 'map-badge-body'
  const icon = legendIconFor(root, spot.category)
  if (icon) {
    body.append(icon)
  }
  element.append(body)

  element.addEventListener('click', (clickEvent) => {
    clickEvent.preventDefault()
    clickEvent.stopPropagation()
    onClick(spot, element)
  })

  return element
}

export function spotPopupHtml(spot: MapSpot): string {
  return buildPopupHtml({
    title: spot.title,
    link: spot.url,
    chips: spot.meta ? [{ label: spot.meta }] : [],
    verdict: spot.verdict,
    showRating: spot.category === 'food',
    excerpt: spot.tagline ?? '',
    addressLines: spot.addressLines ?? [],
    directionsHref: spot.directionsHref,
    websiteHref: spot.websiteHref,
    photo: spot.photo ?? '',
    category: spot.category,
  })
}

function addSpotMarkers(
  map: MapLibreMap,
  root: HTMLElement,
  spots: MapSpot[],
  openPopup: (spot: MapSpot, badge: HTMLElement) => void,
): Map<string, HTMLElement> {
  const offsets = stackBadges(spots)
  const badgeByTitle = new Map<string, HTMLElement>()

  for (const spot of spots) {
    const element = createBadge(root, spot, openPopup)

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

export function activeLegendCategories(root: HTMLElement): Set<string> {
  const active = new Set<string>()
  for (const item of root.querySelectorAll<HTMLButtonElement>(
    '[data-map-legend] [data-legend-category]',
  )) {
    if (item.getAttribute('aria-pressed') !== 'false') {
      active.add(item.dataset.legendCategory ?? '')
    }
  }

  return active
}

function legendItems(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('[data-map-legend] [data-legend-category]')]
}

function setLegendPressed(item: HTMLButtonElement, showing: boolean): void {
  item.setAttribute('aria-pressed', String(showing))
  const row = item.closest<HTMLElement>('.map-legend-row')
  if (row) {
    row.dataset.pressed = String(showing)
  }
}

export function bindLegendToggles(
  root: HTMLElement,
  onToggle: (category: string, showing: boolean) => void,
): void {
  const items = legendItems(root)
  const itemFor = (category: string) =>
    items.find((item) => item.dataset.legendCategory === category)

  const toggle = (item: HTMLButtonElement) => {
    const showing = item.getAttribute('aria-pressed') === 'false'
    setLegendPressed(item, showing)
    updateLegendShown(root)
    onToggle(item.dataset.legendCategory ?? '', showing)
  }

  const only = (item: HTMLButtonElement) => {
    const active = activeLegendCategories(root)
    const category = item.dataset.legendCategory ?? ''
    const alreadyAlone = active.size === 1 && active.has(category)
    for (const other of items) {
      const otherCategory = other.dataset.legendCategory ?? ''
      const showing = alreadyAlone || otherCategory === category
      if ((other.getAttribute('aria-pressed') !== 'false') !== showing) {
        setLegendPressed(other, showing)
        onToggle(otherCategory, showing)
      }
    }
    updateLegendShown(root)
  }

  for (const item of items) {
    item.addEventListener('click', () => toggle(item))
  }
  for (const check of root.querySelectorAll<HTMLButtonElement>(
    '[data-map-legend] [data-legend-check]',
  )) {
    check.addEventListener('click', () => {
      const item = itemFor(check.dataset.legendCheck ?? '')
      if (item) {
        toggle(item)
      }
    })
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    '[data-map-legend] [data-legend-only]',
  )) {
    button.addEventListener('click', () => {
      const item = itemFor(button.dataset.legendOnly ?? '')
      if (item) {
        only(item)
      }
    })
  }
}

const LEGEND_DOT_LIMIT = 4

function updateLegendShown(root: HTMLElement): void {
  const items = [...root.querySelectorAll<HTMLElement>('[data-map-legend] [data-legend-category]')]
  const active = activeLegendCategories(root)
  for (const shown of root.querySelectorAll<HTMLElement>('[data-legend-shown]')) {
    const suffix = shown.dataset.legendShown === 'short' ? '' : ' shown'
    shown.textContent = `${active.size} of ${items.length}${suffix}`
  }
  const dots = root.querySelector<HTMLElement>('[data-legend-dots]')
  if (dots) {
    dots.replaceChildren()
    for (const item of items
      .filter((candidate) => active.has(candidate.dataset.legendCategory ?? ''))
      .slice(0, LEGEND_DOT_LIMIT)) {
      const swatch = item.querySelector<HTMLElement>('.map-legend-swatch')
      const dot = document.createElement('span')
      dot.className = 'map-legend-dot'
      dot.style.setProperty('--badge-color', swatch?.style.getPropertyValue('--badge-color') ?? '')
      dots.append(dot)
    }
  }
}

export function bindLegendCollapse(root: HTMLElement): void {
  const legend = root.querySelector<HTMLElement>('[data-map-legend]')
  const toggle = legend?.querySelector<HTMLButtonElement>('[data-legend-toggle]')
  if (!legend || !toggle) {
    return
  }
  const setExpanded = (expanded: boolean) => {
    toggle.setAttribute('aria-expanded', String(expanded))
    legend.dataset.expanded = String(expanded)
  }
  toggle.addEventListener('click', () => {
    setExpanded(toggle.getAttribute('aria-expanded') !== 'true')
  })
  document.addEventListener('pointerdown', (event) => {
    if (!legend.contains(event.target as Node)) {
      setExpanded(false)
    }
  })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setExpanded(false)
    }
  })
  updateLegendShown(root)
}

function readSpots(root: HTMLElement): MapSpot[] {
  const holder = root.parentElement?.querySelector('script[data-map-pane-spots]')
  if (!holder?.textContent) {
    return []
  }

  try {
    const parsed = JSON.parse(holder.textContent) as MapSpot[]

    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
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
  })

  const popup = createMapPopup(BADGE_POPUP_OFFSET)

  let selectedBadge: HTMLElement | null = null
  popup.on('close', () => {
    selectedBadge?.classList.remove('is-selected')
    selectedBadge = null
  })

  const openSpotPopup = (spot: MapSpot, badge: HTMLElement): void => {
    selectedBadge?.classList.remove('is-selected')
    selectedBadge = badge
    badge.classList.add('is-selected')
    popup.setLngLat(spot.coords).setHTML(spotPopupHtml(spot)).addTo(map)
    settlePopup(map, popup)
  }

  map.on('click', () => popup.remove())

  bindLegendCollapse(root)
  bindLegendToggles(root, (category, showing) => {
    for (const badge of root.querySelectorAll<HTMLElement>(
      `.map-badge[data-category="${category}"]`,
    )) {
      badge.hidden = !showing
    }
    if (!showing && selectedBadge?.dataset.category === category) {
      popup.remove()
    }
  })

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

  const boundaryPromise = boundaryFor(slug)
  void boundaryPromise.then((boundary) => {
    frameView(heroBounds(boundary, spots))
  })

  map.on('load', async () => {
    const boundary = await boundaryPromise
    if (boundary) {
      applyBoundaryLayers(map, boundary, boundaryToken)
    }

    watchThemeChanges(map, () => {
      if (boundary) {
        applyBoundaryLayers(map, boundary, boundaryToken)
      }
    })
  })

  bindCardHover(addSpotMarkers(map, root, spots, openSpotPopup))
}
