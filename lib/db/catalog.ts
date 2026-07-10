import { supabaseService } from '@/lib/supabase/service'
import type { IvaRate, Unit } from '@/lib/procurement/case-file'

/**
 * The catálogo de preços — the vendor's editable rate card. Pricing is
 * deterministic against these rows; the LLM only selects which item + quantity.
 * Seeded with market averages (migration 0008) and editable in the UI.
 */
export interface CatalogItem {
  id: string
  category: string
  description: string
  unit: Unit
  unitPrice: number
  ivaRate: IvaRate
  active: boolean
}

interface CatalogRow {
  id: string
  category: string
  description: string
  unit: string
  unit_price: number
  iva_rate: number
  active: boolean
}

function toItem(r: CatalogRow): CatalogItem {
  return {
    id: r.id,
    category: r.category,
    description: r.description,
    unit: r.unit as Unit,
    unitPrice: Number(r.unit_price),
    ivaRate: r.iva_rate as IvaRate,
    active: r.active,
  }
}

export async function listCatalogItems(activeOnly = true): Promise<CatalogItem[]> {
  let q = supabaseService().from('catalog_items').select('*').order('category').order('description')
  if (activeOnly) q = q.eq('active', true)
  const { data, error } = await q
  if (error) throw new Error(`listCatalogItems failed: ${error.message}`)
  return (data as CatalogRow[] | null)?.map(toItem) ?? []
}

export async function upsertCatalogItem(item: CatalogItem): Promise<void> {
  const { error } = await supabaseService()
    .from('catalog_items')
    .upsert({
      id: item.id,
      category: item.category,
      description: item.description,
      unit: item.unit,
      unit_price: item.unitPrice,
      iva_rate: item.ivaRate,
      active: item.active,
    })
  if (error) throw new Error(`upsertCatalogItem failed: ${error.message}`)
}

export async function deleteCatalogItem(id: string): Promise<void> {
  const { error } = await supabaseService().from('catalog_items').delete().eq('id', id)
  if (error) throw new Error(`deleteCatalogItem failed: ${error.message}`)
}
