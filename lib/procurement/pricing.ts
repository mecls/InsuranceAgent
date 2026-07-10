import type { CatalogItem } from '@/lib/db/catalog'
import type { IvaRate, LineItem, Pricing } from '@/lib/procurement/case-file'

/**
 * Deterministic pricing. The LLM selects which catálogo item + quantity each line
 * is; THIS computes every euro: line totals, per-rate IVA breakdown, and the
 * grand total. A line with no catálogo match is kept with a null price and
 * flagged so the review surfaces it (never invented).
 */

export interface SelectedLine {
  catalogItemId: string | null
  description: string
  unit: LineItem['unit']
  quantity: number
}

export function priceLineItems(
  selected: SelectedLine[],
  catalog: CatalogItem[],
): { lineItems: LineItem[]; pricing: Pricing } {
  const byId = new Map(catalog.map((c) => [c.id, c]))

  const lineItems: LineItem[] = selected.map((s) => {
    const item = s.catalogItemId ? byId.get(s.catalogItemId) : undefined
    if (!item) {
      return {
        catalogItemId: s.catalogItemId ?? null,
        description: s.description,
        unit: s.unit,
        quantity: s.quantity,
        unitPrice: null,
        total: null,
        ivaRate: null,
        source: 'manual',
      }
    }
    const total = round2(item.unitPrice * s.quantity)
    return {
      catalogItemId: item.id,
      description: s.description || item.description,
      unit: item.unit,
      quantity: s.quantity,
      unitPrice: item.unitPrice,
      total,
      ivaRate: item.ivaRate,
      source: 'catalog',
    }
  })

  const subtotal = round2(lineItems.reduce((sum, l) => sum + (l.total ?? 0), 0))

  const byRate = new Map<IvaRate, number>()
  for (const l of lineItems) {
    if (l.total == null || l.ivaRate == null) continue
    byRate.set(l.ivaRate, round2((byRate.get(l.ivaRate) ?? 0) + l.total))
  }
  const ivaBreakdown = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, base]) => ({ rate, base, amount: round2(base * (rate / 100)) }))
  const ivaAmount = round2(ivaBreakdown.reduce((s, b) => s + b.amount, 0))

  const pricing: Pricing = {
    subtotal,
    ivaBreakdown,
    ivaAmount,
    total: round2(subtotal + ivaAmount),
    hasUnpriced: lineItems.some((l) => l.total == null),
  }

  return { lineItems, pricing }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

const EUR = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
export function euro(n: number | null | undefined): string {
  return n == null ? '—' : EUR.format(n)
}
