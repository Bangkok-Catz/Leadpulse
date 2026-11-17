-- A business that has closed down is an account status of its own.
--
-- ADDITIVE. One more allowed value for companies.status: 'closed'. No row changes.
--
-- Why a status and not a note or a parked deal: every work list and both search jobs already
-- read status. Today's leads, the Reach-out sweep, the Accounts tiles and the lead brief count
-- only 'prospect' or 'active_customer'; the owner search's queue does the same; new-lead
-- discovery never proposes a business that is already an account. So one value takes a closed
-- business out of all of them, and "Reopen" puts it back.
--
-- LeadPulse sets it from "Closed down" on a lead or an account, which also parks the account's
-- open deals with the reason "Closed down" (no follow-up date).

alter table public.companies drop constraint if exists companies_status_check;
alter table public.companies add constraint companies_status_check
  check (status = any (array['prospect'::text, 'active_customer'::text, 'inactive'::text, 'lost'::text, 'closed'::text]));
