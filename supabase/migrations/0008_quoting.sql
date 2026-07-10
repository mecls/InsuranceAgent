-- 0008 — vendor quoting
--
-- The catálogo de preços (editable rate card, deterministic pricing basis) and
-- the single-row app settings (global Automate switch). Seeded with 2025-2026
-- Portugal market averages; all values are editable in the UI. The Case File
-- (customer, request, clarifications, line items, pricing, quote) lives in
-- runs.case_file jsonb, so no runs columns change here.

create table if not exists public.catalog_items (
  id          text primary key,
  category    text not null,
  description text not null,
  unit        text not null check (unit in ('m2','ml','unidade','hora','global')),
  unit_price  numeric not null,
  iva_rate    int not null check (iva_rate in (6,13,23)),
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table if not exists public.app_settings (
  id        text primary key default 'default',
  automate  boolean not null default false
);

insert into public.app_settings (id, automate) values ('default', false)
  on conflict (id) do nothing;

insert into public.catalog_items (id, category, description, unit, unit_price, iva_rate) values
  ('pintura-interior',          'Pintura/Obras', 'Pintura interior', 'm2', 9, 6),
  ('pintura-fachada',           'Pintura/Obras', 'Pintura de fachada exterior', 'm2', 22, 6),
  ('impermeabilizacao',         'Pintura/Obras', 'Impermeabilização de fachada/terraço', 'm2', 20, 6),
  ('reparacao-fissuras',        'Pintura/Obras', 'Reparação de fissuras', 'global', 150, 6),
  ('andaimes-aluguer',          'Pintura/Obras', 'Aluguer de andaimes de fachada', 'm2', 5, 23),
  ('andaimes-montagem',         'Pintura/Obras', 'Montagem/desmontagem de andaimes', 'm2', 6, 23),
  ('estuque-interior',          'Pintura/Obras', 'Estuque interior', 'm2', 18, 6),
  ('reboco-parede',             'Pintura/Obras', 'Reboco de parede', 'm2', 22, 6),
  ('remodelacao-chave',         'Remodelação', 'Remodelação escritório/casa (chave na mão)', 'm2', 500, 6),
  ('divisorias-pladur',         'Remodelação', 'Divisórias em pladur', 'm2', 30, 6),
  ('instalacao-eletrica-ponto', 'Remodelação', 'Instalação elétrica (ponto de tomada/luz)', 'unidade', 35, 6),
  ('pavimento-vinilico',        'Remodelação', 'Pavimento vinílico/flutuante', 'm2', 35, 6),
  ('pintura-pos-obra',          'Remodelação', 'Pintura pós-obra', 'm2', 8, 6),
  ('reparacao-fuga',            'Canalização', 'Reparação de fuga/canalização', 'global', 120, 23),
  ('substituicao-torneira',     'Canalização', 'Substituição de torneira/misturadora', 'unidade', 130, 23),
  ('desentupimento',            'Canalização', 'Desentupimento', 'global', 90, 23),
  ('instalacao-esquentador',    'Canalização', 'Instalação de esquentador', 'unidade', 180, 23),
  ('instalacao-termoacumulador','Canalização', 'Instalação de termoacumulador', 'unidade', 250, 23),
  ('limpeza-hora',              'Limpeza', 'Limpeza profissional (hora)', 'hora', 12, 23),
  ('limpeza-area',              'Limpeza', 'Limpeza profissional (por área)', 'm2', 2, 23),
  ('limpeza-pos-obra',          'Limpeza', 'Limpeza pós-obra', 'm2', 8, 23),
  ('limpeza-pos-obra-hora',     'Limpeza', 'Limpeza pós-obra (hora)', 'hora', 25, 23),
  ('jardinagem-hora',           'Limpeza', 'Jardinagem/manutenção de espaços verdes', 'hora', 20, 23),
  ('manutencao-jardim-mensal',  'Limpeza', 'Manutenção mensal de jardim (médio)', 'global', 180, 23)
on conflict (id) do nothing;
