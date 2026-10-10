const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY

const DEFAULT_MAX_ROWS = 10

type ReaderRating = { slug: string; likes: number }

export function initReaderFavorites(): void {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return
  }

  const box = document.querySelector<HTMLElement>('[data-reader-favorites]')
  const list = box?.querySelector<HTMLElement>('[data-favorites-list]')
  if (!box || !list) {
    return
  }

  const titles = readPlaceTitles()

  const maxRows = Number(box.dataset.maxRows) || DEFAULT_MAX_ROWS

  const render = (ratings: ReaderRating[]): void => {
    const named = ratings.filter((rating) => Boolean(titles[rating.slug])).slice(0, maxRows)

    named.forEach((rating, index) => {
      list.append(buildRow(rating, titles[rating.slug], index + 1))
    })

    const emptyLine = box.querySelector<HTMLElement>('[data-favorites-empty]')
    if (emptyLine) {
      emptyLine.hidden = named.length > 0
    }
    box.hidden = false
  }

  void fetchReaderRatings()
    .then(render)
    .catch(() => {})
}

function readPlaceTitles(): Record<string, string> {
  const tag = document.querySelector<HTMLScriptElement>('script[data-place-titles]')
  if (!tag?.textContent) {
    return {}
  }

  try {
    const parsed = JSON.parse(tag.textContent) as Record<string, string>

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function buildRow(rating: ReaderRating, title: string, rank: number): HTMLLIElement {
  const item = document.createElement('li')

  const rankLabel = document.createElement('span')
  rankLabel.className = 'rank'
  rankLabel.textContent = `${rank}.`
  item.append(rankLabel)

  const nameLink = document.createElement('a')
  nameLink.className = 'title-link'
  nameLink.href = `/food/${rating.slug}/`
  nameLink.textContent = title
  item.append(nameLink)

  const count = document.createElement('span')
  count.className = 'fav-count'
  count.textContent = `${rating.likes} ${rating.likes === 1 ? 'vote' : 'votes'}`
  item.append(count)

  return item
}

async function fetchReaderRatings(): Promise<ReaderRating[]> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_reader_ratings`, {
    headers: { apikey: SUPABASE_ANON_KEY },
  })

  if (!response.ok) {
    throw new Error(`get_reader_ratings responded ${response.status}`)
  }

  return (await response.json()) as ReaderRating[]
}
