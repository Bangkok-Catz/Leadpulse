import { describe, expect, it } from 'vitest';
import type { Deal, Meeting } from '../types/crm';
import {
  POINTS, RUN_SIZE, badges, bestWeek, boardCounts, dayRange, doneToday, gameEvents, isQuestDone, laneWins,
  meetingPoints, pickRun, shortAction, pointsBetween, pointsContext, questPoints, questWeight, stopOf, streak, touchesByDay,
  weekStart, weeklyTouches, type GameSnapshot, type Quest,
} from './game';
import type { LaneTimeline } from './lane-time';

const meeting = (over: Partial<Meeting>): Meeting => ({
  id: Math.random().toString(36).slice(2),
  description: 'Touch',
  type: 'dm',
  date: '2026-11-09',
  company_id: null,
  contact_ids: [],
  deal_id: null,
  product: null,
  summary: null,
  outcome: null,
  direction: 'outbound',
  followup_date: null,
  created_at: '2026-11-09T03:00:00Z',
  ...over,
});

const deal = (over: Partial<Deal>): Deal => ({
  id: 'd1', title: 'Deal', stage: 'contacted', product: 'Butter', client: 'Client', company_id: 'c1', contact_ids: [],
  value: null, priority: 'medium', next_action: null, followup_date: null, last_outcome: null, nudge_count: 0,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...over,
} as Deal);

// Pat's touches per day from the live data, 15 Aug to 9 Nov 2026.
const LIVE: Record<string, number> = {
  '2026-08-20': 6, '2026-08-24': 2, '2026-08-25': 3, '2026-08-26': 1, '2026-09-02': 1, '2026-09-06': 5,
  '2026-09-09': 3, '2026-09-10': 5, '2026-09-11': 1, '2026-09-14': 4, '2026-09-15': 1, '2026-09-17': 4,
  '2026-09-21': 3, '2026-09-27': 1, '2026-09-28': 1, '2026-09-29': 5, '2026-10-04': 1, '2026-10-05': 2,
  '2026-10-06': 1, '2026-10-07': 4, '2026-10-09': 1, '2026-10-11': 1, '2026-10-15': 8, '2026-10-19': 1,
  '2026-10-20': 3, '2026-10-21': 2, '2026-10-22': 1, '2026-10-23': 2, '2026-10-24': 1, '2026-10-29': 3,
};
const liveDays = new Map(Object.entries(LIVE));
const ctx0 = pointsContext({ deals: [], companies: [], contacts: [] });

describe('touches', () => {
  it('counts calls, messages, samples and replies, never notes, rewards or internal entries', () => {
    const days = touchesByDay([
      meeting({ type: 'call' }), meeting({ type: 'sample_sent' }), meeting({ direction: 'inbound' }),
      meeting({ type: 'note' }), meeting({ type: 'reward' }), meeting({ type: 'meeting', direction: 'internal' }),
    ]);
    expect(days.get('2026-11-09')).toBe(3);
  });
});

describe('points', () => {
  const ctx = pointsContext({
    deals: [deal({ id: 'won', company_id: 'regular', stage: 'closed_won' }), deal({ id: 'open', company_id: 'new', decision_maker_contact_id: 'boss' })],
    companies: [{ id: 'shop', status: 'active_customer', decision_maker_contact_id: null }],
    contacts: [{ id: 'owner', job_title: 'Owner' }, { id: 'chef', job_title: 'Pastry chef' }],
  });

  it('scores a touch by what it reached', () => {
    expect(meetingPoints(meeting({ deal_id: 'open' }), ctx)).toBe(POINTS.touch);
    expect(meetingPoints(meeting({ deal_id: 'open', type: 'sample_sent' }), ctx)).toBe(POINTS.sample);
    expect(meetingPoints(meeting({ deal_id: 'open', direction: 'inbound' }), ctx)).toBe(POINTS.reply);
    expect(meetingPoints(meeting({ company_id: 'shop' }), ctx)).toBe(POINTS.regular);
    expect(meetingPoints(meeting({ company_id: 'regular' }), ctx)).toBe(POINTS.regular);
    expect(meetingPoints(meeting({ deal_id: 'open', contact_ids: ['boss'] }), ctx)).toBe(POINTS.touch + POINTS.owner);
    expect(meetingPoints(meeting({ deal_id: 'open', contact_ids: ['owner'] }), ctx)).toBe(POINTS.touch + POINTS.owner);
    expect(meetingPoints(meeting({ deal_id: 'open', contact_ids: ['chef'] }), ctx)).toBe(POINTS.touch);
    expect(meetingPoints(meeting({ type: 'note', deal_id: 'open' }), ctx)).toBe(0);
  });

  it('adds Testing moves and wins on the day they happened', () => {
    const moved = Date.parse('2026-11-09T04:00:00Z');
    const timelines = new Map<string, LaneTimeline>([
      ['t', { enteredAt: moved, source: 'moved', stays: [{ lane: 'sample', from: null, to: moved }, { lane: 'testing', from: moved, to: null }] }],
    ]);
    const wins = laneWins([deal({ id: 't', workflow_action: 'testing' }), deal({ id: 'w', stage: 'closed_won', close_date: '2026-11-10' })], timelines);
    expect(wins).toEqual([
      { dealId: 't', kind: 'testing', date: '2026-11-09', points: POINTS.testing },
      { dealId: 'w', kind: 'won', date: '2026-11-10', points: POINTS.won },
    ]);
    expect(pointsBetween([meeting({})], wins, ctx0, '2026-11-09', '2026-11-15')).toBe(POINTS.touch + POINTS.testing + POINTS.won);
    expect(pointsBetween([meeting({})], wins, ctx0, '2026-11-10', '2026-11-15')).toBe(POINTS.won);
  });
});

describe('streak', () => {
  it("matches Pat's history: best 6 days, 19–24 Oct, cold since 29 Oct", () => {
    const s = streak(liveDays, '2026-11-09');
    expect(s).toMatchObject({ current: 0, litToday: false, best: 6, bestFrom: '2026-10-19', bestTo: '2026-10-24', lastTouch: '2026-10-29' });
    expect(dayRange(s.bestFrom!, s.bestTo!)).toBe('19–24 Oct');
  });

  it('never breaks on a weekend and stays alive until today has passed', () => {
    const days = new Map([['2026-11-05', 1], ['2026-11-06', 2]]); // Thu, Fri
    expect(streak(days, '2026-11-09').current).toBe(2); // Monday morning, nothing yet
    expect(streak(new Map([...days, ['2026-11-09', 1]]), '2026-11-09')).toMatchObject({ current: 3, litToday: true });
    expect(streak(days, '2026-11-10').current).toBe(0); // Monday passed with no touch
    expect(streak(new Map([...days, ['2026-11-07', 1]]), '2026-11-09').current).toBe(3); // a Saturday touch adds a day
  });
});

describe('weeks', () => {
  it('counts Monday-to-Sunday weeks with this week last', () => {
    expect(weekStart('2026-11-09')).toBe('2026-11-09');
    expect(weekStart('2026-11-08')).toBe('2026-11-02');
    const weeks = weeklyTouches(liveDays, '2026-11-09');
    expect(weeks).toHaveLength(11);
    expect(weeks.at(-1)).toEqual({ start: '2026-11-09', count: 0 });
    expect(weeks.find(w => w.start === '2026-10-19')?.count).toBe(10);
    expect(bestWeek(liveDays)).toEqual({ count: 10, starts: ['2026-10-19'] });
  });
});

describe('badges', () => {
  it('reads every badge from what is logged', () => {
    const list = badges({
      days: liveDays,
      meetings: [meeting({ type: 'sample_sent', date: '2026-11-09' }), meeting({ type: 'sample_sent', date: '2026-11-10' })],
      deals: [
        deal({ id: 'a', stage: 'closed_won', close_date: '2026-10-02' }), deal({ id: 'b', stage: 'closed_won', close_date: '2026-10-12' }),
        deal({ id: 'c', stage: 'closed_won', close_date: '2026-10-30' }), deal({ id: 'open' }),
      ],
      timelines: new Map(),
      ctx: ctx0,
      late: 3,
      today: '2026-11-10',
    });
    const by = Object.fromEntries(list.map(b => [b.id, b]));
    expect(by.ten).toMatchObject({ unlocked: true, got: '19 Oct' });
    expect(by.six).toMatchObject({ unlocked: true, got: '19–24 Oct' });
    expect(by.three).toMatchObject({ unlocked: true, got: 'October' });
    expect(by.samples).toMatchObject({ unlocked: true, got: 'This week' });
    expect(by.clean).toMatchObject({ unlocked: false });
    expect(by.owner).toMatchObject({ unlocked: false, got: null });
  });

  it('gives Clean slate only when there is open work and nothing is late', () => {
    const base = { days: new Map(), meetings: [], timelines: new Map(), ctx: ctx0, today: '2026-11-09' };
    expect(badges({ ...base, deals: [], late: 0 }).find(b => b.id === 'clean')?.unlocked).toBe(false);
    expect(badges({ ...base, deals: [deal({})], late: 0 }).find(b => b.id === 'clean')?.unlocked).toBe(true);
  });
});

describe("today's run", () => {
  const quest = (over: Partial<Quest>): Quest => {
    const q = { key: over.key ?? 'q', kind: 'late', name: over.key ?? 'Q', action: 'Nudge', dealId: over.key ?? 'q', companyId: null, late: 0, points: 10, bonus: 0, held: false, weight: 0, ...over } as Quest;
    return { ...q, weight: questWeight(q) };
  };

  it('prices a step by what it is', () => {
    expect(questPoints('late', 'Send the samples to Ae', false, false)).toBe(POINTS.sample);
    expect(questPoints('late', 'Confirm the samples arrived', false, false)).toBe(POINTS.touch);
    expect(questPoints('checkin', 'Check in', true, false)).toBe(POINTS.regular);
    expect(questPoints('lead', 'Touch 1 of 5', false, true)).toBe(POINTS.touch + POINTS.owner);
    expect(questPoints('funding', 'Progress report', false, false)).toBe(0);
  });

  it('takes the biggest steps, one check-in, at most two leads and always one lead', () => {
    const quests = [
      quest({ key: 'sample', points: 40, late: 5 }),
      quest({ key: 'c1', kind: 'checkin', points: 30, late: 20 }),
      quest({ key: 'c2', kind: 'checkin', points: 30, late: 19 }),
      quest({ key: 'late1', late: 9 }),
      quest({ key: 'late2', late: 10 }),
      quest({ key: 'late3', late: 8 }),
      quest({ key: 'lead1', kind: 'lead' }),
      quest({ key: 'lead2', kind: 'lead' }),
      quest({ key: 'undated', kind: 'undated', points: 40 }),
      quest({ key: 'held', points: 40, late: 20, held: true }),
    ];
    const { run, next } = pickRun(quests, RUN_SIZE);
    expect(run.map(q => q.key)).toEqual(['sample', 'c1', 'late2', 'late1', 'lead1']);
    expect(next.map(q => q.key)).toEqual(expect.arrayContaining(['c2', 'late3', 'lead2', 'undated', 'held']));
    expect(pickRun(quests, 2).run.map(q => q.key)).toEqual(['sample', 'lead1']);
    expect(pickRun(quests, 0).run).toEqual([]);
  });

  it('keeps Up next a mix instead of every check-in first', () => {
    const quests = [
      quest({ key: 'c1', kind: 'checkin', points: 30, late: 20 }),
      quest({ key: 'c2', kind: 'checkin', points: 30, late: 20 }),
      quest({ key: 'c3', kind: 'checkin', points: 30, late: 20 }),
      quest({ key: 'l1', late: 3 }),
      quest({ key: 'l2', late: 2 }),
      quest({ key: 'u', kind: 'undated' }),
    ];
    expect(pickRun(quests, 0).next.map(q => q.key)).toEqual(['c1', 'l1', 'l2', 'c2', 'c3', 'u']);
  });

  it('marks a step done once today has a touch on its deal or company', () => {
    const ctx = pointsContext({ deals: [deal({ id: 'd1', company_id: 'c1' })], companies: [], contacts: [] });
    const done = doneToday(
      [meeting({ deal_id: 'd1' }), meeting({ deal_id: 'd1', type: 'sample_sent' }), meeting({ company_id: 'c2' }), meeting({ deal_id: 'd1', date: '2026-11-08' })],
      '2026-11-09', ctx, { deal: () => 'Sweet & Green', company: () => 'Veganerie' },
    );
    expect(done).toEqual([
      { key: 'deal:d1', name: 'Sweet & Green', dealId: 'd1', companyId: 'c1', touches: 2, points: POINTS.touch + POINTS.sample },
      { key: 'company:c2', name: 'Veganerie', dealId: null, companyId: 'c2', touches: 1, points: POINTS.touch },
    ]);
    expect(isQuestDone({ kind: 'late', dealId: 'd1', companyId: 'c1' }, done)).toBe(true);
    expect(isQuestDone({ kind: 'checkin', dealId: null, companyId: 'c1' }, done)).toBe(true);
    expect(isQuestDone({ kind: 'late', dealId: 'other', companyId: 'c2' }, done)).toBe(false);
    expect(isQuestDone({ kind: 'funding', dealId: null, companyId: null }, done)).toBe(false);
  });
});

describe('short actions', () => {
  it('cuts a saved next step to one line without dates or asides', () => {
    expect(shortAction('Pat: send samples for testing on 2026-10-20 (planned; not dispatched). Confirm sample SKU/quantity.')).toBe('Send samples for testing');
    expect(shortAction('Send samples to Sweet & Green on 2026-11-04: 2 unsalted + 2 salted; contact Ae (เอ้).')).toBe('Send samples to Sweet & Green');
    expect(shortAction('Check sample feedback')).toBe('Check sample feedback');
    expect(shortAction('Pat plans to deliver butter samples on 2026-10-30.')).toBe('Deliver butter samples');
    expect(shortAction('call the chef about the croissant lamination test and whether the 82% fat block works for them')).toMatch(/^Call the chef about the croissant lamination test and[^]*…$/);
    expect(shortAction(null)).toBe('');
  });
});

describe('board', () => {
  it('puts each open deal at its stop and counts wins this month', () => {
    expect(stopOf(deal({ workflow_action: 'outreach' }))).toBe('reach');
    expect(stopOf(deal({ workflow_action: 'reschedule' }))).toBe('testing');
    expect(stopOf(deal({ workflow_action: 'parked' }))).toBeNull();
    const counts = boardCounts([
      deal({ id: 'a', workflow_action: 'outreach' }), deal({ id: 'b', workflow_action: 'sample' }),
      deal({ id: 'c', stage: 'closed_won', close_date: '2026-11-03' }), deal({ id: 'd', stage: 'closed_won', close_date: '2026-10-03' }),
      deal({ id: 'e', workflow_action: 'parked' }),
    ], new Map(), '2026-11-09');
    expect(counts).toEqual({ reach: 1, reply: 0, sample: 1, testing: 0, won: 1 });
  });
});

describe('celebrations', () => {
  const snap = (over: Partial<GameSnapshot>): GameSnapshot => ({
    done: new Set(), touchesToday: 0, streak: 0, weekPoints: 0, weekTouches: 0, bestBefore: 10, unlocked: new Set(), wonThisMonth: 0, ...over,
  });

  it('fires nothing on the first load', () => {
    expect(gameEvents(null, snap({ touchesToday: 6, done: new Set(['deal:a']) }))).toEqual([]);
  });

  it('names each moment once, as it happens', () => {
    const before = snap({ done: new Set(['deal:a']), touchesToday: 4, streak: 2, weekTouches: 10 });
    const after = snap({ done: new Set(['deal:a', 'deal:b']), touchesToday: 5, streak: 3, weekTouches: 11, unlocked: new Set(['samples']), wonThisMonth: 1 });
    expect(gameEvents(before, after)).toEqual([
      { type: 'done', keys: ['deal:b'] },
      { type: 'streak', days: 3 },
      { type: 'run' },
      { type: 'best-week', count: 11 },
      { type: 'badge', ids: ['samples'] },
      { type: 'won' },
    ]);
    expect(gameEvents(after, snap({ ...after, touchesToday: 6 }))).toEqual([]);
  });
});
