import { getCollection } from 'astro:content'
import { optionalData } from './optional-data'
import { published } from './content'
import { normalizeName } from './neighborhoods'
import { href } from './url'
import { projectOntoLine, type LngLat } from './geo'
import { allSpots, type SpotCategoryKey } from './spots'

export interface StreetSpot {
  name: string
  category: SpotCategoryKey
  coords: LngLat
  link?: string
}

interface StreetLine {
  id: string
  line: number[][]
  include?: string[]
  exclude?: string[]
}

const streetData = optionalData<{ streets: StreetLine[] }>(
  import.meta.glob('../data/streets.json', { eager: true, import: 'default' }),
  { streets: [] },
)

export const STREET_SPOT_RANGE_METERS = 200

interface Candidate extends StreetSpot {
  along: number
}

function nearestStreet(
  coords: LngLat,
  streets: StreetLine[],
): { id: string; along: number } | undefined {
  let best: { id: string; along: number; distance: number } | undefined
  for (const street of streets) {
    const projection = projectOntoLine(coords, street.line)
    if (
      projection.distance <= STREET_SPOT_RANGE_METERS &&
      projection.distance < (best?.distance ?? Infinity)
    ) {
      best = { id: street.id, along: projection.along, distance: projection.distance }
    }
  }

  return best
}

interface Place extends StreetSpot {
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
      link: href(`/food/${place.id}/`),
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

export async function streetSpotsByStreet(): Promise<Record<string, StreetSpot[]>> {
  const streets = streetData.streets
  const places = await allPlaces()
  const candidates = new Map<string, Candidate[]>()
  const push = (id: string, candidate: Candidate) => {
    const list = candidates.get(id) ?? []
    list.push(candidate)
    candidates.set(id, list)
  }

  for (const place of places) {
    const nearest = nearestStreet(place.coords, streets)
    if (nearest) {
      push(nearest.id, { ...place, along: nearest.along })
    }
  }

  for (const street of streets) {
    for (const name of street.include ?? []) {
      const place = places.find((candidate) => candidate.key === normalizeName(name))
      if (place) {
        push(street.id, { ...place, along: projectOntoLine(place.coords, street.line).along })
      }
    }
  }

  const result: Record<string, StreetSpot[]> = {}
  for (const street of streets) {
    const excluded = new Set((street.exclude ?? []).map(normalizeName))
    const seen = new Set<string>()
    result[street.id] = (candidates.get(street.id) ?? [])
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
