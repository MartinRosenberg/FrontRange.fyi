export const formatDate = (date: Date): string =>
  date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })

export const formatMonthShort = (date: Date): string =>
  date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })

export const formatDay = (date: Date): string =>
  date.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'UTC' })

export const isoDate = (date: Date): string => date.toISOString().slice(0, 10)

export function groupByYear<Item>(
  items: Item[],
  dateOf: (item: Item) => Date,
): { year: number; items: Item[] }[] {
  return [...new Set(items.map((item) => dateOf(item).getUTCFullYear()))].map((year) => ({
    year,
    items: items.filter((item) => dateOf(item).getUTCFullYear() === year),
  }))
}
