-- 0004 — storage bucket for broker submission attachments
--
-- The `.eml`, ACORD/supplemental PDFs, and the loss-run workbook are uploaded
-- here on intake and downloaded by the extraction agent. Private bucket; access
-- is via the service-role key only.

insert into storage.buckets (id, name, public)
values ('submissions', 'submissions', false)
on conflict (id) do nothing;
