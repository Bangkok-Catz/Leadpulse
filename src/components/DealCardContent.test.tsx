import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Deal } from '@/types/crm';
import type { DealCardPresentation } from '@/utils/deal-card';
import DealCardContent from './DealCardContent';

const deal: Deal = {
  id: 'deal-1',
  title: 'Mello Vegan — Butter + Condensed Milk',
  stage: 'research',
  product: 'Butter + Condensed Milk',
  client: 'Mello Vegan',
  company_id: 'company-1',
  contact_ids: ['contact-1'],
  value: null,
  priority: 'medium',
  next_action: 'Verify the two conflicting numbers, then call about the butter swap',
  followup_date: '2026-08-25',
  last_outcome: null,
  nudge_count: 0,
  workflow_action: 'outreach',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

const presentation: DealCardPresentation = {
  contact: {
    name: 'Nok S.',
    role: 'Pastry Chef',
    initials: 'NS',
    additionalCount: 1,
    missing: false,
  },
  companyName: 'Mello Vegan',
  companyLogoUrl: null,
  product: 'Butter + Condensed Milk',
  nextAction: 'Verify the two conflicting numbers, then call about the butter swap',
  timing: {
    label: 'Overdue',
    date: '25 Aug',
    tone: 'overdue',
  },
};

afterEach(() => cleanup());

describe('DealCardContent', () => {
  it('shows a set value and tags only high priority', () => {
    render(
      <DealCardContent
        deal={{ ...deal, value: 12000, priority: 'high' }}
        presentation={presentation}
        whyNow={null}
        reviewLabels={[]}
        nudge={null}
      />
    );
    expect(screen.getByTitle('Deal value').textContent).toMatch(/12,000/);
    expect(screen.getByText('High')).toBeTruthy();
  });


  it('keeps company identity independent from a long role and preserves full identity labels', () => {
    const longRole = 'Regional purchasing and pastry development lead';
    const longName = 'ประภัสสร จันทร์สุวรรณกุล';
    render(
      <DealCardContent
        deal={deal}
        presentation={{ ...presentation, contact: { ...presentation.contact, name: longName, role: longRole } }}
        whyNow={null}
        reviewLabels={[]}
        nudge={null}
        showGrip
      />
    );
    expect(screen.getByRole('heading', { name: 'Mello Vegan' }).getAttribute('title')).toBe('Mello Vegan');
    expect(screen.getByText(longName + ' +1 · ' + longRole).getAttribute('title')).toBe(`${longName} · ${longRole}`);
    expect(screen.getByRole('img', { name: 'Mello Vegan logo' })).toBeTruthy();
  });

  it('leads with company identity and keeps next action, timing and an unusual product visible, with no value filler', () => {
    const { container } = render(
      <DealCardContent
        deal={deal}
        presentation={presentation}
        whyNow="Follow-up is overdue"
        reviewLabels={[]}
        nudge={null}
      />
    );

    expect(screen.getByRole('heading', { name: 'Mello Vegan' })).toBeTruthy();
    expect(screen.getByText('Nok S. +1 · Pastry Chef')).toBeTruthy();
    expect(screen.getByText('Overdue · 25 Aug')).toBeTruthy();
    expect(screen.getByText('Butter + Condensed Milk')).toBeTruthy();
    expect(screen.getByText(presentation.nextAction)).toBeTruthy();
    // An unset value shows nothing rather than "Value —".
    expect(screen.queryByTitle('Deal value')).toBeNull();
    expect(screen.getByText('Overdue · 25 Aug').getAttribute('title')).toBe('Follow-up is overdue');

    const text = container.textContent || '';
    expect(text.indexOf('Mello Vegan')).toBeLessThan(text.indexOf('Nok S.'));
    // The next step comes first; the date mark and an unusual product follow in the bottom row.
    expect(text.indexOf(presentation.nextAction)).toBeLessThan(text.indexOf('Overdue'));
    expect(text.indexOf('Overdue')).toBeLessThan(text.indexOf('Butter + Condensed Milk'));
    expect(text).not.toContain(deal.title);
  });

  it('shows only the company when no contact is identified, with no filler line', () => {
    render(
      <DealCardContent
        deal={{ ...deal, contact_ids: [] }}
        presentation={{
          ...presentation,
          contact: {
            name: 'Contact not identified',
            role: null,
            initials: '?',
            additionalCount: 0,
            missing: true,
          },
        }}
        whyNow={null}
        reviewLabels={[]}
        nudge={null}
      />
    );

    expect(screen.getByRole('heading', { name: 'Mello Vegan' })).toBeTruthy();
    expect(screen.queryByText('Contact not identified')).toBeNull();
    expect(screen.getByRole('img', { name: 'Mello Vegan logo' })).toBeTruthy();
    expect(screen.queryByText('?')).toBeNull();
  });

  it('shows the linked company brand logo instead of the question-mark avatar for a missing contact', () => {
    const logoUrl = 'https://example.test/company-logo.webp';

    render(
      <DealCardContent
        deal={{ ...deal, contact_ids: [] }}
        presentation={{
          ...presentation,
          companyLogoUrl: logoUrl,
          contact: {
            name: 'Contact not identified',
            role: null,
            initials: '?',
            additionalCount: 0,
            missing: true,
          },
        }}
        whyNow={null}
        reviewLabels={[]}
        nudge={null}
      />
    );

    const logo = screen.getByRole('img', { name: 'Mello Vegan logo' });
    expect(logo.getAttribute('src')).toBe(logoUrl);
    expect(screen.queryByText('?')).toBeNull();
  });

  it('shows the linked company logo even when a named contact exists', () => {
    const logoUrl = 'https://example.test/company-logo.webp';
    render(
      <DealCardContent
        deal={deal}
        presentation={{ ...presentation, companyLogoUrl: logoUrl }}
        whyNow={null}
        reviewLabels={[]}
        nudge={null}
      />
    );

    expect(screen.getByText('Nok S. +1 · Pastry Chef')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Mello Vegan logo' }).getAttribute('src')).toBe(logoUrl);
  });

  it('keeps a compact card actionable without opening the detail panel', () => {
    render(
      <DealCardContent
        deal={{ ...deal, value: 4500 }}
        presentation={presentation}
        whyNow="Follow-up is overdue"
        reviewLabels={[]}
        nudge={null}
        compact
      />
    );

    expect(screen.getByRole('heading', { name: 'Mello Vegan' })).toBeTruthy();
    expect(screen.getByText('Butter + Condensed Milk')).toBeTruthy();
    expect(screen.getByText(presentation.nextAction)).toBeTruthy();
    expect(screen.getByText('Overdue · 25 Aug')).toBeTruthy();
    expect(screen.getByText('฿4,500')).toBeTruthy();
    expect(screen.queryByText('Why now · Follow-up is overdue')).toBeNull();
  });

  it('offers an actionable empty state instead of a dash when no next action is set', () => {
    render(
      <DealCardContent
        deal={{ ...deal, next_action: null }}
        presentation={{ ...presentation, nextAction: 'No next action set' }}
        whyNow={null}
        reviewLabels={[]}
        nudge={null}
        compact
      />
    );

    expect(screen.getByText('No next action set yet')).toBeTruthy();
    expect(screen.queryByText('No next action set')).toBeNull();
  });

  it('shows the nudge as touch dots, with the words and code kept for the tooltip', () => {
    const { container } = render(
      <DealCardContent
        deal={deal}
        presentation={presentation}
        whyNow={null}
        reviewLabels={[]}
        nudge="2/4 Remind NG-002"
        nudgeStage="remind"
        compact
      />
    );
    const badge = container.querySelector('[data-nudge-badge]')!;
    expect(badge.getAttribute('aria-label')).toBe('Touch 2 of 4 · Remind');
    expect(badge.getAttribute('title')).toBe('2/4 Remind NG-002');
    expect(badge.querySelectorAll('span')).toHaveLength(4);
    expect(badge.querySelectorAll('.bg-clay-lavender')).toHaveLength(2);
    expect(screen.queryByText('2/4 Remind')).toBeNull();
  });

  it('leaves plain butter unsaid, draws no grip, and shows no date mark on a lead not contacted yet', () => {
    const { container } = render(
      <DealCardContent
        deal={{ ...deal, product: 'Butter' }}
        presentation={{ ...presentation, product: 'Butter', timing: { label: '', date: null, tone: 'hidden' } }}
        whyNow={null}
        reviewLabels={[]}
        nudge={null}
        showGrip
      />
    );
    expect(screen.queryByText('Butter')).toBeNull();
    expect(container.querySelector('[data-card-timing]')).toBeNull();
    expect(container.querySelector('svg.lucide-grip-vertical')).toBeNull();
  });

  it('shows one status only: Laya first, then stalled, then a lane gap, then priority', () => {
    const base = { presentation, whyNow: null, nudge: null };
    const status = (ui: React.ReactElement) => {
      const { container } = render(ui);
      const text = container.querySelector('.border-t')!.textContent ?? '';
      cleanup();
      return text;
    };
    const high = { ...deal, priority: 'high' as const };
    const grade = { status: 'needs_review' as const, baseTier: 'B' as const, tier: 'B' as const, suggestedTier: null, momentum: null, reasons: [], review: ['x'], quantity: 'none' as const };
    const all = status(<DealCardContent {...base} deal={high} reviewLabels={['Follow-up missing a date']} laneTime={{ days: 30, stalled: true }} layaGrade={grade} />);
    expect(all).toMatch(/Laya: review/);
    expect(all).not.toMatch(/stalled|Needs review|High/);
    expect(status(<DealCardContent {...base} deal={high} reviewLabels={['Follow-up missing a date']} laneTime={{ days: 30, stalled: true }} />)).toMatch(/stalled · 30d/);
    expect(status(<DealCardContent {...base} deal={high} reviewLabels={['Follow-up missing a date']} laneTime={{ days: 3, stalled: false }} />)).toMatch(/Needs review/);
    const priority = status(<DealCardContent {...base} deal={high} reviewLabels={[]} laneTime={{ days: 3, stalled: false }} />);
    expect(priority).toMatch(/High/);
    expect(priority).not.toMatch(/in lane|kg/);
  });
});
