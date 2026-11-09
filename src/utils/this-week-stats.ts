// Small numbers This week and the morning digest share. Pure; dates are Bangkok date keys.

import type { HealthTier } from './accountHealth';
import { businessDaysBetween, isCalendarDateKey } from './business-time';
import type { CheckInRow } from './this-week-queue';

/** How many days past its date an item is (0 when not overdue or undated). */
export function daysOverdue(dueDate: string | null, today: string): number {
  if (!dueDate || !isCalendarDateKey(dueDate)) return 0;
  return Math.max(0, businessDaysBetween(dueDate, today));
}

export function checkInSplit(checkIns: readonly CheckInRow[]): Record<HealthTier | 'reorder_only', number> {
  const split = { healthy: 0, watch: 0, at_risk: 0, dormant: 0, reorder_only: 0 };
  for (const row of checkIns) split[row.tier ?? 'reorder_only'] += 1;
  return split;
}
