import maplibregl from 'maplibre-gl'
import type { LngLatBoundsLike, Map as MapLibreMap } from 'maplibre-gl'
import { createBasemapMap, watchThemeChanges } from './basemap'
import { boundariesFor, type BoundaryFeature } from './boundaries'
import { optionalData } from '../lib/optional-data'
import { projectOntoLine } from '../lib/geo'

const corridorData = optionalData<{ corridors: unknown[] }>(
  import.meta.glob('../data/corridors.json', { eager: true, import: 'default' }),
  { corridors: [] },
)

const SOURCE_ID = 'corridor'
const LINE_LAYER_ID = 'corridor-line'
const ENDPOINTS_SOURCE_ID = 'corridor-endpoints'
const ENDPOINTS_LAYER_ID = 'corridor-endpoint-dots'
const LABELS_SOURCE_ID = 'corridor-labels'
const LABELS_LAYER_ID = 'corridor-label-text'

interface Corridor {
  id: string
  name: string
  label?: string
  street: string
  from: string
  to: string
  anchor: string
  neighborhoods: string[]
  line: number[][]
}

const corridors = new Map<string, Corridor>(
  (corridorData.corridors as Corridor[]).map((corridor) => [corridor.id, corridor]),
)

interface Spot {
  name: string
  category: string
  coords: number[]
  link?: string
}

function readSpotsByCorridor(): Record<string, Spot[]> {
  const holder = document.querySelector('script[data-corridor-spots]')
  if (!holder?.textContent) {
    return {}
  }

  try {
    return JSON.parse(holder.textContent) as Record<string, Spot[]>
  } catch {
    return {}
  }
}

const spotsByCorridor = readSpotsByCorridor()

function badgeIconFor(category: string): Node | undefined {
  const template = document.querySelector<HTMLTemplateElement>('template[data-badge-icons]')
  const icon = template?.content.querySelector(`[data-category="${category}"] .icon`)

  return icon?.cloneNode(true)
}

const SNAP_METERS = 75

function snapToLines(point: [number, number], group: Corridor[]): [number, number] {
  let best = point
  let bestDistance = Infinity
  for (const corridor of group) {
    const projection = projectOntoLine(point, corridor.line)
    if (projection.distance < bestDistance) {
      bestDistance = projection.distance
      best = projection.point
    }
  }

  return bestDistance <= SNAP_METERS ? best : point
}

function addSpotMarkers(map: MapLibreMap, group: Corridor[]): void {
  for (const corridor of group) {
    const spots = spotsByCorridor[corridor.id] ?? []
    if (spots.length === 0) {
      continue
    }
    for (const spot of spots) {
      const element = document.createElement(spot.link ? 'a' : 'span')
      element.className = 'corridor-spot map-badge'
      element.dataset.category = spot.category
      element.setAttribute('aria-label', spot.name)
      if (spot.link && element instanceof HTMLAnchorElement) {
        element.href = import.meta.env.BASE_URL.replace(/\/$/, '') + spot.link
      }

      const body = document.createElement('span')
      body.className = 'map-badge-body'
      const icon = badgeIconFor(spot.category)
      if (icon) {
        body.append(icon)
      }
      element.append(body)

      const name = document.createElement('span')
      name.className = 'corridor-spot-name'
      name.textContent = spot.name
      element.append(name)

      new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat(snapToLines(spot.coords as [number, number], [corridor]))
        .addTo(map)
    }
  }
}

function corridorsFor(element: HTMLElement): Corridor[] {
  const ids = (element.dataset.corridorMap ?? '').split(/\s+/).filter(Boolean)

  return ids.flatMap((id) => {
    const corridor = corridors.get(id)

    return corridor ? [corridor] : []
  })
}

function boundsOf(group: Corridor[]): LngLatBoundsLike {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  for (const corridor of group) {
    for (const [lng, lat] of corridor.line) {
      west = Math.min(west, lng)
      south = Math.min(south, lat)
      east = Math.max(east, lng)
      north = Math.max(north, lat)
    }
  }

  return [
    [west, south],
    [east, north],
  ]
}

function readCorridorColors(): { line: string; halo: string } {
  const styles = getComputedStyle(document.documentElement)
  const readColor = (token: string, fallback: string) =>
    styles.getPropertyValue(token).trim() || fallback

  return {
    line: readColor('--color-map-corridor', '#c0392b'),
    halo: readColor('--color-background', '#f3efe7'),
    label: readColor('--color-text', '#1b1a17'),
  }
}

function applyCorridorLayers(map: MapLibreMap, group: Corridor[]): void {
  const colors = readCorridorColors()
  const labeled = group.length > 1

  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: group.map((corridor) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: corridor.line },
        })),
      },
    })

    map.addSource(ENDPOINTS_SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: group.flatMap((corridor) =>
          [corridor.line[0], corridor.line[corridor.line.length - 1]].map((point) => ({
            type: 'Feature' as const,
            properties: {},
            geometry: { type: 'Point' as const, coordinates: point },
          })),
        ),
      },
    })

    if (labeled) {
      map.addSource(LABELS_SOURCE_ID, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: group.map((corridor) => ({
            type: 'Feature',
            properties: { label: corridor.label ?? corridor.name },
            geometry: {
              type: 'Point',
              coordinates: corridor.line[Math.floor(corridor.line.length / 2)],
            },
          })),
        },
      })
    }
  }

  if (map.getLayer(LINE_LAYER_ID)) {
    map.setPaintProperty(LINE_LAYER_ID, 'line-color', colors.line)
    map.setPaintProperty(ENDPOINTS_LAYER_ID, 'circle-color', colors.line)
    map.setPaintProperty(ENDPOINTS_LAYER_ID, 'circle-stroke-color', colors.halo)
    if (map.getLayer(LABELS_LAYER_ID)) {
      map.setPaintProperty(LABELS_LAYER_ID, 'text-color', colors.label)
      map.setPaintProperty(LABELS_LAYER_ID, 'text-halo-color', colors.halo)
    }

    return
  }

  map.addLayer({
    id: LINE_LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': colors.line, 'line-width': 4, 'line-opacity': 0.75 },
  })

  map.addLayer({
    id: ENDPOINTS_LAYER_ID,
    type: 'circle',
    source: ENDPOINTS_SOURCE_ID,
    paint: {
      'circle-radius': 4.5,
      'circle-color': colors.line,
      'circle-stroke-color': colors.halo,
      'circle-stroke-width': 1.5,
    },
  })

  if (labeled) {
    map.addLayer({
      id: LABELS_LAYER_ID,
      type: 'symbol',
      source: LABELS_SOURCE_ID,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Medium'],
        'text-size': 12,
        'text-anchor': 'bottom',
        'text-offset': [0, -0.6],
      },
      paint: { 'text-color': colors.label, 'text-halo-color': colors.halo, 'text-halo-width': 1.5 },
    })
  }
}

function appendSpotCaption(element: HTMLElement, group: Corridor[]): void {
  const spots = group.flatMap((corridor) => spotsByCorridor[corridor.id] ?? [])
  const figure = element.closest('figure')
  if (spots.length === 0 || !figure || figure.querySelector('.corridor-map-caption')) {
    return
  }

  const caption = document.createElement('figcaption')
  caption.className = 'corridor-map-caption'
  spots.forEach((spot, index) => {
    if (index > 0) {
      caption.append(' | ')
    }
    if (spot.link) {
      const anchor = document.createElement('a')
      anchor.href = import.meta.env.BASE_URL.replace(/\/$/, '') + spot.link
      anchor.textContent = spot.name
      caption.append(anchor)
    } else {
      caption.append(spot.name)
    }
  })
  figure.append(caption)
}

interface MountedMap {
  map: MapLibreMap
  disposeTheme: () => void
}

function figureBounds(group: Corridor[]): LngLatBoundsLike {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  const extend = ([lng, lat]: number[]) => {
    west = Math.min(west, lng)
    south = Math.min(south, lat)
    east = Math.max(east, lng)
    north = Math.max(north, lat)
  }

  for (const corridor of group) {
    corridor.line.forEach(extend)
    for (const spot of spotsByCorridor[corridor.id] ?? []) {
      extend(spot.coords)
    }
  }

  return [
    [west, south],
    [east, north],
  ]
}

function mountCorridorMap(element: HTMLElement, group: Corridor[]): MountedMap {
  const map = createBasemapMap(element, {
    interactive: false,
    attributionControl: { compact: true },
  })

  map.on('load', () => {
    applyCorridorLayers(map, group)
    const camera = map.cameraForBounds(figureBounds(group), { padding: 36 })
    if (camera) {
      map.jumpTo({ center: camera.center, zoom: (camera.zoom ?? 14) - 0.25 })
    }
  })

  addSpotMarkers(map, group)
  appendSpotCaption(element, group)

  const disposeTheme = watchThemeChanges(map, () => {
    applyCorridorLayers(map, group)
  })

  return { map, disposeTheme }
}

const OVERVIEW_BOUNDARIES_SOURCE_ID = 'corridor-overview-boundaries'
const OVERVIEW_FILL_LAYER_ID = 'corridor-overview-fill'
const OVERVIEW_OUTLINE_LAYER_ID = 'corridor-overview-outline'
const OVERVIEW_HIT_LAYER_ID = 'corridor-overview-hit'

function applyOverviewLayers(
  map: MapLibreMap,
  group: Corridor[],
  boundaries: BoundaryFeature[],
): void {
  const styles = getComputedStyle(document.documentElement)
  const readColor = (token: string, fallback: string) =>
    styles.getPropertyValue(token).trim() || fallback
  const lineColor = readColor('--color-map-corridor', '#c0392b')
  const polygonColor = readColor('--color-map-accent', '#6a47a6')
  const haloColor = readColor('--color-background', '#f3efe7')
  const labelColor = readColor('--color-text', '#1b1a17')

  if (!map.getSource(SOURCE_ID)) {
    map.addSource(OVERVIEW_BOUNDARIES_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: boundaries as never },
    })
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: group.map((corridor) => ({
          type: 'Feature',
          properties: { anchor: corridor.anchor },
          geometry: { type: 'LineString', coordinates: corridor.line },
        })),
      },
    })

    const labeledAnchors = new Set<string>()
    map.addSource(LABELS_SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: group.flatMap((corridor) => {
          if (labeledAnchors.has(corridor.anchor)) {
            return []
          }
          labeledAnchors.add(corridor.anchor)

          return [
            {
              type: 'Feature' as const,
              properties: { label: corridor.name },
              geometry: {
                type: 'Point' as const,
                coordinates: corridor.line[Math.floor(corridor.line.length / 2)],
              },
            },
          ]
        }),
      },
    })
  }

  if (map.getLayer(LINE_LAYER_ID)) {
    map.setPaintProperty(LINE_LAYER_ID, 'line-color', lineColor)
    map.setPaintProperty(OVERVIEW_FILL_LAYER_ID, 'fill-color', polygonColor)
    map.setPaintProperty(OVERVIEW_OUTLINE_LAYER_ID, 'line-color', polygonColor)
    map.setPaintProperty(LABELS_LAYER_ID, 'text-color', labelColor)
    map.setPaintProperty(LABELS_LAYER_ID, 'text-halo-color', haloColor)

    return
  }

  map.addLayer({
    id: OVERVIEW_FILL_LAYER_ID,
    type: 'fill',
    source: OVERVIEW_BOUNDARIES_SOURCE_ID,
    paint: { 'fill-color': polygonColor, 'fill-opacity': 0.08 },
  })

  map.addLayer({
    id: OVERVIEW_OUTLINE_LAYER_ID,
    type: 'line',
    source: OVERVIEW_BOUNDARIES_SOURCE_ID,
    paint: { 'line-color': polygonColor, 'line-width': 1, 'line-opacity': 0.5 },
  })

  map.addLayer({
    id: LINE_LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': lineColor, 'line-width': 3.5, 'line-opacity': 0.85 },
  })

  map.addLayer({
    id: OVERVIEW_HIT_LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    paint: { 'line-width': 16, 'line-opacity': 0 },
  })

  map.addLayer({
    id: LABELS_LAYER_ID,
    type: 'symbol',
    source: LABELS_SOURCE_ID,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Medium'],
      'text-size': 11,
      'text-anchor': 'bottom',
      'text-offset': [0, -0.4],
    },
    paint: { 'text-color': labelColor, 'text-halo-color': haloColor, 'text-halo-width': 1.5 },
  })
}

function mountOverviewMap(element: HTMLElement): MountedMap {
  const group = [...corridors.values()]
  const map = createBasemapMap(element, {
    cooperativeGestures: true,
    attributionControl: { compact: true },
  })

  map.on('load', async () => {
    const boundaries = await boundariesFor(
      group.flatMap((corridor) => corridor.neighborhoods ?? []),
    )
    applyOverviewLayers(map, group, boundaries)
    map.fitBounds(boundsOf(group), { padding: 28, duration: 0 })
  })

  map.on('click', OVERVIEW_HIT_LAYER_ID, (event) => {
    const anchor = event.features?.[0]?.properties?.anchor
    if (typeof anchor === 'string' && anchor.length > 0) {
      window.location.hash = anchor
    }
  })
  map.on('mouseenter', OVERVIEW_HIT_LAYER_ID, () => {
    map.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseleave', OVERVIEW_HIT_LAYER_ID, () => {
    map.getCanvas().style.cursor = ''
  })

  const disposeTheme = watchThemeChanges(map, () => applyOverviewLayers(map, group, []))

  return { map, disposeTheme }
}

export function initCorridorMaps(selector = '[data-corridor-map], [data-corridor-overview]'): void {
  const elements = document.querySelectorAll<HTMLElement>(selector)
  if (elements.length === 0) {
    return
  }

  const mounted = new Map<Element, MountedMap>()

  const mount = (element: HTMLElement) => {
    if (element.hasAttribute('data-corridor-overview')) {
      mounted.set(element, mountOverviewMap(element))

      return
    }
    const group = corridorsFor(element)
    if (group.length > 0) {
      mounted.set(element, mountCorridorMap(element, group))
    }
  }

  const mountObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !mounted.has(entry.target)) {
          mount(entry.target as HTMLElement)
        }
      }
    },
    { rootMargin: '600px 0px' },
  )

  const teardownObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const state = mounted.get(entry.target)
        if (!entry.isIntersecting && state) {
          state.disposeTheme()
          state.map.remove()
          mounted.delete(entry.target)
        }
      }
    },
    { rootMargin: '1800px 0px' },
  )

  for (const element of elements) {
    mountObserver.observe(element)
    teardownObserver.observe(element)
  }
}
