'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Deal, DealWorkflowAction, PRODUCT_OPTIONS } from '@/types/crm';
import { useCrm } from '@/components/CrmProvider';
import { useSearchParams } from 'next/navigation';
import { useQuerySelection } from '@/hooks/useQuerySelection';
import CreateModal from '@/components/CreateModal';
import ProspectsTab from '@/components/ProspectsTab';
import ReachOutSweep, { useSweepCount } from '@/components/ReachOutSweep';
import PipelineToolbar from '@/components/pipeline/PipelineToolbar';
import { SourceFunnelLine, SourceSelect } from '@/components/pipeline/SourceFunnel';
import ReviewQueue from '@/components/pipeline/ReviewQueue';
import DealsTable from '@/components/pipeline/DealsTable';
import LanePickerSheet from '@/components/pipeline/LanePickerSheet';
import { DraggableCard, DroppableLane } from '@/components/pipeline/BoardDnd';
import { LANE_CRITERIA, dueStateFor, whyNow } from '@/components/pipeline/board-view';
import DealDetail from '@/components/DealDetail';
import DealCardContent from '@/components/DealCardContent';
import LaneGateModal, { LaneGatePayload } from '@/components/LaneGateModal';
import ReviewFixModal, { ReviewFixPayload } from '@/components/ReviewFixModal';
import { useToast } from '@/components/ToastProvider';
import { CelebrateProvider, useCelebrate } from '@/components/game/Celebrate';
import { GameBoard, type BoardToken } from '@/components/game/GameBoard';
import { boardCounts, stopOf, type StopId } from '@/utils/game';
import { businessDateKey } from '@/utils/business-time';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import * as crm from '@/lib/crm';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import { Plus, Loader2, ArrowRight } from 'lucide-react';
import clsx from 'clsx';
import { formatBangkokWeekdayDate, formatBaht, sumLaneValues } from '@/utils/format';
import { calculateWeightedForecast, calculateSourcePerformance, lostReasonTotals, parkReasonTotals, weightedLaneValues } from '@/utils/analytics-metrics';
import { WORKFLOW_LANES, WORKFLOW_BY_ID, getWorkflowAction, isOnJourneyBoard, isJourneyLane, deriveNudge, formatDerivedNudgeBadge, outboundSendCountForDeal } from '@/utils/deal-workflow';
import ExitDealModal, { ExitDealPayload } from '@/components/ExitDealModal';
import { useLayaGrades } from '@/hooks/useLayaReviewList';
import OverdueBulkBar from '@/components/pipeline/OverdueBulkBar';
import ParkSuggestionBar from '@/components/pipeline/ParkSuggestionBar';
import { buildParkSuggestions } from '@/utils/park-suggestion';
import MissingDataBar from '@/components/pipeline/MissingDataBar';
import LayaStatusLine from '@/components/LayaStatusLine';
import { buildDataGapReport, dealIdsWithGap, isDataGap, type DataGap } from '@/utils/deal-data-gaps';
import { buildLayaStatus } from '@/utils/laya-status';
import { buildWaitingOnYou } from '@/utils/waiting-on-you';
import { splitToContact } from '@/utils/to-contact';
import { lastContactDates, quietLabel } from '@/utils/last-contact';
import { buildStalled, daysInLane, laneTimelines, pipelineOutcomes, stallThresholds } from '@/utils/lane-time';
import { calculateLeadScore, scoreToTier, type LeadTier } from '@/utils/lead-scoring';
import { BoardAttentionFilter, BoardSort, capLane, LANE_CARD_CAP, reviewReasons, REVIEW_LABEL, buildReviewReport, buildReviewFix, filterAndSortBoardDeals, findDealsMatchingSearch, getDoNowCounts, localDateKey } from '@/utils/deal-board';
import { buildCloseUpdate } from '@/utils/deal-close';
import { SOURCE_FILTER_OPTIONS, buildSourceFunnel, filterDealsBySource, sourceByCompany, splitDealFormSource, type SourceFilter } from '@/utils/acquisition-source';
import { buildLaneGateDecision } from '@/utils/lane-gate';
import { buildDealCardPresentation } from '@/utils/deal-card';
import { PageTransition, StaggerList, StaggerItem } from '@/components/motion';
import { Blob, type BlobState } from '@/components/blob';
import { LANE_BLOB_STATE } from '@/utils/lane-blob';
import { EASE_OUT, pressScale, springPress} from '@/lib/motion';

const TO_CONTACT_PREVIEW = 24;

type ViewMode = 'prospects' | 'tocontact' | 'board' | 'parked' | 'won' | 'lost' | 'table';
/** Four tabs; Not started and Closed each hold a small switch between their lists. */
type TabGroup = 'board' | 'notstarted' | 'table' | 'closed';
const TAB_OF: Record<ViewMode, TabGroup> = {
  board: 'board', tocontact: 'notstarted', prospects: 'notstarted', table: 'table', won: 'closed', lost: 'closed', parked: 'closed',
};

// Suspense boundary for useSearchParams (via useQuerySelection) — see its docs.
export default function DealsPage() {
  return (
    <Suspense>
      <CelebrateProvider>
        <DealsBoard />
      </CelebrateProvider>
    </Suspense>
  );
}

function DealsBoard() {
  const [view, setView] = useState<ViewMode>('board');
  const [mobileLane, setMobileLane] = useState<DealWorkflowAction>('outreach');
  const [selectedDeal, setSelectedDeal] = useQuerySelection('deal');
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Set by a prospect's "Start a deal"; kept in state so the form sees a stable object.
  const [dealPrefill, setDealPrefill] = useState<{ company_id: string } | undefined>();
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [gate, setGate] = useState<{ deal: Deal; target: DealWorkflowAction } | null>(null);
  const [reviewFix, setReviewFix] = useState<{ deal: Deal; reasons: ReturnType<typeof reviewReasons> } | null>(null);
  const [celebrate, setCelebrate] = useState<{ dealId: string; laneId: DealWorkflowAction } | null>(null);
  const [pickerDeal, setPickerDeal] = useState<Deal | null>(null);
  // `/deals?missing=<gap|all>` (the This week links) lands on the Missing data filter.
  // `/deals?filter=waiting-on-you` does the same for that filter.
  const searchParams = useSearchParams();
  const requestedGap = searchParams.get('missing');
  const [attentionFilter, setAttentionFilter] = useState<BoardAttentionFilter>(
    requestedGap ? 'missing-data'
      : searchParams.get('filter') === 'waiting-on-you' ? 'waiting-on-you'
      : searchParams.get('filter') === 'stalled' ? 'stalled'
      : searchParams.get('filter') === 'park-suggested' ? 'park-suggested' : 'all');
  const [gapFilter, setGapFilter] = useState<DataGap | 'all'>(isDataGap(requestedGap) ? requestedGap : 'all');
  const [boardSort, setBoardSort] = useState<BoardSort>('do-now');
  /** lanes showing every card instead of the first LANE_CARD_CAP */
  const [expandedLanes, setExpandedLanes] = useState<ReadonlySet<string>>(new Set());
  const toggleLane = (laneId: string) => setExpandedLanes(prev => {
    const next = new Set(prev);
    if (next.has(laneId)) next.delete(laneId); else next.add(laneId);
    return next;
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [productFilter, setProductFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<Deal['priority'] | 'all'>('all');
  // `/deals?source=meta_ad` lands on one acquisition source.
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(() => {
    const requested = searchParams.get('source');
    return SOURCE_FILTER_OPTIONS.some(option => option.value === requested) ? requested as SourceFilter : 'all';
  });

  const { deals: dbDeals, contacts: dbContacts, companies: dbCompanies, meetings: dbMeetings, activities, loading, refresh, createDeal, logActivity, addMeeting } = useCrm();
  const { addToast } = useToast();
  const reduceMotion = usePrefersReducedMotion();
  const contacts = dbContacts;
  const companies = dbCompanies;
  // The source filter narrows every view at once — board, To contact, exits and table.
  const companySources = useMemo(() => sourceByCompany(companies), [companies]);
  const deals: Deal[] = useMemo(() => filterDealsBySource(dbDeals, sourceFilter, companySources), [dbDeals, sourceFilter, companySources]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  /* ─── Board overflow indicator ─── */
  const boardRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(true); // denser default so five journey lanes fit mid-width better
  const [boardScroll, setBoardScroll] = useState({ canScrollRight: false, canScrollLeft: false });
  const todayStr = localDateKey();

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const update = () => {
      setBoardScroll({
        canScrollRight: el.scrollLeft + el.clientWidth < el.scrollWidth - 8,
        canScrollLeft: el.scrollLeft > 8,
      });
    };
    update();
    const raf = requestAnimationFrame(update);
    el.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [view, compact]);

  const scrollBoard = (dir: 1 | -1) => {
    const el = boardRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  // Outreach deals with no logged call, email, DM or meeting wait in the To contact tab;
  // the journey board holds the deals where a conversation has started.
  const { toContact: toContactDeals, inConversation: actionBoardDeals } = useMemo(
    () => splitToContact(deals, dbMeetings || []),
    [deals, dbMeetings]
  );
  const [showAllToContact, setShowAllToContact] = useState(false);
  const [sweepOpen, setSweepOpen] = useState(false);
  const sweepCount = useSweepCount();

  // Laya's grades for deals with a pasted reply; review ids drive the "Laya review" filter.
  const { grades: layaGrades, judgments: layaJudgments, status: layaLoad } = useLayaGrades(actionBoardDeals, dbMeetings || []);
  const layaReviewIds = useMemo(
    () => new Set([...layaGrades].filter(([, grade]) => grade.status === 'needs_review').map(([id]) => id)),
    [layaGrades]
  );

  // "Hottest" sort: Laya's tier when the deal is graded, otherwise the CRM tier; the CRM
  // score breaks ties within a tier.
  const hotness = useMemo(() => {
    const rank: Record<LeadTier, number> = { D: 0, C: 1, B: 2, A: 3, S: 4 };
    return new Map(actionBoardDeals.map(deal => {
      const score = calculateLeadScore(deal);
      const grade = layaGrades.get(deal.id);
      const tier = grade?.status === 'graded' ? grade.tier : scoreToTier(score);
      return [deal.id, rank[tier] * 1000 + score];
    }));
  }, [actionBoardDeals, layaGrades]);

  // Open deals missing a field the grade or the forecast reads.
  const gapReport = useMemo(() => buildDataGapReport(actionBoardDeals, dbMeetings || []), [actionBoardDeals, dbMeetings]);
  const missingDataIds = useMemo(() => dealIdsWithGap(gapReport, gapFilter), [gapReport, gapFilter]);

  // "Quietest" sort: when each deal was last in contact.
  const lastContact = useMemo(() => lastContactDates(dbMeetings || []), [dbMeetings]);

  // Deals where the buyer spoke last and nothing has gone back since.
  const waitingOnYouIds = useMemo(
    () => new Set(buildWaitingOnYou({ deals: actionBoardDeals, meetings: dbMeetings || [], grades: layaGrades, today: todayStr }).map(item => item.deal.id)),
    [actionBoardDeals, dbMeetings, layaGrades, todayStr]
  );

  const [statusNow] = useState(() => Date.now());

  // Time in lane, read from the activity log; stalled = past the lane's threshold.
  const timelines = useMemo(() => laneTimelines(dbDeals, activities || []), [dbDeals, activities]);

  // The board, as on This week: the same five stops and counts. Faces are the deals that moved
  // today; a stop jumps to its lane, and a deal won drops coins.
  const { fire } = useCelebrate();
  const stopCounts = useMemo(() => boardCounts(dbDeals, timelines, todayStr), [dbDeals, timelines, todayStr]);
  const movedToday = useMemo((): BoardToken[] => {
    const out: BoardToken[] = [];
    for (const deal of dbDeals) {
      const timeline = timelines.get(deal.id);
      const stop = stopOf(deal);
      if (!stop || timeline?.source !== 'moved' || businessDateKey(new Date(timeline.enteredAt)) !== todayStr) continue;
      const company = deal.company_id ? dbCompanies.find(c => c.id === deal.company_id) : undefined;
      out.push({ dealId: deal.id, stop, name: company?.name || deal.client || deal.title, companyId: deal.company_id, logoUrl: company?.logo_url });
    }
    return out;
  }, [dbDeals, dbCompanies, timelines, todayStr]);
  const showStop = (stop: StopId) => {
    if (stop === 'reach') { setView('tocontact'); return; }
    if (stop === 'won') { setView('won'); return; }
    const lane: DealWorkflowAction = stop;
    // Desktop: bring the lane to the middle of the board (only the board scrolls; a re-render
    // would cancel the smooth scroll, so nothing else changes). Phone: show that one lane.
    const board = boardRef.current;
    const shown = board?.querySelector<HTMLElement>(`[data-lane-id="${lane}"]`);
    if (board && shown && shown.getClientRects().length > 0) {
      const b = board.getBoundingClientRect();
      const l = shown.getBoundingClientRect();
      board.scrollBy({ left: l.left - b.left - (b.width - l.width) / 2, behavior: reduceMotion ? 'auto' : 'smooth' });
    } else {
      setMobileLane(lane);
    }
  };
  // How far the selected source's deals got through the journey.
  const sourceFunnel = useMemo(
    () => (sourceFilter === 'all' ? null : buildSourceFunnel(deals, timelines)),
    [sourceFilter, deals, timelines]
  );
  const stalled = useMemo(
    () => buildStalled({ deals: actionBoardDeals, timelines, thresholds: stallThresholds(dbDeals, timelines), now: statusNow }),
    [actionBoardDeals, dbDeals, timelines, statusNow]
  );
  const stalledIds = useMemo(() => new Set(stalled.map(item => item.deal.id)), [stalled]);
  // Four sends since the buyer last replied: offered for parking, never parked on its own.
  const parkSuggestions = useMemo(
    () => buildParkSuggestions({ deals: actionBoardDeals, meetings: dbMeetings || [] }),
    [actionBoardDeals, dbMeetings]
  );
  const parkSuggestedIds = useMemo(() => new Set(parkSuggestions.map(item => item.deal.id)), [parkSuggestions]);
  const outcomes = useMemo(() => pipelineOutcomes(deals, timelines), [deals, timelines]);
  const layaStatus = useMemo(
    () => (layaLoad === 'ready'
      ? buildLayaStatus({ deals: actionBoardDeals, grades: layaGrades, judgments: layaJudgments, now: statusNow })
      : null),
    [layaLoad, actionBoardDeals, layaGrades, layaJudgments, statusNow]
  );

  const doNowCounts = useMemo(
    () => ({ ...getDoNowCounts(actionBoardDeals, todayStr, layaReviewIds), missingData: gapReport.total, waitingOnYou: waitingOnYouIds.size, stalled: stalledIds.size, parkSuggested: parkSuggestedIds.size }),
    [actionBoardDeals, todayStr, layaReviewIds, gapReport.total, waitingOnYouIds, stalledIds, parkSuggestedIds]
  );

  const visibleActionBoardDeals = useMemo(
    () => filterAndSortBoardDeals(actionBoardDeals, {
      attention: attentionFilter,
      search: searchQuery,
      product: productFilter,
      priority: priorityFilter,
      today: todayStr,
      layaReviewIds,
      missingDataIds,
      waitingOnYouIds,
      stalledIds,
      parkSuggestedIds,
      sort: boardSort,
      hotness,
      lastContact,
    }),
    [actionBoardDeals, attentionFilter, searchQuery, productFilter, priorityFilter, todayStr, layaReviewIds, missingDataIds, waitingOnYouIds, stalledIds, parkSuggestedIds, boardSort, hotness, lastContact]
  );

  // Same deals the "Needs review" count uses: lane requirements only apply on the board.
  const reviewReport = useMemo(
    () => buildReviewReport(actionBoardDeals),
    [actionBoardDeals]
  );
  const productOptions = useMemo(
    () => Array.from(new Set([...PRODUCT_OPTIONS, ...actionBoardDeals.map(deal => deal.product)].filter(Boolean))).sort(),
    [actionBoardDeals]
  );

  const dealsByAction = useMemo(() => {
    const groups = Object.fromEntries(WORKFLOW_LANES.map(lane => [lane.id, [] as Deal[]])) as Record<string, Deal[]>;
    visibleActionBoardDeals.forEach(deal => {
      groups[getWorkflowAction(deal)].push(deal);
    });
    return groups;
  }, [visibleActionBoardDeals]);

  // folk-style "total deal value per stage": sum of non-null deal.value per lane.
  const laneValues = useMemo(() => sumLaneValues(WORKFLOW_LANES, dealsByAction), [dealsByAction]);
  const weightedLanes = useMemo(() => weightedLaneValues(WORKFLOW_LANES, dealsByAction), [dealsByAction]);

  const openPipelineValue = useMemo(
    () => WORKFLOW_LANES.reduce((acc, lane) => acc + laneValues[lane.id], 0),
    [laneValues]
  );

  // Salvaged from the deprecated /analytics page — the two honest numbers it
  // had: probability-weighted open forecast, and win rate per lead source
  // (resolved outcomes only).
  const weightedForecast = useMemo(() => calculateWeightedForecast(deals), [deals]);
  // Compares sources, so it reads every deal whatever the source filter.
  const sourceRows = useMemo(() => calculateSourcePerformance(dbDeals, companies), [dbDeals, companies]);

  const parkedDeals = useMemo(
    () => deals.filter(deal => getWorkflowAction(deal) === 'parked' && deal.stage !== 'closed_won' && deal.stage !== 'closed_lost'),
    [deals]
  );
  const wonDeals = useMemo(() => deals.filter(deal => deal.stage === 'closed_won'), [deals]);
  const lostDeals = useMemo(() => deals.filter(deal => deal.stage === 'closed_lost'), [deals]);

  const [exitModal, setExitModal] = useState<{ deal: Deal; kind: 'won' | 'lost' | 'park' } | null>(null);

  const stats = useMemo(() => {
    return {
      active: actionBoardDeals.length,
      parked: parkedDeals.length,
      dueToday: doNowCounts.today,
      won: wonDeals.length,
    };
  }, [actionBoardDeals, parkedDeals, wonDeals, doNowCounts.today]);

  // A deal opened by link stays openable when the source filter hides it.
  const activeDeal = selectedDeal ? dbDeals.find(deal => deal.id === selectedDeal) : null;

  const filtersActive = attentionFilter !== 'all' || searchQuery.trim() !== '' || productFilter !== 'all' || priorityFilter !== 'all' || sourceFilter !== 'all';

  // A deal filtered out must not read as missing: search across every deal, keeping the query.
  const searchEscapeMatches = useMemo(
    () => findDealsMatchingSearch(deals, searchQuery, todayStr),
    [deals, searchQuery, todayStr]
  );
  const tableDeals = searchQuery.trim() ? searchEscapeMatches : deals;

  // Escape hatch: keep the query, drop the board filters, and list every deal (parked/won too).
  const searchAllDeals = () => {
    setAttentionFilter('all');
    setProductFilter('all');
    setPriorityFilter('all');
    setSourceFilter('all');
    setView('table');
  };

  const clearDoNowFilters = () => {
    setAttentionFilter('all');
    setGapFilter('all');
    setSearchQuery('');
    setProductFilter('all');
    setPriorityFilter('all');
    setSourceFilter('all');
  };


  const handleCreate = async (data: any) => {
    // Let errors bubble to the modal so failures are visible.
    const { deal, companyPatch } = splitDealFormSource(data);
    if (companyPatch) {
      const { id, ...patch } = companyPatch;
      await crm.updateCompany(id, patch);
    }
    await createDeal(deal);
  };

  // A lane header's mascot: a landing wins, then a drag in progress, then the lane's own mood.
  const laneMascot = (laneId: DealWorkflowAction): BlobState =>
    celebrate?.laneId === laneId ? 'land' : activeDragId ? 'watch' : LANE_BLOB_STATE[laneId];

  /* ─── Drag & drop lane moves with per-lane gatekeeping ─── */
  const handleDragStart = (event: DragStartEvent) => setActiveDragId(event.active.id as string);

  const handleDragEnd = (event: DragEndEvent) => {
    const id = event.active.id as string;
    setActiveDragId(null);
    const over = event.over?.id as string | undefined;
    if (!over) return;
    if (!isJourneyLane(over as DealWorkflowAction)) return; // exits are never drag targets
    const deal = deals.find(d => d.id === id);
    if (!deal) return;
    const current = getWorkflowAction(deal);
    if (over === current) return;
    setGate({ deal, target: over as DealWorkflowAction });
  };

  const handleGateConfirm = async (payload: LaneGatePayload) => {
    if (!gate) return;
    const { deal, target } = gate;
    const lane = WORKFLOW_BY_ID[target];
    const before: Partial<Deal> = {
      workflow_action: getWorkflowAction(deal),
      sample_status: deal.sample_status || null,
      nudge_stage: deal.nudge_stage || null,
      followup_date: deal.followup_date,
      stage: deal.stage,
      next_action: deal.next_action,
      last_outcome: deal.last_outcome,
      buyer_reply: deal.buyer_reply ?? null,
    };

    // One pure decision, shared with the event rules: "no response" is a wait, not a reply, and
    // the interaction is dated on the business calendar.
    const { updates, meeting } = buildLaneGateDecision(
      deal,
      {
        target,
        channel: payload.channel ?? null,
        reply_outcome: payload.reply_outcome ?? null,
        reply_summary: payload.reply_summary ?? null,
        buyer_reply: payload.buyer_reply ?? null,
        next_action: payload.next_action ?? null,
        sample_status: payload.sample_status ?? null,
        followup_date: payload.followup_date ?? null,
        contact_ids: payload.contact_ids,
      },
      { dateKey: todayStr }
    );

    try {
      // Version-checked like the other write paths: two concurrent moves cannot silently
      // overwrite one another.
      await crm.updateDealIfUnchanged(deal.id, deal.updated_at, updates);
    } catch (err) {
      setGate(null);
      const message = err instanceof Error ? err.message : 'This deal changed before the move was saved';
      addToast(message, 'error');
      await refresh();
      return;
    }

    logActivity({
      type: 'edit',
      entity: 'deal',
      entityId: deal.id,
      label: `${lane.icon} ${lane.label}`,
      description: `${deal.client} moved to the ${lane.shortLabel} lane`,
      undoPayload: before,
    });

    // Interaction-type lane moves also create an interaction row so the Activity pulse stays true.
    if (meeting) {
      await addMeeting(meeting as any);
    }
    setGate(null);
    setCelebrate({ dealId: deal.id, laneId: target });
    setTimeout(() => setCelebrate(null), 900);
    addToast(`Moved to ${lane.shortLabel}`);
    await refresh();
  };

  const handleReviewFixConfirm = async (payload: ReviewFixPayload) => {
    if (!reviewFix) return;
    const { deal, reasons } = reviewFix;
    const updates = buildReviewFix(reasons, payload);
    if (Object.keys(updates).length === 0) {
      setReviewFix(null);
      return;
    }
    const before: Partial<Deal> = {
      sample_status: deal.sample_status || null,
      followup_date: deal.followup_date,
      nudge_stage: deal.nudge_stage || null,
      last_outcome: deal.last_outcome,
      next_action: deal.next_action,
    };
    const label = WORKFLOW_BY_ID[getWorkflowAction(deal)].shortLabel;
    await crm.updateDeal(deal.id, updates);
    logActivity({
      type: 'edit',
      entity: 'deal',
      entityId: deal.id,
      label: `🔧 Data hygiene fix · ${label}`,
      description: `Completed missing fields for ${deal.client} (${reasons.map(r => REVIEW_LABEL[r]).join(', ')})`,
      undoPayload: before,
    });
    setReviewFix(null);
    addToast(`✓ ${deal.client} review flag cleared`);
    await refresh();
  };

  // Won / Lost / Park from the exit modal: one version-checked close, logged for undo.
  const handleExitConfirm = async (payload: ExitDealPayload) => {
    if (!exitModal) return;
    const d = exitModal.deal;
    const before: Partial<Deal> = {
      stage: d.stage,
      workflow_action: getWorkflowAction(d),
      followup_date: d.followup_date,
      value: d.value,
      next_action: d.next_action,
      sample_status: d.sample_status || null,
      nudge_stage: d.nudge_stage || null,
      last_outcome: d.last_outcome,
      close_date: d.close_date || null,
      won_note: d.won_note || null,
      lost_reason: d.lost_reason || null,
      park_reason: d.park_reason || null,
    };
    if (payload.kind === 'won') {
      const close = buildCloseUpdate(d, {
        kind: 'won',
        close_date: payload.close_date,
        won_note: payload.won_note,
        value: payload.value,
        action: payload.action ?? null,
      });
      if (close.error) {
        addToast(close.error, 'error');
        return;
      }
      try {
        await crm.closeDealWithOrderIfUnchanged({
          dealId: d.id,
          expectedUpdatedAt: d.updated_at,
          updates: close.updates,
          order: d.company_id && close.recordOrderAmount != null
            ? {
                companyId: d.company_id,
                eventDate: payload.close_date || todayStr,
                amount: close.recordOrderAmount,
                productLine: d.product || null,
              }
            : null,
        });
      } catch (error) {
        if (error instanceof crm.OrderRecordPendingError) {
          logActivity({ type: 'edit', entity: 'deal', entityId: d.id, label: '🎉 Marked won', description: `${d.client} marked won; order record pending retry`, undoPayload: before });
          addToast('Deal marked won; order record needs retry.', 'error', {
            label: 'Retry',
            onClick: () => {
              void crm.recordOrderForClosedDeal(d.id, error.order)
                .then(() => addToast('Order record saved'))
                .catch(() => addToast('Order record still needs retry.', 'error'));
            },
          });
          setExitModal(null);
          await refresh();
          return;
        }
        throw error;
      }
      logActivity({ type: 'edit', entity: 'deal', entityId: d.id, label: '🎉 Marked won', description: `${d.client} marked won`, undoPayload: before });
      fire('coins', document.querySelector('[data-testid="game-board"]'));
      addToast('Deal marked won');
    } else if (payload.kind === 'lost') {
      const close = buildCloseUpdate(d, { kind: 'lost', lost_reason: payload.lost_reason });
      await crm.updateDealIfUnchanged(d.id, d.updated_at, close.updates);
      logActivity({ type: 'edit', entity: 'deal', entityId: d.id, label: '📉 Marked lost', description: `${d.client} marked lost`, undoPayload: before });
      addToast('Deal marked lost');
    } else {
      const close = buildCloseUpdate(d, {
        kind: 'park',
        park_reason: payload.park_reason,
        followup_date: payload.followup_date,
      });
      await crm.updateDealIfUnchanged(d.id, d.updated_at, close.updates);
      logActivity({ type: 'edit', entity: 'deal', entityId: d.id, label: '⏸ Parked', description: `${d.client} parked`, undoPayload: before });
      addToast('Deal parked');
    }
    setExitModal(null);
    await refresh();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-clay-ink animate-spin" />
      </div>
    );
  }

  // Leads with nothing logged yet: their date is a plan, so their cards carry no date mark.
  const toContactIds = new Set(toContactDeals.map(deal => deal.id));

  const renderDealCard = (deal: Deal, opts?: { grip?: boolean; compact?: boolean; dragging?: boolean }) => {
    const action = getWorkflowAction(deal);
    const sendCount = outboundSendCountForDeal(dbMeetings || [], deal.id);
    const derived = deriveNudge(deal, todayStr, {
      sendCount,
    });
    const nudge = derived ? formatDerivedNudgeBadge(derived) : null;
    const nudgeStage = derived?.stage ?? null;
    const lane = WORKFLOW_BY_ID[action];
    const due = dueStateFor(deal, todayStr);
    const reason = whyNow(deal, due);
    const reasons = reviewReasons(deal);
    const isCompact = !!opts?.compact;
    const presentation = buildDealCardPresentation(deal, contacts, companies, due, { today: todayStr, notStarted: toContactIds.has(deal.id) });
    const skipMotion = reduceMotion || !!opts?.dragging;

    return (
      <div key={deal.id} className="space-y-1.5" data-deal-card>
        <motion.button
          type="button"
          onClick={() => setSelectedDeal(deal.id)}
          whileTap={skipMotion ? undefined : { scale: pressScale }}
          transition={springPress}
          className={clsx(
            'w-full text-left bg-white dark:bg-clay-card rounded-lg border border-clay-hairline touch-manipulation transition-[border-color,box-shadow] hover:border-clay-muted/40 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-clay-teal',
            isCompact ? 'p-3' : 'p-3.5',
            // Late: a thin red left edge, the one loud mark (visual spec: urgency is a left edge, never a red box).
            presentation.timing.tone === 'overdue' && 'border-l-[3px] border-l-clay-error/70',
          )}
        >
          <DealCardContent
            deal={deal}
            presentation={presentation}
            whyNow={reason}
            reviewLabels={reasons.map(item => REVIEW_LABEL[item])}
            nudge={nudge}
            nudgeStage={nudgeStage}
            compact={isCompact}
            showGrip={opts?.grip}
            layaGrade={layaGrades.get(deal.id)}
            quietNote={boardSort === 'quietest' ? quietLabel(lastContact.get(deal.id), todayStr) : null}
            laneTime={action !== 'outreach' && isOnJourneyBoard(deal) && timelines.has(deal.id)
              ? { days: daysInLane(timelines.get(deal.id)!, statusNow), stalled: stalledIds.has(deal.id) }
              : null}
          />
          <p className="sr-only">Open {deal.client} in {lane.label}</p>
        </motion.button>
      </div>
    );
  };

  return (
    <PageTransition className="p-4 md:px-4 md:py-6 pb-20 lg:pb-6 min-h-full">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="zams-eyebrow mb-1">{formatBangkokWeekdayDate()} · Bangkok</p>
          <h1 className="zams-display text-2xl md:text-[28px] leading-tight">Pipeline</h1>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="clay-btn-primary shrink-0 motion-press">
          <Plus className="w-4 h-4" /> <span className="hidden sm:inline">New deal</span>
        </button>
      </div>



      {/* Phone: the source menu gets its own line so the view tabs keep the full width. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:flex-nowrap sm:border-b sm:border-clay-hairline">
      <nav className="flex w-full min-w-0 gap-1 overflow-x-auto no-scrollbar border-b border-clay-hairline sm:w-auto sm:flex-1 sm:border-b-0" aria-label="Deal views">
        {([
          ['board', 'board', 'Board', stats.active],
          ['notstarted', 'tocontact', 'Not started', toContactDeals.length],
          ['table', 'table', 'Table', deals.length],
          ['closed', 'won', 'Closed', stats.won + lostDeals.length + stats.parked],
        ] as const).map(([group, first, label, count]) => (
          <button
            key={group}
            onClick={() => setView(first)}
            aria-current={TAB_OF[view] === group ? 'page' : undefined}
            className={clsx('shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors', TAB_OF[view] === group ? 'border-clay-ink text-clay-ink' : 'border-transparent text-clay-muted hover:text-clay-ink')}
          >
            {label}<span className="ml-1 text-xs font-normal text-clay-muted">{count}</span>
          </button>
        ))}
      </nav>
      {/* The board keeps its source filter in Filter; the lists keep it here. */}
      {view !== 'prospects' && view !== 'board' && <SourceSelect value={sourceFilter} onChange={setSourceFilter} />}
      </div>

      {(TAB_OF[view] === 'notstarted' || TAB_OF[view] === 'closed') && (
        <div role="group" aria-label={TAB_OF[view] === 'closed' ? 'Closed deals' : 'Not started'} className="mb-3 flex flex-wrap gap-1.5">
          {(TAB_OF[view] === 'closed'
            ? ([['won', 'Won', stats.won], ['lost', 'Lost', lostDeals.length], ['parked', 'Parked', stats.parked]] as const)
            : ([['tocontact', 'To contact', toContactDeals.length], ['prospects', 'Prospects to review', null]] as const)
          ).map(([mode, label, count]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
              className={clsx(
                'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors',
                view === mode ? 'border-clay-lavender/60 bg-clay-lavender/20 text-clay-ink' : 'border-clay-hairline text-clay-muted hover:text-clay-ink',
              )}
            >
              {label}{count !== null && <span className="text-xs text-clay-muted">{count}</span>}
            </button>
          ))}
        </div>
      )}

      {view !== 'prospects' && sourceFunnel && (
        <SourceFunnelLine filter={sourceFilter} funnel={sourceFunnel} onClear={() => setSourceFilter('all')} />
      )}

      {view === 'prospects' && (
        <ProspectsTab
          onStartDeal={(companyId) => {
            setDealPrefill({ company_id: companyId });
            setIsModalOpen(true);
          }}
        />
      )}

      {view === 'board' && (
        <>
          <div className="mb-3">
            <GameBoard counts={stopCounts} tokens={movedToday} onStop={showStop} link={null} />
          </div>
          <PipelineToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            attentionFilter={attentionFilter}
            onAttentionChange={setAttentionFilter}
            counts={doNowCounts}
            productFilter={productFilter}
            onProductChange={setProductFilter}
            productOptions={productOptions}
            priorityFilter={priorityFilter}
            onPriorityChange={setPriorityFilter}
            sourceFilter={sourceFilter}
            onSourceChange={setSourceFilter}
            sort={boardSort}
            onSortChange={setBoardSort}
            filtersActive={filtersActive}
            onClear={clearDoNowFilters}
            visibleCount={visibleActionBoardDeals.length}
            totalCount={actionBoardDeals.length}
            openPipelineValue={openPipelineValue}
            weightedForecast={weightedForecast}
            sourceRows={sourceRows}
            outcomes={outcomes}
            compact={compact}
            onToggleCompact={() => setCompact(!compact)}
            status={(
              <LayaStatusLine
                status={layaStatus}
                load={layaLoad}
                now={statusNow}
                missingReplyWords={gapReport.counts['reply-words']}
              />
            )}
          />

          {attentionFilter === 'missing-data' && (
            <MissingDataBar report={gapReport} gap={gapFilter} onGapChange={setGapFilter} />
          )}

          {attentionFilter === 'overdue' && (
            <OverdueBulkBar deals={visibleActionBoardDeals} today={todayStr} onDone={refresh} />
          )}

          {attentionFilter === 'park-suggested' && (
            <ParkSuggestionBar
              items={parkSuggestions.filter(item => visibleActionBoardDeals.some(deal => deal.id === item.deal.id))}
              onPark={deal => setExitModal({ deal, kind: 'park' })}
            />
          )}

          {attentionFilter === 'needs-review' && (
            <ReviewQueue items={reviewReport} onFix={(deal, reasons) => setReviewFix({ deal, reasons })} />
          )}

          {actionBoardDeals.length === 0 && (
            <div className="mb-4 rounded-xl border border-clay-hairline bg-white dark:bg-clay-card px-6 py-8 flex flex-col sm:flex-row items-center justify-center gap-5 text-center sm:text-left">
              <Blob state="sleep" size={72} aria-label="No deals on the board yet" />
              <div>
                {sourceFilter === 'all' ? (
                  <>
                    <p className="text-sm font-medium text-clay-ink mb-1">No deals on the board yet</p>
                    <p className="text-xs text-clay-muted">Create a deal and it will land in the outreach lane, ready for its first action.</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-clay-ink mb-1">{sourceFilter === 'unset' ? 'Every deal in conversation has a source' : `No ${SOURCE_FILTER_OPTIONS.find(option => option.value === sourceFilter)?.label} deals in conversation`}</p>
                    <p className="text-xs text-clay-muted">Set the source on an account and its deals show here.</p>
                  </>
                )}
              </div>
              <button
                onClick={() => setIsModalOpen(true)}
                className="shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-clay-ink text-clay-canvas text-sm font-medium rounded-lg active:opacity-85"
              >
                <Plus className="w-4 h-4" /> New deal
              </button>
            </div>
          )}
          {actionBoardDeals.length > 0 && visibleActionBoardDeals.length === 0 && (
            <div className="mb-4 rounded-xl border border-clay-hairline bg-white dark:bg-clay-card px-5 py-6 flex flex-col sm:flex-row items-center justify-center gap-4 text-center sm:text-left">
              <Blob state="sleep" size={48} aria-label="No deals match filters" />
              <div className="flex-1">
                {searchQuery.trim() ? (
                  searchEscapeMatches.length > 0 ? (
                    <>
                      <p className="text-sm font-medium text-clay-ink">
                        {searchEscapeMatches.length === 1 ? '1 deal matches' : `${searchEscapeMatches.length} deals match`} “{searchQuery.trim()}” outside these filters
                      </p>
                      <p className="text-xs text-clay-muted mt-1">
                        Showing {visibleActionBoardDeals.length} of {actionBoardDeals.length} on this board — the match is filtered out, not missing.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-clay-ink">No deal matches “{searchQuery.trim()}”</p>
                      <p className="text-xs text-clay-muted mt-1">Searched every deal, not just this board view.</p>
                    </>
                  )
                ) : (
                  <>
                    <p className="text-sm font-medium text-clay-ink">No deals match this Do now view</p>
                    <p className="text-xs text-clay-muted mt-1">Clear a filter or search for another client.</p>
                  </>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                {searchQuery.trim() !== '' && searchEscapeMatches.length > 0 && (
                  <button
                    onClick={searchAllDeals}
                    data-search-all-deals
                    className="min-h-[44px] rounded-lg bg-clay-ink px-4 text-sm font-medium text-clay-canvas active:opacity-85"
                  >
                    Search all deals
                  </button>
                )}
                <button onClick={clearDoNowFilters} className="min-h-[44px] rounded-lg border border-clay-hairline px-4 text-sm font-medium text-clay-body active:opacity-85">
                  Show all deals
                </button>
              </div>
            </div>
          )}
          {/* Phone: one readable lane at a time. Desktop: full board. */}
          <div className="md:hidden">
            <div className="-mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar pb-3 snap-x">
              {WORKFLOW_LANES.map(lane => (
                <button
                  key={lane.id}
                  onClick={() => setMobileLane(lane.id)}
                  className={clsx(
                    'snap-start shrink-0 flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium min-h-[44px]',
                    mobileLane === lane.id ? 'bg-clay-ink text-clay-canvas border-clay-ink' : 'bg-white dark:bg-clay-card text-clay-ink border-clay-hairline'
                  )}
                >
                  <Blob state={LANE_BLOB_STATE[lane.id]} size={18} aria-label="" />
                  <span>{lane.shortLabel}</span>
                  <span className={clsx('text-xs', mobileLane === lane.id ? 'text-clay-canvas/70' : 'text-clay-muted')}>{dealsByAction[lane.id].length} · {formatBaht(laneValues[lane.id])}</span>
                </button>
              ))}
            </div>
            {(() => {
              const lane = WORKFLOW_LANES.find(item => item.id === mobileLane)!;
              const laneDeals = dealsByAction[mobileLane];
              const { shown, hiddenCount } = capLane(laneDeals, expandedLanes.has(lane.id));
              return (
                <section data-lane-id={lane.id} className="rounded-xl border border-clay-hairline bg-clay-surface p-3">
                  <div data-lane-header className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-clay-teal" aria-hidden="true" />
                    <h2 data-lane-title className="min-w-0 flex-1 text-base font-semibold text-clay-ink">{lane.shortLabel}</h2>
                    <span data-lane-stats className="whitespace-nowrap text-xs text-clay-muted">
                      {laneDeals.length} · {formatBaht(laneValues[lane.id])}
                      {laneValues[lane.id] > 0 && <span data-lane-weighted> · {formatBaht(weightedLanes[lane.id])} weighted</span>}
                    </span>
                  </div>
                  <StaggerList stagger={0.04} className="space-y-2">
                    {shown.map(d => (
                      <StaggerItem key={d.id} className="flex flex-wrap items-stretch gap-1.5">
                        <div className="flex-1 min-w-[min(100%,12rem)]">{renderDealCard(d, { compact })}</div>
                        <button
                          onClick={() => setPickerDeal(d)}
                          className="w-11 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl border border-clay-hairline bg-white dark:bg-clay-card text-clay-ink active:bg-clay-lavender/20"
                          aria-label={`Move ${d.client} to another lane`}
                        >
                          <ArrowRight className="w-4 h-4" />
                          <span className="zams-mono text-[8px] uppercase tracking-[0.12px]">Move</span>
                        </button>
                      </StaggerItem>
                    ))}
                    <LaneShowAll laneLabel={lane.shortLabel} total={laneDeals.length} hiddenCount={hiddenCount}
                      expanded={expandedLanes.has(lane.id)} onToggle={() => toggleLane(lane.id)} />
                    {laneDeals.length === 0 && (
                      <div className="border border-dashed border-clay-hairline rounded-xl px-3 py-8 text-center text-sm text-clay-muted-soft flex flex-col items-center gap-2">
                        <Blob state={LANE_BLOB_STATE[lane.id]} size={40} aria-label="" />
                        <span>No deals in this lane</span>
                      </div>
                    )}
                  </StaggerList>
                </section>
              );
            })()}
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="hidden md:block relative">
              <div ref={boardRef} className="flex gap-2.5 items-stretch overflow-x-auto pb-3 pl-0.5 pr-8 scroll-smooth snap-x snap-mandatory [scrollbar-gutter:stable]">
                {WORKFLOW_LANES.map(lane => (
                  <DroppableLane key={lane.id} laneId={lane.id} reduceMotion={reduceMotion}>
                    <div data-lane-header className="mb-3 shrink-0 flex flex-wrap items-center gap-1.5">
                      {/* The lane's mascot: watches a card being dragged, bounces when one lands here. */}
                      <span data-lane-mascot={laneMascot(lane.id)} className="-my-1 shrink-0" aria-hidden="true">
                        <Blob state={laneMascot(lane.id)} size={22} follow={!!activeDragId} aria-label="" />
                      </span>
                      <h2 data-lane-title title={LANE_CRITERIA[lane.id]} className="min-w-0 flex-1 text-[13px] font-semibold text-clay-ink">{lane.shortLabel}</h2>
                      <span data-lane-stats title={`Weighted by stage probability: ${formatBaht(weightedLanes[lane.id])}`} className="shrink-0 whitespace-nowrap text-[11px] text-clay-muted">{dealsByAction[lane.id].length} · {formatBaht(laneValues[lane.id])}</span>
                    </div>
                    <StaggerList stagger={0.04} className="space-y-2 flex-1 pr-0.5">
                      {capLane(dealsByAction[lane.id], expandedLanes.has(lane.id)).shown.map(deal => (
                        <StaggerItem key={deal.id}>
                          <DraggableCard
                            deal={deal}
                            landing={celebrate?.dealId === deal.id && celebrate?.laneId === lane.id}
                            reduceMotion={reduceMotion}
                            onClick={() => setSelectedDeal(deal.id)}
                          >
                            {renderDealCard(deal, { grip: true, compact, dragging: activeDragId === deal.id })}
                          </DraggableCard>
                        </StaggerItem>
                      ))}
                      <LaneShowAll laneLabel={lane.shortLabel} total={dealsByAction[lane.id].length}
                        hiddenCount={capLane(dealsByAction[lane.id], expandedLanes.has(lane.id)).hiddenCount}
                        expanded={expandedLanes.has(lane.id)} onToggle={() => toggleLane(lane.id)} />
                      {dealsByAction[lane.id].length === 0 && (
                        lane.id === 'parked' ? (
                          <div className="text-center py-6 rounded-lg border-2 border-dashed border-clay-hairline flex flex-col items-center gap-2 opacity-90">
                            <Blob state="sleep" size={44} aria-label="Nothing parked" />
                            <p className="text-xs text-clay-muted-soft">Nothing parked — everything is moving.</p>
                          </div>
                        ) : (
                          <div className="text-center py-6 text-xs text-clay-muted-soft border-2 border-dashed border-clay-hairline rounded-lg flex flex-col items-center gap-2">
                            <Blob state={LANE_BLOB_STATE[lane.id]} size={36} aria-label="" />
                            <span>Drop here</span>
                          </div>
                        )
                      )}
                      {celebrate && celebrate.laneId === lane.id && (
                        <motion.div
                          className="flex justify-center"
                          initial={reduceMotion ? false : { opacity: 0, scale: 0.88, y: 6 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          transition={{ duration: 0.24, ease: EASE_OUT }}
                        >
                          <Blob
                            state={lane.id === 'success' ? 'joy' : LANE_BLOB_STATE[lane.id]}
                            size={40}
                            aria-label="Celebrating lane move"
                          />
                        </motion.div>
                      )}
                    </StaggerList>
                  </DroppableLane>
                ))}
              </div>

              {/* Overflow indicators: wider fades + scroll arrows so mid-width clipping is obvious */}
              {boardScroll.canScrollRight && (
                <>
                  <div className="absolute right-0 top-0 bottom-3 w-24 bg-gradient-to-l from-clay-canvas via-clay-canvas/85 to-transparent pointer-events-none rounded-r-xl" />
                  <button
                    onClick={() => scrollBoard(1)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-clay-ink text-clay-canvas border border-clay-ink shadow-md flex items-center justify-center hover:opacity-90 transition-opacity"
                    aria-label="Scroll to more lanes"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </>
              )}
              {boardScroll.canScrollLeft && (
                <>
                  <div className="absolute left-0 top-0 bottom-3 w-16 bg-gradient-to-r from-clay-canvas via-clay-canvas/80 to-transparent pointer-events-none rounded-l-xl" />
                  <button
                    onClick={() => scrollBoard(-1)}
                    className="absolute left-1.5 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-clay-ink text-clay-canvas border border-clay-ink shadow-md flex items-center justify-center hover:opacity-90 transition-opacity"
                    aria-label="Scroll back"
                  >
                    <ArrowRight className="w-4 h-4 rotate-180" />
                  </button>
                </>
              )}
            </div>
            <DragOverlay>
              {activeDragId ? (
                <div className="relative w-[272px] rotate-2">
                  {renderDealCard(deals.find(d => d.id === activeDragId)!, { dragging: true })}
                  <motion.div
                    className="absolute -top-7 -right-4"
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.85, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ duration: 0.22, ease: EASE_OUT }}
                  >
                    <Blob
                      state={LANE_BLOB_STATE[getWorkflowAction(deals.find(d => d.id === activeDragId)!)]}
                      size={40}
                      aria-label="Carrying deal to a new lane"
                    />
                  </motion.div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </>
      )}

      {view === 'tocontact' && (
        <section aria-label="To contact">
          <p className="mb-3 text-sm text-clay-muted">
            Outreach deals with nothing logged yet. Log the first call, email or DM and the deal moves onto the board.
          </p>
          {sweepCount > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-clay-hairline bg-white px-3 py-2.5 dark:bg-clay-card" data-testid="sweep-entry">
              <p className="min-w-0 flex-1 text-sm text-clay-ink">
                <b className="font-semibold">{sweepCount} {sweepCount === 1 ? 'lead' : 'leads'} to sort.</b>{' '}
                <span className="text-clay-muted">Keep the real ones, set the rest aside.</span>
              </p>
              <button type="button" onClick={() => setSweepOpen(true)} className="clay-btn-primary h-9 shrink-0">Sort the pile</button>
            </div>
          )}
          {toContactDeals.length === 0 ? (
            <div className="rounded-xl border border-dashed border-clay-hairline p-8 text-center text-sm text-clay-muted">Everyone in Outreach has been contacted.</div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {(showAllToContact ? toContactDeals : toContactDeals.slice(0, TO_CONTACT_PREVIEW)).map(d => renderDealCard(d))}
              </div>
              {toContactDeals.length > TO_CONTACT_PREVIEW && (
                <button
                  type="button"
                  onClick={() => setShowAllToContact(value => !value)}
                  className="mt-3 h-9 rounded-lg px-2 text-sm font-medium text-clay-lavender hover:bg-clay-surface"
                >
                  {showAllToContact ? 'Show fewer' : `Show all ${toContactDeals.length}`}
                </button>
              )}
            </>
          )}
        </section>
      )}
      <ReachOutSweep open={sweepOpen} onClose={() => setSweepOpen(false)} />

      {(view === 'parked' || view === 'won' || view === 'lost') && (() => {
        const list = { parked: parkedDeals, won: wonDeals, lost: lostDeals }[view];
        const [caption, empty] = {
          parked: ['Parked deals come back on their revisit date.', 'Nothing parked.'],
          won: ['', 'No won deals yet.'],
          lost: ['', 'No lost deals.'],
        }[view];
        return (
          <div className="flex-1 overflow-y-auto">
            {caption && <p className="text-sm text-clay-muted mb-3">{caption}</p>}
            {view !== 'won' && list.length > 0 && (
              <ul aria-label={view === 'lost' ? 'Why deals were lost' : 'Why deals were parked'} data-testid="reason-totals"
                className="mb-3 flex flex-wrap gap-1.5 text-xs">
                {(view === 'lost' ? lostReasonTotals(list) : parkReasonTotals(list)).map(reason => (
                  <li key={reason.label} className="rounded-lg border border-clay-hairline bg-white px-2.5 py-1 text-clay-body dark:bg-clay-card">
                    {reason.label} <span className="font-semibold text-clay-ink">{reason.count}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {list.length === 0 ? (
                <div className="col-span-full rounded-xl border border-dashed border-clay-hairline p-8 text-center text-sm text-clay-muted">{empty}</div>
              ) : list.map(d => renderDealCard(d))}
            </div>
          </div>
        );
      })()}

      {view === 'table' && (
        <DealsTable
          deals={tableDeals}
          totalCount={deals.length}
          searchQuery={searchQuery}
          contacts={contacts}
          companies={companies}
          meetings={dbMeetings || []}
          today={todayStr}
          onOpen={setSelectedDeal}
        />
      )}

      {activeDeal && <DealDetail deal={activeDeal} onClose={() => setSelectedDeal(null)} onSaved={refresh} />}

      {gate && (
        <LaneGateModal
          deal={gate.deal}
          targetLane={gate.target}
          contacts={contacts}
          companies={companies}
          onCancel={() => setGate(null)}
          onConfirm={handleGateConfirm}
        />
      )}

      {reviewFix && (
        <ReviewFixModal
          deal={reviewFix.deal}
          reasons={reviewFix.reasons}
          onCancel={() => setReviewFix(null)}
          onConfirm={handleReviewFixConfirm}
        />
      )}

      {pickerDeal && (
        <LanePickerSheet
          deal={pickerDeal}
          currentLane={getWorkflowAction(pickerDeal)}
          counts={dealsByAction}
          onPick={(target) => {
            setPickerDeal(null);
            setGate({ deal: pickerDeal, target });
          }}
          onExit={(kind) => {
            const d = pickerDeal;
            setPickerDeal(null);
            setExitModal({ deal: d, kind });
          }}
          onClose={() => setPickerDeal(null)}
        />
      )}

      {exitModal && (
        <ExitDealModal
          deal={exitModal.deal}
          kind={exitModal.kind}
          onCancel={() => setExitModal(null)}
          onConfirm={handleExitConfirm}
        />
      )}

      <CreateModal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setDealPrefill(undefined); }}
        onSave={handleCreate}
        type="deal"
        companies={companies}
        contacts={contacts}
        initialValues={dealPrefill}
      />
    </PageTransition>
  );
}

/** "Show all N" under a capped lane, and "Show fewer" once expanded. Nothing for a short lane. */
function LaneShowAll({ laneLabel, total, hiddenCount, expanded, onToggle }: {
  laneLabel: string; total: number; hiddenCount: number; expanded: boolean; onToggle: () => void;
}) {
  if (!expanded && hiddenCount === 0) return null;
  if (expanded && total <= LANE_CARD_CAP) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      data-lane-show-all
      aria-label={expanded ? `Show fewer ${laneLabel} deals` : `Show all ${total} ${laneLabel} deals`}
      className="w-full rounded-lg border border-dashed border-clay-hairline py-2 text-xs font-medium text-clay-muted transition-colors hover:border-clay-ink/30 hover:text-clay-ink"
    >
      {expanded ? 'Show fewer' : `Show all ${total} · ${hiddenCount} more`}
    </button>
  );
}
