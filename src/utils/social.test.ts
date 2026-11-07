import { describe, expect, it } from 'vitest';
import { buildChannelGrowth, compactNumber, signed, weekLine, weekRange, type SocialSnapshot } from './social';

const week = (network: string, period_start: string, over: Partial<SocialSnapshot> = {}): SocialSnapshot => ({
  network,
  period_start,
  period_end: period_start,
  followers: null,
  followers_change: null,
  reach: null,
  views: null,
  interactions: null,
  posts: null,
  fetched_at: '2026-11-09T02:00:00Z',
  ...over,
});

describe('buildChannelGrowth', () => {
  it('gives each channel its latest week, the week before and a line, Instagram first', () => {
    const channels = buildChannelGrowth([
      week('googleBusinessProfile', '2026-10-26', { views: 300 }),
      week('googleBusinessProfile', '2026-11-02', { views: 420 }),
      week('instagram', '2026-11-02', { followers: 2140, followers_change: 86 }),
      week('instagram', '2026-10-26', { followers: 2054, followers_change: 20 }),
      week('mastodon', '2026-11-02', { followers: 5 }),
    ]);
    expect(channels.map(c => c.label)).toEqual(['Instagram', 'Google Business', 'Mastodon']);
    expect(channels[0].latest.period_start).toBe('2026-11-02');
    expect(channels[0].previous?.period_start).toBe('2026-10-26');
    expect(channels[0]).toMatchObject({ seriesOf: 'followers', series: [2054, 2140] });
    // No followers on Google Business: the line follows views.
    expect(channels[1]).toMatchObject({ seriesOf: 'views', series: [300, 420] });
    expect(channels[2].previous).toBeNull();
  });

  it('keeps the line to the last twelve weeks', () => {
    const rows = Array.from({ length: 15 }, (_, i) => week('tiktok', `2026-${String(1 + Math.floor(i / 4)).padStart(2, '0')}-${String(1 + (i % 4) * 7).padStart(2, '0')}`, { followers: i }));
    expect(buildChannelGrowth(rows)[0].series).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });
});

describe('formatting', () => {
  it('shortens big numbers and signs the change', () => {
    expect(compactNumber(1310)).toBe('1,310');
    expect(compactNumber(18240)).toBe('18.2k');
    expect(compactNumber(20000)).toBe('20k');
    expect(compactNumber(2_400_000)).toBe('2.4M');
    expect(signed(86)).toBe('+86');
    expect(signed(-12)).toBe('−12');
    expect(signed(0)).toBe('0');
    expect(signed(null)).toBeNull();
  });

  it('writes the week line without what a channel does not give', () => {
    expect(weekLine({ reach: 12400, views: 30100, interactions: 820, posts: 6 })).toBe('12.4k reached · 30.1k views · 820 interactions · 6 posts');
    expect(weekLine({ reach: null, views: 1, interactions: null, posts: 1 })).toBe('1 view · 1 post');
  });

  it('names the week', () => {
    expect(weekRange('2026-11-02', '2026-11-08')).toBe('2–8 Nov');
    expect(weekRange('2026-10-26', '2026-11-01')).toBe('26 Oct–1 Nov');
  });
});
