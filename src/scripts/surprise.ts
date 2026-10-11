function candidateIds(button: HTMLElement): string[] {
  const inline = button.dataset.surpriseIds
  if (inline) {
    try {
      const parsed = JSON.parse(inline) as unknown

      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string')
        : []
    } catch {
      return []
    }
  }

  return [
    ...document.querySelectorAll<HTMLElement>('[data-filter-item]:not([hidden]):not([data-stub])'),
  ]
    .map((item) => item.id)
    .filter(Boolean)
}

export function initSurprise(): void {
  for (const button of document.querySelectorAll<HTMLElement>('[data-surprise]')) {
    button.addEventListener('click', () => {
      const ids = candidateIds(button)
      if (ids.length === 0) {
        return
      }
      const pick = ids[Math.floor(Math.random() * ids.length)]
      window.location.assign(`/food/${pick}/`)
    })
  }
}
