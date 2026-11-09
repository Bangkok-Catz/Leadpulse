import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Company, Contact, Deal, Meeting } from '@/types/crm';

const crmMocks = vi.hoisted(() => ({ updateDealIfUnchanged: vi.fn() }));
vi.mock('@/lib/crm', () => crmMocks);
const provider = vi.hoisted(() => ({ addMeeting: vi.fn(), logActivity: vi.fn(), refresh: vi.fn() }));
vi.mock('@/components/CrmProvider', () => ({ useCrm: () => provider }));
const addToast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/components/CompanyLogo', () => ({ default: () => null }));
vi.mock('@/components/MessageDraft', () => ({ default: () => <div data-testid="draft" /> }));
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));

import { LeadTools, leadAction, leadChannel, useLeadActions } from './LeadActions';
import { buildTodaysLeads, type Lead } from '@/utils/prospecting';

const today = '2026-11-06';
const company = (id: string, name: string, over: Partial<Company> = {}) => ({ id, name, status: 'prospect', address: null, logo_url: null, ...over } as unknown as Company);
const deal = (id: string, companyId: string, over: Partial<Deal> = {}): Deal => ({
  id, title: `${companyId} — Butter`, stage: 'research', product: 'Butter', client: companyId, company_id: companyId,
  contact_ids: [], value: null, priority: 'medium', next_action: null, followup_date: null, last_outcome: null,
  buyer_reply: null, nudge_count: 0, workflow_action: 'outreach', nudge_stage: null, sample_status: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over,
} as Deal);
const shop = (companyId: string, over: Partial<Contact> = {}) =>
  ({ id: `r-${companyId}`, company_id: companyId, name: 'Shop route', identity_quality: 'company_route', line: '@shop', phone: null, email: null, job_title: null, ...over } as unknown as Contact);

const companies = [company('ub', 'Ubuntu EAT'), company('mv', 'May Veggie Home', { address: 'Bangkok' }), company('bw', 'Banana Warrior')];
const contacts = [shop('ub'), { ...shop('mv'), id: 'p-mv', name: 'Khun May', identity_quality: 'named', line: null, job_title: 'owner' } as unknown as Contact];
const deals = [deal('d-ub', 'ub'), deal('d-mv', 'mv'), deal('d-bw', 'bw')];

function leadsFor(meetings: Meeting[] = []) {
  return buildTodaysLeads({ deals, companies, contacts, meetings, fits: new Map([['ub', 0.81], ['mv', 0.67]]), today });
}

function Harness({ lead }: { lead: Lead }) {
  const { log, park, busy } = useLeadActions(today);
  return (
    <div>
      <button type="button" onClick={() => void log(lead, lead.route.type)}>Done</button>
      <LeadTools lead={lead} today={today} contacts={contacts} busy={busy === lead.deal.id} onLog={log} onPark={park} />
    </div>
  );
}

describe('lead actions', () => {
  beforeEach(() => {
    crmMocks.updateDealIfUnchanged = vi.fn().mockResolvedValue(undefined);
    provider.addMeeting = vi.fn().mockResolvedValue(undefined);
    provider.logActivity = vi.fn();
    provider.refresh = vi.fn().mockResolvedValue(undefined);
    addToast.mockReset();
  });
  afterEach(cleanup);

  it('says the next step in a few words, with the way in', () => {
    const leads = leadsFor();
    expect(leads.today.map(l => l.company.name)).toEqual(['Ubuntu EAT', 'May Veggie Home']);
    const [ub, mv] = leads.today;
    expect(leadAction(ub)).toBe('First message on Shop LINE, ask for the owner');
    expect(leadChannel(ub)).toBe('Shop LINE');
    expect(leadAction(mv)).toBe('Visit, ask for Khun May');
    expect(leadChannel(mv)).toBe('Visit');
    expect(leads.waiting.map(w => w.company.name)).toEqual(['Banana Warrior']);
  });

  it('one tap logs the touch to the shop route, moves the deal to waiting on reply and dates touch 2', async () => {
    render(<Harness lead={leadsFor().today[0]} />);
    expect(screen.getByTestId('lead-tools').textContent).toContain('Touch 1 of 5 · first message');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(crmMocks.updateDealIfUnchanged).toHaveBeenCalled());
    expect(provider.addMeeting).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Touch 1 of 5 · first message (Shop LINE)', type: 'dm', date: today, deal_id: 'd-ub',
      company_id: 'ub', contact_ids: ['r-ub'], direction: 'outbound', followup_date: '2026-11-08',
    }));
    const [id, stamp, updates] = crmMocks.updateDealIfUnchanged.mock.calls[0];
    expect([id, stamp]).toEqual(['d-ub', '2026-10-01T00:00:00Z']);
    expect(updates).toMatchObject({ workflow_action: 'reply', stage: 'contacted', followup_date: '2026-11-08', next_action: 'Touch 2 of 5 · gentle follow-up' });
    expect(addToast).toHaveBeenCalledWith('Touch 1 logged · next Sun 8 Nov');
  });

  it('says so when the touch saved but the deal did not', async () => {
    crmMocks.updateDealIfUnchanged = vi.fn().mockRejectedValue(new Error('changed elsewhere'));
    render(<Harness lead={leadsFor().today[0]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.stringContaining("Touch saved, but the next date didn't update"), 'error'));
  });

  it('Not now parks the lead with a revisit date two months out', async () => {
    render(<Harness lead={leadsFor().today[0]} />);
    fireEvent.click(within(screen.getByTestId('lead-tools')).getByRole('button', { name: /Not now/ }));
    await waitFor(() => expect(crmMocks.updateDealIfUnchanged).toHaveBeenCalled());
    expect(crmMocks.updateDealIfUnchanged.mock.calls[0][2]).toMatchObject({ workflow_action: 'parked', park_reason: 'Not now', followup_date: '2027-01-05' });
  });

  it('opens the message draft from the tools', () => {
    render(<Harness lead={leadsFor().today[0]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    expect(screen.getByTestId('draft')).toBeTruthy();
  });
});
