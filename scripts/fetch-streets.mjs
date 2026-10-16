import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'

const OVERPASS_URL = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter'
const STREETS_PATH = fileURLToPath(new URL('../src/data/streets.json', import.meta.url))
const data = JSON.parse(readFileSync(STREETS_PATH, 'utf8'))

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function overpass(query) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response
    try {
      response = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'street-extract/1.0',
        },
        body: `data=${encodeURIComponent(query)}`,
      })
    } catch (error) {
      console.warn(`  network error (${error.message}), attempt ${attempt}/3`)
      await sleep(10000 * attempt)
      continue
    }

    if (response.ok) {
      const result = await response.json()
      if (result.elements.length === 0 && result.remark) {
        console.warn(`  overpass remark (${result.remark.slice(0, 60)}…), attempt ${attempt}/3`)
        await sleep(8000 * attempt)
        continue
      }

      return result
    }

    console.warn(`  overpass ${response.status}, attempt ${attempt}/3 — backing off`)
    await sleep(8000 * attempt)
  }

  throw new Error('Overpass kept failing')
}

const nameRegex = (names) => `^(${names.join('|')})$`
const bboxAround = ([lat, lng], margin) =>
  `${lat - margin},${lng - margin * 1.25},${lat + margin},${lng + margin * 1.25}`

async function resolveEndpoint(query, endpoint) {
  if (!endpoint.names && endpoint.coord) {
    const [lat, lng] = endpoint.coord

    return { lat, lng, nodeCount: 0 }
  }

  const bbox = bboxAround(query.center, 0.04)
  const request = `[out:json][timeout:30];
way["highway"]["highway"!~"_link"]["name"~"${nameRegex(query.roadNames)}"](${bbox});
node(w)->.street_nodes;
way["highway"]["highway"!~"_link"]["name"~"${nameRegex(endpoint.names)}"](${bbox});
node(w)->.cross_nodes;
node.street_nodes.cross_nodes;
out;`

  const result = await overpass(request)
  const nodes = result.elements.filter((element) => element.type === 'node')

  if (nodes.length === 0) {
    if (endpoint.coord) {
      const [lat, lng] = endpoint.coord

      return { lat, lng, nodeCount: 0 }
    }

    return null
  }

  const lat = nodes.reduce((sum, node) => sum + node.lat, 0) / nodes.length
  const lng = nodes.reduce((sum, node) => sum + node.lon, 0) / nodes.length

  return { lat, lng, nodeCount: nodes.length }
}

async function fetchStreetPoints(query, start, end) {
  const south = Math.min(start.lat, end.lat) - 0.004
  const north = Math.max(start.lat, end.lat) + 0.004
  const west = Math.min(start.lng, end.lng) - 0.005
  const east = Math.max(start.lng, end.lng) + 0.005
  const request = `[out:json][timeout:30];
way["highway"]["highway"!~"_link"]["name"~"${nameRegex(query.roadNames)}"](${south},${west},${north},${east});
out geom;`

  const result = await overpass(request)
  const points = []
  for (const element of result.elements) {
    if (element.type === 'way' && element.geometry) {
      points.push(...element.geometry)
    }
  }

  return points
}

function metricProjector(latitudeOrigin) {
  const metersPerLat = 110970
  const metersPerLng = Math.cos((latitudeOrigin * Math.PI) / 180) * 111320

  return (point) => ({ x: point.lon * metersPerLng, y: point.lat * metersPerLat })
}

function buildLine(points, start, end) {
  const project = metricProjector((start.lat + end.lat) / 2)
  const startXY = project({ lon: start.lng, lat: start.lat })
  const endXY = project({ lon: end.lng, lat: end.lat })
  const axis = { x: endXY.x - startXY.x, y: endXY.y - startXY.y }
  const axisLength = Math.hypot(axis.x, axis.y)
  const tolerance = 10 / axisLength

  const buckets = new Map()
  for (const point of points) {
    const projected = project(point)
    const relative = { x: projected.x - startXY.x, y: projected.y - startXY.y }
    const along = (relative.x * axis.x + relative.y * axis.y) / (axisLength * axisLength)
    const perpendicular = Math.abs(relative.x * axis.y - relative.y * axis.x) / axisLength

    if (along < -tolerance || along > 1 + tolerance || perpendicular > 300) {
      continue
    }

    const bucketIndex = Math.round((along * axisLength) / 25)
    const bucket = buckets.get(bucketIndex) ?? { lat: 0, lng: 0, count: 0 }
    bucket.lat += point.lat
    bucket.lng += point.lon
    bucket.count += 1
    buckets.set(bucketIndex, bucket)
  }

  const line = [...buckets.entries()]
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([, bucket]) => [bucket.lng / bucket.count, bucket.lat / bucket.count])

  if (line.length < 3) {
    return null
  }

  line[0] = [start.lng, start.lat]
  line[line.length - 1] = [end.lng, end.lat]

  return {
    line: line.map(([lng, lat]) => [Number(lng.toFixed(6)), Number(lat.toFixed(6))]),
    lengthMeters: Math.round(axisLength),
  }
}

const onlyIds = process.argv.slice(2)
const targets =
  onlyIds.length > 0 ? data.streets.filter((street) => onlyIds.includes(street.id)) : data.streets

const problems = []
let updated = 0

for (const street of targets) {
  console.log(`\n${street.name} (${street.road}, ${street.from} -> ${street.to})`)

  const start = await resolveEndpoint(street.query, street.query.from)
  await sleep(2500)
  const end = await resolveEndpoint(street.query, street.query.to)
  await sleep(2500)

  if (!start || !end) {
    problems.push(`${street.id}: unresolved endpoint (start=${!!start}, end=${!!end})`)
    console.log('  FAILED to resolve endpoints, keeping the existing line')
    continue
  }

  console.log(
    `  start ${start.lat.toFixed(5)},${start.lng.toFixed(5)} (${start.nodeCount} nodes)` +
      ` | end ${end.lat.toFixed(5)},${end.lng.toFixed(5)} (${end.nodeCount} nodes)`,
  )

  const points = await fetchStreetPoints(street.query, start, end)
  await sleep(2500)
  const built = buildLine(points, start, end)

  if (!built) {
    problems.push(`${street.id}: too few points (${points.length} raw)`)
    console.log(
      `  FAILED to build line from ${points.length} raw points, keeping the existing line`,
    )
    continue
  }

  const miles = (built.lengthMeters / 1609.34).toFixed(2)
  console.log(
    `  ${points.length} raw points -> ${built.line.length} line points, ~${miles} mi end to end`,
  )

  street.line = built.line
  updated += 1
}

const prettierOptions = await resolveConfig(STREETS_PATH)
writeFileSync(
  STREETS_PATH,
  await format(JSON.stringify(data), { ...prettierOptions, filepath: STREETS_PATH }),
)

console.log(`\nUpdated ${updated}/${targets.length} street lines in ${STREETS_PATH}`)
if (problems.length > 0) {
  console.log('Problems:')
  for (const problem of problems) {
    console.log(`  - ${problem}`)
  }
  process.exitCode = 1
}
