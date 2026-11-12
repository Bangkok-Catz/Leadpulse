import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Company, Contact, Deal } from '@/types/crm';

const crmMocks = vi.hoisted(() => ({ updateDealIfUnchanged: vi.fn(), getCompanyFits: vi.fn() }));
vi.mock('@/lib/crm', () => crmMocks);
const provider = vi.hoisted(() => ({
  deals: [] as Deal[], companies: [] as Company[], contacts: [] as Contact[], meetings: [] as never[],
  refresh: vi.fn(), logActivity: vi.fn(), undoActivity: vi.fn(),
}));
vi.mock('@/components/CrmProvider', () => ({ useCrm: () => provider }));
const addToast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/components/CompanyLogo', () => ({ default: () => null }));
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/utils/business-time', async importOriginal => ({ ...(await importOriginal<object>()), businessDateKey: () => '2026-11-09' }));

import ReachOutSweep from './ReachOutSweep';

const company = (id: string, name: string, over: Partial<Company> = {}) =>
  ({ id, name, status: 'prospect', address: null, logo_url: null, lead_source: 'VG Saveur Thailand partner research 2026-09-02', what_they_make: 'Vegan bakery', ...over } as unknown as Company);
const deal = (id: string, companyId: string): Deal => ({
  id, title: `${companyId} — Butter`, stage: 'research', product: 'Butter', client: companyId, company_id: companyId,
  contact_ids: [], value: null, priority: 'medium', next_action: null, followup_date: null, last_outcome: null,
  buyer_reply: null, nudge_count: 0, workflow_action: 'outreach', nudge_stage: null, sample_status: null, kept_at: null,
  created_at: '2026-09-02T00:00:00Z', updated_at: `v-${id}`,
} as Deal);
const fit = (noul: number) => ({
  grades: [{ archetype: 'bakery_patisserie_brands', noul }], best: { archetype: 'bakery_patisserie_brands', noul }, fits: noul >= 0.3, judgedAt: '2026-11-01',
});

describe('the Reach-out sweep', () => {
  beforeEach(() => {
    provider.companies = [company('ub', 'Ubuntu EAT'), company('mv', 'May Veggie Home'), company('bw', 'Banana Warrior')];
    provider.deals = [deal('d-ub', 'ub'), deal('d-mv', 'mv'), deal('d-bw', 'bw')];
    provider.contacts = [{ id: 'r-ub', company_id: 'ub', name: 'Shop', identity_quality: 'company_route', line: '@ub', phone: null, email: null, job_title: null } as unknown as Contact];
    provider.refresh = vi.fn().mockResolvedValue(undefined);
    provider.logActivity = vi.fn((entry: { entityId: string }) => `act-${entry.entityId}`);
    provider.undoActivity = vi.fn().mockResolvedValue(true);
    crmMocks.updateDealIfUnchanged = vi.fn().mockResolvedValue({});
    crmMocks.getCompanyFits = vi.fn().mockResolvedValue(new Map([['ub', fit(0.81)], ['mv', fit(0.5)], ['bw', fit(0.1)]]));
    addToast.mockReset();
  });
  afterEach(cleanup);

  it('shows one lead at a time, best fit first, and saves each choice', async () => {
    const onClose = vi.fn();
    render(<ReachOutSweep open onClose={onClose} />);
    expect(await screen.findByRole('heading', { name: 'Ubuntu EAT' })).toBeTruthy();
    expect(screen.getByText('0 of 3 sorted')).toBeTruthy();
    expect(screen.getByText('Laya: bakery fit 81%')).toBeTruthy();
    expect(screen.getByText('Vegan bakery · Partner research · Sep')).toBeTruthy();
    expect(screen.getByText('Shop LINE · ask for the owner')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Keep/ }));
    expect(crmMocks.updateDealIfUnchanged).toHaveBeenCalledWith('d-ub', 'v-d-ub', { kept_at: '2026-11-09' });
    expect(await screen.findByRole('heading', { name: 'May Veggie Home' })).toBeTruthy();
    expect(screen.getByText('No way in yet · the owner search looks on Tue and Thu')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'n' });
    expect(crmMocks.updateDealIfUnchanged).toHaveBeenLastCalledWith('d-mv', 'v-d-mv', expect.objectContaining({ park_reason: 'Not now', followup_date: '2027-01-08' }));
    fireEvent.keyDown(window, { key: 'x' });
    expect(crmMocks.updateDealIfUnchanged).toHaveBeenLastCalledWith('d-bw', 'v-d-bw', expect.objectContaining({ park_reason: 'Not a fit', followup_date: null }));

    expect(await screen.findByText('Pile sorted')).toBeTruthy();
    expect(screen.getByText("You kept 1. They come first in Today's leads.")).toBeTruthy();
    expect(screen.getByText('3 of 3 sorted')).toBeTruthy();
    await waitFor(() => expect(provider.logActivity).toHaveBeenCalledTimes(3));
    expect(provider.logActivity).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'd-ub', label: 'Sorted: Keep', undoPayload: { kept_at: null } }));

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(provider.refresh).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('puts the last lead back on Undo', async () => {
    render(<ReachOutSweep open onClose={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Ubuntu EAT' });
    fireEvent.click(screen.getByRole('button', { name: /Keep/ }));
    await screen.findByRole('heading', { name: 'May Veggie Home' });
    await waitFor(() => expect(provider.logActivity).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('heading', { name: 'Ubuntu EAT' })).toBeTruthy();
    expect(provider.undoActivity).toHaveBeenCalledWith('act-d-ub');
    expect(screen.getByText('0 of 3 sorted')).toBeTruthy();
  });

  it('puts a lead back and says so when the save fails', async () => {
    crmMocks.updateDealIfUnchanged = vi.fn().mockRejectedValue(new Error('offline'));
    render(<ReachOutSweep open onClose={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Ubuntu EAT' });
    fireEvent.click(screen.getByRole('button', { name: /Keep/ }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Ubuntu EAT wasn't saved: offline", 'error'));
    expect(await screen.findByRole('heading', { name: 'Ubuntu EAT' })).toBeTruthy();
    expect(screen.getByText('0 of 3 sorted')).toBeTruthy();
  });
});
