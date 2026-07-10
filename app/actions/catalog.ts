'use server'

import { revalidatePath } from 'next/cache'
import { deleteCatalogItem, upsertCatalogItem, type CatalogItem } from '@/lib/db/catalog'
import type { IvaRate, Unit } from '@/lib/procurement/case-file'

const UNITS: Unit[] = ['m2', 'ml', 'unidade', 'hora', 'global']
const IVA: IvaRate[] = [6, 13, 23]

function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40)
}

/** Create or update a catálogo item from the editor form. */
export async function saveCatalogItem(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const category = String(formData.get('category') ?? '').trim() || 'Geral'
  const unitRaw = String(formData.get('unit') ?? 'unidade')
  const unit: Unit = UNITS.includes(unitRaw as Unit) ? (unitRaw as Unit) : 'unidade'
  const unitPrice = Number(formData.get('unitPrice'))
  const ivaRaw = Number(formData.get('ivaRate'))
  const ivaRate: IvaRate = IVA.includes(ivaRaw as IvaRate) ? (ivaRaw as IvaRate) : 23
  const active = String(formData.get('active') ?? 'true') !== 'false'

  if (!description || !Number.isFinite(unitPrice)) throw new Error('Descrição e preço são obrigatórios.')

  await upsertCatalogItem({
    id: id || slugify(description) || `item-${Date.now()}`,
    category,
    description,
    unit,
    unitPrice,
    ivaRate,
    active,
  } satisfies CatalogItem)
  revalidatePath('/dashboard')
}

export async function removeCatalogItem(id: string): Promise<void> {
  await deleteCatalogItem(id)
  revalidatePath('/dashboard')
}
