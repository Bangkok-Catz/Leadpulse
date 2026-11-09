// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Company, Deal, Meeting } from '@/types/crm';
import type { QuickTapData, QuickTapDeps } from './quick-log-telegram';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/telegram', () => ({ answerTelegramCallback: vi.fn(), editTelegramButtons: vi.fn() }));
const { handleQuickLogTap } = await import('./quick-log-telegram');

const TODAY = '2026-11-09';
const CHAT = '42';

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: 'deal-1', title: 'Mello Vegan · Butter', stage: 'research', product: 'Butter', client: 'Mello Vegan', company_id: 'co-1',
  contact_ids: [], value: null, priority: 'medium', next_action: 'Second follow-up: call เกลอ', followup_date: '2026-11-01',
  last_outcome: null, nudge_count: 0, workflow_action: 'reply', nudge_stage: null, sample_status: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: 'v1', ...over,
} as Deal);

const company = (over: Partial<Company> = {}): Company => ({
  id: 'co-2', name: 'Aleenta Resort', status: 'active_customer', created_at: '2024-01-01T00:00:00Z',
  last_human_touch: null, next_touch_due: '2026-10-01', ...over,
} as Company);

function setup(data: Partial<QuickTapData> = {}) {
  const deps = {
    today: () => TODAY,
    load: vi.fn(async () => ({ deals: [deal()], companies: [company({ id: 'co-1', name: 'Mello Vegan', status: 'prospect' }), company()], contacts: [], meetings: [], fits: new Map(), ...data })),
    createMeeting: vi.fn(async () => ({})),
    updateDealIfUnchanged: vi.fn(async () => ({})),
    updateCompany: vi.fn(async () => ({})),
    updateContact: vi.fn(async () => ({})),
    logActivity: vi.fn(async () => ({})),
    answer: vi.fn(async () => {}),
    editButtons: vi.fn(async () => {}),
  } satisfies QuickTapDeps;
  return deps;
}

const tap = (data: string, chat = CHAT) => ({
  callback_query: {
    id: 'cb-1', data,
    message: {
      message_id: 7, chat: { id: Number(chat) },
      reply_markup: { inline_keyboard: [[{ text: '✓ Mello Vegan · Called', callback_data: 'ql:call:d:deal-1' }], [{ text: '✓ Aleenta · Messaged', callback_data: 'ql:dm:c:co-2:watch' }]] },
    },
  },
});

describe('a run button tapped in Telegram', () => {
  it('logs the call, moves the follow-up and ticks the button', async () => {
    const deps = setup();
    expect(await handleQuickLogTap(tap('ql:call:d:deal-1'), CHAT, deps)).toBe('logged: call');
    expect(deps.createMeeting).toHaveBeenCalledWith(expect.objectContaining({ type: 'call', direction: 'outbound', deal_id: 'deal-1', date: TODAY, followup_date: '2026-11-12' }));
    expect(deps.updateDealIfUnchanged).toHaveBeenCalledWith('deal-1', 'v1', { followup_date: '2026-11-12' });
    expect(deps.logActivity).toHaveBeenCalledWith(expect.objectContaining({ entity: 'deal', entity_id: 'deal-1', undo_payload: { followup_date: '2026-11-01' } }));
    expect(deps.answer).toHaveBeenCalledWith('cb-1', 'Logged: Mello Vegan · Called · next 12 Nov');
    expect(deps.editButtons).toHaveBeenCalledWith(7, [
      [{ text: '✓ Mello Vegan · logged', callback_data: 'ql:done' }],
      [{ text: '✓ Aleenta · Messaged', callback_data: 'ql:dm:c:co-2:watch' }],
    ]);
  });

  it('logs a check-in against the account and moves its next check-in date', async () => {
    const deps = setup();
    expect(await handleQuickLogTap(tap('ql:dm:c:co-2:watch'), CHAT, deps)).toBe('logged: dm');
    expect(deps.createMeeting).toHaveBeenCalledWith(expect.objectContaining({ company_id: 'co-2', deal_id: null, type: 'dm' }));
    expect(deps.updateDealIfUnchanged).not.toHaveBeenCalled();
    const calls = deps.updateCompany.mock.calls as unknown as [string, Record<string, unknown>][];
    const checkIn = calls.find(([, patch]) => 'next_touch_due' in patch);
    expect(checkIn?.[0]).toBe('co-2');
    expect((checkIn?.[1] as { last_human_touch: string }).last_human_touch).toBe(TODAY);
  });

  it('never logs a step twice in a day', async () => {
    const already: Meeting = { id: 'm1', description: 'Called', type: 'call', date: TODAY, company_id: 'co-1', contact_ids: [], deal_id: 'deal-1', product: 'Butter', summary: null, outcome: null, direction: 'outbound', followup_date: null, created_at: `${TODAY}T03:00:00Z` };
    const deps = setup({ meetings: [already] });
    expect(await handleQuickLogTap(tap('ql:call:d:deal-1'), CHAT, deps)).toBe('ignored: already logged today');
    expect(deps.createMeeting).not.toHaveBeenCalled();
    expect(deps.answer).toHaveBeenCalledWith('cb-1', 'Mello Vegan: already logged today');
    expect(deps.editButtons).toHaveBeenCalled();
  });

  it('ignores other chats, ticked buttons and unknown data', async () => {
    const deps = setup();
    expect(await handleQuickLogTap(tap('ql:call:d:deal-1', '99'), CHAT, deps)).toBe('ignored: another chat');
    expect(await handleQuickLogTap(tap('ql:done'), CHAT, deps)).toBe('ignored: already logged');
    expect(await handleQuickLogTap(tap('ql:nope:d:deal-1'), CHAT, deps)).toBe('ignored: unknown button');
    expect(deps.createMeeting).not.toHaveBeenCalled();
  });

  it('says so when the touch could not be saved, and changes nothing else', async () => {
    const deps = setup();
    deps.createMeeting.mockRejectedValueOnce(new Error('offline'));
    expect(await handleQuickLogTap(tap('ql:call:d:deal-1'), CHAT, deps)).toBe('failed: offline');
    expect(deps.updateDealIfUnchanged).not.toHaveBeenCalled();
    expect(deps.answer).toHaveBeenCalledWith('cb-1', 'Could not log Mello Vegan. Tap again.');
    expect(deps.editButtons).not.toHaveBeenCalled();
  });
});
