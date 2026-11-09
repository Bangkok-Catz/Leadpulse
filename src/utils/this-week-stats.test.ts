import { describe, expect, it } from 'vitest';
import type { CheckInRow } from './this-week-queue';
import { checkInSplit, daysOverdue } from './this-week-stats';

describe('this-week stats', () => {
  it('counts business days past a date, and nothing for undated or future items', () => {
    expect(daysOverdue('2026-11-04', '2026-11-09')).toBeGreaterThan(0);
    expect(daysOverdue('2026-11-12', '2026-11-09')).toBe(0);
    expect(daysOverdue(null, '2026-11-09')).toBe(0);
  });

  it('splits check-ins by health, counting reorder-only rows separately', () => {
    const rows = [{ tier: 'at_risk' }, { tier: 'at_risk' }, { tier: 'watch' }, { tier: null }] as CheckInRow[];
    expect(checkInSplit(rows)).toEqual({ healthy: 0, watch: 1, at_risk: 2, dormant: 0, reorder_only: 1 });
  });
});
