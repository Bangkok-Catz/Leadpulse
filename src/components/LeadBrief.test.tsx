import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Company, Contact, Deal, Meeting } from '@/types/crm';
import LeadBrief from './LeadBrief';

const state = vi.hoisted(() => ({
  contacts: [] as unknown[], meetings: [] as unknown[], refresh: vi.fn(async () => {}),
  fit: null as unknown, evidence: [] as unknown[], proposals: [] as unknown[],
  decide: vi.fn(async () => ({ status: 'applied', note: null, retry: false })),
  toast: vi.fn(),
}));
vi.mock('@/components/CrmProvider', () => ({ useCrm: () => ({ contacts: state.contacts, meetings: state.meetings, refresh: state.refresh }) }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ addToast: state.toast }) }));
vi.mock('@/utils/useBusinessDateKey', () => ({ useBusinessDateKey: () => '2026-11-16' }));
vi.mock('@/lib/crm', () => ({
  getCompanyFit: vi.fn(async () => state.fit),
  getCompanyEvidence: vi.fn(async () => state.evidence),
  getPendingProposals: vi.fn(async () => state.proposals),
  decideProposalInApp: (...args: unknown[]) => state.decide(...(args as [])),
}));

const company = { id: 'a', name: 'Alpha Bakery', status: 'prospect', address: null, website: null, notes: null, what_they_make: 'croissants' } as unknown as Company;
const deal = { id: 'd', company_id: 'a', client: 'Alpha Bakery', stage: 'research', workflow_action: 'outreach', priority: 'medium', followup_date: null, deleted_at: null, park_reason: null, buyer_reply: null, contact_ids: [] } as unknown as Deal;
const may = { id: 'm', company_id: 'a', name: 'Khun May', job_title: 'Owner', line: '@may', phone: null, email: null, identity_quality: 'named', status: 'uncontacted' } as unknown as Contact;
const shop = { id: 's', company_id: 'a', name: 'Alpha - public route', job_title: null, line: '@alpha', phone: null, email: null, identity_quality: 'company_route', status: 'uncontacted' } as unknown as Contact;

afterEach(cleanup);
beforeEach(() => {
  Object.assign(state, { contacts: [], meetings: [], fit: null, evidence: [], proposals: [] });
  state.decide.mockClear(); state.refresh.mockClear(); state.toast.mockClear();
});

describe('LeadBrief', () => {
  it('leads with the next step, then who decides, the way in and why them', async () => {
    state.contacts = [may, shop];
    state.evidence = [{ entity_type: 'contact', entity_id: 'm', field: 'name', value: 'Khun May', source_url: 'https://alpha.example/about', source_tier: 'own_site', quote: 'our owner, Khun May', recorded_at: '2026-11-10T02:00:00Z' }];
    state.fit = { grades: [], best: { archetype: 'bakery_patisserie_brands', noul: 0.65 }, fits: true, judgedAt: '2026-11-01' };
    const onWrite = vi.fn();
    render(<LeadBrief deal={deal} company={company} onWrite={onWrite} />);
    expect(screen.getByTestId('lead-brief-action').textContent).toBe('Send the first message · May · LINE');
    expect(screen.getByText('May decides and you have their own LINE.')).toBeTruthy();
    expect(screen.getByText('Khun May')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Source: own site · 10 Nov/)).toBeTruthy());
    expect(screen.getByText('Laya: bakery fit 65%')).toBeTruthy();
    expect(screen.getByText('Makes croissants')).toBeTruthy();
    const rungs = screen.getAllByRole('listitem').map(li => li.textContent);
    expect(rungs).toEqual(['Yes: Named', 'Yes: Source checked', 'Yes: Own channel', 'Not yet: Replied']);
    fireEvent.click(screen.getByRole('button', { name: /Write it/ }));
    expect(onWrite).toHaveBeenCalledOnce();
  });

  it('says plainly when there is no owner and nothing to send to', () => {
    render(<LeadBrief deal={deal} company={company} />);
    expect(screen.getByTestId('lead-brief-action').textContent).toBe('Find a way in');
    expect(screen.getByText('No owner on file')).toBeTruthy();
    expect(screen.getByText('None yet')).toBeTruthy();
    expect(screen.getByText('Not graded yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Write it/ })).toBeNull();
  });

  it('lets Pat save an owner the search found, then reloads', async () => {
    state.contacts = [shop];
    state.proposals = [{ id: 'p1', field: 'decision_maker', status: 'pending', company_id: 'a', value: 'Thrina Low', details: { job_title: 'Founder' }, source_url: 'https://alpha.example/about-us' }];
    render(<LeadBrief deal={deal} company={company} />);
    await waitFor(() => expect(screen.getByTestId('lead-brief-action').textContent).toBe('Decide on Thrina Low, Founder'));
    expect(screen.getByText('alpha.example/about-us')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Save as contact/ }));
    await waitFor(() => expect(state.decide).toHaveBeenCalledWith('p1', 'save'));
    await waitFor(() => expect(state.refresh).toHaveBeenCalled());
    expect(state.toast).toHaveBeenCalledWith('Saved as a contact');
  });

  it('shows nothing for a deal that is not an open lead', () => {
    const { container } = render(<LeadBrief deal={{ ...deal, buyer_reply: 'Yes please' } as Deal} company={company} />);
    expect(container.firstChild).toBeNull();
    const done = render(<LeadBrief deal={deal} company={{ ...company, status: 'active_customer' } as Company} />);
    expect(done.container.firstChild).toBeNull();
  });

  it('counts the touches sent', () => {
    state.contacts = [may];
    state.meetings = [{ id: 'x', deal_id: 'd', company_id: 'a', date: '2026-11-15', type: 'dm', direction: 'outbound', outcome: null, contact_ids: [] } as unknown as Meeting];
    render(<LeadBrief deal={deal} company={company} />);
    expect(screen.getByTestId('lead-brief-action').textContent).toBe('Wait until Tue 17 Nov');
    expect(screen.getByText('1 sent')).toBeTruthy();
  });
});
