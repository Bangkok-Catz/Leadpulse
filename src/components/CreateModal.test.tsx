import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import CreateModal from './CreateModal';

describe('CreateModal explicit outbound fields', () => {
  afterEach(cleanup);

  it('saves a primary client ask separately from the CRM next action', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <CreateModal
        isOpen
        type="deal"
        onClose={vi.fn()}
        onSave={onSave}
        companies={[{
          id: 'company-1',
          name: 'GALLOTHAI',
          status: 'prospect',
          lead_source: 'Referral',
          account_owner: 'Pat',
          last_contact_date: null,
          tags: [],
          industry: null,
          size: null,
          address: null,
          website: null,
          notes: null,
          created_at: '2026-08-01T00:00:00Z',
          updated_at: '2026-08-01T00:00:00Z',
        }]}
      />
    );

    expect(document.querySelectorAll('select[name="priority"]')).toHaveLength(1);
    fireEvent.change(document.querySelector('select[name="company_id"]') as HTMLSelectElement, {
      target: { value: 'company-1' },
    });
    fireEvent.change(document.querySelector('input[name="next_action"]') as HTMLInputElement, {
      target: { value: 'Capture feedback and send application notes' },
    });
    fireEvent.change(document.querySelector('input[name="draft_primary_ask"]') as HTMLInputElement, {
      target: { value: "Ask for the team's first feedback from Hin's trial" },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      next_action: 'Capture feedback and send application notes',
      draft_primary_ask: "Ask for the team's first feedback from Hin's trial",
    }));
  });

  it('groups the client ask in an Ebimaru brief and hides a blank brief outside messaging lanes', () => {
    render(<CreateModal isOpen type="deal" onClose={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByText('EBIMARU DRAFTING BRIEF')).toBeTruthy();
    expect(document.querySelector('input[name="draft_primary_ask"]')).toBeTruthy();

    fireEvent.change(document.querySelector('select[name="workflow_action"]') as HTMLSelectElement, {
      target: { value: 'testing' },
    });

    expect(screen.queryByText('EBIMARU DRAFTING BRIEF')).toBeNull();
    expect(document.querySelector('input[name="draft_primary_ask"]')).toBeNull();
  });

  it('keeps a newly entered client ask accessible after changing to a non-messaging lane', () => {
    render(<CreateModal isOpen type="deal" onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.change(document.querySelector('input[name="draft_primary_ask"]') as HTMLInputElement, {
      target: { value: 'Ask for a test date' },
    });
    fireEvent.change(document.querySelector('select[name="workflow_action"]') as HTMLSelectElement, {
      target: { value: 'testing' },
    });

    expect(screen.getByText('EBIMARU DRAFTING BRIEF')).toBeTruthy();
    expect((document.querySelector('input[name="draft_primary_ask"]') as HTMLInputElement).value).toBe('Ask for a test date');
  });

  it('asks who the contact is before saving, then saves that answer', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<CreateModal isOpen type="contact" onClose={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('Name or contact label *'), { target: { value: 'Head Chef' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/Say who this is/);

    fireEvent.click(screen.getByRole('radio', { name: 'A role' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Head Chef', identity_quality: 'role_only', status: 'uncontacted' }));
  });

  it('adapts the name field to who the contact is', () => {
    render(<CreateModal isOpen type="contact" onClose={vi.fn()} onSave={vi.fn()} />);
    const name = screen.getByLabelText('Name or contact label *') as HTMLInputElement;
    expect(name.placeholder).toBe('e.g., John, Head Chef, or company LINE');
    fireEvent.click(screen.getByRole('radio', { name: 'A role' }));
    expect((screen.getByLabelText('Role or contact label *') as HTMLInputElement).placeholder).toBe('e.g., Head Chef, name unknown');
    fireEvent.click(screen.getByRole('radio', { name: "The shop's channel" }));
    expect(screen.getByLabelText('Company route label *')).toBeTruthy();
    expect(screen.queryByLabelText('Role')).toBeNull();
  });

  it('has a box per app and saves an Instagram handle without the @ or link', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<CreateModal isOpen type="contact" onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByLabelText('Alternate phone')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'A person' }));
    fireEvent.change(screen.getByLabelText('Full name *'), { target: { value: 'Julia' } });
    fireEvent.change(screen.getByLabelText('Instagram'), { target: { value: 'https://www.instagram.com/juliapanchkowry/' } });
    fireEvent.change(screen.getByLabelText('WhatsApp'), { target: { value: '+65 9766 9860' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ identity_quality: 'named', instagram: 'juliapanchkowry', whatsapp: '+65 9766 9860' }));
  });

  it('offers the one-tap fixes for a phone or LINE box holding the wrong thing', () => {
    render(<CreateModal isOpen type="contact" onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+66 80 135 0032 / +66 2 658 0932' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move the second to Alternate phone' }));
    expect((screen.getByLabelText('Phone') as HTMLInputElement).value).toBe('+66 80 135 0032');
    expect((screen.getByLabelText('Alternate phone') as HTMLInputElement).value).toBe('+66 2 658 0932');

    fireEvent.change(screen.getByLabelText('LINE'), { target: { value: 'Line @loaves / IG @loaves_glutenfreevegan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move to Instagram' }));
    expect((screen.getByLabelText('LINE') as HTMLInputElement).value).toBe('@loaves');
    expect((screen.getByLabelText('Instagram') as HTMLInputElement).value).toBe('loaves_glutenfreevegan');

    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0000' } });
    expect(screen.getByText('Too short to be a phone number')).toBeTruthy();
  });

  it('saves a company acquisition source with its campaign', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<CreateModal isOpen type="company" onClose={vi.fn()} onSave={onSave} />);

    fireEvent.change(document.querySelector('input[name="name"]') as HTMLInputElement, { target: { value: 'Ad Bakery' } });
    expect(document.querySelector('input[name="acquisition_campaign"]')).toBeNull();
    fireEvent.change(document.querySelector('select[name="acquisition_source"]') as HTMLSelectElement, { target: { value: 'meta_ad' } });
    fireEvent.change(document.querySelector('input[name="acquisition_campaign"]') as HTMLInputElement, { target: { value: ' Croissant Oct ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Ad Bakery',
      acquisition_source: 'meta_ad',
      acquisition_campaign: 'Croissant Oct',
    }));
  });

  it('saves a company with no source as null, not an empty string', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<CreateModal isOpen type="company" onClose={vi.fn()} onSave={onSave} />);

    fireEvent.change(document.querySelector('input[name="name"]') as HTMLInputElement, { target: { value: 'Quiet Bakery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ acquisition_source: null, acquisition_campaign: null }));
  });

  it('shows the company source on a new deal and sends a change as a company patch', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const company = {
      id: 'company-ad', name: 'Ad Bakery', status: 'prospect' as const, lead_source: '', account_owner: 'Pat',
      last_contact_date: null, tags: [], industry: null, size: null, address: null, website: null, notes: null,
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
      acquisition_source: 'outbound' as const, acquisition_campaign: null,
    };
    render(<CreateModal isOpen type="deal" onClose={vi.fn()} onSave={onSave} companies={[company]} />);

    expect(document.querySelector('select[name="deal_source"]')).toBeNull();
    fireEvent.change(document.querySelector('select[name="company_id"]') as HTMLSelectElement, { target: { value: 'company-ad' } });
    const source = document.querySelector('select[name="deal_source"]') as HTMLSelectElement;
    expect(source.value).toBe('outbound');
    fireEvent.change(source, { target: { value: 'meta_ad' } });
    fireEvent.change(document.querySelector('input[name="deal_campaign"]') as HTMLInputElement, { target: { value: 'Oct promo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(saved.company_acquisition).toEqual({ acquisition_source: 'meta_ad', acquisition_campaign: 'Oct promo' });
    expect(saved).not.toHaveProperty('deal_source');
    expect(saved).not.toHaveProperty('deal_campaign');
  });

  it('sends no company patch when the new deal keeps the company source', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const company = {
      id: 'company-ad', name: 'Ad Bakery', status: 'prospect' as const, lead_source: '', account_owner: 'Pat',
      last_contact_date: null, tags: [], industry: null, size: null, address: null, website: null, notes: null,
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
      acquisition_source: 'meta_ad' as const, acquisition_campaign: 'Oct promo',
    };
    render(<CreateModal isOpen type="deal" onClose={vi.fn()} onSave={onSave} companies={[company]} initialValues={{ company_id: 'company-ad' }} />);

    expect((document.querySelector('input[name="deal_campaign"]') as HTMLInputElement).value).toBe('Oct promo');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('company_acquisition');
  });
});
