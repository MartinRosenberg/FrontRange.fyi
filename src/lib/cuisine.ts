const LABEL_OVERRIDES: Record<string, string> = { bbq: 'BBQ', lgbtq: 'LGBTQ' }

export function cuisineLabel(cuisine: string): string {
  const key = cuisine.trim().toLowerCase()

  return LABEL_OVERRIDES[key] ?? key.replace(/\b\w/g, (char) => char.toUpperCase())
}

export function cuisineSlug(cuisine: string): string {
  return cuisine
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
}

export const CUISINE_PAGE_MIN_PLACES = 2

export function cuisinesWithPages(
  places: { data: { cuisine: string[] } }[],
): Map<string, { data: { cuisine: string[] } }[]> {
  const grouped = new Map<string, { data: { cuisine: string[] } }[]>()
  for (const place of places) {
    for (const cuisine of place.data.cuisine) {
      const key = cuisine.trim().toLowerCase()
      grouped.set(key, [...(grouped.get(key) ?? []), place])
    }
  }
  for (const [cuisine, group] of grouped) {
    if (group.length < CUISINE_PAGE_MIN_PLACES) {
      grouped.delete(cuisine)
    }
  }

  return grouped
}
