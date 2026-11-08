import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Deal } from '@/types/crm';
import { localDateKey } from '@/utils/deal-board';
import { addDaysToDateKey } from '@/utils/deal-workflow';
import { LANE_PLAYBOOKS } from '@/utils/lane-playbook';

const crmMocks = vi.hoisted(() => ({
  updateDeal: vi.fn(),
  updateDealIfUnchanged: vi.fn(),
  updateContact: vi.fn(),
  createAccountEvent: vi.fn(),
}));
const addToast = vi.fn();
const logActivity = vi.fn();
const addMeeting = vi.fn();

vi.mock('@/lib/crm', () => crmMocks);
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => ({ addToast }),
}));
vi.mock('@/components/CrmProvider', () => ({
  useCrm: () => ({
    logActivity,
    deleteEntity: vi.fn(),
    companies: [],
    contacts: [],
    meetings: [],
    addMeeting,
  }),
}));
vi.mock('@/components/LogInteractionModal', () => ({
  default: () => null,
}));
vi.mock('@/components/ExitDealModal', () => ({
  default: () => null,
}));

import DealDetail from './DealDetail';

const deal: Deal = {
  id: 'deal-1',
  title: 'Butter · GALLOTHAI',
  stage: 'research',
  product: 'Butter',
  client: 'GALLOTHAI',
  company_id: null,
  contact_ids: [],
  value: null,
  priority: 'medium',
  next_action: 'Capture feedback and send application notes',
  draft_primary_ask: "Ask for the team's first feedback",
  followup_date: null,
  last_outcome: null,
  nudge_count: 0,
  workflow_action: 'outreach',
  nudge_stage: null,
  sample_status: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-25T10:00:00Z',
};

describe('DealDetail journey modal', () => {
  beforeEach(() => {
    crmMocks.updateDeal.mockReset().mockResolvedValue({
      ...deal,
      draft_primary_ask: 'Ask only for first trial feedback',
    });
    crmMocks.updateDealIfUnchanged.mockReset().mockResolvedValue({
      ...deal,
      draft_primary_ask: 'Ask only for first trial feedback',
    });
    addToast.mockReset();
    logActivity.mockReset();
  });

  afterEach(cleanup);

  it('shows first-screen fields: stage, next action, follow-up, Log touch — not Open/Won/Lost', () => {
    render(<DealDetail deal={deal} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByText('Next action')).toBeTruthy();
    expect(screen.getByText(/^Follow-up ·/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Log touch/i })).toBeTruthy();
    expect(screen.queryByText('DEAL STATUS')).toBeNull();
    expect(screen.queryByRole('button', { name: /● Open/ })).toBeNull();
  });

  it('requires a verbatim buyer reply before offering a Laya review', () => {
    render(<DealDetail deal={deal} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Score buyer reply with Laya' })).toBeNull();
    expect(screen.getByText(/No verbatim buyer reply recorded/i)).toBeTruthy();
    expect(screen.getByText(/does not change deal priority, stage, or workflow/i)).toBeTruthy();
  });

  it('keeps account intelligence available but collapsed in Details, beneath the operational fields', () => {
    render(<DealDetail deal={deal} onClose={vi.fn()} onSaved={vi.fn()} />);
    const details = screen.getByText('Account and buyer map').closest('details');
    expect(details?.querySelector('summary')?.textContent).toBe('Details');
    expect(details?.open).toBe(false);
    expect(screen.getByRole('button', { name: /Log touch/i })).toBeTruthy();
    fireEvent.click(screen.getByText('Details'));
    expect(details?.open).toBe(true);
  });

  it('keeps the panel to three folds: Details, Draft and History', () => {
    render(
      <DealDetail deal={{ ...deal, last_outcome: '09/20 — Client liked the sample' }} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    const folds = Array.from(document.querySelectorAll('details > summary')).map(summary => summary.textContent);
    expect(folds.filter(title => ['Details', 'Draft', 'History'].includes(title ?? ''))).toEqual(['Details', 'Draft', 'History']);
    expect(folds).not.toContain('Drafting brief');
    expect(folds).not.toContain('Commercial details');
    expect(screen.getByText('Drafting brief').closest('details')?.querySelector('summary')?.textContent).toBe('Draft');
  });

  it('does not expand drafting brief by default', () => {
    render(<DealDetail deal={deal} onClose={vi.fn()} onSaved={vi.fn()} />);
    const summary = screen.getByText('Drafting brief');
    expect(summary).toBeTruthy();
    const details = summary.closest('details');
    expect(details).toBeTruthy();
    expect(details?.open).toBe(false);
  });

  it('keeps sample milestone visible and has exit actions without won column', () => {
    render(
      <DealDetail
        deal={{
          ...deal,
          stage: 'proposal',
          workflow_action: 'sample',
          sample_status: 'received',
          next_action: 'Confirm kitchen test slot',
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByText('Track sample delivery')).toBeTruthy();
    expect(screen.getByText(/Received by client/)).toBeTruthy();
    expect(screen.getByText('Close deal')).toBeTruthy();
  });

  it('saves only the field the user edited, one write, no false success', async () => {
    render(<DealDetail deal={deal} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit deal' }));
    // Editing opens every section, so the drafting brief field is reachable directly.
    expect(screen.getByText('Drafting brief').closest('details')?.open).toBe(true);
    const ask = screen.getByPlaceholderText('What one thing should the client answer?');
    fireEvent.change(ask, { target: { value: 'Ask only for first trial feedback' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save deal' }));

    await waitFor(() => expect(crmMocks.updateDealIfUnchanged).toHaveBeenCalledTimes(1));
    expect(crmMocks.updateDealIfUnchanged).toHaveBeenCalledWith(
      'deal-1',
      deal.updated_at,
      { draft_primary_ask: 'Ask only for first trial feedback' }
    );
    // A whole-record write is exactly the defect: untouched fields must not be resent.
    expect(crmMocks.updateDeal).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith('Deal saved!');
  });

  it('saves the buyer reply separately and preserves the exact entered message', async () => {
    render(<DealDetail deal={deal} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit deal' }));
    const reply = screen.getByRole('textbox', { name: 'Latest buyer reply (verbatim)' });
    fireEvent.change(reply, { target: { value: 'Can you send the sample next week?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save deal' }));

    await waitFor(() => expect(crmMocks.updateDealIfUnchanged).toHaveBeenCalledTimes(1));
    expect(crmMocks.updateDealIfUnchanged).toHaveBeenCalledWith(
      'deal-1',
      deal.updated_at,
      { buyer_reply: 'Can you send the sample next week?' }
    );
  });

  const movedDeal: Deal = {
    ...deal,
    workflow_action: 'reply',
    stage: 'contacted',
    followup_date: '2026-09-20',
    last_outcome: '2026-09-10 02:00:00 UTC] ✅ Outreach logged: Sent intro email\n---\n2026-09-14 04:00:00 UTC] ✅ Outreach logged — waiting on reply: Sent follow-up email',
    updated_at: '2026-09-14T04:00:00Z',
  };

  it('shows the moved lane and the latest history after an interaction, without a reload', () => {
    const { rerender } = render(<DealDetail deal={deal} onClose={vi.fn()} onSaved={vi.fn()} />);

    rerender(<DealDetail deal={movedDeal} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit deal' }));

    expect((screen.getByLabelText('Action lane') as HTMLSelectElement).value).toBe('reply');
    expect(document.body.textContent).toMatch(/waiting on reply: Sent follow-up email/);
  });

  it('keeps unsaved edits while the record moves on, and names the conflicted field', () => {
    const { rerender } = render(<DealDetail deal={deal} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit deal' }));
    fireEvent.change(screen.getByLabelText('Next action'), { target: { value: 'Call the chef back' } });

    // The same field moved in another surface while the editor was open.
    rerender(
      <DealDetail
        deal={{ ...movedDeal, next_action: 'Confirm the trial slot' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect((screen.getByLabelText('Next action') as HTMLInputElement).value).toBe('Call the chef back');
    expect((screen.getByLabelText('Action lane') as HTMLSelectElement).value).toBe('reply');
    expect(screen.getByRole('status').textContent).toMatch(/Next action/);

    fireEvent.click(screen.getByRole('button', { name: /Use the latest saved values/i }));
    expect((screen.getByLabelText('Next action') as HTMLInputElement).value).toBe('Confirm the trial slot');
  });

  it('writes nothing and does not claim success when nothing was edited', () => {
    render(<DealDetail deal={deal} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit deal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save deal' }));

    expect(crmMocks.updateDealIfUnchanged).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith('No changes to save');
  });

  it('reports a failed save and keeps the form recoverable', async () => {
    crmMocks.updateDealIfUnchanged.mockRejectedValueOnce(new Error('network down'));
    render(<DealDetail deal={deal} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit deal' }));
    fireEvent.change(screen.getByLabelText('Next action'), { target: { value: 'Call the chef back' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save deal' }));

    expect(await screen.findByText(/Could not save: network down/)).toBeTruthy();
    expect(addToast).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Next action') as HTMLInputElement).value).toBe('Call the chef back');
  });

  it('surfaces a rejected concurrent update instead of silently overwriting', async () => {
    crmMocks.updateDealIfUnchanged.mockRejectedValueOnce(
      new Error('This deal changed while the interaction was saving. Review its current lane before trying again.')
    );
    render(<DealDetail deal={deal} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit deal' }));
    fireEvent.change(screen.getByLabelText('Next action'), { target: { value: 'Call the chef back' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save deal' }));

    expect(await screen.findByText(/changed while the interaction was saving/i)).toBeTruthy();
    expect(addToast).not.toHaveBeenCalled();
  });

describe('DealDetail cadence', () => {
  beforeEach(() => {
    crmMocks.updateDealIfUnchanged.mockReset().mockResolvedValue(deal);
    addToast.mockReset();
    logActivity.mockReset();
  });

  afterEach(cleanup);

  it('shows product, value, and (high) priority under the title', () => {
    render(<DealDetail deal={{ ...deal, value: 100000, priority: 'high' }} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByText('Butter · ฿100,000 · High')).toBeTruthy();
  });

  it('hides the outcome history until there is one', () => {
    render(<DealDetail deal={deal} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByText('History')).toBeNull();
    cleanup();

    render(
      <DealDetail
        deal={{ ...deal, last_outcome: '09/20 — Client liked the sample' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(screen.getByText('History')).toBeTruthy();
  });

  it('snoozes the follow-up date with one tap and logs it for undo', async () => {
    const onSaved = vi.fn();
    render(
      <DealDetail deal={{ ...deal, followup_date: '2020-01-01' }} onClose={vi.fn()} onSaved={onSaved} />
    );

    const expected = new Date();
    expected.setDate(expected.getDate() + 3);
    const expectedKey = localDateKey(expected);

    fireEvent.click(screen.getByRole('button', { name: '+3 days' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(crmMocks.updateDealIfUnchanged).toHaveBeenCalledTimes(1);
    expect(crmMocks.updateDealIfUnchanged).toHaveBeenCalledWith(deal.id, deal.updated_at, {
      followup_date: expectedKey,
    });
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity.mock.calls[0][0].undoPayload.followup_date).toBe('2020-01-01');
    expect(addToast).toHaveBeenCalledWith('Follow-up updated');
  });

  it('surfaces a failed snooze instead of a false success', async () => {
    crmMocks.updateDealIfUnchanged.mockRejectedValueOnce(new Error('network down'));
    const onSaved = vi.fn();
    render(
      <DealDetail deal={{ ...deal, followup_date: '2020-01-01' }} onClose={vi.fn()} onSaved={onSaved} />
    );

    fireEvent.click(screen.getByRole('button', { name: '+1 day' }));

    expect(await screen.findByText(/Could not save: network down/)).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it('offers no snooze chips on a closed deal', () => {
    render(<DealDetail deal={{ ...deal, stage: 'closed_won' }} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.queryByRole('button', { name: '+1d' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+3d' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next week' })).toBeNull();
  });
});

});

describe('DealDetail lane playbooks', () => {
  beforeEach(() => {
    crmMocks.updateDealIfUnchanged.mockReset().mockResolvedValue(deal);
    addToast.mockReset();
    logActivity.mockReset();
  });

  afterEach(cleanup);

  const editLane = (target: Deal) => {
    render(<DealDetail deal={target} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit deal' }));
  };
  const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
  const dateField = () => document.querySelector('input[type="date"]') as HTMLInputElement;

  it('fills the lane\'s date and next action when the deal has no date, and saves them with the move', async () => {
    editLane({ ...deal, followup_date: null });
    fireEvent.change(screen.getByLabelText('Action lane'), { target: { value: 'reply' } });

    const expected = addDaysToDateKey(localDateKey(), LANE_PLAYBOOKS.reply!.days);
    expect(dateField().value).toBe(expected);
    expect(screen.getByText('+2 days · Waiting on reply default')).toBeTruthy();
    expect(field('Next action').value).toBe(LANE_PLAYBOOKS.reply!.nextAction);
    expect(screen.getByText(`Replaces: ${deal.next_action}`)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save deal' }));
    await waitFor(() => expect(crmMocks.updateDealIfUnchanged).toHaveBeenCalledTimes(1));
    const [, , payload] = crmMocks.updateDealIfUnchanged.mock.calls[0];
    expect(payload).toMatchObject({
      workflow_action: 'reply',
      followup_date: expected,
      next_action: LANE_PLAYBOOKS.reply!.nextAction,
    });
  });

  it('keeps a date already on the deal and offers the default instead', async () => {
    editLane({ ...deal, followup_date: '2099-01-15' });
    fireEvent.change(screen.getByLabelText('Action lane'), { target: { value: 'sample' } });

    expect(dateField().value).toBe('2099-01-15');
    expect(screen.getByText(/The deal's date is kept/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Sample status'), { target: { value: 'sent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save deal' }));

    await waitFor(() => expect(crmMocks.updateDealIfUnchanged).toHaveBeenCalledTimes(1));
    const [, , payload] = crmMocks.updateDealIfUnchanged.mock.calls[0];
    expect('followup_date' in payload).toBe(false);
    expect(payload.next_action).toBe(LANE_PLAYBOOKS.sample!.nextAction);
  });

  it('takes the defaults back out when the lane goes back to the deal\'s own', () => {
    editLane({ ...deal, followup_date: null });
    fireEvent.change(screen.getByLabelText('Action lane'), { target: { value: 'reply' } });
    fireEvent.change(screen.getByLabelText('Action lane'), { target: { value: 'outreach' } });

    expect(dateField().value).toBe('');
    expect(field('Next action').value).toBe(deal.next_action);
    fireEvent.click(screen.getByRole('button', { name: 'Save deal' }));
    expect(crmMocks.updateDealIfUnchanged).not.toHaveBeenCalled();
  });

  it('swaps one lane\'s defaults for another, but never what Pat typed', () => {
    editLane({ ...deal, followup_date: null });
    fireEvent.change(field('Next action'), { target: { value: 'Call the chef on Monday' } });
    fireEvent.change(screen.getByLabelText('Action lane'), { target: { value: 'reply' } });
    expect(field('Next action').value).toBe('Call the chef on Monday');

    fireEvent.change(screen.getByLabelText('Action lane'), { target: { value: 'reschedule' } });
    expect(dateField().value).toBe(addDaysToDateKey(localDateKey(), LANE_PLAYBOOKS.reschedule!.days));
    expect(field('Next action').value).toBe('Call the chef on Monday');
  });
});
