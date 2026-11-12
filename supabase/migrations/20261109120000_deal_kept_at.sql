-- Reach-out sweep: remember which never-contacted leads Pat chose to keep.
--
-- ADDITIVE. One nullable column; existing rows stay null (not sorted yet).
--
-- deals.kept_at: the day Pat pressed Keep on this deal in the Reach-out sweep. The sweep shows
-- only open, never-contacted leads with kept_at null, and Today's leads takes kept leads before
-- the rest. "Not now" and "Not a fit" park the deal as before (park_reason), so they need no
-- column. Undo sets it back to null.

alter table public.deals
  add column if not exists kept_at date;

comment on column public.deals.kept_at is
  'Day Pat kept this lead in the Reach-out sweep. null = not sorted yet. Kept leads come first in Today''s leads.';
