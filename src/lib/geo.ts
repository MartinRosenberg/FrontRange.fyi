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
