import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/CompanyLogo', () => ({ default: () => null }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import { GameBoard } from './GameBoard';

const counts = { reach: 120, reply: 11, sample: 3, testing: 2, won: 1 };

describe('the board', () => {
  afterEach(cleanup);

  it('on This week: counts per stop and a link to Pipeline', () => {
    render(<GameBoard counts={counts} tokens={[]} />);
    expect(screen.getByRole('listitem', { name: 'Reach out: 120 to contact' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Pipeline' }).getAttribute('href')).toBe('/deals');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('on Pipeline: each stop jumps to its lane, with today\'s moves as faces', () => {
    const onStop = vi.fn();
    render(<GameBoard counts={counts} tokens={[{ dealId: 'd1', stop: 'won', name: 'Kemkon', companyId: 'c1' }]} onStop={onStop} link={null} />);
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show Testing: 2 trying it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Won: 1 this month' }));
    expect(onStop.mock.calls).toEqual([['testing'], ['won']]);
    expect(screen.getByTestId('board-token').getAttribute('data-stop')).toBe('won');
  });
});
