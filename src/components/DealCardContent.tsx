import { AlertCircle, Banknote, CalendarDays, Hourglass, Mail, MessageCircle, Package, Phone, User, Users, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import type { Deal, NudgeStage } from '@/types/crm';
import type { DealCardPresentation } from '@/utils/deal-card';
import { isConcreteNextAction, nudgeChipLabel, productNote } from '@/utils/deal-card';
import { formatBaht } from '@/utils/format';
import { actionChannel, type ActionChannel } from '@/utils/action-channel';
import CompanyLogo from '@/components/CompanyLogo';
import LayaGradeChip from '@/components/LayaGradeChip';
import type { DealGrade } from '@/utils/grade';

interface DealCardContentProps {
  deal: Deal;
  presentation: DealCardPresentation;
  whyNow: string | null;
  reviewLabels: string[];
  nudge: string | null;
  nudgeStage?: NudgeStage | null;
  compact?: boolean;
  /** kept for callers; the whole card is the drag handle, so no grip is drawn */
  showGrip?: boolean;
  /** Laya's grade for this deal, when it has a reply to grade */
  layaGrade?: DealGrade;
  /** how long since the last contact, shown while the board is sorted quietest-first */
  quietNote?: string | null;
  /** days in the current lane; only a stalled deal shows it on the card */
  laneTime?: { days: number; stalled: boolean } | null;
}

const CHANNEL_ICON: Record<ActionChannel, LucideIcon> = { call: Phone, email: Mail, message: MessageCircle, meeting: Users };

// Every fact on the card leads with a small grey line icon.
const factIcon = 'h-3.5 w-3.5 shrink-0 text-clay-muted-soft';

export default function DealCardContent({
  deal,
  presentation,
  whyNow,
  reviewLabels,
  nudge,
  compact = false,
  layaGrade,
  quietNote = null,
  laneTime = null,
}: DealCardContentProps) {
  const { contact, companyName, companyLogoUrl, product, nextAction, timing } = presentation;
  const hasConcreteNextAction = isConcreteNextAction(deal.next_action);
  const closed = deal.stage === 'closed_won' || deal.stage === 'closed_lost';
  const nudgeText = nudgeChipLabel(nudge);
  // "2/4 Remind" → two of four dots, as the touch plan reads on This week.
  const nudgeSteps = nudgeText ? /(\d+)\s*\/\s*(\d+)/.exec(nudgeText) : null;
  const otherProduct = productNote(product === 'Product not set' ? null : product);
  const hasLayaChip = !!layaGrade && layaGrade.status !== 'not_graded';
  const hasStatus = hasLayaChip || !!laneTime?.stalled || reviewLabels.length > 0 || deal.priority === 'high';
  // No bottom row (and no divider) when there is nothing to put in it.
  const hasMeta = timing.tone !== 'hidden' || !!nudgeText || !!otherProduct || deal.value != null || !!quietNote || hasStatus;
  const channel = hasConcreteNextAction ? actionChannel(nextAction) : null;
  const ChannelIcon = channel ? CHANNEL_ICON[channel] : null;

  return (
    <div className="min-w-0 space-y-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <CompanyLogo src={companyLogoUrl} name={companyName} id={deal.company_id} size={30} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 title={companyName} className="line-clamp-2 text-[13px] font-semibold leading-snug text-clay-ink [overflow-wrap:anywhere]">
            {companyName}
          </h3>
        </div>
      </div>

      {/* Only a known person is worth a line; "not identified" on most cards is noise. */}
      {!contact.missing && (
        <div className="flex min-w-0 items-center gap-1.5">
          <User className={factIcon} aria-hidden="true" />
          <p className="truncate text-[11px] text-clay-muted" title={`${contact.name}${contact.role ? ` · ${contact.role}` : ''}`}>
            {contact.name}{contact.additionalCount > 0 ? ` +${contact.additionalCount}` : ''}{!compact && contact.role ? ` · ${contact.role}` : ''}
          </p>
        </div>
      )}
      {/* A closed deal with no next step says nothing rather than "No next action set yet". */}
      {(hasConcreteNextAction || !closed) && (
        <div className="flex min-w-0 items-start gap-1.5">
          {ChannelIcon && <ChannelIcon data-channel={channel} className={clsx(factIcon, 'mt-px')} aria-hidden="true" />}
          <p
            data-card-next-action
            title={nextAction}
            className={clsx(
              'min-w-0 text-xs leading-snug line-clamp-2',
              hasConcreteNextAction ? 'font-medium text-clay-body-strong' : 'italic text-clay-muted'
            )}
          >
            {hasConcreteNextAction ? nextAction : 'No next action set yet'}
          </p>
        </div>
      )}

      {hasMeta && <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-clay-hairline/70 pt-2 text-[11px]">
        {/* The one date mark: plain text, red only when late (the card's left edge says it too). */}
        {timing.tone !== 'hidden' && (
          <span
            data-card-timing={timing.tone}
            title={whyNow || undefined}
            className={clsx(
              'inline-flex items-center gap-1 whitespace-nowrap tabular-nums',
              timing.tone === 'overdue' && 'font-semibold text-clay-error',
              timing.tone === 'today' && 'font-semibold text-clay-warning-strong dark:text-clay-ochre',
              timing.tone === 'scheduled' && 'text-clay-body',
              timing.tone === 'none' && 'text-clay-muted'
            )}
          >
            {timing.tone === 'scheduled' && <CalendarDays className="h-3 w-3 shrink-0" aria-hidden="true" />}
            {timing.label}{timing.date ? ` · ${timing.date}` : ''}
          </span>
        )}
        {nudgeSteps ? (
          <span
            data-nudge-badge
            title={nudge || undefined}
            aria-label={`Touch ${nudgeSteps[1]} of ${nudgeSteps[2]}${nudgeText ? ` · ${nudgeText.replace(nudgeSteps[0], '').trim()}` : ''}`}
            className="inline-flex items-center gap-[3px]"
          >
            {Array.from({ length: Number(nudgeSteps[2]) }, (_, i) => (
              <span key={i} aria-hidden="true" className={clsx('h-[6px] w-[6px] rounded-full', i < Number(nudgeSteps[1]) ? 'bg-clay-lavender' : 'bg-clay-hairline')} />
            ))}
          </span>
        ) : nudgeText ? (
          <span data-nudge-badge title={nudge || undefined} className="text-clay-muted">{nudgeText}</span>
        ) : null}
        {otherProduct && (
          <span className="inline-flex min-w-0 items-center gap-1 text-clay-teal dark:text-clay-mint" title={`${deal.title} · ${otherProduct}`}>
            <Package className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{otherProduct}</span>
          </span>
        )}
        {deal.value != null && (
          <span className="ml-auto inline-flex items-center gap-1 font-semibold text-clay-ink" title="Deal value"><Banknote className={factIcon} aria-hidden="true" />{formatBaht(deal.value)}</span>
        )}
        {quietNote && (
          <span data-quiet-note title="Time since the last logged contact with the buyer, in either direction." className="text-[10px] text-clay-muted">
            {quietNote}
          </span>
        )}
        {/* One status only, the most pressing: Laya's grade, then stalled, then a lane gap, then priority.
            Everything else (order size, chases since reply, days in lane) lives in the deal panel. */}
        {hasLayaChip ? (
          <LayaGradeChip grade={layaGrade} />
        ) : laneTime?.stalled ? (
          <span
            data-lane-days="stalled"
            title="Stalled: in this lane past its limit (14 days, or 1.2× what won deals took once three have passed through)."
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-clay-ochre"
          >
            <Hourglass className="h-3 w-3" aria-hidden="true" />
            stalled · {laneTime.days}d
          </span>
        ) : reviewLabels.length > 0 ? (
          <span title={reviewLabels.join(' · ')} className="inline-flex items-center gap-1 rounded bg-clay-lavender/20 px-1.5 py-0.5 text-[10px] font-medium text-clay-ink">
            <AlertCircle className="h-3 w-3" aria-hidden="true" /> Needs review
          </span>
        ) : deal.priority === 'high' ? (
          <span className="rounded bg-clay-coral/15 px-1.5 py-0.5 text-[10px] font-semibold text-clay-coral">High</span>
        ) : null}
      </div>}
    </div>
  );
}
