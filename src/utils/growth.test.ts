import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GROWTH_KINDS,
  applicationText,
  buildComingUp,
  channelStats,
  dueLabel,
  groupGrowthItems,
  growthDueThisWeek,
  itemLine,
  normalizeGrowthDraft,
  emptyGrowthDraft,
  planGrowthLog,
  planStepDone,
  programsIn,
  resultLine,
  stageLine,
  windowStart,
  type GrowthItem,
} from './growth';

const TODAY = '2026-11-08';

function item(overrides: Partial<GrowthItem>): GrowthItem {
  return {
    id: overrides.id ?? overrides.name ?? 'x',
    track: 'funding',
    name: 'Item',
    kind: 'government',
    offer: null,
    stage: 1,
    status: 'open',
    next_step: null,
    next_date: null,
    waiting_since: null,
    url: null,
    note: null,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

describe('growth kinds', () => {
  it('match the growth_items check constraint', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261108090000_growth_page.sql'), 'utf8');
    const allowed = /kind in \(([^)]*)\)/.exec(sql)?.[1].match(/'([^']+)'/g)?.map(v => v.slice(1, -1));
    expect(allowed).toEqual([...GROWTH_KINDS]);
  });
});

describe('groupGrowthItems', () => {
  const items = [
    item({ name: 'NIA', stage: 5, next_date: '2026-11-14' }),
    item({ name: 'DIPROM', stage: 5 }),
    item({ name: 'Big Idea Ventures', kind: 'accelerator', stage: 1 }),
    item({ name: 'GWS', kind: 'pitch_event', status: 'missed' }),
    item({ name: 'Archived', stage: 3, deleted_at: '2026-11-02T00:00:00Z' }),
    item({ name: 'Story', track: 'pr', kind: 'press', stage: 3 }),
    item({ name: 'Feature', track: 'pr', kind: 'press', stage: 5 }),
    item({ name: 'Veganuary', track: 'pr', kind: 'moment', stage: 2 }),
  ];

  it('puts programs Pat is in first on Funding, closed rows last, and skips empty and archived', () => {
    const groups = groupGrowthItems(items, 'funding');
    expect(groups.map(g => g.label)).toEqual(['In a program', 'Watching', 'Closed']);
    // dated first, then by name
    expect(groups[0].items.map(i => i.name)).toEqual(['NIA', 'DIPROM']);
  });

  it('puts live PR work first and published last', () => {
    expect(groupGrowthItems(items, 'pr').map(g => g.label)).toEqual(['Pitched', 'Planned', 'Published']);
  });

  it('labels the stage', () => {
    expect(stageLine({ track: 'funding', stage: 3 })).toBe('Stage 3 of 5 · submitted');
    expect(stageLine({ track: 'pr', stage: 9 })).toBe('Stage 5 of 5 · published');
  });
});

describe('Coming up', () => {
  const items = [
    item({ id: 'late', name: 'Late', next_step: 'Report', next_date: '2026-11-05' }),
    item({ id: 'soon', name: 'Soon', next_step: 'Check-in', next_date: '2026-11-19' }),
    item({ id: 'far', name: 'Far', next_step: 'Check the site', next_date: '2027-01-05' }),
    item({ id: 'sent', name: 'Sent', next_step: 'Nudge', next_date: '2026-11-10', waiting_since: '2026-11-03' }),
    item({ id: 'idle', name: 'Idle' }),
    item({ id: 'closed', name: 'Closed', status: 'done', next_date: '2026-11-09' }),
  ];

  it('splits open rows into due soon, waiting on them and later', () => {
    const up = buildComingUp(items, TODAY);
    expect(up.due.map(i => i.id)).toEqual(['late', 'sent', 'soon']);
    expect(up.waiting.map(i => i.id)).toEqual(['sent']);
    expect(up.later.map(i => i.id)).toEqual(['far']);
    expect(up.total).toBe(4);
  });

  it('says how far off a date is', () => {
    expect(dueLabel('2026-11-05', TODAY)).toEqual({ text: '3d late', tone: 'late' });
    expect(dueLabel(TODAY, TODAY)?.text).toBe('today');
    expect(dueLabel('2026-11-09', TODAY)?.text).toBe('tomorrow');
    expect(dueLabel('2026-11-14', TODAY)?.text).toBe('in 6 days');
    expect(dueLabel('2027-01-05', TODAY)).toEqual({ text: 'Tue 5 Jan', tone: 'later' });
    expect(dueLabel(null, TODAY)).toBeNull();
  });

  it('writes the row line from what was sent, the step and its date', () => {
    expect(itemLine(item({ next_step: 'Nudge about the deck', next_date: '2026-11-10', waiting_since: '2026-11-03' })))
      .toBe('Sent Tue 3 Nov · Nudge about the deck · Tue 10 Nov');
    expect(itemLine(item({ note: 'No 2026 casting yet\nsecond line' }))).toBe('No 2026 casting yet');
    expect(itemLine(item({}))).toBe('');
  });

  it('gives This week the late and next-seven-day steps', () => {
    const due = growthDueThisWeek(items, TODAY);
    expect(due.overdue.map(i => i.id)).toEqual(['late']);
    expect(due.week.map(i => i.id)).toEqual(['sent']);
  });
});

describe('logging', () => {
  it('writes the note and the new next step; a fresh wait starts today', () => {
    const log = planGrowthLog({
      item: { id: 'a', stage: 2, waiting_since: null },
      note: '  Sent the deck ',
      nextStep: 'Nudge',
      nextDate: '2026-11-15',
      stage: 3,
      waiting: true,
      today: TODAY,
    });
    expect(log.update).toEqual({ item_id: 'a', happened_on: TODAY, note: 'Sent the deck' });
    expect(log.patch).toEqual({ stage: 3, next_step: 'Nudge', next_date: '2026-11-15', waiting_since: TODAY });
  });

  it('keeps the first sent date while still waiting, and a blank note writes no row', () => {
    const log = planGrowthLog({
      item: { id: 'a', stage: 3, waiting_since: '2026-11-03' },
      note: ' ',
      nextStep: '',
      nextDate: 'not a date',
      stage: 3,
      waiting: true,
      today: TODAY,
    });
    expect(log.update).toBeNull();
    expect(log.patch).toEqual({ stage: 3, next_step: null, next_date: null, waiting_since: '2026-11-03' });
  });

  it('marks a step done by logging it and clearing it', () => {
    expect(planStepDone({ id: 'a', next_step: 'Progress report' }, TODAY)).toEqual({
      update: { item_id: 'a', happened_on: TODAY, note: 'Done: Progress report' },
      patch: { next_step: null, next_date: null },
    });
  });
});

describe('the add form', () => {
  it('needs a name, trims text and adds https to a bare domain', () => {
    expect(normalizeGrowthDraft({ ...emptyGrowthDraft('funding'), name: '  ' })).toEqual({ error: 'Add a name.' });
    const result = normalizeGrowthDraft({ ...emptyGrowthDraft('pr'), name: ' Brand Buffet ', url: 'brandbuffet.in.th', offer: ' ', stage: 7 });
    expect(result).toEqual({
      payload: {
        track: 'pr', name: 'Brand Buffet', kind: 'press', offer: null, stage: 5,
        next_step: null, next_date: null, url: 'https://brandbuffet.in.th', note: null,
      },
    });
  });
});

describe('application text', () => {
  const facts = { usualMonth: 24750, regulars: 6, leads: 123, programs: ['DIPROM (กสอ.)', 'NIA (สนช.)', 'OSMEP (สสว.)'] };

  it('writes English from the live numbers, without the Thai abbreviations', () => {
    expect(applicationText('en', facts)).toBe(
      'VG Saveur makes dairy-free butter for bakeries, cafés and vegan restaurants in Thailand. '
      + 'A usual month brings ฿24,750 in sales, 6 regular buyers keep reordering, and 123 more leads are lined up. '
      + 'We are supported by DIPROM, NIA and OSMEP.',
    );
  });

  it('writes Thai', () => {
    expect(applicationText('th', facts)).toBe(
      'VG Saveur ผลิตเนยจากพืชสำหรับร้านเบเกอรี่ คาเฟ่ และร้านอาหารวีแกนในไทย '
      + 'ยอดขายเดือนปกติ ฿24,750 มีลูกค้าประจำ 6 รายที่สั่งซ้ำ และ มีลีดอีก 123 รายรอติดต่อ '
      + 'ได้รับการสนับสนุนจาก DIPROM (กสอ.) NIA (สนช.) และ OSMEP (สสว.)',
    );
  });

  it('leaves out what is unknown', () => {
    expect(applicationText('en', { usualMonth: null, regulars: 1, leads: 0, programs: [] })).toBe(
      'VG Saveur makes dairy-free butter for bakeries, cafés and vegan restaurants in Thailand. 1 regular buyer keeps reordering.',
    );
  });

  it('counts only open funding rows at stage 5 as programs', () => {
    expect(programsIn([
      item({ name: 'NIA', stage: 5 }),
      item({ name: 'Ended', stage: 5, status: 'done' }),
      item({ name: 'Story', track: 'pr', stage: 5 }),
      item({ name: 'Watching', stage: 1 }),
    ])).toEqual(['NIA']);
  });
});

describe('where buyers came from', () => {
  const companies = [
    { id: 'a', created_at: '2026-10-01T03:00:00Z', acquisition_source: 'meta_ad' as const, acquisition_campaign: 'Bangkok bakeries' },
    { id: 'b', created_at: '2026-10-05T03:00:00Z', acquisition_source: 'meta_ad' as const, acquisition_campaign: 'bangkok bakeries ' },
    { id: 'c', created_at: '2026-09-20T03:00:00Z', acquisition_source: 'outbound' as const, acquisition_campaign: null },
    { id: 'd', created_at: '2026-10-02T03:00:00Z', acquisition_source: null, acquisition_campaign: null },
    { id: 'old', created_at: '2026-01-02T03:00:00Z', acquisition_source: 'outbound' as const, acquisition_campaign: null },
  ];
  const deals = [{ company_id: 'a', stage: 'closed_won' as const }, { company_id: 'c', stage: 'research' as const }];
  const sales = new Map([['a', 5200], ['old', 9000]]);

  it('counts accounts added since the start by source, with wins, sales and campaigns', () => {
    const stats = channelStats({ companies, deals, salesByCompany: sales, since: windowStart('90d', TODAY) });
    expect(windowStart('90d', TODAY)).toBe('2026-08-10');
    expect(stats.rows).toEqual([
      { source: 'meta_ad', label: 'Meta ads', leads: 2, won: 1, sales: 5200 },
      { source: 'outbound', label: 'Your outreach', leads: 1, won: 0, sales: 0 },
    ]);
    expect(stats.campaigns).toEqual([{ name: 'Bangkok bakeries', source: 'meta_ad', leads: 2, won: 1, sales: 5200 }]);
    expect(stats.notRecorded).toBe(1);
    expect(resultLine(stats.campaigns[0])).toBe('2 leads · 1 won · ฿5,200');
  });

  it('reaches back to 1 January for This year', () => {
    expect(windowStart('year', TODAY)).toBe('2026-01-01');
    expect(channelStats({ companies, deals, salesByCompany: sales, since: '2026-01-01' }).rows[0]).toEqual(
      { source: 'outbound', label: 'Your outreach', leads: 2, won: 0, sales: 9000 },
    );
  });
});
