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
const crmApi = vi.hoisted(() => ({ updateCompany: vi.fn(async () => ({})), getCompanyFits: vi.fn(async () => new Map()) }));
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

describe('This week page', () => {
  afterEach(() => { reorder.signals = []; growthRows.items = []; });

  it("puts a prospect's unanswered lead in Today's leads, not also in Overdue", () => {
    setCrm({
      deals: [
        makeDeal({ id: 'lead', client: 'Lead Cafe', company_id: 'lead-co', stage: 'research', followup_date: addDaysToDateKey(today(), -4), next_action: 'Find the owner' }),
        makeDeal({ followup_date: addDaysToDateKey(today(), -1) }),
      ],
      companies: [makeCompany(), makeCompany({ id: 'lead-co', name: 'Lead Cafe', status: 'prospect', next_touch_due: null })],
      contacts: [{ id: 'route', company_id: 'lead-co', name: 'Lead Cafe - public route', identity_quality: 'company_route', line: '@leadcafe', phone: null, email: null, job_title: null }],
    });
    render(<TodayPage />);

    const leads = screen.getByTestId('todays-leads');
    expect(leads.textContent).toContain('Lead Cafe');
    expect(leads.textContent).toContain('Shop LINE · ask for the owner');
    expect(screen.queryByText('Find the owner')).toBeNull();
    expect(screen.getAllByText('Check sample feedback').length).toBeGreaterThan(0);
    // Today's leads and the follow-ups share one "do now" card at the top, above the stat cards.
    const doNow = document.getElementById('follow-ups')!;
    expect(doNow.contains(leads)).toBe(true);
    expect(doNow.compareDocumentPosition(screen.getByLabelText('This week at a glance')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // With no touches yet, the touches card suggests the first lead.
    expect(screen.getByLabelText('This week at a glance').textContent).toContain('None yet. Start with Lead Cafe.');
    // The monthly goal is kept for reference, folded until opened.
    expect(screen.getByText(/^[A-Z][a-z]+ goal$/).closest('details')?.open).toBe(false);
  });

  it('splits overdue deals from retention check-ins and links to the records', () => {
    setCrm({
      deals: [makeDeal({ followup_date: addDaysToDateKey(today(), -1) })],
      companies: [makeCompany()],
    });
    render(<TodayPage />);

    expect(screen.getByRole('heading', { name: 'This week' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Overdue/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Customers to check in with' })).toBeTruthy();
    // The row is grouped by age under the Overdue tab.
    expect(screen.getByRole('heading', { name: /This week · 1/ })).toBeTruthy();
    expect(screen.getAllByText('Check sample feedback').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /open deal:.*synthetic bakery/i }).getAttribute('href'))
      .toBe('/deals?deal=synthetic-deal-1');
    expect(screen.getByRole('link', { name: /open company:.*synthetic bakery/i }).getAttribute('href'))
      .toBe('/companies?company=synthetic-company-1');
  });

  it('shows the four stat cards and switches the list from a card', () => {
    setCrm({
      deals: [
        makeDeal({ id: 'late', title: 'Late deal', followup_date: addDaysToDateKey(today(), -20) }),
        makeDeal({ id: 'soon', title: 'Soon deal', followup_date: addDaysToDateKey(today(), 2) }),
      ],
      companies: [makeCompany()],
      meetings: [{ id: 'm1', date: today(), type: 'call', direction: 'outbound', outcome: 'positive' }],
    });
    render(<TodayPage />);

    const cards = screen.getByLabelText('This week at a glance');
    expect(cards.textContent).toMatch(/Overdue\s*1/);
    expect(cards.textContent).toMatch(/1 waiting over 2 weeks\. Oldest: 20 days\./);
    expect(cards.textContent).toMatch(/1 on \w+day\. Today is clear\./);
    expect(cards.textContent).toMatch(/Up from 0 the week before\. Busiest: today\./);
    expect(cards.textContent).toMatch(/Due this week\s*1/);
    expect(cards.textContent).toMatch(/Check-ins\s*1/);
    expect(cards.textContent).toMatch(/Touches · 7 days\s*1/);
    expect(screen.getByRole('heading', { name: /Over 2 weeks · 1/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Due this week/ }));
    expect(screen.getByRole('tab', { name: /This week/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('link', { name: /open deal: soon deal/i })).toBeTruthy();
  });

  it('puts a deal the buyer replied on at the top, and never one where only Pat reached out', () => {
    setCrm({
      deals: [
        makeDeal({ id: 'replied', title: 'Replied deal', client: 'Replied Co', company_id: null, followup_date: null }),
        makeDeal({ id: 'sent', title: 'Sent deal', client: 'Sent Co', company_id: null, followup_date: null }),
      ],
      meetings: [
        { id: 'm1', deal_id: 'replied', date: addDaysToDateKey(today(), -5), type: 'dm', direction: 'inbound', outcome: null },
        // Pat's own DM, tagged by the old form: not a reply.
        { id: 'm2', deal_id: 'sent', date: addDaysToDateKey(today(), -5), type: 'dm', direction: 'outbound', outcome: 'neutral' },
      ],
    });
    render(<TodayPage />);

    const block = screen.getByTestId('waiting-on-you');
    expect(block.textContent).toMatch(/Waiting on you · 1/);
    expect(block.textContent).toMatch(/Replied Co/);
    expect(block.textContent).toMatch(/Buyer replied 5 days ago, nothing sent since/);
    expect(block.textContent).not.toMatch(/Sent Co/);
    // One list: no separate Do next or Missing data cards on the daily page.
    expect(screen.queryByText(/^Do next/)).toBeNull();
    expect(screen.queryByText(/^Missing data/)).toBeNull();
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

    // Nothing overdue, so the This week tab opens with both deals.
    expect(screen.getByRole('tab', { name: /This week\s*2/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('link', { name: /open deal: sample request/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /open deal: saved quote/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /parked one|closed one/i })).toBeNull();
  });

  it('keeps undated deals under their own tab without inventing a date', () => {
    setCrm({ deals: [makeDeal({ followup_date: null })] });
    render(<TodayPage />);

    expect(screen.queryByRole('link', { name: /open deal/i })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /No date\s*1/ }));
    expect(screen.getByRole('link', { name: /open deal: synthetic bakery/i })).toBeTruthy();
    expect(screen.getByText(/set a follow-up date or park it/i)).toBeTruthy();
    expect(screen.queryByText(/\d+d$/)).toBeNull();
  });

  it('flags a known contact hold and offers no Log shortcut for it', () => {
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
    expect(screen.getByText(/on hold — check before contacting/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Log interaction for/i })).toBeNull();
  });

  it('opens the interaction modal for a saved deal', () => {
    setCrm({ deals: [makeDeal({ followup_date: today() })], companies: [makeCompany()] });
    render(<TodayPage />);

    fireEvent.click(screen.getByRole('button', { name: /Log interaction for synthetic bakery sample follow-up/i }));
    expect(screen.getByTestId('log-modal').textContent).toContain('synthetic-deal-1');
    expect(screen.queryByRole('button', { name: /send|contact now/i })).toBeNull();
  });

  it('logs against the company for a check-in row', () => {
    setCrm({ companies: [makeCompany()] });
    render(<TodayPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Log interaction for Synthetic Bakery' }));
    expect(screen.getByTestId('log-modal').textContent).toContain('synthetic-company-1');
  });

  it('moves the account\'s saved check-in date after logging a check-in', async () => {
    const refresh = vi.fn(async () => {});
    setCrm({ companies: [makeCompany()], refresh });
    render(<TodayPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Log interaction for Synthetic Bakery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save log' }));

    await waitFor(() => expect(crmApi.updateCompany).toHaveBeenCalledOnce());
    const [companyId, patch] = crmApi.updateCompany.mock.calls[0] as unknown as [string, { last_human_touch: string; next_touch_due: string }];
    expect(companyId).toBe('synthetic-company-1');
    expect(patch.last_human_touch).toBe(today());
    expect(patch.next_touch_due > today()).toBe(true);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('merges a CRM-linked reorder signal into the check-in list', () => {
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

    expect(screen.getByRole('link', { name: 'Open company: Historical Buyer' })).toBeTruthy();
    expect(screen.getByText(/40d past reorder/)).toBeTruthy();
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

  it('lists a late funding step under Overdue and links it to Growth', () => {
    setCrm({ deals: [], companies: [] });
    growthRows.items = [{
      id: 'nia', track: 'funding', name: 'NIA', kind: 'government', offer: null, stage: 5, status: 'open',
      next_step: 'Progress report', next_date: addDaysToDateKey(today(), -2), waiting_since: null, url: null, note: null,
      created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', deleted_at: null,
    }];
    render(<TodayPage />);

    expect(screen.getByRole('tab', { name: /Overdue/ }).getAttribute('aria-selected')).toBe('true');
    const group = screen.getByTestId('growth-due');
    expect(within(group).getByRole('heading', { name: /Funding & PR · 1/ })).toBeTruthy();
    expect(group.textContent).toContain('2d late');
    expect(group.textContent).toContain('Progress report');
    expect(within(group).getByRole('link', { name: 'NIA' }).getAttribute('href')).toBe('/growth');
    expect(screen.queryByText('Nothing due this week.')).toBeNull();
  });

  it('shows a plain empty state and no internal wording', () => {
    setCrm({ deals: [], companies: [] });
    render(<TodayPage />);

    expect(screen.getByText('Nothing due this week.')).toBeTruthy();
    expect(screen.queryByText(/advisory|not clearance|deals\.followup_date|not interpreted/i)).toBeNull();
  });
});
