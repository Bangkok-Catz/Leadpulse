import { describe, expect, it } from 'vitest';
import type { RhythmView } from './sales-rhythm';
import { bestMonth, importGain, monthPace, regularsLine } from './sales-game';

const m = (month: string, amount: number, orders = 1) => ({ month, amount, orders, buyers: 1 });

describe('the Sales scoreboard', () => {
  it('measures this month against a usual month', () => {
    const months = [m('2026-09-01', 20000), m('2026-10-01', 30000), m('2026-11-01', 12000, 3)];
    expect(monthPace(months, '2026-11-01', 24000)).toEqual({ amount: 12000, orders: 3, usual: 24000, share: 0.5, above: false });
    expect(monthPace(months, '2026-11-01', 10000).above).toBe(true);
    expect(monthPace([], '2026-11-01', null)).toEqual({ amount: 0, orders: 0, usual: null, share: null, above: false });
  });

  it('finds the best month, latest on a tie, none without sales', () => {
    expect(bestMonth([m('2026-07-01', 41000), m('2026-08-01', 9000), m('2026-10-01', 41000)])).toEqual({ month: '2026-10-01', amount: 41000 });
    expect(bestMonth([m('2026-07-01', 0)])).toBeNull();
  });

  it('counts regulars by how they stand', () => {
    const r = (status: RhythmView['status']) => ({ status } as RhythmView);
    expect(regularsLine([r('late'), r('due'), r('due'), r('on_track'), r('quiet')])).toEqual({ late: 1, due: 2, onTrack: 1 });
  });

  it('says what an import added', () => {
    expect(importGain([m('2026-10-01', 30000, 4)], [m('2026-10-01', 30000, 4), m('2026-11-01', 5200.4, 2)])).toEqual({ amount: 5200, orders: 2 });
    expect(importGain([m('2026-10-01', 30000, 4)], [m('2026-10-01', 30000, 4)])).toEqual({ amount: 0, orders: 0 });
  });
});
