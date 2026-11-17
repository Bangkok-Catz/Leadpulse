import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Company, Deal } from '@/types/crm';

const crmMocks = vi.hoisted(() => ({ updateCompany: vi.fn(), updateDealIfUnchanged: vi.fn() }));
vi.mock('@/lib/crm', () => crmMocks);
const provider = vi.hoisted(() => ({ deals: [] as unknown[], refresh: vi.fn(async () => {}), logActivity: vi.fn() }));
vi.mock('@/components/CrmProvider', () => ({ useCrm: () => provider }));
const addToast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ addToast }) }));

import { useCloseDown } from './useCloseDown';

const company = { id: 'bw', name: 'The Banana Warrior Cafe', status: 'prospect' } as unknown as Company;
const deal = (id: string, over: Partial<Deal> = {}) =>
  ({ id, company_id: 'bw', client: 'Banana Warrior', stage: 'research', workflow_action: 'outreach', followup_date: '2026-11-20', next_action: null, last_outcome: null, park_reason: null, nudge_stage: null, updated_at: 'v1', ...over } as unknown as Deal);

let hook: { current: ReturnType<typeof useCloseDown> };

beforeEach(() => {
  provider.deals = [deal('d1'), deal('d2'), deal('won', { stage: 'closed_won' })];
  crmMocks.updateCompany.mockReset().mockResolvedValue({});
  crmMocks.updateDealIfUnchanged.mockReset().mockResolvedValue({});
  provider.refresh.mockClear(); provider.logActivity.mockClear(); addToast.mockClear();
  hook = renderHook(() => useCloseDown()).result;
});
afterEach(cleanup);

describe('useCloseDown', () => {
  it('closes the account, parks its open deals and logs what Undo restores', async () => {
    let ok = false;
    await act(async () => { ok = await hook.current.closeDown(company); });
    expect(ok).toBe(true);
    expect(crmMocks.updateCompany).toHaveBeenCalledWith('bw', { status: 'closed' });
    expect(crmMocks.updateDealIfUnchanged.mock.calls.map(c => c[0])).toEqual(['d1', 'd2']);
    expect(crmMocks.updateDealIfUnchanged.mock.calls[0][2]).toMatchObject({ park_reason: 'Closed down', followup_date: null });
    const logged = provider.logActivity.mock.calls.map(c => c[0]);
    expect(logged[0]).toMatchObject({ entity: 'company', entityId: 'bw', label: 'Closed down', undoPayload: { status: 'prospect' } });
    expect(logged.slice(1).map(l => [l.entity, l.entityId, l.undoPayload.park_reason, l.undoPayload.followup_date]))
      .toEqual([['deal', 'd1', null, '2026-11-20'], ['deal', 'd2', null, '2026-11-20']]);
    expect(provider.refresh).toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith('The Banana Warrior Cafe: closed down · 2 deals parked', undefined);
  });

  it('touches no deal when the account could not be saved', async () => {
    crmMocks.updateCompany.mockRejectedValue(new Error('violates check constraint'));
    let ok = true;
    await act(async () => { ok = await hook.current.closeDown(company); });
    expect(ok).toBe(false);
    expect(crmMocks.updateDealIfUnchanged).not.toHaveBeenCalled();
    expect(provider.logActivity).not.toHaveBeenCalled();
    expect(addToast.mock.calls[0][0]).toContain('Could not mark The Banana Warrior Cafe closed');
  });

  it('says so when a deal could not be parked', async () => {
    crmMocks.updateDealIfUnchanged.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('stale'));
    await act(async () => { await hook.current.closeDown(company); });
    expect(addToast.mock.calls[0][0]).toContain('1 deal could not be parked');
    expect(addToast.mock.calls[0][1]).toBe('error');
  });

  it('reopens as a customer when it ever bought, and leaves the deals parked', async () => {
    await act(async () => { await hook.current.reopen({ ...company, status: 'closed' } as Company); });
    expect(crmMocks.updateCompany).toHaveBeenCalledWith('bw', { status: 'active_customer' });
    expect(crmMocks.updateDealIfUnchanged).not.toHaveBeenCalled();
    expect(provider.logActivity.mock.calls[0][0]).toMatchObject({ label: 'Reopened', undoPayload: { status: 'closed' } });
  });
});
