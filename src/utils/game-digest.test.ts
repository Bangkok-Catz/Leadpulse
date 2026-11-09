import { describe, expect, it } from 'vitest';
import type { Company, Deal, Meeting } from '@/types/crm';
import { buildAfternoonNudge, buildDailyDigest } from './daily-digest';
import { buildGameDigest, parseQuickCallback, quickCallback, type GameDigest } from './game-digest';
import type { AttentionCandidate } from './followup-policy';
import type { QuestSeed } from './quests';
import type { ThisWeekQueue } from './this-week-queue';

const MONDAY = '2026-11-09';
const UUID = '0b9a6c1e-2f4d-4b8a-9c3e-5d6f7a8b9c0d';

const queue = (over: Partial<ThisWeekQueue> = {}): ThisWeekQueue => ({
  needsReview: [], overdue: [], dueThisWeek: [], checkIns: [], needsDate: [], ...over,
});

const followup = (over: Partial<AttentionCandidate>): AttentionCandidate => ({
  id: 'x', action: 'honor_saved_followup', section: 'saved', reasonCode: 'saved', reason: '', sourceRefs: [],
  dueDate: '2026-11-01', originalDueDate: null, dueDateSource: null, companyId: 'co-1', companyName: 'Mello Vegan',
  dealId: 'deal-1', dealTitle: 'Mello Vegan · Butter', nextAction: 'Second follow-up: call เกลอ', priority: 'medium', holds: [], ...over,
});

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: 'deal-1', title: 'Mello Vegan · Butter', stage: 'research', product: 'Butter', client: 'Mello Vegan', company_id: 'co-1',
  contact_ids: [], value: null, priority: 'medium', next_action: 'Second follow-up: call เกลอ', followup_date: '2026-11-01',
  last_outcome: null, nudge_count: 0, workflow_action: 'reply', nudge_stage: null, sample_status: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over,
} as Deal);

const touch = (date: string, over: Partial<Meeting> = {}): Meeting => ({
  id: `m-${date}`, description: 'Called', type: 'call', date, company_id: 'co-9', contact_ids: [], deal_id: null, product: 'Butter',
  summary: null, outcome: null, direction: 'outbound', followup_date: null, created_at: `${date}T03:00:00Z`, ...over,
});

const noLeads = { today: [], more: [], waiting: [], dealIds: new Set<string>() } as unknown as Parameters<typeof buildGameDigest>[0]['leads'];

describe('the game for Telegram', () => {
  it('works out the streak, last week and the run the app shows', () => {
    const game = buildGameDigest({
      deals: [deal()], companies: [{ id: 'co-1', name: 'Mello Vegan', status: 'prospect' } as Company], contacts: [],
      meetings: [touch('2026-11-04'), touch('2026-11-05'), touch('2026-11-06'), touch('2026-10-20'), touch('2026-10-21')],
      events: [], queue: queue({ overdue: [followup({})] }), leads: noLeads, today: MONDAY, now: Date.parse('2026-11-09T02:00:00Z'),
    });
    expect(game.streak.current).toBe(3);
    expect(game.touchesToday).toBe(0);
    expect(game.lastWeek).toEqual({ touches: 3, best: 3, bestStart: '2026-11-02' });
    expect(game.run.map(q => [q.name, q.quick?.primary])).toEqual([['Mello Vegan', 'call']]);
  });

  it('skips last week on other days', () => {
    const game = buildGameDigest({
      deals: [], companies: [], contacts: [], meetings: [], events: [], queue: queue(), leads: noLeads, today: '2026-11-10', now: 0,
    });
    expect(game.lastWeek).toBeNull();
    expect(game.run).toEqual([]);
  });
});

describe('run buttons', () => {
  it('round-trip within 64 bytes', () => {
    const company = quickCallback('dm', { type: 'company', companyId: UUID, tier: 'reorder_only' });
    expect(new TextEncoder().encode(company).length).toBeLessThanOrEqual(64);
    expect(parseQuickCallback(company)).toEqual({ kind: 'dm', target: { type: 'company', companyId: UUID, tier: 'reorder_only' } });
    expect(parseQuickCallback(quickCallback('sample', { type: 'deal', dealId: UUID }))).toEqual({ kind: 'sample', target: { type: 'deal', dealId: UUID } });
    expect(parseQuickCallback(quickCallback('call', { type: 'lead', dealId: UUID }))).toEqual({ kind: 'call', target: { type: 'lead', dealId: UUID } });
  });

  it('refuse anything else', () => {
    expect(parseQuickCallback('save:123')).toBeNull();
    expect(parseQuickCallback('ql:hack:d:1')).toBeNull();
    expect(parseQuickCallback('ql:dm:c:1:vip')).toBeNull();
    expect(parseQuickCallback('ql:dm:d:../../x')).toBeNull();
  });
});

const seed = (over: Partial<QuestSeed>): QuestSeed => ({
  key: 'deal:deal-1', kind: 'late', name: 'Mello Vegan', action: 'Second follow-up: call เกลอ', full: '', dealId: 'deal-1', companyId: 'co-1',
  late: 8, points: 35, bonus: 0, held: false, weight: 50, tag: null, channel: null, href: null,
  quick: { primary: 'call', others: [] }, source: { type: 'followup' } as QuestSeed['source'], ...over,
});

const game = (over: Partial<GameDigest> = {}): GameDigest => ({
  streak: { current: 0, litToday: false, best: 6, bestFrom: '2026-10-19', bestTo: '2026-10-24', lastTouch: '2026-10-29' },
  touchesToday: 0,
  run: [seed({}), seed({ key: 'deal:deal-2', dealId: 'deal-2', name: 'ICING Creative', action: 'Send samples for testing', late: 4, quick: { primary: 'sample', others: [] } })],
  lastWeek: { touches: 0, best: 10, bestStart: '2026-10-19' },
  ...over,
});

describe('the morning message with the game', () => {
  it('leads with last week, the streak and the run, then one line of counts', () => {
    const digest = buildDailyDigest({ queue: queue({ overdue: [followup({}), followup({ dealId: 'deal-3' })] }), waiting: [], today: MONDAY, appUrl: 'https://lp.example', game: game() });
    const lines = digest.text.split('\n');
    expect(lines.slice(0, 3)).toEqual(['<b>LeadPulse · Mon 9 Nov</b>', 'Last week: 0 touches · best week 10 (19 Oct)', 'Streak: 0 days · best 6']);
    expect(digest.text).toContain("<b>Today's run · 0/5</b>\n• <b>Mello Vegan</b> · Second follow-up: call เกลอ · 8d late\n• <b>ICING Creative</b> · Send samples for testing · 4d late");
    expect(digest.text).toContain('Also: 2 overdue');
    expect(digest.text).not.toContain('<b>Overdue</b>');
    expect(digest.buttons).toEqual([
      [{ text: '✓ Mello Vegan · Called', callback_data: 'ql:call:d:deal-1' }],
      [{ text: '✓ ICING Creative · Sample sent', callback_data: 'ql:sample:d:deal-2' }],
    ]);
    expect(digest.isEmpty).toBe(false);
  });

  it('leaves out a held step\'s button', () => {
    const digest = buildDailyDigest({ queue: queue(), waiting: [], today: MONDAY, game: game({ run: [seed({ held: true })] }) });
    expect(digest.buttons).toBeUndefined();
  });
});

describe('the 4 pm nudge with the game', () => {
  it('goes out on a day with nothing logged, with the run and its buttons', () => {
    const nudge = buildAfternoonNudge({ queue: queue(), waiting: [], today: MONDAY, game: game({ streak: { ...game().streak, current: 3 } }) });
    expect(nudge.isEmpty).toBe(false);
    expect(nudge.text).toContain('Nothing logged yet today. One touch keeps your 3-day streak.');
    expect(nudge.text).toContain("<b>Still in today's run</b>");
    expect(nudge.buttons).toHaveLength(2);
  });

  it('stays quiet once something is logged and nothing is due', () => {
    const nudge = buildAfternoonNudge({ queue: queue(), waiting: [], today: MONDAY, game: game({ touchesToday: 1 }) });
    expect(nudge.isEmpty).toBe(true);
    expect(nudge.buttons).toBeUndefined();
  });
});
