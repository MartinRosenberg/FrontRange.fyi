export const LAST_CITY_NEIGHBORHOOD_NUMBER = 79

function isCityNeighborhood(row) {
  return !row.ignored && !row.type && row.number <= LAST_CITY_NEIGHBORHOOD_NUMBER
}

export function officialNamesBySlug(rows) {
  const nameByNumber = new Map()
  for (const row of rows) {
    if (isCityNeighborhood(row)) {
      nameByNumber.set(row.number, row.officialName ?? row.name)
    }
  }
  for (const row of rows) {
    if (row.mergedInto) {
      nameByNumber.set(row.number, row.name)
    }
  }

  const numbersBySlug = new Map()
  for (const row of rows) {
    const slug = row.mergedInto ?? (isCityNeighborhood(row) ? row.slug : undefined)
    if (slug) {
      numbersBySlug.set(slug, new Set([...(numbersBySlug.get(slug) ?? []), row.number]))
    }
  }

  return new Map(
    [...numbersBySlug].map(([slug, numbers]) => [
      slug,
      [...numbers].sort((left, right) => left - right).map((number) => nameByNumber.get(number)),
    ]),
  )
}
