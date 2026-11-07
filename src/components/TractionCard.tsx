'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Copy } from 'lucide-react';
import { useToast } from '@/components/ToastProvider';
import { focusRing, smallBtn } from '@/components/GrowthRow';
import { formatBaht } from '@/utils/format';
import { applicationText, type TractionFacts } from '@/utils/growth';

/** The numbers every application asks for, kept current from Sales, and a paragraph to paste. */
export default function TractionCard({ facts, loading }: { facts: TractionFacts; loading: boolean }) {
  const { addToast } = useToast();
  const [lang, setLang] = useState<'en' | 'th'>('en');
  const text = applicationText(lang, facts);
  const dash = loading ? '…' : '—';

  const tiles = [
    { label: 'Usual month', value: facts.usualMonth != null ? formatBaht(facts.usualMonth) : dash, sub: 'median of past months' },
    { label: 'Regulars', value: loading ? dash : String(facts.regulars), sub: 'still ordering' },
    { label: 'Leads lined up', value: String(facts.leads), sub: 'found, not yet contacted' },
    { label: 'Programs', value: String(facts.programs.length), sub: facts.programs.length ? facts.programs.map(p => p.replace(/\s*\([^)]*\)/g, '')).join(' · ') : 'none yet' },
  ];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      addToast('Copied');
    } catch {
      addToast('Could not copy. Select the text instead.', 'error');
    }
  };

  return (
    <section aria-labelledby="growth-traction" className="flex min-w-0 flex-col gap-3 rounded-xl border border-clay-hairline bg-white p-3.5 dark:bg-clay-card">
      <h2 id="growth-traction" className="text-sm font-semibold text-clay-ink">Traction</h2>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map(tile => (
          <div key={tile.label} className="min-w-0 rounded-[10px] bg-clay-card px-3 py-2.5 dark:bg-clay-surface">
            <p className="text-xs text-clay-muted">{tile.label}</p>
            <p className="mt-0.5 text-xl font-semibold leading-tight text-clay-ink tabular-nums">{tile.value}</p>
            <p className="text-[11px] leading-snug text-clay-muted">{tile.sub}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t border-clay-hairline pt-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-clay-ink">For applications</h3>
          <div className="flex gap-1.5" role="group" aria-label="Language">
            {(['en', 'th'] as const).map(l => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => setLang(l)}
                className={clsx(
                  'h-7 rounded-lg border px-2.5 text-xs transition-colors',
                  lang === l ? 'border-clay-lavender/60 bg-clay-lavender/20 text-clay-ink' : 'border-clay-hairline text-clay-muted hover:text-clay-ink',
                  focusRing,
                )}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <p lang={lang} data-testid="application-text" className="rounded-[10px] bg-clay-surface px-3 py-2.5 text-[13px] leading-relaxed text-clay-body">{text}</p>
        <button type="button" onClick={copy} className={clsx(smallBtn, 'self-start')}>
          <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
        </button>
      </div>
    </section>
  );
}
