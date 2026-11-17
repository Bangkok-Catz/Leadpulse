-- Instagram and WhatsApp get their own boxes on a contact.
--
-- ADDITIVE. Two nullable text columns; no row changes. Until now the LINE box was the only
-- chat field, so 24 contacts hold Instagram handles or WhatsApp numbers in contacts.line
-- ("IG @ubuntueat", "WhatsApp +65 …"). The app reads those correctly without moving them
-- (utils/contact-channels.ts splitLegacyLine); new entries go in their own box.
--
-- instagram: the handle without @ ("ubuntueat"). whatsapp: the number as written.

alter table public.contacts add column if not exists instagram text;
alter table public.contacts add column if not exists whatsapp text;

comment on column public.contacts.instagram is 'Instagram handle without @; older handles may still sit in line (utils/contact-channels.ts)';
comment on column public.contacts.whatsapp is 'WhatsApp number as written; older numbers may still sit in line';
