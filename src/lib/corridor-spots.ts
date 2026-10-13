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
  include?: string[]
  exclude?: string[]
}

const corridorData = optionalData<{ corridors: CorridorLine[] }>(
  import.meta.glob('../data/corridors.json', { eager: true, import: 'default' }),
  { corridors: [] },
)

export const CORRIDOR_SPOT_RANGE_METERS = 200

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

interface Place extends CorridorSpot {
  key: string
}

async function allPlaces(): Promise<Place[]> {
  const places: Place[] = []
  for (const place of published(await getCollection('food'))) {
    const [lat, lng] = place.data.coords ?? []
    if (lat === undefined || lng === undefined) {
      continue
    }
    places.push({
      key: normalizeName(place.data.title),
      name: place.data.title,
      category: 'food',
      coords: [lng, lat],
      link: hasBody(place) ? href(`/food/${place.id}/`) : undefined,
    })
  }
  for (const spot of allSpots()) {
    if (spot.coords) {
      places.push({
        key: normalizeName(spot.name),
        name: spot.name,
        category: spot.category,
        coords: spot.coords,
      })
    }
  }

  return places
}

export async function corridorSpotsByCorridor(): Promise<Record<string, CorridorSpot[]>> {
  const corridors = corridorData.corridors
  const places = await allPlaces()
  const candidates = new Map<string, Candidate[]>()
  const push = (id: string, candidate: Candidate) => {
    const list = candidates.get(id) ?? []
    list.push(candidate)
    candidates.set(id, list)
  }

  for (const place of places) {
    const nearest = nearestCorridor(place.coords, corridors)
    if (nearest) {
      push(nearest.id, { ...place, along: nearest.along })
    }
  }

  for (const corridor of corridors) {
    for (const name of corridor.include ?? []) {
      const place = places.find((candidate) => candidate.key === normalizeName(name))
      if (place) {
        push(corridor.id, { ...place, along: projectOntoLine(place.coords, corridor.line).along })
      }
    }
  }

  const result: Record<string, CorridorSpot[]> = {}
  for (const corridor of corridors) {
    const excluded = new Set((corridor.exclude ?? []).map(normalizeName))
    const seen = new Set<string>()
    result[corridor.id] = (candidates.get(corridor.id) ?? [])
      .sort((left, right) => left.along - right.along)
      .filter((candidate) => {
        const key = normalizeName(candidate.name)
        if (excluded.has(key) || seen.has(key)) {
          return false
        }
        seen.add(key)

        return true
      })
      .map(({ along: _along, key: _key, ...spot }) => spot)
  }

  return result
}
