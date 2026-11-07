import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { Company, Deal } from '@/types/crm';
import type { GrowthItem } from '@/utils/growth';

const crm = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@/components/CrmProvider', () => ({ useCrm: () => crm.value }));
const toast = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => toast }));
vi.mock('@/components/CompanyLogo', () => ({ default: () => null }));
vi.mock('@/components/blob', () => ({ Blob: () => null }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/utils/useBusinessDateKey', () => ({ useBusinessDateKey: () => '2026-11-08' }));
vi.mock('@/lib/sales', () => ({
  getSalesByMonth: async () => [
    { month: '2026-08-01', amount: 20000, orders: 9, buyers: 6 },
    { month: '2026-09-01', amount: 24750, orders: 10, buyers: 7 },
    { month: '2026-10-01', amount: 30000, orders: 12, buyers: 8 },
  ],
  getCustomerRhythms: async () => [
    { customer_id: 'hl', name_en: 'Healthy Lux', name_th: null, crm_company_id: null, order_count: 20, first_order: '2025-01-01', last_order: '2026-11-01', median_gap_days: 14, median_value: 2000 },
  ],
  getSalesByCompany: async () => new Map([['meta-co', 5200]]),
}));

const item = (over: Partial<GrowthItem>): GrowthItem => ({
  id: over.name ?? 'x', track: 'funding', name: 'x', kind: 'government', offer: null, stage: 5, status: 'open',
  next_step: null, next_date: null, waiting_since: null, url: null, note: null,
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', deleted_at: null, ...over,
});

const db = vi.hoisted(() => ({
  items: [] as GrowthItem[],
  getGrowthItems: vi.fn(),
  createGrowthItem: vi.fn(async () => ({})),
  updateGrowthItem: vi.fn(async () => ({})),
  addGrowthUpdate: vi.fn(async () => {}),
  archiveGrowthItem: vi.fn(async () => {}),
  restoreGrowthItem: vi.fn(async () => {}),
  getGrowthUpdates: vi.fn(async () => []),
}));
vi.mock('@/lib/growth', () => ({
  getGrowthItems: async () => db.items,
  createGrowthItem: db.createGrowthItem,
  updateGrowthItem: db.updateGrowthItem,
  addGrowthUpdate: db.addGrowthUpdate,
  archiveGrowthItem: db.archiveGrowthItem,
  restoreGrowthItem: db.restoreGrowthItem,
  getGrowthUpdates: db.getGrowthUpdates,
}));

const socialRows = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('@/lib/social', () => ({ getSocialSnapshots: async () => socialRows.rows }));

import GrowthPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  socialRows.rows = [];
});

const companies = [
  { id: 'meta-co', name: 'Bakery A', status: 'prospect', created_at: '2026-10-01T00:00:00Z', acquisition_source: 'meta_ad', acquisition_campaign: 'Bangkok bakeries' },
  { id: 'out-co', name: 'Cafe B', status: 'prospect', created_at: '2026-10-02T00:00:00Z', acquisition_source: 'outbound', acquisition_campaign: null },
  { id: 'none-co', name: 'Cafe C', status: 'prospect', created_at: '2026-10-03T00:00:00Z', acquisition_source: null, acquisition_campaign: null },
] as unknown as Company[];
const deals = [{ id: 'd1', company_id: 'meta-co', stage: 'closed_won', contact_ids: [] }] as unknown as Deal[];
crm.value = { companies, deals, contacts: [], meetings: [] };

function seed() {
  db.items = [
    item({ name: 'DIPROM (กสอ.)' }),
    item({ name: 'NIA (สนช.)', next_step: 'Progress report', next_date: '2026-11-14' }),
    item({ name: 'OSMEP (สสว.)' }),
    item({ name: 'Big Idea Ventures', kind: 'accelerator', stage: 1, offer: 'Equity', url: 'https://bigideaventures.com', note: '2026 call was pet food only' }),
    item({ name: 'Better Bite Ventures', kind: 'investor', stage: 3, next_step: 'Nudge', next_date: '2026-11-11', waiting_since: '2026-11-04' }),
  ];
}

describe('Growth page', () => {
  it('shows what is coming up, the traction numbers and the text for applications', async () => {
    seed();
    render(<GrowthPage />);

    expect(screen.getByRole('heading', { name: 'Growth' })).toBeTruthy();
    const comingUp = screen.getByRole('region', { name: /Coming up/ });
    await waitFor(() => expect(within(comingUp).getAllByTestId('growth-row')).toHaveLength(2));
    // Soonest first: the nudge (Wed 11) before the NIA report (Sat 14).
    const rows = within(comingUp).getAllByTestId('growth-row').map(r => r.textContent);
    expect(rows[0]).toContain('Better Bite Ventures');
    expect(rows[0]).toContain('Sent Wed 4 Nov · Nudge · Wed 11 Nov');
    expect(rows[1]).toContain('in 6 days');
    expect(rows[1]).toContain('Progress report · Sat 14 Nov');

    const traction = screen.getByRole('region', { name: 'Traction' });
    await waitFor(() => expect(traction.textContent).toContain('฿24,750'));
    expect(traction.textContent).toContain('DIPROM · NIA · OSMEP');
    expect(screen.getByTestId('application-text').textContent).toContain('We are supported by DIPROM, NIA and OSMEP.');
    fireEvent.click(within(traction).getByRole('button', { name: 'TH' }));
    expect(screen.getByTestId('application-text').textContent).toContain('ได้รับการสนับสนุนจาก DIPROM (กสอ.) NIA (สนช.) และ OSMEP (สสว.)');
  });

  it('groups Funding by stage, has no PR tab, and switches to Social', async () => {
    seed();
    render(<GrowthPage />);

    await waitFor(() => expect(screen.getByRole('heading', { name: /In a program · 3/ })).toBeTruthy());
    expect(screen.getByRole('heading', { name: /Watching · 1/ })).toBeTruthy();
    expect(screen.getByText('Stage 1 of 5 · watching')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Big Idea Ventures site' }).getAttribute('href')).toBe('https://bigideaventures.com');

    expect(screen.getByRole('heading', { name: /Submitted · 1/ })).toBeTruthy();
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Due soon2', 'Waiting on them1', 'Later0', 'Funding5', 'Social']);

    fireEvent.click(screen.getByRole('tab', { name: 'Social' }));
    const channels = screen.getByRole('region', { name: 'Where buyers came from' });
    expect(within(channels).getByRole('img', { name: 'Meta ads: 1 lead, 1 won, ฿0' })).toBeTruthy();
    await waitFor(() => expect(within(channels).getByRole('img', { name: 'Meta ads: 1 lead, 1 won, ฿5,200' })).toBeTruthy());
    expect(channels.textContent).toContain('Your outreach');
    expect(channels.textContent).toContain('1 account has no source recorded.');
    expect(screen.getByRole('region', { name: 'Campaigns' }).textContent).toContain('1 lead · 1 won · ฿5,200');
  });

  it("shows each channel's week from Metricool on the Social tab", async () => {
    seed();
    const snap = (network: string, period_start: string, period_end: string, over: Record<string, number | null>) => ({
      network, period_start, period_end, followers: null, followers_change: null, reach: null, views: null,
      interactions: null, posts: null, fetched_at: '2026-11-09T02:00:00Z', ...over,
    });
    socialRows.rows = [
      snap('instagram', '2026-10-26', '2026-11-01', { followers: 2054, followers_change: 20 }),
      snap('instagram', '2026-11-02', '2026-11-08', { followers: 2140, followers_change: 86, reach: 12400, views: 30100, interactions: 820, posts: 6 }),
      snap('googleBusinessProfile', '2026-11-02', '2026-11-08', { views: 420, interactions: 31, posts: 1 }),
    ];
    render(<GrowthPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Social' }));

    const card = screen.getByRole('region', { name: 'Channel growth' });
    await waitFor(() => expect(within(card).getAllByTestId('channel-row')).toHaveLength(2));
    expect(card.textContent).toContain('Week of 2–8 Nov · from Metricool');
    const [ig, gbp] = within(card).getAllByTestId('channel-row');
    expect(ig.textContent).toContain('Instagram2,140 followers+86 this week');
    expect(ig.textContent).toContain('12.4k reached · 30.1k views · 820 interactions · 6 posts');
    expect(within(ig).getByRole('img', { name: 'Instagram followers over the last 2 weeks' })).toBeTruthy();
    expect(gbp.textContent).toContain('Google Business420 views this week');
  });

  it('asks to link channels in Metricool when none have arrived', async () => {
    seed();
    render(<GrowthPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Social' }));

    const card = screen.getByRole('region', { name: 'Channel growth' });
    const link = await within(card).findByRole('link', { name: /Open Metricool connections/ });
    expect(link.getAttribute('href')).toBe('https://app.metricool.com/brands/connections?blogId=7936170');
    expect(card.textContent).toContain('their numbers arrive here every Monday');
  });

  it('marks a due step done by logging it and clearing it', async () => {
    seed();
    render(<GrowthPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Mark done: Progress report' }));
    await waitFor(() => expect(db.updateGrowthItem).toHaveBeenCalledWith('NIA (สนช.)', { next_step: null, next_date: null }));
    expect(db.addGrowthUpdate).toHaveBeenCalledWith({ item_id: 'NIA (สนช.)', happened_on: '2026-11-08', note: 'Done: Progress report' });
    expect(toast.addToast).toHaveBeenCalledWith('Done: Progress report');
  });

  it('adds a row on the open tab', async () => {
    db.items = [];
    render(<GrowthPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add the first one' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name *'), { target: { value: 'Future Fit Asia Award' } });
    fireEvent.change(within(dialog).getByLabelText('What it is'), { target: { value: 'award' } });
    fireEvent.change(within(dialog).getByLabelText('Website'), { target: { value: 'futurefitasia.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(db.createGrowthItem).toHaveBeenCalledWith({
      track: 'funding', name: 'Future Fit Asia Award', kind: 'award', offer: null, stage: 1,
      next_step: null, next_date: null, url: 'https://futurefitasia.com', note: null,
    }));
  });

  it('logs an update with a new next step and a wait on them', async () => {
    seed();
    render(<GrowthPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Log update for Big Idea Ventures' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('What happened'), { target: { value: 'Emailed about a food cohort' } });
    fireEvent.change(within(dialog).getByLabelText('Next step'), { target: { value: 'Nudge' } });
    fireEvent.change(within(dialog).getByLabelText('By'), { target: { value: '2026-11-17' } });
    fireEvent.click(within(dialog).getByLabelText('Sent, waiting on them'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(db.updateGrowthItem).toHaveBeenCalledWith('Big Idea Ventures', {
      stage: 1, next_step: 'Nudge', next_date: '2026-11-17', waiting_since: '2026-11-08',
    }));
    expect(db.addGrowthUpdate).toHaveBeenCalledWith({ item_id: 'Big Idea Ventures', happened_on: '2026-11-08', note: 'Emailed about a food cohort' });
  });
});
