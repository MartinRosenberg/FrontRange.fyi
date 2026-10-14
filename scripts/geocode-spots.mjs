import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'
import { CITY, REGION } from '../site.config.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const spotsPath = resolve(root, 'src/data/spots.json')
const spots = JSON.parse(readFileSync(spotsPath, 'utf8'))

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function search(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1' }).toString()
  const response = await fetch(url, { headers: { 'User-Agent': 'site-spot-geocoder/1.0' } })
  if (!response.ok) {
    throw new Error(`Nominatim responded ${response.status}`)
  }

  return response.json()
}

const unresolved = []
let resolved = 0

for (const spot of spots) {
  if (spot.coords || !spot.address) {
    continue
  }
  const label = `${spot.neighborhoods.join('+')}: ${spot.name}`
  const query = `${spot.address}, ${CITY}, ${REGION}`
  const [match] = await search(query)
  await sleep(1100)
  if (!match) {
    unresolved.push(`${label} (${spot.address})`)
    continue
  }
  spot.coords = [Number(Number(match.lon).toFixed(5)), Number(Number(match.lat).toFixed(5))]
  resolved += 1
  console.log(`${label} -> ${spot.coords.join(', ')}`)
}

const prettierOptions = await resolveConfig(spotsPath)
writeFileSync(
  spotsPath,
  await format(JSON.stringify(spots), { ...prettierOptions, filepath: spotsPath }),
)
console.log(`Resolved ${resolved} spot${resolved === 1 ? '' : 's'}.`)
if (unresolved.length > 0) {
  console.log(`Could not resolve:\n  ${unresolved.join('\n  ')}`)
}
