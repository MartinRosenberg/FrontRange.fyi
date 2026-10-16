export type LngLat = [number, number]

const METERS_PER_DEGREE_LAT = 110970
const METERS_PER_DEGREE_LNG_AT_EQUATOR = 111320

function metersPerDegreeLng(latitude: number): number {
  return Math.cos((latitude * Math.PI) / 180) * METERS_PER_DEGREE_LNG_AT_EQUATOR
}

export function metersBetween(left: LngLat, right: LngLat): number {
  const east = (right[0] - left[0]) * metersPerDegreeLng(left[1])
  const north = (right[1] - left[1]) * METERS_PER_DEGREE_LAT

  return Math.hypot(east, north)
}

const HULL_CIRCLE_STEPS = 32

function cross(origin: LngLat, first: LngLat, second: LngLat): number {
  return (
    (first[0] - origin[0]) * (second[1] - origin[1]) -
    (first[1] - origin[1]) * (second[0] - origin[0])
  )
}

function convexHull(points: LngLat[]): LngLat[] {
  const sorted = [...points].sort((left, right) => left[0] - right[0] || left[1] - right[1])
  const halfHull = (ordered: LngLat[]) => {
    const chain: LngLat[] = []
    for (const point of ordered) {
      while (
        chain.length >= 2 &&
        cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0
      ) {
        chain.pop()
      }
      chain.push(point)
    }
    chain.pop()

    return chain
  }
  const hull = [...halfHull(sorted), ...halfHull([...sorted].reverse())]

  return [...hull, hull[0]]
}

export function hullAroundPoints(centers: number[][], meters: number): LngLat[] {
  const points: LngLat[] = []
  for (const [lng, lat] of centers) {
    const lngScale = metersPerDegreeLng(lat)
    for (let step = 0; step < HULL_CIRCLE_STEPS; step += 1) {
      const angle = (step / HULL_CIRCLE_STEPS) * 2 * Math.PI
      points.push([
        lng + (Math.cos(angle) * meters) / lngScale,
        lat + (Math.sin(angle) * meters) / METERS_PER_DEGREE_LAT,
      ])
    }
  }

  return convexHull(points)
}

export interface LineProjection {
  point: LngLat
  distance: number
  along: number
}

export function projectOntoLine(point: LngLat, line: number[][]): LineProjection {
  const lngScale = metersPerDegreeLng(point[1])
  let best: LineProjection = { point, distance: Infinity, along: 0 }
  let travelled = 0

  for (let index = 0; index < line.length - 1; index += 1) {
    const [startLng, startLat] = line[index]
    const [endLng, endLat] = line[index + 1]
    const segmentX = (endLng - startLng) * lngScale
    const segmentY = (endLat - startLat) * METERS_PER_DEGREE_LAT
    const pointX = (point[0] - startLng) * lngScale
    const pointY = (point[1] - startLat) * METERS_PER_DEGREE_LAT
    const lengthSquared = segmentX * segmentX + segmentY * segmentY
    const length = Math.sqrt(lengthSquared)
    const fraction =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, (pointX * segmentX + pointY * segmentY) / lengthSquared))
    const distance = Math.hypot(pointX - fraction * segmentX, pointY - fraction * segmentY)

    if (distance < best.distance) {
      best = {
        point: [
          startLng + (endLng - startLng) * fraction,
          startLat + (endLat - startLat) * fraction,
        ],
        distance,
        along: travelled + fraction * length,
      }
    }
    travelled += length
  }

  return best
}
