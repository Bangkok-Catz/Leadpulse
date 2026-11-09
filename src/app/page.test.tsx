import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { Company, Contact, Deal } from '@/types/crm';
import { addDaysToDateKey } from '@/utils/deal-workflow';
import { businessDateKey } from '@/utils/business-time';

const crm = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock('@/components/CrmProvider', () => ({ useCrm: () => crm.value }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/components/blob', () => ({ Blob: () => null }));
vi.mock('@/components/CreateModal', () => ({ default: () => null }));
vi.mock('@/components/LogInteractionModal', () => ({
  default: ({ isOpen, selectedDealId, initialCompanyId, onSave }: {
    isOpen: boolean;
    selectedDealId?: string;
    initialCompanyId?: string;
    onSave: (meeting: { deal_id: string | null }) => Promise<void>;
  }) =>
    isOpen ? (
      <div data-testid="log-modal">
        Logging {selectedDealId ?? initialCompanyId ?? 'new interaction'}
        <button onClick={() => void onSave({ deal_id: null })}>Save log</button>
      </div>
    ) : null,
}));
const crmApi = vi.hoisted(() => ({
  updateCompany: vi.fn(async () => ({})),
  getCompanyFits: vi.fn(async () => new Map()),
  getSalesGoal: vi.fn(async () => null as number | null),
  setSalesGoal: vi.fn(async () => {}),
  updateDealIfUnchanged: vi.fn(async () => {}),
}));
vi.mock('@/lib/crm', () => crmApi);
const reorder = vi.hoisted(() => ({ signals: [] as unknown[] }));
vi.mock('@/hooks/useReorderSignals', () => ({ useReorderSignals: () => ({ signals: reorder.signals }) }));
const growthRows = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock('@/hooks/useGrowthItems', () => ({ useGrowthItems: () => ({ items: growthRows.items, loading: false, error: null, reload: () => {} }) }));

import TodayPage from './page';

afterEach(() => cleanup());

const today = () => businessDateKey();

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: 'synthetic-deal-1',
    title: 'Synthetic Bakery sample follow-up',
    stage: 'contacted',
    product: 'Butter',
    client: 'Synthetic Bakery',
    company_id: 'synthetic-company-1',
    contact_ids: [],
    value: null,
    priority: 'medium',
    next_action: 'Check sample feedback',
    followup_date: today(),
    last_outcome: null,
    nudge_count: 0,
    workflow_action: 'outreach',
    ...overrides,
  } as Deal;
}

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'synthetic-company-1',
    name: 'Synthetic Bakery',
    status: 'active_customer',
    created_at: '2024-01-01T00:00:00.000Z',
    last_human_touch: null,
    next_touch_due: addDaysToDateKey(today(), -3),
    ...overrides,
  } as Company;
}

function setCrm(values: Record<string, unknown> = {}) {
  crm.value = {
    deals: [],
    contacts: [],
    companies: [],
    meetings: [],
    accountEvents: [],
    accountEventsUnavailable: false,
    loading: false,
    error: null,
    createDeal: vi.fn(),
    addMeeting: vi.fn(),
    refresh: vi.fn(async () => {}),
    ...values,
  };
}

const rows = () => screen.getAllByTestId('quest-row');
const rowFor = (name: RegExp | string) => rows().find(r => (typeof name === 'string' ? r.textContent?.includes(name) : name.test(r.textContent ?? '')))!;
const runList = () => screen.getByRole('list', { name: "Today's run" });

describe('This week page', () => {
  afterEach(() => { reorder.signals = []; growthRows.items = []; });

  it("puts the game bar first and a prospect's unanswered lead in the run, not also as late", () => {
    setCrm({
      deals: [
        makeDeal({ id: 'lead', client: 'Lead Cafe', company_id: 'lead-co', stage: 'research', followup_date: addDaysToDateKey(today(), -4), next_action: 'Find the owner' }),
        makeDeal({ followup_date: addDaysToDateKey(today(), -1) }),
      ],
      companies: [makeCompany(), makeCompany({ id: 'lead-co', name: 'Lead Cafe', status: 'prospect', next_touch_due: null })],
      contacts: [{ id: 'route', company_id: 'lead-co', name: 'Lead Cafe - public route', identity_quality: 'company_route', line: '@leadcafe', phone: null, email: null, job_title: null }],
    });
    render(<TodayPage />);

    const lead = rowFor('Lead Cafe');
    expect(lead.dataset.kind).toBe('lead');
    expect(lead.textContent).toContain('First message on Shop LINE, ask for the owner');
    expect(lead.textContent).toContain('New lead');
    expect(screen.queryByText('Find the owner')).toBeNull();
    expect(rows().filter(r => r.textContent?.includes('Lead Cafe'))).toHaveLength(1);
    expect(screen.getAllByText('Check sample feedback').length).toBeGreaterThan(0);
    // The summary comes first: the game bar sits above today's run.
    const bar = screen.getByTestId('game-bar');
    expect(bar.compareDocumentPosition(document.getElementById('follow-ups')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(bar).getByRole('button', { name: "Today's run: 0 of 5 touches" })).toBeTruthy();
    expect(bar.textContent).toContain("5 touches finish today's run");
  });

  it('lists late deals and customer check-ins as steps and links to the records', () => {
    setCrm({
      deals: [makeDeal({ followup_date: addDaysToDateKey(today(), -1) })],
      companies: [makeCompany()],
    });
    render(<TodayPage />);

    expect(screen.getByRole('heading', { name: 'This week' })).toBeTruthy();
    const late = rows().find(r => r.dataset.kind === 'late')!;
    expect(late.textContent).toMatch(/Synthetic Bakery·?\s*Check sample feedback/);
    expect(late.textContent).toMatch(/\dd late/);
    const checkIn = rows().find(r => r.dataset.kind === 'checkin')!;
    expect(checkIn.textContent).toMatch(/Win them back|Check in/);
    expect(within(late).getByRole('link', { name: 'Synthetic Bakery' }).getAttribute('href')).toBe('/deals?deal=synthetic-deal-1');
    expect(within(checkIn).getByRole('link', { name: 'Synthetic Bakery' }).getAttribute('href')).toBe('/companies?company=synthetic-company-1');
  });

  it("counts today's touches, the streak and this week's points in the game bar", () => {
    setCrm({
      deals: [
        makeDeal({ id: 'late', title: 'Late deal', followup_date: addDaysToDateKey(today(), -20) }),
        makeDeal({ id: 'soon', title: 'Soon deal', followup_date: addDaysToDateKey(today(), 2) }),
      ],
      companies: [makeCompany()],
      meetings: [{ id: 'm1', date: today(), type: 'call', direction: 'outbound', outcome: 'positive', contact_ids: [] }],
    });
    render(<TodayPage />);

    const bar = screen.getByTestId('game-bar');
    expect(within(bar).getByRole('button', { name: "Today's run: 1 of 5 touches" })).toBeTruthy();
    expect(bar.textContent).toContain("4 more to finish today's run");
    expect(screen.getByTestId('streak-cell').textContent).toMatch(/1\s*day/);
    expect(screen.getByTestId('streak-cell').textContent).toContain('Touched today');
    expect(screen.getByTestId('week-cell').textContent).toMatch(/10\s*pts this week/);
    expect(rowFor('20d late')).toBeTruthy();
    // The done pile holds today's touch.
    expect(screen.getByTestId('done-today').textContent).toContain('+10');
  });

  it('puts a deal the buyer replied on at the top, and never one where only Pat reached out', () => {
    setCrm({
      deals: [
        makeDeal({ id: 'replied', title: 'Replied deal', client: 'Replied Co', company_id: null, followup_date: null }),
        makeDeal({ id: 'sent', title: 'Sent deal', client: 'Sent Co', company_id: null, followup_date: null }),
      ],
      meetings: [
        { id: 'm1', deal_id: 'replied', date: addDaysToDateKey(today(), -5), type: 'dm', direction: 'inbound', outcome: null, contact_ids: [] },
        // Pat's own DM, tagged by the old form: not a reply.
        { id: 'm2', deal_id: 'sent', date: addDaysToDateKey(today(), -5), type: 'dm', direction: 'outbound', outcome: 'neutral', contact_ids: [] },
      ],
    });
    render(<TodayPage />);

    const first = within(runList()).getAllByTestId('quest-row')[0];
    expect(first.dataset.kind).toBe('reply');
    expect(first.textContent).toContain('Replied Co');
    expect(first.textContent).toContain('Buyer replied');
    fireEvent.click(within(first).getByRole('button', { name: /Details/ }));
    expect(first.textContent).toMatch(/Buyer replied 5 days ago, nothing sent since/);
    expect(rows().filter(r => r.dataset.kind === 'reply' && r.textContent?.includes('Sent Co'))).toHaveLength(0);
  });

  it('keeps distinct deals for one company and honors parked/closed deal rules', () => {
    setCrm({
      deals: [
        makeDeal({ id: 'deal-a', title: 'Sample request', followup_date: today() }),
        makeDeal({ id: 'deal-b', title: 'Saved quote', followup_date: today() }),
        makeDeal({ id: 'deal-parked', title: 'Parked one', workflow_action: 'parked', followup_date: today() }),
        makeDeal({ id: 'deal-closed', title: 'Closed one', stage: 'closed_lost', followup_date: today() }),
      ],
    });
    render(<TodayPage />);

    expect(screen.getByRole('button', { name: 'Done: log interaction for Sample request' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done: log interaction for Saved quote' })).toBeTruthy();
    expect(screen.getAllByText('Due today').length).toBe(2);
    expect(screen.queryByRole('button', { name: /parked one|closed one/i })).toBeNull();
  });

  it('keeps undated deals under No date without inventing a date', () => {
    setCrm({ deals: [makeDeal({ followup_date: null })] });
    render(<TodayPage />);

    // Not in the run: an undated deal needs a date, not a touch.
    expect(screen.queryByRole('list', { name: "Today's run" })).toBeNull();
    expect(screen.getByText('Nothing else for the run today.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /No date\s*1/ }));
    const row = rowFor('Synthetic Bakery');
    expect(row.dataset.kind).toBe('undated');
    expect(within(row).getByRole('link', { name: 'Open: Synthetic Bakery sample follow-up' }).getAttribute('href')).toBe('/deals?deal=synthetic-deal-1');
    fireEvent.click(within(row).getByRole('button', { name: /Details/ }));
    expect(row.textContent).toMatch(/set a follow-up date or park it/i);
    expect(row.textContent).not.toMatch(/\d+d late/);
  });

  it('flags a known contact hold and offers no log shortcut for it', () => {
    const contact = {
      id: 'synthetic-contact-1',
      company_id: 'synthetic-company-1',
      name: 'Synthetic Contact',
      status: 'not_interested',
    } as Contact;
    setCrm({
      deals: [makeDeal({ contact_ids: [contact.id], followup_date: today() })],
      contacts: [contact],
    });
    render(<TodayPage />);

    expect(screen.getByRole('heading', { name: /Needs a decision/ })).toBeTruthy();
    expect(screen.getAllByText(/on hold — check before contacting/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Done: log interaction for/i })).toBeNull();
  });

  it('opens the interaction modal for a saved deal', () => {
    setCrm({ deals: [makeDeal({ followup_date: today() })], companies: [makeCompany()] });
    render(<TodayPage />);

    fireEvent.click(screen.getByRole('button', { name: /Done: log interaction for synthetic bakery sample follow-up/i }));
    expect(screen.getByTestId('log-modal').textContent).toContain('synthetic-deal-1');
    expect(screen.queryByRole('button', { name: /send|contact now/i })).toBeNull();
  });

  it('logs against the company for a check-in row', () => {
    setCrm({ companies: [makeCompany()] });
    render(<TodayPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Done: log interaction for Synthetic Bakery' }));
    expect(screen.getByTestId('log-modal').textContent).toContain('synthetic-company-1');
  });

  it('moves the account\'s saved check-in date after logging a check-in', async () => {
    const refresh = vi.fn(async () => {});
    setCrm({ companies: [makeCompany()], refresh });
    render(<TodayPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Done: log interaction for Synthetic Bakery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save log' }));

    await waitFor(() => expect(crmApi.updateCompany).toHaveBeenCalledOnce());
    const [companyId, patch] = crmApi.updateCompany.mock.calls[0] as unknown as [string, { last_human_touch: string; next_touch_due: string }];
    expect(companyId).toBe('synthetic-company-1');
    expect(patch.last_human_touch).toBe(today());
    expect(patch.next_touch_due > today()).toBe(true);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('merges a CRM-linked reorder signal into the check-ins', () => {
    reorder.signals = [{
      customerId: 'hist-1',
      name: 'Historical Buyer',
      crmCompanyId: 'synthetic-company-2',
      inCrm: true,
      severityDays: 40,
      evidence: 'Usually reorders every ~30 days — 40 days past that cycle.',
    }];
    setCrm();
    render(<TodayPage />);

    const row = rowFor('Historical Buyer');
    expect(within(row).getByRole('link', { name: 'Historical Buyer' }).getAttribute('href')).toBe('/companies?company=synthetic-company-2');
    expect(row.textContent).toMatch(/40d past reorder/);
  });

  it('shows source failures without claiming an empty list and retries through the provider', () => {
    const refresh = vi.fn(async () => {});
    setCrm({ error: 'synthetic source failure', refresh });
    render(<TodayPage />);

    expect(screen.getByRole('alert').textContent).toMatch(/list may be incomplete/i);
    expect(screen.queryByText(/nothing due/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /retry loading/i }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByText('synthetic source failure')).toBeNull();
  });

  it('labels missing sales history', () => {
    setCrm({ accountEventsUnavailable: true });
    render(<TodayPage />);

    expect(screen.getByText(/sales history didn’t load/i)).toBeTruthy();
  });

  it('renders loading separately from an empty result', () => {
    setCrm({ loading: true });
    render(<TodayPage />);

    expect(screen.getByRole('status').textContent).toMatch(/loading this week/i);
    expect(screen.queryByText(/nothing due/i)).toBeNull();
  });

  it('lists a late funding step under Funding and links it to Growth', () => {
    setCrm({ deals: [], companies: [] });
    growthRows.items = [{
      id: 'nia', track: 'funding', name: 'NIA', kind: 'government', offer: null, stage: 5, status: 'open',
      next_step: 'Progress report', next_date: addDaysToDateKey(today(), -2), waiting_since: null, url: null, note: null,
      created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', deleted_at: null,
    }];
    render(<TodayPage />);

    fireEvent.click(screen.getByRole('tab', { name: /Funding\s*1/ }));
    const row = rowFor('NIA');
    expect(row.dataset.kind).toBe('funding');
    expect(row.textContent).toContain('2d late');
    expect(row.textContent).toContain('Progress report');
    expect(within(row).getByRole('link', { name: 'Open NIA on Growth' }).getAttribute('href')).toBe('/growth');
    // Funding steps score nothing: only steps that reach a buyer do.
    expect(within(row).queryByLabelText(/points/)).toBeNull();
    expect(screen.queryByText('Nothing due this week.')).toBeNull();
  });

  it('shows a plain empty state and no internal wording', () => {
    setCrm({ deals: [], companies: [] });
    render(<TodayPage />);

    expect(screen.getByText('Nothing due this week.')).toBeTruthy();
    expect(screen.queryByText(/advisory|not clearance|deals\.followup_date|not interpreted/i)).toBeNull();
  });

  it('shows the board, badges and how points work', () => {
    setCrm({
      deals: [makeDeal({ id: 'a', workflow_action: 'outreach' }), makeDeal({ id: 'b', workflow_action: 'sample', followup_date: addDaysToDateKey(today(), -2), next_action: 'Send the samples to Ae' })],
      companies: [makeCompany({ status: 'prospect', next_touch_due: null })],
    });
    render(<TodayPage />);

    const board = screen.getByTestId('game-board');
    expect(within(board).getByLabelText(/Reach out: 1/)).toBeTruthy();
    expect(within(board).getByLabelText(/Sample: 1/)).toBeTruthy();
    expect(within(board).getAllByTestId('board-token').length).toBeGreaterThan(0);
    // Sending a sample is worth more than a nudge.
    expect(within(rowFor('Send the samples to Ae')).getByLabelText('40 points')).toBeTruthy();
    expect(screen.getByTestId('badges').textContent).toMatch(/0 of 6/);
    expect(screen.getByText('How points work').closest('details')?.open).toBe(false);
  });

  it('ticks a step off when its touch is logged, then finishes the run', async () => {
    // Reduced motion: no confetti or delays, the same game.
    const matchMedia = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
    try {
      const earlier = Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, date: today(), type: 'dm', direction: 'outbound', outcome: null, contact_ids: [], deal_id: null, company_id: null }));
      const deals = [makeDeal({ followup_date: today() })];
      setCrm({ deals, meetings: earlier });
      const { rerender } = render(<TodayPage />);
      expect(within(screen.getByTestId('game-bar')).getByRole('button', { name: "Today's run: 4 of 5 touches" })).toBeTruthy();
      await new Promise(r => setTimeout(r, 20));

      setCrm({ deals, meetings: [...earlier, { id: 't5', date: today(), type: 'call', direction: 'outbound', outcome: null, contact_ids: [], deal_id: 'synthetic-deal-1', company_id: 'synthetic-company-1' }] });
      rerender(<TodayPage />);

      expect(within(screen.getByTestId('game-bar')).getByRole('button', { name: "Today's run: 5 of 5 touches" })).toBeTruthy();
      // The step stays a moment, ticked, then folds into Done today and the run is done.
      expect(within(runList()).getByRole('status').textContent).toContain('Done');
      await waitFor(() => expect(screen.getByTestId('run-done').textContent).toMatch(/Run done/), { timeout: 2500 });
      expect(screen.getByTestId('done-today').textContent).toContain('Synthetic Bakery');
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});
