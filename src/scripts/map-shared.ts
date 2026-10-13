import maplibregl from 'maplibre-gl'
import { CITY_BOUNDS as CONFIGURED_CITY_BOUNDS } from '../../site.config.mjs'

interface PannableMap {
  getContainer(): HTMLElement
  panBy(offset: [number, number], options?: { animate?: boolean }): void
}

const PIN_HEIGHT = 36
const PIN_HIGHLIGHT_SCALE = 1.3
const BADGE_SIZE = 30
const POPUP_GAP = 6

export const PIN_POPUP_OFFSET = Math.round(PIN_HEIGHT * PIN_HIGHLIGHT_SCALE + POPUP_GAP)
export const BADGE_POPUP_OFFSET = Math.round(BADGE_SIZE / 2 + POPUP_GAP)

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

function buildCloseIcon(): SVGSVGElement {
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg')
  icon.setAttribute('class', 'icon')
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('fill', 'currentColor')
  icon.setAttribute('aria-hidden', 'true')
  const use = document.createElementNS(SVG_NAMESPACE, 'use')
  use.setAttribute('href', '#icon-x')
  icon.append(use)

  return icon
}

function replaceCloseGlyph(popup: maplibregl.Popup): void {
  const button = popup
    .getElement()
    ?.querySelector<HTMLButtonElement>('.maplibregl-popup-close-button')
  if (button) {
    button.replaceChildren(buildCloseIcon())
  }
}

export const SHEET_QUERY = '(max-width: 700px)'

type PopupEvent = 'open' | 'close'

export interface MapPopup {
  setLngLat(lngLat: [number, number]): MapPopup
  setHTML(html: string): MapPopup
  addTo(map: maplibregl.Map): MapPopup
  remove(): MapPopup
  isOpen(): boolean
  getElement(): HTMLElement | undefined
  getLngLat(): [number, number] | undefined
  on(event: PopupEvent, handler: () => void): MapPopup
}

interface Sheet {
  root: HTMLElement
  body: HTMLElement
  owner: MapPopup | null
}

let sheet: Sheet | null = null

function ensureSheet(): Sheet {
  if (sheet) {
    return sheet
  }
  const root = document.createElement('div')
  root.className = 'map-sheet'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', 'Place details')
  root.hidden = true

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'map-sheet-close'
  close.setAttribute('aria-label', 'Close')
  close.append(buildCloseIcon())
  close.addEventListener('click', () => sheet?.owner?.remove())

  const body = document.createElement('div')
  body.className = 'map-sheet-body'

  root.append(close, body)
  document.body.append(root)

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      sheet?.owner?.remove()
    }
  })

  sheet = { root, body, owner: null }

  return sheet
}

export function sheetHeight(): number {
  return sheet && !sheet.root.hidden ? sheet.root.getBoundingClientRect().height : 0
}

function usesSheet(): boolean {
  return window.matchMedia(SHEET_QUERY).matches
}

export function createMapPopup(offset: number): MapPopup {
  const popup = new maplibregl.Popup({
    className: 'map-popup',
    closeButton: true,
    closeOnClick: false,
    anchor: 'bottom',
    maxWidth: '320px',
    offset,
    focusAfterOpen: false,
  })
  const handlers: Record<PopupEvent, Array<() => void>> = { open: [], close: [] }
  const emit = (event: PopupEvent) => handlers[event].forEach((handler) => handler())
  let html = ''
  let lngLat: [number, number] | undefined
  let inSheet = false

  popup.on('open', () => {
    replaceCloseGlyph(popup)
    emit('open')
  })
  popup.on('close', () => emit('close'))

  const facade: MapPopup = {
    setLngLat(next) {
      lngLat = next
      popup.setLngLat(next)

      return facade
    },
    setHTML(next) {
      html = next
      popup.setHTML(next)

      return facade
    },
    addTo(map) {
      if (!usesSheet()) {
        popup.addTo(map)

        return facade
      }
      const target = ensureSheet()
      if (target.owner && target.owner !== facade) {
        target.owner.remove()
      }
      target.owner = facade
      target.body.innerHTML = html
      target.root.hidden = false
      inSheet = true
      emit('open')

      return facade
    },
    remove() {
      if (inSheet) {
        inSheet = false
        if (sheet?.owner === facade) {
          sheet.owner = null
          sheet.root.hidden = true
          sheet.body.replaceChildren()
        }
        emit('close')
      } else {
        popup.remove()
      }

      return facade
    },
    isOpen() {
      return inSheet || popup.isOpen()
    },
    getElement() {
      return inSheet ? undefined : popup.getElement()
    },
    getLngLat() {
      return lngLat
    },
    on(event, handler) {
      handlers[event].push(handler)

      return facade
    },
  }

  return facade
}

export function revealAboveSheet(
  map: PannableMap & { project(lngLat: [number, number]): { y: number } },
  lngLat: [number, number],
): void {
  requestAnimationFrame(() => {
    const covered = sheetHeight()
    if (covered === 0) {
      return
    }
    const mapRect = map.getContainer().getBoundingClientRect()
    const visibleBottom = window.innerHeight - covered
    const pointY = mapRect.top + map.project(lngLat).y
    const limit = Math.min(mapRect.bottom, visibleBottom) - 24
    if (pointY > limit) {
      map.panBy([0, pointY - limit])
    }
  })
}

export function settlePopup(
  map: PannableMap & { project(lngLat: [number, number]): { y: number } },
  popup: MapPopup,
): void {
  const element = popup.getElement()
  const lngLat = popup.getLngLat()
  if (element) {
    keepPopupInView(map, () => element)
  } else if (lngLat) {
    revealAboveSheet(map, lngLat)
  }
}

export const CITY_BOUNDS = CONFIGURED_CITY_BOUNDS as [[number, number], [number, number]]

interface BoundsLike {
  getWest(): number
  getEast(): number
  getNorth(): number
  getSouth(): number
}

interface FramableMap {
  getContainer(): HTMLElement
  getCenter(): { lng: number; lat: number }
  getBounds(): BoundsLike
  fitBounds(
    bounds: [[number, number], [number, number]],
    options: { padding: number; maxZoom?: number; animate: boolean },
  ): void
  setCenter(center: [number, number]): void
}

export function fitZoomFor(map: FramableMap, bounds: BoundsLike, padding: number): number {
  const mercatorY = (lat: number): number => {
    const sine = Math.sin((lat * Math.PI) / 180)

    return 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)
  }
  const spanX = (bounds.getEast() - bounds.getWest()) / 360
  const spanY = mercatorY(bounds.getSouth()) - mercatorY(bounds.getNorth())
  const container = map.getContainer()
  const scaleX = (container.clientWidth - padding * 2) / 512 / spanX
  const scaleY = (container.clientHeight - padding * 2) / 512 / spanY

  return Math.log2(Math.min(scaleX, scaleY))
}

export function frameCityView(map: FramableMap, padding: number, anchorRiver = true): void {
  map.fitBounds(CITY_BOUNDS, { padding, animate: false })

  if (!anchorRiver) {
    return
  }

  const visibleBounds = map.getBounds()
  const visibleLatSpan = visibleBounds.getNorth() - visibleBounds.getSouth()
  const visibleLngSpan = visibleBounds.getEast() - visibleBounds.getWest()
  const center = map.getCenter()

  const biasedLat = center.lat - visibleLatSpan * 0.1

  const riverEdge = CITY_BOUNDS[1][0]
  const westBiasedLng = riverEdge + visibleLngSpan * 0.06 - visibleLngSpan / 2
  const biasedLng = Math.min(center.lng, westBiasedLng)

  map.setCenter([biasedLng, biasedLat])
}

export function topChromeBottom(): number {
  return ['.masthead-nav', '.secondary-header']
    .map((selector) => document.querySelector<HTMLElement>(selector))
    .reduce(
      (bottom, node) => (node ? Math.max(bottom, node.getBoundingClientRect().bottom) : bottom),
      0,
    )
}

export function keepPopupInView(map: PannableMap, getPopupEl: () => HTMLElement | undefined): void {
  requestAnimationFrame(() => {
    const popupEl = getPopupEl()
    if (!popupEl) {
      return
    }
    const popupRect = popupEl.getBoundingClientRect()
    const mapRect = map.getContainer().getBoundingClientRect()
    const pad = 16
    const topLimit = topChromeBottom() + 8
    let dx = 0
    let dy = 0
    if (popupRect.top < topLimit) {
      dy = popupRect.top - topLimit
    }
    if (popupRect.left < mapRect.left + pad) {
      dx = popupRect.left - (mapRect.left + pad)
    } else if (popupRect.right > mapRect.right - pad) {
      dx = popupRect.right - (mapRect.right - pad)
    }
    if (dx !== 0 || dy !== 0) {
      map.panBy([dx, dy])
    }
  })
}

export const DESKTOP_HOVER_QUERY = '(hover: hover) and (min-width: 701px)'

export function bindRowHover(
  items: Iterable<HTMLElement>,
  handlers: { enter: (item: HTMLElement) => void; leave: (item: HTMLElement) => void },
): void {
  if (!window.matchMedia(DESKTOP_HOVER_QUERY).matches) {
    return
  }
  for (const item of items) {
    item.addEventListener('mouseenter', () => handlers.enter(item))
    item.addEventListener('mouseleave', () => handlers.leave(item))
  }
}
