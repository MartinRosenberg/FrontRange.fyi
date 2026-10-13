import type { CollectionEntry } from 'astro:content'
import { getImage } from 'astro:assets'
import { hasBody } from './content'
import { cuisineLabel } from './cuisine'
import { googleMapsHref } from './maps'
import { spotCategories, type MapSpot, type Spot } from './spots'
import { href } from './url'
import { resolveVerdict, verdictLabels } from './verdict'

const isExternalUrl = (url: string) => /^https?:\/\//.test(url)

export function spotPageHref(spot: Spot): string | undefined {
  return spot.url && !isExternalUrl(spot.url) ? href(spot.url) : undefined
}

export function spotWebsiteHref(spot: Spot): string | undefined {
  return spot.url && isExternalUrl(spot.url) ? spot.url : undefined
}

export function spotDirectionsHref(spot: Spot): string | undefined {
  if (!spot.coords) {
    return undefined
  }

  return googleMapsHref({
    title: spot.name,
    address: spot.address ? [spot.address, 'St. Louis, MO'] : undefined,
    coords: [spot.coords[1], spot.coords[0]],
  })
}

export function spotToMapSpot(spot: Spot): MapSpot | undefined {
  if (!spot.coords) {
    return undefined
  }

  return {
    title: spot.name,
    category: spot.category,
    coords: spot.coords,
    url: spotPageHref(spot),
    websiteHref: spotWebsiteHref(spot),
    meta: spotCategories[spot.category].meta,
    tagline: spot.description ?? '',
    addressLines: spot.address ? [spot.address] : [],
    directionsHref: spotDirectionsHref(spot),
  }
}

export async function foodToMapSpot(place: CollectionEntry<'food'>): Promise<MapSpot | undefined> {
  const [lat, lng] = place.data.coords ?? []
  if (lat === undefined || lng === undefined) {
    return undefined
  }
  const verdict = resolveVerdict(place.data)
  const thumb = place.data.photo
    ? await getImage({ src: place.data.photo, width: 480, format: 'webp' })
    : undefined

  return {
    title: place.data.title,
    category: 'food',
    url: hasBody(place) ? href(`/food/${place.id}/`) : undefined,
    coords: [lng, lat],
    meta: cuisineLabel(place.data.cuisine[0]),
    verdict: verdict ? { key: verdict, label: verdictLabels[verdict] } : undefined,
    tagline: place.data.description ?? '',
    addressLines: place.data.address ?? [],
    directionsHref: googleMapsHref(place.data),
    websiteHref: place.data.url,
    photo: thumb?.src,
  }
}

export async function toMapSpots(
  spots: Spot[],
  places: CollectionEntry<'food'>[],
): Promise<MapSpot[]> {
  const spotMapSpots = spots.flatMap((spot) => {
    const mapSpot = spotToMapSpot(spot)

    return mapSpot ? [mapSpot] : []
  })
  const foodMapSpots = (await Promise.all(places.map(foodToMapSpot))).flatMap((mapSpot) =>
    mapSpot ? [mapSpot] : [],
  )

  return [...spotMapSpots, ...foodMapSpots]
}
