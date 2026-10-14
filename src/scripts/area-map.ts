import maplibregl from 'maplibre-gl'
import type { ExpressionSpecification } from 'maplibre-gl'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import { createBasemapMap, watchThemeChanges } from './basemap'
import { buildPopupHtml, escapeHtml, type PopupChip } from './popup'
import {
  BADGE_POPUP_OFFSET,
  PIN_POPUP_OFFSET,
  bindRowHover,
  createMapPopup,
  frameCityView,
  settlePopup,
} from './map-shared'
import { neighborhoodRecords as neighborhoods } from '../lib/neighborhood-data'
import type { MapSpot } from '../lib/spots'
import {
  activeLegendCategories,
  bindLegendCollapse,
  bindLegendToggles,
  createBadge,
  legendIconFor,
  spotPopupHtml,
  stackBadges,
} from './map-pane'
import Supercluster from 'supercluster'
import { NEIGHBORHOOD_BOUNDARIES_FILE } from '../../site.config.mjs'

const CITY_VIEW_ZOOM_IN = 0.5
const CITY_VIEW_RIVER_MARGIN = 0.15

const bySlug = new Map(neighborhoods.map((neighborhood) => [neighborhood.slug, neighborhood]))
const byNumber = new Map(
  neighborhoods.flatMap((neighborhood) => {
    if (neighborhood.mergedInto) {
      const parent = bySlug.get(neighborhood.mergedInto)

      return parent ? [[neighborhood.number, parent] as const] : []
    }

    return 'ignored' in neighborhood ? [] : [[neighborhood.number, neighborhood] as const]
  }),
)

function readAreaSpots(element: HTMLElement): MapSpot[] {
  const holder = element.parentElement?.querySelector('script[data-area-map-spots]')
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

function groupByCategory(spots: MapSpot[]): Map<string, MapSpot[]> {
  const groups = new Map<string, MapSpot[]>()
  for (const spot of spots) {
    const group = groups.get(spot.category) ?? []
    group.push(spot)
    groups.set(spot.category, group)
  }

  return groups
}

function forEachPosition(geometry: Geometry, fn: (position: Position) => void): void {
  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) {
      for (const position of ring) {
        fn(position)
      }
    }
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        for (const position of ring) {
          fn(position)
        }
      }
    }
  }
}

export async function initAreaMap(selector = '[data-area-map]'): Promise<void> {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) {
    return
  }

  type RegionKey = 'north' | 'central' | 'south' | 'county' | 'park'

  function readRegionColors(): Record<RegionKey, string> {
    const styles = getComputedStyle(document.documentElement)
    const readColor = (token: string, fallback: string) =>
      styles.getPropertyValue(token).trim() || fallback

    return {
      north: readColor('--color-map-north', '#b8860b'),
      central: readColor('--color-map-central', '#c0392b'),
      south: readColor('--color-map-south', '#6a47a6'),
      county: readColor('--color-map-county', '#2766ad'),
      park: readColor('--color-map-park', '#2e7d4a'),
    }
  }

  function regionKeyForArea(area: { group?: string; type?: string } | undefined): RegionKey {
    if (area?.type === 'park') {
      return 'park'
    }
    if (area?.group === 'St. Louis County') {
      return 'county'
    }
    if (area?.group === 'North City') {
      return 'north'
    }
    if (area?.group === 'South City') {
      return 'south'
    }

    return 'central'
  }

  let regionColors = readRegionColors()
  function regionColorExpression(): ExpressionSpecification {
    return [
      'match',
      ['get', 'region'],
      'north',
      regionColors.north,
      'central',
      regionColors.central,
      'south',
      regionColors.south,
      'county',
      regionColors.county,
      'park',
      regionColors.park,
      regionColors.central,
    ]
  }

  let geojson: FeatureCollection
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${NEIGHBORHOOD_BOUNDARIES_FILE}`)
    if (!response.ok) {
      return
    }
    geojson = await response.json()
  } catch {
    return
  }

  const rows = [...document.querySelectorAll<HTMLElement>('[data-section]')]
  const spots = readAreaSpots(element)
  function rowFor(slug: string): HTMLElement | undefined {
    return rows.find((row) => row.dataset.section === slug)
  }

  const SOURCE_ID = 'neighborhoods'
  const FILL_LAYER = 'neighborhoods-fill'
  const LINE_LAYER = 'neighborhoods-line'
  const slugToFeatureIds = new Map<string, number[]>()
  const centerBySlug = new Map<string, [number, number]>()
  const boundsBySlug = new Map<string, maplibregl.LngLatBounds>()
  const nameBySlug = new Map<string, string>()
  const regionKeyBySlug = new Map<string, RegionKey>()

  geojson.features.forEach((feature: Feature, index: number) => {
    feature.id = index
    const number = Number(feature.properties?.NHD_NUM)
    const entry = byNumber.get(number)
    const name = entry?.name ?? String(feature.properties?.NHD_NAME ?? 'Neighborhood')
    const slug = entry?.slug ?? ''
    const region = regionKeyForArea(entry)
    feature.properties = { ...feature.properties, region, slug, name }

    const featureBounds = new maplibregl.LngLatBounds()
    forEachPosition(feature.geometry, (position) => {
      featureBounds.extend([position[0], position[1]])
    })

    if (slug) {
      slugToFeatureIds.set(slug, [...(slugToFeatureIds.get(slug) ?? []), index])
      centerBySlug.set(slug, featureBounds.getCenter().toArray() as [number, number])
      boundsBySlug.set(slug, featureBounds)
      nameBySlug.set(slug, name)
      regionKeyBySlug.set(slug, region)
    }
  })

  const map = createBasemapMap(element, { minZoom: 10, maxZoom: 16 })

  const canHover = window.matchMedia('(hover: hover)').matches

  let selectedSlug: string | null = null
  let hoveredId: number | null = null

  function setSlugState(slug: string, state: { selected?: boolean; hover?: boolean }): void {
    for (const id of slugToFeatureIds.get(slug) ?? []) {
      map.setFeatureState({ source: SOURCE_ID, id }, state)
    }
  }

  function activate(slug: string): void {
    if (selectedSlug === slug) {
      return
    }
    if (selectedSlug) {
      setSlugState(selectedSlug, { selected: false })
      rowFor(selectedSlug)?.classList.remove('is-active')
    }

    selectedSlug = slug
    setSlugState(slug, { selected: true })
    rowFor(slug)?.classList.add('is-active')
  }

  function deactivate(slug: string): void {
    if (selectedSlug !== slug) {
      return
    }
    setSlugState(slug, { selected: false })
    rowFor(slug)?.classList.remove('is-active')
    selectedSlug = null
  }

  function popupHtmlFor(slug: string): string {
    const name = nameBySlug.get(slug) ?? ''
    if (!slug) {
      return `<h2>${escapeHtml(name)}</h2>`
    }
    const row = rowFor(slug)
    const area = row?.dataset.area ?? ''
    const chips: PopupChip[] = []
    if (row?.dataset.type === 'park') {
      chips.push({ label: 'Park' })
    }
    if (area) {
      chips.push({ label: area })
    }
    const link = `${import.meta.env.BASE_URL}neighborhoods/${slug}/`

    return buildPopupHtml({
      title: name,
      link,
      photo: row?.dataset.photo ?? '',
      chips,
      tagline: row?.dataset.tagline ?? '',
      excerpt: row?.dataset.excerpt ?? '',
    })
  }

  const popup = createMapPopup(PIN_POPUP_OFFSET)
  popup.on('close', () => {
    if (selectedSlug) {
      deactivate(selectedSlug)
    }
  })

  function openPopupFor(slug: string, deferKeepInView = false): void {
    const center = centerBySlug.get(slug)
    if (!center) {
      return
    }
    popup.setLngLat(center).setHTML(popupHtmlFor(slug)).addTo(map)
    activate(slug)
    if (deferKeepInView) {
      map.once('moveend', () => settlePopup(map, popup))
    } else {
      settlePopup(map, popup)
    }
  }

  function addBoundaryLayers(): void {
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: 'geojson', data: geojson })
    }
    if (!map.getLayer(FILL_LAYER)) {
      map.addLayer({
        id: FILL_LAYER,
        type: 'fill',
        source: SOURCE_ID,
        paint: {
          'fill-color': regionColorExpression(),
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            0.4,
            ['boolean', ['feature-state', 'hover'], false],
            0.3,
            0.1,
          ],
        },
      })
    }
    if (!map.getLayer(LINE_LAYER)) {
      map.addLayer({
        id: LINE_LAYER,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': regionColorExpression(),
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            4,
            ['boolean', ['feature-state', 'hover'], false],
            3,
            2,
          ],
        },
      })
    }
    if (selectedSlug) {
      setSlugState(selectedSlug, { selected: true })
    }
  }

  function bindRowHighlights(): void {
    bindRowHover(rows, {
      enter: (row) => {
        const slug = row.dataset.section
        if (!slug) {
          return
        }
        if (slug !== selectedSlug) {
          setSlugState(slug, { hover: true })
        }
      },
      leave: (row) => {
        const slug = row.dataset.section
        if (!slug) {
          return
        }
        setSlugState(slug, { hover: false })
      },
    })
  }

  function addBoundaryInteractions(): void {
    map.on('mousemove', FILL_LAYER, (event) => {
      if (!canHover) {
        return
      }
      const feature = event.features?.[0]
      if (feature?.id === undefined) {
        return
      }
      const id = feature.id as number
      if (hoveredId !== null && hoveredId !== id) {
        map.setFeatureState({ source: SOURCE_ID, id: hoveredId }, { hover: false })
      }
      hoveredId = id
      const slug = String(feature.properties?.slug ?? '')
      if (slug !== selectedSlug) {
        map.setFeatureState({ source: SOURCE_ID, id }, { hover: true })
      }
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', FILL_LAYER, () => {
      if (hoveredId !== null) {
        map.setFeatureState({ source: SOURCE_ID, id: hoveredId }, { hover: false })
      }
      hoveredId = null
      map.getCanvas().style.cursor = ''
    })
    map.on('click', (event) => {
      const hits = map.queryRenderedFeatures(event.point, { layers: [FILL_LAYER] })
      const slug = hits.length ? String(hits[0].properties?.slug ?? '') : ''
      if (slug) {
        openPopupFor(slug)
      } else {
        popup.remove()
      }
      badgePopup.remove()
    })
  }

  const badgePopup = createMapPopup(BADGE_POPUP_OFFSET)
  let selectedBadge: HTMLElement | null = null
  badgePopup.on('close', () => {
    selectedBadge?.classList.remove('is-selected')
    selectedBadge = null
  })

  function openBadgePopup(spot: MapSpot, badge: HTMLElement): void {
    popup.remove()
    selectedBadge?.classList.remove('is-selected')
    selectedBadge = badge
    badge.classList.add('is-selected')
    badgePopup.setLngLat(spot.coords).setHTML(spotPopupHtml(spot)).addTo(map)
    settlePopup(map, badgePopup)
  }

  type LeafProps = { spotIndex: number }
  const indexByCategory = new Map<string, Supercluster<LeafProps>>()
  for (const [category, categorySpots] of groupByCategory(spots)) {
    const features: Supercluster.PointFeature<LeafProps>[] = categorySpots.map((spot) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: spot.coords },
      properties: { spotIndex: spots.indexOf(spot) },
    }))
    indexByCategory.set(
      category,
      new Supercluster<LeafProps>({ radius: 22, minPoints: 2, minZoom: 10, maxZoom: 15 }).load(
        features,
      ),
    )
  }

  let badgeMarkers: maplibregl.Marker[] = []

  function createClusterBadge(
    category: string,
    count: number,
    clusterId: number,
    center: [number, number],
  ): HTMLElement {
    const badge = document.createElement('button')
    badge.type = 'button'
    badge.className = 'map-badge map-badge--cluster'
    badge.dataset.category = category
    badge.setAttribute('aria-label', `${count} places, zoom in`)
    const body = document.createElement('span')
    body.className = 'map-badge-body'
    const icon = legendIconFor(element, category)
    if (icon) {
      body.append(icon)
    }
    const label = document.createElement('span')
    label.className = 'map-badge-count'
    label.textContent = String(count)
    body.append(label)
    badge.append(body)
    badge.addEventListener('click', (clickEvent) => {
      clickEvent.stopPropagation()
      const index = indexByCategory.get(category)
      const expansionZoom = index?.getClusterExpansionZoom(clusterId) ?? map.getZoom() + 2
      const target = Math.min(
        map.getMaxZoom(),
        Math.max(expansionZoom, Math.floor(map.getZoom()) + 1),
      )
      map.easeTo({ center, zoom: target })
    })

    return badge
  }

  function renderBadges(): void {
    for (const marker of badgeMarkers) {
      marker.remove()
    }
    badgeMarkers = []
    const active = activeLegendCategories(element)
    const viewport = map.getBounds()
    const bbox: [number, number, number, number] = [
      viewport.getWest(),
      viewport.getSouth(),
      viewport.getEast(),
      viewport.getNorth(),
    ]
    const zoom = Math.floor(map.getZoom())
    const placed: { spot: MapSpot; element: HTMLElement }[] = []

    for (const [category, index] of indexByCategory) {
      if (!active.has(category)) {
        continue
      }
      for (const feature of index.getClusters(bbox, zoom)) {
        const center = feature.geometry.coordinates as [number, number]
        if (feature.properties && 'cluster' in feature.properties) {
          const clusterProperties = feature.properties as Supercluster.ClusterProperties
          const badge = createClusterBadge(
            category,
            clusterProperties.point_count,
            clusterProperties.cluster_id,
            center,
          )
          placed.push({
            spot: { title: '', category: category as MapSpot['category'], coords: center },
            element: badge,
          })
        } else {
          const spot = spots[(feature.properties as LeafProps).spotIndex]
          placed.push({ spot, element: createBadge(element, spot, openBadgePopup) })
        }
      }
    }

    const offsets = stackBadges(placed.map((entry) => entry.spot))
    for (const entry of placed) {
      if (
        selectedBadge &&
        entry.spot.title &&
        selectedBadge.getAttribute('aria-label') === entry.spot.title
      ) {
        entry.element.classList.add('is-selected')
        selectedBadge = entry.element
      }
      badgeMarkers.push(
        new maplibregl.Marker({
          element: entry.element,
          anchor: 'center',
          offset: offsets.get(entry.spot) ?? [0, 0],
        })
          .setLngLat(entry.spot.coords)
          .addTo(map),
      )
    }
  }

  const split = document.querySelector('[data-map-split]')

  function frameInitialView(): void {
    const initialSlug = location.hash.slice(1)
    if (initialSlug && slugToFeatureIds.has(initialSlug)) {
      activate(initialSlug)
      const selectedBounds = boundsBySlug.get(initialSlug)
      if (selectedBounds) {
        map.fitBounds(selectedBounds, { padding: 40, maxZoom: 13, animate: false })
      }
    } else {
      frameCityView(map, 40, true, CITY_VIEW_ZOOM_IN, CITY_VIEW_RIVER_MARGIN)
    }
  }

  let framed = false
  function frameWhenSized(): void {
    if (framed || element?.clientHeight === 0) {
      return
    }
    framed = true
    frameInitialView()
  }

  if (split) {
    const observer = new MutationObserver(() => {
      if (split.getAttribute('data-view') !== 'map') {
        return
      }
      map.resize()
      frameWhenSized()
    })
    observer.observe(split, { attributes: true, attributeFilter: ['data-view'] })
  }

  map.on('load', () => {
    addBoundaryLayers()
    addBoundaryInteractions()
    bindRowHighlights()
    renderBadges()
    map.on('moveend', renderBadges)
    bindLegendCollapse(element)
    bindLegendToggles(element, (category, showing) => {
      if (!showing && selectedBadge?.dataset.category === category) {
        badgePopup.remove()
      }
      renderBadges()
    })
    watchThemeChanges(map, () => {
      regionColors = readRegionColors()
      if (map.getLayer(FILL_LAYER)) {
        map.setPaintProperty(FILL_LAYER, 'fill-color', regionColorExpression())
      }
      if (map.getLayer(LINE_LAYER)) {
        map.setPaintProperty(LINE_LAYER, 'line-color', regionColorExpression())
      }
    })
    frameWhenSized()
  })
}
