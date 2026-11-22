import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@/components/CompanyLogo', () => ({ default: () => null }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('@/components/game/Celebrate', () => ({ useCelebrate: () => ({ fire: () => {} }) }));

import QuestList, { type QuestView } from './QuestList';
import { questWeight, type QuestKind } from '@/utils/game';

const quest = (key: string, kind: QuestKind, late: number): QuestView => {
  const q = {
    key, kind, name: key, action: 'Follow up', dealId: key, companyId: null, late, points: 10, bonus: 0, held: false, weight: 0,
    channel: null, tag: null, detail: null, href: null, doneLabel: `Open ${key}`,
  };
  return { ...q, weight: questWeight(q) };
};

const props = { done: [], touchesToday: 0, primed: true, runPulse: 0 };

describe("This week's list", () => {
  afterEach(cleanup);

  it('shows a follow-up over a month late as gone cold, not red, and re-plans them from one filter', async () => {
    render(
      <QuestList
        {...props}
        run={[quest('Fresh', 'late', 3)]}
        next={[quest('Recent', 'late', 12), quest('Healthy Oven', 'late', 68), quest('Mango', 'lead', 62)]}
        coldTools={<div data-testid="cold-tools">Move all</div>}
      />,
    );
    expect(screen.getByText('3d late')).toBeTruthy();
    expect(screen.getByText('12d late')).toBeTruthy();
    expect(screen.queryByText('68d late')).toBeNull();
    expect(screen.getByText(/Gone cold · 68d/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Late/ }).textContent).toBe('Late1');

    const entry = screen.getByTestId('cold-entry');
    expect(entry.textContent).toMatch(/2 steps have gone cold/);
    expect(screen.queryByTestId('cold-tools')).toBeNull();
    fireEvent.click(within(entry).getByRole('button', { name: 'Re-plan' }));

    expect(screen.getByRole('tab', { name: /Gone cold/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('cold-tools')).toBeTruthy();
    const upNext = screen.getByRole('list', { name: 'Up next' });
    // The other rows fold away (their exit animation), leaving only the cold ones.
    await waitFor(() => expect(within(upNext).getAllByTestId('quest-row').map(r => r.textContent?.match(/^(Healthy Oven|Mango|Recent)/)?.[0])).toEqual(['Healthy Oven', 'Mango']));
    expect(screen.queryByTestId('cold-entry')).toBeNull();
  });

  it('says nothing about cold steps when there are none', () => {
    render(<QuestList {...props} run={[]} next={[quest('Recent', 'late', 12)]} coldTools={<div data-testid="cold-tools" />} />);
    expect(screen.queryByTestId('cold-entry')).toBeNull();
    expect(screen.queryByRole('tab', { name: /Gone cold/ })).toBeNull();
  });
});
