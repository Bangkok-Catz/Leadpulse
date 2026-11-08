'use client';

import clsx from 'clsx';
import { CircleCheck, CircleX, SignalHigh, SignalLow, SignalMedium } from 'lucide-react';
import type { Company, Contact, Deal, Meeting } from '@/types/crm';
import CompanyLogo from '@/components/CompanyLogo';
import LaneIcon from '@/components/LaneIcon';
import { PRIORITY_CLASSES, PRIORITY_LABELS, buildDealCardPresentation, nudgeChipLabel } from '@/utils/deal-card';
import { WORKFLOW_BY_ID, deriveNudge, formatDerivedNudgeBadge, getWorkflowAction, outboundSendCountForDeal } from '@/utils/deal-workflow';
import { compactDate, dueStateFor } from './board-view';

const PRIORITY_ICON = { high: SignalHigh, medium: SignalMedium, low: SignalLow } as const;

/** One stage per deal, the board's: its lane, or Won / Lost once it is closed. */
function StageCell({ deal }: { deal: Deal }) {
  if (deal.stage === 'closed_won' || deal.stage === 'closed_lost') {
    const won = deal.stage === 'closed_won';
    const Icon = won ? CircleCheck : CircleX;
    return (
      <span className={clsx('inline-flex items-center gap-1.5 text-xs whitespace-nowrap', won ? 'text-clay-teal dark:text-clay-mint' : 'text-clay-muted')}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />{won ? 'Won' : 'Lost'}
      </span>
    );
  }
  const lane = WORKFLOW_BY_ID[getWorkflowAction(deal)];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-clay-body whitespace-nowrap"><LaneIcon lane={lane.id} className="h-3.5 w-3.5 text-clay-muted" />{lane.shortLabel}</span>
  );
}

function PriorityIcon({ priority }: { priority: Deal['priority'] }) {
  const Icon = PRIORITY_ICON[priority];
  return <Icon className="h-3 w-3" aria-hidden="true" />;
}

export default function DealsTable({
  deals,
  totalCount,
  searchQuery,
  contacts,
  companies,
  meetings,
  today,
  onOpen,
}: {
  deals: Deal[];
  totalCount: number;
  searchQuery: string;
  contacts: Contact[];
  companies: Company[];
  meetings: Meeting[];
  today: string;
  onOpen: (dealId: string) => void;
}) {
  return (
    <div className="flex-1 overflow-auto bg-white dark:bg-clay-card rounded-xl border border-clay-hairline">
      {searchQuery.trim() !== '' && (
        <p data-table-search-note className="border-b border-clay-hairline px-3 py-2 text-[11px] text-clay-muted">
          Searching every deal for “{searchQuery.trim()}” — {deals.length} matching, {totalCount} in total.
        </p>
      )}
      <table className="w-full text-sm">
        <thead><tr className="border-b border-clay-hairline text-left text-clay-muted text-xs uppercase tracking-wide"><th className="px-3 py-3 font-medium">Client</th><th className="px-3 py-3 font-medium">Stage</th><th className="hidden sm:table-cell px-3 py-3 font-medium">Follow-up</th><th className="px-3 py-3 font-medium">Priority</th></tr></thead>
        <tbody>
          {deals.map(deal => {
            const identity = buildDealCardPresentation(deal, contacts, companies, dueStateFor(deal, today));
            const derived = deriveNudge(deal, today, {
              sendCount: outboundSendCountForDeal(meetings, deal.id),
            });
            return <tr key={deal.id} onClick={() => onOpen(deal.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(deal.id); } }} tabIndex={0} className="border-b border-clay-hairline active:bg-clay-surface cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-clay-teal"><td className="px-3 py-3"><div className="flex min-w-0 items-center gap-2.5"><CompanyLogo src={identity.companyLogoUrl} name={identity.companyName} id={deal.company_id} size={28} /><div className="min-w-0"><p className="font-medium text-clay-ink">{identity.companyName}</p><p className="text-[10px] text-clay-muted truncate max-w-40">{deal.title}</p></div></div></td><td className="px-3 py-3"><StageCell deal={deal} />{derived && <p className="text-[10px] text-clay-muted mt-0.5">{nudgeChipLabel(formatDerivedNudgeBadge(derived))}</p>}</td><td className="hidden sm:table-cell px-3 py-3 text-xs text-clay-muted">{compactDate(deal.followup_date) || '—'}</td><td className="px-3 py-3"><span className={clsx('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded', PRIORITY_CLASSES[deal.priority])}><PriorityIcon priority={deal.priority} />{PRIORITY_LABELS[deal.priority]}</span></td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}
