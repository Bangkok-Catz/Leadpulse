// LeadPulse CRM — Full Database Schema
// Four connected databases: Contacts, Companies, Deal Pipeline, Meetings

// ─── Companies ───
export type CompanyStatus = 'prospect' | 'active_customer' | 'inactive' | 'lost';

export interface Company {
  id: string;
  name: string;
  status: CompanyStatus;
  lead_source: string;
  /** how the account was acquired (utils/acquisition-source.ts); null = not recorded */
  acquisition_source?: 'outbound' | 'meta_ad' | 'social_post' | 'press' | 'referral' | 'inbound_other' | null;
  /** optional campaign or ad name for the acquisition source */
  acquisition_campaign?: string | null;
  /** Pat's Local / Export choice (utils/account-market.ts); null = not set, rules decide */
  market?: 'local' | 'export' | null;
  account_owner: string;
  last_contact_date: string | null;
  tags: string[];
  industry: string | null;
  size: string | null;
  address: string | null;
  website: string | null;
  /** what the account makes or sells, in its own words; drafts name it */
  what_they_make?: string | null;
  logo_url?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Retention cadence (Slice 5, Phase 2): last logged human touch + derived next due. */
  last_human_touch?: string | null;
  next_touch_due?: string | null;

  // Stakeholder mini-map (company-level; deals inherit)
  champion_contact_id?: string | null;
  decision_maker_contact_id?: string | null;
  blocker_contact_id?: string | null;
  blocker_label?: string | null;
  map_status?: 'unknown' | 'partial' | 'complete';
  /** a branch points at its main account ("Branch of" in Possible duplicates); null = none */
  parent_company_id?: string | null;
}

// ─── Contacts ───
export type ContactStatus = 'uncontacted' | 'active' | 'replied' | 'not_interested' | 'no_response' | 'parked';
export type ContactIdentityQuality = 'named' | 'role_only' | 'company_route' | 'unknown';
export type OutreachLanguage = 'thai' | 'english' | 'autodetect';
export type OutreachLanguageBasis = 'last_inbound' | 'pat_override' | 'autodetect';

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  phone_second: string | null;
  line: string | null;
  job_title: string | null;
  company_id: string | null;
  status: ContactStatus;
  identity_quality?: ContactIdentityQuality | null;
  outreach_language?: OutreachLanguage;
  outreach_language_basis?: OutreachLanguageBasis;
  last_contacted_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Deal Pipeline ───
export type DealStage =
  | 'research'
  | 'contacted'
  | 'proposal'
  | 'negotiation'
  | 'closed_won'
  | 'closed_lost';

// Action-board state: what needs to happen next. This is intentionally
// separate from the pipeline stage, which remains the sales-health signal.
export type DealWorkflowAction =
  | 'outreach'
  | 'reply'
  | 'sample'
  | 'testing'
  | 'reschedule'
  | 'parked'
  | 'success';

export type NudgeStage = 'warm' | 'remind' | 'firm' | 'parking';
export type SampleStatus = 'sent' | 'received';
/** Payment state of a test/order. 'unknown' is a valid, honest value — never a gap to fill. */
export type CompStatus = 'paid' | 'comped' | 'unknown';
export type Value_type = 'estimated' | 'committed' | 'unknown';

export interface ReshipEntry {
  date: string;
  reason: string;
}

/** Facts asked on a qualifying call; every answer is optional. */
export interface CallChecklist {
  /** who decides on the purchase */
  decision_maker?: string;
  /** how much of this product they use per month (kg) */
  monthly_volume_kg?: number;
  /** what they use today */
  current_product?: string;
}

export interface Deal {
  id: string;
  title: string;
  stage: DealStage;
  product: string;
  client: string;          // denormalized for display
  company_id: string | null;
  contact_ids: string[];
  value: number | null;
  priority: 'high' | 'medium' | 'low';
  next_action: string | null;
  draft_primary_ask?: string | null;
  followup_date: string | null;
  last_outcome: string | null;
  /**
   * The buyer's reply VERBATIM (first-person, exactly as received — email/LINE/
   * call transcript excerpt). Distinct from `last_outcome`, which is the rep's
   * paraphrase. The local Laya buyer-response interpretation reads this field
   * first because it handles first-person buyer text far better than reported
   * speech (scripts/eval_results/2026-09-23-buyer-response-eval-report.md).
   */
  buyer_reply?: string | null;
  /** the order size the buyer stated, confirmed by Pat from the reply (kg) */
  stated_order_kg?: number | null;
  /** answers to the qualifying call checklist */
  call_checklist?: CallChecklist | null;
  nudge_count: number;
  workflow_action?: DealWorkflowAction | null;
  nudge_stage?: NudgeStage | null;
  sample_status?: SampleStatus | null;
  /**
   * Payment state of the test/order. PROPOSED schema
   * (`supabase/migrations/20260914_add_deal_comp_status.sql`) — deliberately NOT
   * applied, so this is absent on every live row. 'unknown' is the honest
   * default, and it is never inferred from order value or `is_zero_value`.
   */
  comp_status?: CompStatus | null;
  /** Date the paid test was recorded against. Same migration, also not applied. */
  paid_test_date?: string | null;
  /** Exit metadata — not journey lanes */
  lost_reason?: 'price' | 'taste' | 'timing' | 'vendor_list' | 'no_reply' | 'other' | null;
  park_reason?: string | null;
  won_note?: string | null;
  /** the day Pat kept this never-contacted lead in the Reach-out sweep; kept leads come first in Today's leads */
  kept_at?: string | null;
  created_at: string;
  updated_at: string;

  // Revenue reporting fields (2026-08-28)
  currency?: string | null;
  close_date?: string | null;
  stage_probability?: number | null;

  // ─── Sales Controls (2026-09-03) ───

  // Deal health
  blocker?: string | null;
  owner_contact_id?: string | null;
  stale_days?: number | null;

  // Test-to-order
  test_recipient_contact_id?: string | null;
  test_application?: string | null;
  test_conditions?: string | null;
  test_result_texture?: string | null;
  test_result_flavour?: string | null;
  test_feedback_date?: string | null;
  reship_count?: number;
  reship_history?: ReshipEntry[] | null;

  // Forecast integrity
  decision_maker_contact_id?: string | null;
  value_type?: Value_type | null;
  conflicting_signals?: string[] | null;
}

// ─── Meetings ───
export type MeetingType = 'call' | 'email' | 'dm' | 'meeting' | 'sample_sent' | 'note' | 'nudge' | 'reward';
export type MeetingDirection = 'inbound' | 'outbound' | 'internal' | 'unknown';

export interface Meeting {
  id: string;
  description: string;
  type: MeetingType;
  date: string;
  company_id: string | null;
  contact_ids: string[];
  deal_id: string | null;
  product: string | null;
  summary: string | null;
  outcome: 'positive' | 'neutral' | 'negative' | 'no_response' | null;
  /**
   * Who initiated the touch: outbound send, inbound customer reply, internal note/meeting.
   * Present in the database and returned by getMeetings() (`select '*'`). Evidence tiers
   * depend on it: without direction every logged row is indistinguishable from internal
   * workflow activity.
   *
   * Declared ONCE. main and the send-gauge branch each added this field independently;
   * the two declarations were type-equivalent (`MeetingDirection | null`), so the
   * duplicate was removed without choosing either variant's semantics.
   */
  direction?: MeetingDirection | null;
  followup_date: string | null;
  created_at: string;
}

// ─── Lookup Maps ───
export const STAGE_LABELS: Record<DealStage, string> = {
  research: 'Research',
  contacted: 'Contacted',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
};

export const STAGE_ORDER: DealStage[] = [
  'research',
  'contacted',
  'proposal',
  'negotiation',
  'closed_won',
];

export const COMPANY_STATUS_LABELS: Record<CompanyStatus, string> = {
  prospect: 'Prospect',
  active_customer: 'Active Customer',
  inactive: 'Inactive',
  lost: 'Lost',
};

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  uncontacted: 'Uncontacted',
  active: 'Active',
  replied: 'Replied',
  not_interested: 'Not Interested',
  no_response: 'No Response',
  parked: 'Parked',
};

export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  call: 'Call',
  email: 'Email',
  dm: 'DM',
  meeting: 'Meeting',
  sample_sent: 'Sample Sent',
  note: 'Note',
  nudge: 'Nudge',
  reward: 'Reward',
};

export const PRODUCT_OPTIONS = [
  'Butter',
  'Condensed Milk',
  'Both',
  'White Chocolate',
  'Custom',
];

export const VALUE_TYPE_LABELS: Record<Value_type, string> = {
  estimated: 'Estimated',
  committed: 'Committed',
  unknown: 'Unknown',
};
