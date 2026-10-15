import type { LegendItem } from './legend'

const LABEL_OVERRIDES: Record<string, string> = { bbq: 'BBQ' }

export function cuisineLabel(cuisine: string): string {
  const key = cuisine.trim().toLowerCase()

  return LABEL_OVERRIDES[key] ?? key.replace(/\b\w/g, (char) => char.toUpperCase())
}

const CUISINE_ICONS: Record<string, string> = {
  african: 'bowl-spoon',
  american: 'utensils',
  asian: 'bowl-chopsticks',
  bakery: 'baguette',
  balkan: 'sausage',
  bar: 'cocktail',
  bbq: 'grill',
  breakfast: 'fried-egg',
  brewery: 'beer',
  burgers: 'burger',
  cafe: 'coffee',
  chinese: 'dumpling',
  dessert: 'ice-cream',
  european: 'chef-hat',
  'fried chicken': 'canary',
  greek: 'salad',
  'hot dogs': 'sausage',
  indian: 'flame',
  italian: 'cheese',
  korean: 'bowl-chopsticks',
  'latin american': 'avocado',
  mexican: 'pepper',
  'middle eastern': 'grill',
  pizza: 'pizza',
  ramen: 'bowl-chopsticks',
  sandwiches: 'bread',
  spanish: 'wine-glass',
  sushi: 'fish',
  thai: 'lemon',
  vietnamese: 'soup',
}

export function cuisineIcon(cuisine: string | undefined): string {
  return CUISINE_ICONS[(cuisine ?? '').trim().toLowerCase()] ?? 'utensils'
}

export function cuisineLegendItems(cuisines: string[]): LegendItem[] {
  return cuisines.map((cuisine) => ({
    key: cuisine,
    label: cuisineLabel(cuisine),
    token: '--color-accent-blue-soft',
    icon: cuisineIcon(cuisine),
  }))
}
