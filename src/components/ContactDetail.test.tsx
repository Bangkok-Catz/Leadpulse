import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Contact } from '@/types/crm';

const crmMocks = vi.hoisted(() => ({
  updateContact: vi.fn(),
}));
const addToast = vi.fn();

vi.mock('@/lib/crm', () => crmMocks);
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => ({ addToast }),
}));
vi.mock('@/components/CrmProvider', () => ({
  useCrm: () => ({ deleteEntity: vi.fn() }),
}));

import ContactDetail from './ContactDetail';

const contact: Contact = {
  id: 'contact-1',
  name: 'Head Chef',
  email: null,
  phone: '020000000',
  phone_second: null,
  line: null,
  job_title: 'Head Chef',
  company_id: null,
  status: 'active',
  identity_quality: 'unknown',
  last_contacted_date: null,
  notes: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-25T10:00:00Z',
};

describe('ContactDetail contact quality', () => {
  beforeEach(() => {
    crmMocks.updateContact.mockReset().mockResolvedValue({
      ...contact,
      identity_quality: 'role_only',
    });
    addToast.mockReset();
  });

  afterEach(cleanup);

  it('displays and preserves an uncontacted route when editing metadata', async () => {
    const neutralContact = { ...contact, status: 'uncontacted' } as Contact;
    crmMocks.updateContact.mockResolvedValue({ ...neutralContact, identity_quality: 'role_only' });
    render(<ContactDetail contact={neutralContact} onClose={vi.fn()} onSaved={vi.fn()} companies={[]} />);
    expect(screen.getByText('Uncontacted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit contact' }));
    expect(screen.getByRole('option', { name: 'Uncontacted' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'A role' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    await waitFor(() => expect(crmMocks.updateContact).toHaveBeenCalledTimes(1));
    expect(crmMocks.updateContact).toHaveBeenCalledWith('contact-1', expect.objectContaining({ status: 'uncontacted' }));
  });

  it('asks an unknown contact who it is before saving, then saves the answer', async () => {
    render(<ContactDetail contact={contact} onClose={vi.fn()} onSaved={vi.fn()} companies={[]} />);
    expect(screen.getByText(/not said yet/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Edit contact' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    expect(crmMocks.updateContact).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/Say who this is/);

    fireEvent.click(screen.getByRole('radio', { name: 'A role' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));

    await waitFor(() => expect(crmMocks.updateContact).toHaveBeenCalledTimes(1));
    expect(crmMocks.updateContact).toHaveBeenCalledWith('contact-1', expect.objectContaining({
      identity_quality: 'role_only',
    }));
  });

  it('adapts the editable contact-name field to contact quality', () => {
    render(<ContactDetail contact={contact} onClose={vi.fn()} onSaved={vi.fn()} companies={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit contact' }));
    expect(screen.getByLabelText('Name or contact label *').getAttribute('placeholder')).toBe(
      'e.g., John, Head Chef, or company LINE'
    );

    fireEvent.click(screen.getByRole('radio', { name: "The shop's channel" }));

    expect(screen.getByLabelText('Company route label *').getAttribute('placeholder')).toBe(
      'e.g., Buarys general LINE'
    );
  });

  it('labels the second number as an alternate phone', () => {
    render(<ContactDetail contact={contact} onClose={vi.fn()} onSaved={vi.fn()} companies={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit contact' }));
    expect(screen.getByLabelText('Alternate phone')).toBeTruthy();
  });

  it('shows an Instagram handle kept in the old LINE box as Instagram, with a link', () => {
    render(<ContactDetail contact={{ ...contact, line: 'Instagram @juliapanchkowry' }} onClose={vi.fn()} onSaved={vi.fn()} companies={[]} />);
    const link = screen.getByRole('link', { name: '@juliapanchkowry' });
    expect(link.getAttribute('href')).toBe('https://instagram.com/juliapanchkowry');
    expect(screen.getByRole('link', { name: '020000000' }).getAttribute('href')).toBe('tel:020000000');
  });
});
