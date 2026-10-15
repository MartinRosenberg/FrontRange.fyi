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
