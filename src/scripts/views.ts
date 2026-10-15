import { initFilter } from './filter'

export function initMapPage(rootSelector = '[data-filter-root]'): void {
  const root = document.querySelector<HTMLElement>(rootSelector)
  if (!root) {
    return
  }

  initFilter(rootSelector)

  const toggle = root.querySelector<HTMLButtonElement>('[data-map-split-toggle]')
  const toggleLabel = root.querySelector<HTMLElement>('[data-map-split-label]')

  const setView = (view: 'map' | 'list'): void => {
    root.dataset.view = view
    if (toggleLabel) {
      toggleLabel.textContent = view === 'map' ? 'View list' : 'View map'
    }
  }

  setView('map')
  toggle?.addEventListener('click', () => {
    setView(root.dataset.view === 'map' ? 'list' : 'map')
  })
}
