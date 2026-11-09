'use client';

// ─── The Reach-out sweep ───
// One never-contacted lead at a time: Keep, Not now or Not a fit (utils/sweep.ts). The pile is
// fixed when the sweep opens, so it never reshuffles under Pat's thumb; each choice saves in
// the background and the next card is already there. Undo puts the last one back. Keys: K or →
// keep, N or ↓ not now, X or ← not a fit, U undo, Esc close. No points: this is housekeeping.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import clsx from 'clsx';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ExternalLink, Search, Undo2, X } from 'lucide-react';
import ModalShell from '@/components/motion/ModalShell';
import CompanyLogo from '@/components/CompanyLogo';
import { useCrm } from '@/components/CrmProvider';
import { useToast } from '@/components/ToastProvider';
import { ROUTE_ICON } from '@/components/LeadActions';
import * as crm from '@/lib/crm';
import { FIT_LABELS, percent, type CompanyFit } from '@/utils/account-profile';
import { businessDateKey } from '@/utils/business-time';
import { dayLabel } from '@/utils/proposals';
import { notNowDate } from '@/utils/prospecting';
import { SWEEP_LABEL, buildSweepPile, noteFacts, sweepUpdate, type SweepCard, type SweepChoice } from '@/utils/sweep';

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay-lavender';
const MARKET: Record<string, string> = { local: 'Local', export: 'Export' };

/** How many leads are waiting to be sorted, for the buttons that open the sweep. */
export function useSweepCount(): number {
  const { deals, companies, contacts, meetings } = useCrm();
  return useMemo(() => buildSweepPile({ deals, companies, contacts, meetings, fits: new Map() }).length, [deals, companies, contacts, meetings]);
}

const noop = () => () => {};

export default function ReachOutSweep({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Rendered on the body: the pages' entrance motion leaves a transform on their wrapper,
  // which would pin a fixed dialog to the page instead of the screen.
  const onClient = useSyncExternalStore(noop, () => true, () => false);
  if (!onClient) return null;
  return createPortal(
    <ModalShell
      open={open}
      onClose={onClose}
      panelClassName="bg-clay-canvas dark:bg-clay-card md:max-w-lg md:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
    >
      {open && <Sweep onClose={onClose} />}
    </ModalShell>,
    document.body,
  );
}

type Decision = { id: string; choice: SweepChoice; activityId: string | null };

function Sweep({ onClose }: { onClose: () => void }) {
  const { deals, companies, contacts, meetings, refresh, logActivity, undoActivity } = useCrm();
  const { addToast } = useToast();
  const reduce = useReducedMotion();
  const today = businessDateKey();
  // The pile is fixed once the fit grades are in, so it never reshuffles mid-sweep.
  const [fits, setFits] = useState<Map<string, CompanyFit> | null>(null);
  const [order, setOrder] = useState<SweepCard[] | null>(null);
  const data = useRef({ deals, companies, contacts, meetings });
  useEffect(() => { data.current = { deals, companies, contacts, meetings }; });
  useEffect(() => {
    let live = true;
    const start = (rows: Map<string, CompanyFit>) => {
      if (!live) return;
      setFits(rows);
      setOrder(buildSweepPile({ ...data.current, fits: new Map([...rows].map(([id, fit]) => [id, fit.best.noul])) }));
    };
    crm.getCompanyFits().then(start).catch(() => start(new Map()));
    return () => { live = false; };
  }, []);

  const [decided, setDecided] = useState<Decision[]>([]);
  const [exit, setExit] = useState<SweepChoice>('keep');
  const changed = useRef(false);
  const decidedIds = useMemo(() => new Set(decided.map(d => d.id)), [decided]);
  const left = useMemo(() => (order ?? []).filter(card => !decidedIds.has(card.deal.id)), [order, decidedIds]);
  const card = left[0] ?? null;
  const total = order?.length ?? 0;
  const counts = useMemo(() => {
    const out: Record<SweepChoice, number> = { keep: 0, not_now: 0, not_fit: 0 };
    for (const d of decided) out[d.choice]++;
    return out;
  }, [decided]);

  const close = useCallback(() => {
    if (changed.current) void refresh();
    onClose();
  }, [onClose, refresh]);

  const choose = useCallback((choice: SweepChoice) => {
    if (!card) return;
    // Save against the deal as it is now (an Undo may have refreshed it since the pile was made).
    const deal = deals.find(d => d.id === card.deal.id) ?? card.deal;
    const { patch, before } = sweepUpdate(deal, choice, today);
    setExit(choice);
    setDecided(d => [...d, { id: deal.id, choice, activityId: null }]);
    changed.current = true;
    crm.updateDealIfUnchanged(deal.id, deal.updated_at, patch)
      .then(() => {
        const activityId = logActivity({
          type: 'edit', entity: 'deal', entityId: deal.id,
          label: `Sorted: ${SWEEP_LABEL[choice]}`, description: `${card.company.name}: ${SWEEP_LABEL[choice].toLowerCase()} (Reach-out sweep)`,
          undoPayload: before,
        });
        setDecided(d => d.map(x => (x.id === deal.id ? { ...x, activityId } : x)));
      })
      .catch(err => {
        // Put the card back so nothing looks sorted that wasn't.
        setDecided(d => d.filter(x => x.id !== deal.id));
        addToast(`${card.company.name} wasn't saved: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
      });
  }, [card, deals, today, logActivity, addToast]);

  const undo = useCallback(async () => {
    const last = decided.at(-1);
    if (!last) return;
    if (!last.activityId) {
      addToast('Still saving, try Undo again in a moment', 'error');
      return;
    }
    setDecided(d => d.slice(0, -1));
    const ok = await undoActivity(last.activityId);
    if (!ok) {
      setDecided(d => [...d, last]);
      addToast("Couldn't undo that one", 'error');
    }
  }, [decided, undoActivity, addToast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const key = e.key.toLowerCase();
      if (key === 'escape') { e.preventDefault(); close(); return; }
      if (key === 'u') { e.preventDefault(); void undo(); return; }
      if (!card) return;
      if (key === 'k' || key === 'arrowright') { e.preventDefault(); choose('keep'); }
      else if (key === 'n' || key === 'arrowdown') { e.preventDefault(); choose('not_now'); }
      else if (key === 'x' || key === 'arrowleft') { e.preventDefault(); choose('not_fit'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, choose, undo, close]);

  const sorted = decided.length;
  const away = reduce ? { opacity: 0 } : {
    keep: { opacity: 0, x: 90, rotate: 3 },
    not_fit: { opacity: 0, x: -90, rotate: -3 },
    not_now: { opacity: 0, y: 50 },
  }[exit];

  return (
    <div className="p-4 md:p-5" data-testid="reach-out-sweep" aria-label="Sort the Reach out pile">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-base font-semibold text-clay-ink">Sort the Reach out pile</h2>
        {sorted > 0 && (
          <button type="button" onClick={() => void undo()} className={clsx('inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-clay-muted hover:text-clay-ink', focusRing)}>
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Undo
          </button>
        )}
        <button type="button" onClick={close} aria-label="Close" className={clsx('inline-flex h-8 w-8 items-center justify-center rounded-lg text-clay-muted hover:text-clay-ink', focusRing)}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {order && total > 0 && (
        <div className="mt-3">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-clay-hairline"
            role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={sorted} aria-label="Sorted so far"
          >
            <motion.div
              className="h-full rounded-full bg-clay-lavender"
              initial={false}
              animate={{ width: `${(sorted / total) * 100}%` }}
              transition={{ duration: reduce ? 0 : 0.35, ease: 'easeOut' }}
            />
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-clay-muted" aria-live="polite">
            <span className="font-medium text-clay-ink">{sorted} of {total} sorted</span>
            {counts.keep > 0 && <span>Kept {counts.keep}</span>}
            {counts.not_now > 0 && <span>Not now {counts.not_now}</span>}
            {counts.not_fit > 0 && <span>Not a fit {counts.not_fit}</span>}
          </p>
        </div>
      )}

      <div className="relative mt-4 min-h-[15rem]">
        {!order ? (
          <p role="status" className="py-16 text-center text-sm text-clay-muted">Loading the pile…</p>
        ) : !card ? (
          <Finished total={total} kept={counts.keep} onClose={close} />
        ) : (
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={card.deal.id}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 }}
              exit={away}
              transition={{ duration: reduce ? 0.01 : 0.22, ease: 'easeOut' }}
            >
              <LeadCard card={card} fit={fits?.get(card.company.id) ?? null} />
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {card && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button type="button" onClick={() => choose('not_fit')} className={clsx('h-11 rounded-xl border border-clay-hairline bg-white text-sm font-medium text-clay-ink hover:border-clay-lavender active:scale-[0.97] dark:bg-clay-canvas', focusRing)}>
            Not a fit
          </button>
          <button type="button" onClick={() => choose('not_now')} className={clsx('h-11 rounded-xl border border-clay-hairline bg-white px-1 text-sm font-medium text-clay-ink hover:border-clay-lavender active:scale-[0.97] dark:bg-clay-canvas', focusRing)}>
            Not now<span className="block text-[11px] font-normal leading-none text-clay-muted">back {dayLabel(notNowDate(today))}</span>
          </button>
          <button type="button" onClick={() => choose('keep')} className={clsx('clay-btn-primary h-11 justify-center rounded-xl text-sm', focusRing)}>
            <Check className="h-4 w-4" aria-hidden="true" /> Keep
          </button>
        </div>
      )}
      {card && (
        <p className="mt-2 hidden text-center text-[11px] text-clay-muted-soft md:block">
          Keys: X not a fit · N not now · K keep · U undo
        </p>
      )}
    </div>
  );
}

function LeadCard({ card, fit }: { card: SweepCard; fit: CompanyFit | null }) {
  const { company, deal, route, source } = card;
  const RouteIcon = route ? ROUTE_ICON[route.type] : Search;
  const facts = noteFacts(company.notes);
  const about = [
    company.what_they_make || facts.type || company.industry,
    facts.place ?? (company.market ? MARKET[company.market] : null),
    source,
  ].filter(Boolean);
  const site = company.website?.trim() ? (/^https?:\/\//i.test(company.website) ? company.website : `https://${company.website}`) : null;
  return (
    <article className="rounded-2xl border border-clay-hairline bg-white p-4 shadow-sm dark:bg-clay-canvas" data-testid="sweep-card">
      <div className="flex items-start gap-3">
        <CompanyLogo src={company.logo_url} name={company.name} id={company.id} size={44} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug text-clay-ink">{company.name}</h3>
          {about.length > 0 && <p className="mt-0.5 text-xs text-clay-muted">{about.join(' · ')}</p>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {fit && (
          <span className={clsx('inline-flex h-6 items-center rounded-md px-2 text-xs', fit.fits ? 'bg-clay-lavender/20 text-clay-ink' : 'bg-clay-surface text-clay-muted dark:bg-clay-hairline/40')}>
            {fit.fits ? `Laya: ${FIT_LABELS[fit.best.archetype].short.toLowerCase()} fit ${percent(fit.best.noul)}` : `Laya: no fit · best ${percent(fit.best.noul)}`}
          </span>
        )}
        {deal.priority === 'high' && <span className="inline-flex h-6 items-center rounded-md bg-clay-surface px-2 text-xs text-clay-muted dark:bg-clay-hairline/40">High priority</span>}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[13px] text-clay-ink">
        <RouteIcon className="h-4 w-4 shrink-0 text-clay-muted" aria-hidden="true" />
        {route ? <span>Way in: <b className="font-semibold">{route.label}</b></span> : <span className="text-clay-muted">No way in yet · the owner search looks on Tue and Thu</span>}
      </p>

      {(facts.why || facts.rest) && (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-clay-body">
          {facts.why ? <><span className="text-clay-muted">Why: </span>{facts.why}</> : facts.rest}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        {site && (
          <a href={site} target="_blank" rel="noreferrer" className={clsx('inline-flex items-center gap-1 font-medium text-clay-lavender hover:underline', focusRing)}>
            Website <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}
        <Link href={`/companies?company=${company.id}`} className={clsx('font-medium text-clay-lavender hover:underline', focusRing)}>Open account</Link>
      </div>
    </article>
  );
}

function Finished({ total, kept, onClose }: { total: number; kept: number; onClose: () => void }) {
  return (
    <div className="py-10 text-center" data-testid="sweep-done">
      <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-full bg-clay-mint/30 text-clay-ink">
        <Check className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className="mt-3 text-base font-semibold text-clay-ink">{total === 0 ? 'Nothing to sort' : 'Pile sorted'}</h3>
      <p className="mt-1 text-sm text-clay-muted">
        {total === 0
          ? 'Every lead in Reach out has been contacted or sorted.'
          : kept > 0 ? `You kept ${kept}. They come first in Today's leads.` : 'Nothing kept this time.'}
      </p>
      <button type="button" onClick={onClose} className={clsx('clay-btn-primary mt-4', focusRing)}>Done</button>
    </div>
  );
}
