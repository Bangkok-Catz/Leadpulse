// Loads what the This week page loads and builds the same queue, on the server,
// for the morning digest and the afternoon nudge. Read-only.

import type { Company, Contact, Deal, Meeting } from '@/types/crm';
import * as crm from '@/lib/crm';
import { fetchReorderSignalRows, rankSignals } from '@/lib/historical';
import { buildAfternoonNudge, buildDailyDigest, type AfternoonNudge, type DailyDigest, type DigestParkSuggestion, type DigestWaiting } from '@/utils/daily-digest';
import { buildFollowupActions, deriveRetentionDueSignals, existingRetentionReferenceDate } from '@/utils/followup-policy';
import { buildThisWeekQueue, type ThisWeekQueue } from '@/utils/this-week-queue';
import { buildWaitingOnYou, waitingLabel } from '@/utils/waiting-on-you';
import { buildParkSuggestions, parkSuggestionLabel } from '@/utils/park-suggestion';
import { getGrowthItems } from '@/lib/growth';
import { businessDaysBetween } from '@/utils/business-time';
import { growthDueThisWeek } from '@/utils/growth';
import type { DigestGrowth } from '@/utils/daily-digest';

/** Funding steps due today or late. An extra: without it the digest still goes out. */
async function loadGrowthDue(today: string): Promise<DigestGrowth[]> {
  const items = await getGrowthItems().catch(() => []);
  const due = growthDueThisWeek(items, today);
  return [...due.overdue, ...due.week.filter(item => item.next_date === today)].map(item => ({
    name: item.name,
    step: item.next_step,
    daysLate: Math.max(0, businessDaysBetween(item.next_date!, today)),
  }));
}

async function loadThisWeek(today: string): Promise<{ queue: ThisWeekQueue; waiting: DigestWaiting[]; parkSuggested: DigestParkSuggestion[] }> {
  const [companies, contacts, dealRows, meetingRows, accountEvents, signalRows] = await Promise.all([
    crm.getCompanies(),
    crm.getContacts(),
    crm.getDeals(),
    crm.getMeetings(),
    // Sales history and reorder signals are extras: without them check-ins are thinner, not wrong.
    crm.getAccountEvents().then(data => ({ data, unavailable: false })).catch(() => ({ data: [], unavailable: true })),
    fetchReorderSignalRows().catch(() => []),
  ]);
  // Same defaults CrmProvider applies in the browser.
  const deals = (dealRows as Deal[]).map(deal => ({ ...deal, contact_ids: deal.contact_ids || [] }));
  const meetings = (meetingRows as Meeting[]).map(meeting => ({ ...meeting, contact_ids: meeting.contact_ids || [], direction: meeting.direction ?? null }));

  const retentionDue = deriveRetentionDueSignals({
    today,
    retentionCalculationDate: existingRetentionReferenceDate(),
    companies: companies as Company[],
    deals,
    meetings,
    accountEvents: accountEvents.data,
    accountEventsUnavailable: accountEvents.unavailable,
  });
  const candidates = buildFollowupActions({ today, deals, companies: companies as Company[], contacts: contacts as Contact[], retentionDue });
  const signals = rankSignals(
    signalRows,
    meetings as unknown as Parameters<typeof rankSignals>[1],
    deals as unknown as Parameters<typeof rankSignals>[2],
    {},
  );
  const queue = buildThisWeekQueue({ candidates, retentionDue, signals, today });

  const companyName = new Map((companies as Company[]).map(company => [company.id, company.name]));
  const nameOf = (deal: Deal) => (deal.company_id && companyName.get(deal.company_id)) || deal.client || deal.title || 'Deal';
  // Laya's grades are left out here, so a waiting deal is never marked as "asked"; it is still listed.
  const waiting = buildWaitingOnYou({ deals, meetings, today })
    .sort((a, b) => b.daysWaiting - a.daysWaiting)
    .map(item => ({
      name: nameOf(item.deal),
      label: `Buyer replied ${waitingLabel(item.daysWaiting)}, nothing sent since`,
    }));
  // Same list as the Pipeline's "Park this deal?" filter. The afternoon nudge leaves it out.
  const parkSuggested = buildParkSuggestions({ deals, meetings })
    .map(item => ({ name: nameOf(item.deal), label: parkSuggestionLabel(item) }));

  return { queue, waiting, parkSuggested };
}

export async function loadDailyDigest(today: string, appUrl?: string | null): Promise<DailyDigest> {
  const [thisWeek, growth] = await Promise.all([loadThisWeek(today), loadGrowthDue(today)]);
  return buildDailyDigest({ ...thisWeek, growth, today, appUrl });
}

export async function loadAfternoonNudge(today: string, appUrl?: string | null): Promise<AfternoonNudge> {
  return buildAfternoonNudge({ ...(await loadThisWeek(today)), today, appUrl });
}
