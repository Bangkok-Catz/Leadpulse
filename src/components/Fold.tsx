import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/** A card that starts folded, for things kept for reference rather than for today. */
export default function Fold({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <details className="group min-w-0 rounded-xl border border-clay-hairline bg-white dark:bg-clay-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3.5 text-sm font-semibold text-clay-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay-lavender [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-clay-muted transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-clay-hairline px-3.5 pb-3 pt-2">{children}</div>
    </details>
  );
}
