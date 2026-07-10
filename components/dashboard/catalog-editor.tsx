'use client'

import { useState } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import type { CatalogItem } from '@/lib/db/catalog'
import { saveCatalogItem, removeCatalogItem } from '@/app/actions/catalog'
import { cn } from '@/lib/utils'

/**
 * Catálogo editor — the customizable rate card. Edit a price/IVA/unit inline and
 * save, add a new item, or remove one. Pricing reads these rows deterministically.
 */
export function CatalogEditor({ items }: { items: CatalogItem[] }) {
  const [open, setOpen] = useState(false)
  const categories = Array.from(new Set(items.map((i) => i.category)))

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left">
        <div className="flex items-center gap-2.5">
          <span className="text-[15px] font-semibold text-[var(--color-text-primary)]">Catálogo de preços</span>
          <span className="text-xs text-[var(--color-text-muted)]">{items.length} itens</span>
        </div>
        <ChevronDown className={cn('size-4 shrink-0 text-[var(--color-text-muted)] transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-[var(--color-border)] px-6 py-5">
          {categories.map((cat) => (
            <div key={cat} className="mb-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{cat}</div>
              <div className="space-y-1.5">
                {items.filter((i) => i.category === cat).map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))}
          <NewItemRow />
        </div>
      )}
    </div>
  )
}

function ItemRow({ item }: { item: CatalogItem }) {
  return (
    <form action={saveCatalogItem} className="flex flex-wrap items-center gap-2 rounded-md bg-[#F9FAFB] px-3 py-2 text-sm">
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="category" value={item.category} />
      <span className="min-w-0 flex-1 truncate text-[var(--color-text-secondary)]">{item.description}</span>
      <span className="text-xs text-[var(--color-text-muted)]">€</span>
      <input name="unitPrice" defaultValue={item.unitPrice} inputMode="decimal" className="input h-8 w-20 text-right" />
      <span className="text-xs text-[var(--color-text-muted)]">/{item.unit}</span>
      <select name="unit" defaultValue={item.unit} className="input h-8 w-24">
        {['m2', 'ml', 'unidade', 'hora', 'global'].map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
      <select name="ivaRate" defaultValue={item.ivaRate} className="input h-8 w-20">
        {[6, 13, 23].map((r) => <option key={r} value={r}>{r}%</option>)}
      </select>
      <input type="hidden" name="active" value="true" />
      <button type="submit" className="btn-secondary h-8">Guardar</button>
      <button type="submit" formAction={removeCatalogItem.bind(null, item.id)} className="grid size-8 place-items-center rounded-md text-[var(--color-text-placeholder)] hover:bg-neutral-200 hover:text-[var(--color-danger)]" aria-label="Remover">
        <Trash2 className="size-4" />
      </button>
    </form>
  )
}

function NewItemRow() {
  return (
    <form action={saveCatalogItem} className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3 text-sm">
      <input name="description" placeholder="Novo item…" className="input h-8 min-w-0 flex-1" required />
      <input name="category" placeholder="Categoria" className="input h-8 w-32" />
      <span className="text-xs text-[var(--color-text-muted)]">€</span>
      <input name="unitPrice" placeholder="0" inputMode="decimal" className="input h-8 w-20 text-right" required />
      <select name="unit" defaultValue="unidade" className="input h-8 w-24">
        {['m2', 'ml', 'unidade', 'hora', 'global'].map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
      <select name="ivaRate" defaultValue={23} className="input h-8 w-20">
        {[6, 13, 23].map((r) => <option key={r} value={r}>{r}%</option>)}
      </select>
      <input type="hidden" name="active" value="true" />
      <button type="submit" className="btn-primary h-8">
        <Plus className="size-4" /> Adicionar
      </button>
    </form>
  )
}
