'use client';

import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Plus } from 'lucide-react';
import { Blob, type BlobState } from '@/components/blob';
import { useCrm } from '@/components/CrmProvider';
import CreateModal from '@/components/CreateModal';
import LogInteractionModal from '@/components/LogInteractionModal';
import ThisWeekQueue from '@/components/ThisWeekQueue';
import { CelebrateProvider } from '@/components/game/Celebrate';
import { PageTransition } from '@/components/motion';
import { useToast } from '@/components/ToastProvider';
import * as crm from '@/lib/crm';
import { useReorderSignals } from '@/hooks/useReorderSignals';
import { useGrowthItems } from '@/hooks/useGrowthItems';
import { growthDueThisWeek } from '@/utils/growth';
import {
  buildFollowupActions,
  deriveRetentionDueSignals,
  existingRetentionReferenceDate,
} from '@/utils/followup-policy';
import { buildThisWeekQueue } from '@/utils/this-week-queue';
import { distinctOrderCount, planRetentionTouch } from '@/utils/retention-touch';
import { useBusinessDateKey } from '@/utils/useBusinessDateKey';
import { formatBangkokWeekdayDate } from '@/utils/format';
import { splitDealFormSource } from '@/utils/acquisition-source';
import { buildTodaysLeads } from '@/utils/prospecting';

export default function TodayPage() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [logDealId, setLogDealId] = useState<string | undefined>();
  const [logCompanyId, setLogCompanyId] = useState<string | undefined>();
  // The mascot sleeps while the streak is cold and jumps for joy on a win (ThisWeekQueue).
  const [mood, setMood] = useState<BlobState>('idle');
  const {
    deals,
    contacts,
    companies,
    meetings,
    accountEvents,
    accountEventsUnavailable,
    loading,
    error,
    createDeal,
    addMeeting,
    refresh,
  } = useCrm();

  const { addToast } = useToast();
  const todayKey = useBusinessDateKey();
  const headerDate = formatBangkokWeekdayDate();
  // Preserve /retention's UTC health/cadence input; its mixed date boundary is pinned in tests.
  const retentionCalculationDate = existingRetentionReferenceDate();
  const retentionSignals = useMemo(() => deriveRetentionDueSignals({
    today: todayKey,
    retentionCalculationDate,
    companies,
    deals,
    meetings,
    accountEvents,
    accountEventsUnavailable,
  }), [
    todayKey,
    retentionCalculationDate,
    companies,
    deals,
    meetings,
    accountEvents,
    accountEventsUnavailable,
  ]);
  const actions = useMemo(() => buildFollowupActions({
    today: todayKey,
    deals,
    companies,
    contacts,
    retentionDue: retentionSignals,
  }), [todayKey, deals, companies, contacts, retentionSignals]);

  // CRM-linked reorder signals only; unlinked historical buyers stay on /signals.
  const { signals } = useReorderSignals();
  // Laya's fit grade per prospect orders today's leads; without it they still show, by priority.
  const [fits, setFits] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let cancelled = false;
    crm.getCompanyFits()
      .then(rows => { if (!cancelled) setFits(new Map([...rows].map(([id, fit]) => [id, fit.best.noul]))); })
      .catch(() => { /* leads still show, ordered by priority */ });
    return () => { cancelled = true; };
  }, [companies]);
  const leads = useMemo(() => buildTodaysLeads({ deals, companies, contacts, meetings, fits, today: todayKey }),
    [deals, companies, contacts, meetings, fits, todayKey]);

  // A lead waiting on its first reply is worked from Today's leads, so the dated follow-up
  // lists leave it out instead of showing it twice. Decisions (needsReview) still show.
  const queue = useMemo(() => {
    const full = buildThisWeekQueue({ candidates: actions, retentionDue: retentionSignals, signals, today: todayKey });
    const notLead = (c: { dealId: string | null }) => !c.dealId || !leads.dealIds.has(c.dealId);
    return { ...full, overdue: full.overdue.filter(notLead), dueThisWeek: full.dueThisWeek.filter(notLead), needsDate: full.needsDate.filter(notLead) };
  }, [actions, retentionSignals, signals, todayKey, leads.dealIds]);

  // Funding and PR steps from the Growth page; This week shows the late and this-week ones.
  const { items: growthItems } = useGrowthItems();
  const growthDue = useMemo(() => growthDueThisWeek(growthItems, todayKey), [growthItems, todayKey]);

  const handleCreate = async (data: Parameters<typeof createDeal>[0]) => {
    // A source set while adding the deal belongs to its company; save it first so the
    // refresh after the deal is created already shows it.
    const { deal, companyPatch } = splitDealFormSource(data);
    if (companyPatch) {
      const { id, ...patch } = companyPatch;
      await crm.updateCompany(id, patch);
    }
    await createDeal(deal);
  };

  const openDealLog = (dealId: string) => {
    setLogDealId(dealId);
    setIsLogOpen(true);
  };

  const openCompanyLog = (companyId: string) => {
    setLogCompanyId(companyId);
    setIsLogOpen(true);
  };

  // A check-in logged here is a retention touch: move the account's saved check-in date
  // (otherwise it stays overdue) and run the reward draw, as /retention used to.
  const recordCheckIn = async (companyId: string, dealId: string | null) => {
    const company = companies.find((c) => c.id === companyId);
    const tier = retentionSignals.find((s) => s.companyId === companyId)?.tier;
    if (!company || !tier) return;
    const orderCount = distinctOrderCount(
      accountEvents.filter((e) => e.company_id === companyId),
      deals.filter((d) => d.company_id === companyId && d.stage === 'closed_won'),
    );
    const plan = planRetentionTouch({ company, tier, orderCount, today: todayKey });
    if (!plan) return;
    try {
      await crm.updateCompany(companyId, plan.companyPatch);
    } catch (err) {
      console.error('Interaction saved, but the check-in date did not update:', err);
      addToast('Logged, but the next check-in date did not update', 'error');
    }
    const option = plan.reward?.option;
    if (!option) return;
    addToast(`Reward idea for ${company.name}: ${option.label}`);
    try {
      await addMeeting({
        description: `Surprise reward (${plan.reward!.trigger}): ${option.label}`,
        type: 'reward',
        date: todayKey,
        company_id: companyId,
        contact_ids: [],
        deal_id: dealId,
        product: null,
        summary: option.note,
        outcome: 'positive',
        followup_date: null,
      });
    } catch (err) {
      console.error('Interaction saved, but reward audit logging failed:', err);
    }
  };

  return (
    <CelebrateProvider>
    <PageTransition className="p-4 md:p-6 max-w-6xl pb-20 lg:pb-6">
      <div className="mb-5 md:mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Blob state={mood} size={48} follow aria-label="Butter mascot" />
          <div className="min-w-0">
            <p className="zams-eyebrow mb-1">{headerDate} · Bangkok</p>
            <h1 className="zams-display text-3xl md:text-[34px] leading-none">This week</h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-clay-hairline px-3 sm:px-4 text-sm font-medium text-clay-ink hover:border-clay-lavender hover:text-clay-lavender transition-colors"
          >
            <Plus className="h-4 w-4" />
            New deal
          </button>
          <button
            type="button"
            onClick={() => setIsLogOpen(true)}
            className="clay-btn-primary motion-press min-h-11"
          >
            <MessageCircle className="h-4 w-4" />
            <span>Log interaction</span>
          </button>
        </div>
      </div>

      <ThisWeekQueue
        leads={leads}
        growth={growthDue}
        contacts={contacts}
        onMood={setMood}
        queue={queue}
        today={todayKey}
        deals={deals}
        companies={companies}
        meetings={meetings}
        loading={loading}
        sourceError={Boolean(error)}
        accountEventsUnavailable={accountEventsUnavailable}
        onRetry={() => { void refresh(); }}
        onLogDeal={openDealLog}
        onLogCompany={openCompanyLog}
      />

      <CreateModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSave={handleCreate}
        type="deal"
        companies={companies}
        contacts={contacts}
      />
      <LogInteractionModal
        isOpen={isLogOpen}
        onClose={() => {
          setIsLogOpen(false);
          setLogDealId(undefined);
          setLogCompanyId(undefined);
        }}
        onSave={async (meeting) => {
          await addMeeting(meeting);
          if (logCompanyId) {
            await recordCheckIn(logCompanyId, meeting.deal_id ?? null);
            await refresh();
          }
        }}
        deals={deals}
        contacts={contacts}
        companies={companies}
        selectedDealId={logDealId}
        initialCompanyId={logCompanyId}
      />
    </PageTransition>
    </CelebrateProvider>
  );
}
