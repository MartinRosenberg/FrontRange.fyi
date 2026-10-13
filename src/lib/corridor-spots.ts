import { getCollection } from 'astro:content'
import { optionalData } from './optional-data'
import { published, hasBody } from './content'
import { normalizeName } from './neighborhoods'
import { href } from './url'
import { projectOntoLine, type LngLat } from './geo'
import { allSpots, type SpotCategoryKey } from './spots'

export interface CorridorSpot {
  name: string
  category: SpotCategoryKey
  coords: LngLat
  link?: string
}

interface CorridorLine {
  id: string
  line: number[][]
}

const corridorData = optionalData<{ corridors: CorridorLine[] }>(
  import.meta.glob('../data/corridors.json', { eager: true, import: 'default' }),
  { corridors: [] },
)

const extraSpots = optionalData<Record<string, CorridorSpot[]>>(
  import.meta.glob('../data/corridor-spots.json', { eager: true, import: 'default' }),
  {},
)

export const CORRIDOR_SPOT_RANGE_METERS = 75

interface Candidate extends CorridorSpot {
  along: number
}

function nearestCorridor(
  coords: LngLat,
  corridors: CorridorLine[],
): { id: string; along: number } | undefined {
  let best: { id: string; along: number; distance: number } | undefined
  for (const corridor of corridors) {
    const projection = projectOntoLine(coords, corridor.line)
    if (
      projection.distance <= CORRIDOR_SPOT_RANGE_METERS &&
      projection.distance < (best?.distance ?? Infinity)
    ) {
      best = { id: corridor.id, along: projection.along, distance: projection.distance }
    }
  }

  return best
}

export async function corridorSpotsByCorridor(): Promise<Record<string, CorridorSpot[]>> {
  const corridors = corridorData.corridors
  const candidates = new Map<string, Candidate[]>()
  const push = (id: string, candidate: Candidate) => {
    const list = candidates.get(id) ?? []
    list.push(candidate)
    candidates.set(id, list)
  }

  for (const place of published(await getCollection('food'))) {
    const [lat, lng] = place.data.coords ?? []
    if (lat === undefined || lng === undefined) {
      continue
    }
    const coords: LngLat = [lng, lat]
    const nearest = nearestCorridor(coords, corridors)
    if (nearest) {
      push(nearest.id, {
        name: place.data.title,
        category: 'food',
        coords,
        link: hasBody(place) ? href(`/food/${place.id}/`) : undefined,
        along: nearest.along,
      })
    }
  }

  for (const spot of allSpots()) {
    if (!spot.coords) {
      continue
    }
    const nearest = nearestCorridor(spot.coords, corridors)
    if (nearest) {
      push(nearest.id, {
        name: spot.name,
        category: spot.category,
        coords: spot.coords,
        along: nearest.along,
      })
    }
  }

  for (const [id, extras] of Object.entries(extraSpots)) {
    const corridor = corridors.find((candidate) => candidate.id === id)
    for (const extra of extras) {
      const along = corridor ? projectOntoLine(extra.coords, corridor.line).along : 0
      push(id, { category: 'food', ...extra, along })
    }
  }

  const result: Record<string, CorridorSpot[]> = {}
  for (const [id, list] of candidates) {
    const seen = new Set<string>()
    result[id] = list
      .sort((left, right) => left.along - right.along)
      .filter((candidate) => {
        const key = normalizeName(candidate.name)
        if (seen.has(key)) {
          return false
        }
        seen.add(key)

        return true
      })
      .map(({ along: _along, ...spot }) => spot)
  }

  return result
}
