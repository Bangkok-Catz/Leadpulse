// ─── Social tab: each channel's growth, week by week ───
// Pure. Rows come from social_snapshots (supabase/migrations/20261108120000_social_snapshots.sql),
// written every Monday by a Claude task that reads Metricool; loading is in lib/social.ts.

export interface SocialSnapshot {
  network: string;
  period_start: string;
  period_end: string;
  followers: number | null;
  followers_change: number | null;
  reach: number | null;
  views: number | null;
  interactions: number | null;
  posts: number | null;
  fetched_at: string;
}

/** Metricool's channel names, as the weekly task stores them. */
export const NETWORK_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  googleBusinessProfile: 'Google Business',
  threads: 'Threads',
  pinterest: 'Pinterest',
  bluesky: 'Bluesky',
  linkedin: 'LinkedIn',
  twitter: 'X',
};

/** Channels in this order; any other comes after, by name. */
const NETWORK_ORDER = ['instagram', 'facebook', 'tiktok', 'youtube', 'threads', 'googleBusinessProfile', 'linkedin', 'pinterest', 'bluesky', 'twitter'];

export const METRICOOL_CONNECTIONS_URL = 'https://app.metricool.com/brands/connections?blogId=7936170';

/** How many weeks the small line shows. */
export const SERIES_WEEKS = 12;

export interface ChannelGrowth {
  network: string;
  label: string;
  /** the latest week */
  latest: SocialSnapshot;
  /** the week before it, when there is one */
  previous: SocialSnapshot | null;
  /** what the line shows: followers when the channel has them, else views */
  seriesOf: 'followers' | 'views';
  /** oldest first, at most SERIES_WEEKS; null where that week has no number */
  series: (number | null)[];
}

export function networkLabel(network: string): string {
  return NETWORK_LABELS[network] ?? network.charAt(0).toUpperCase() + network.slice(1);
}

/** One entry per channel: its latest week, the week before, and the line. */
export function buildChannelGrowth(rows: readonly SocialSnapshot[]): ChannelGrowth[] {
  const byNetwork = new Map<string, SocialSnapshot[]>();
  for (const row of rows) {
    const list = byNetwork.get(row.network) ?? [];
    list.push(row);
    byNetwork.set(row.network, list);
  }
  const rank = (network: string) => {
    const i = NETWORK_ORDER.indexOf(network);
    return i === -1 ? NETWORK_ORDER.length : i;
  };
  return [...byNetwork.entries()]
    .map(([network, list]) => {
      const weeks = [...list].sort((a, b) => a.period_start.localeCompare(b.period_start));
      const latest = weeks[weeks.length - 1];
      const recent = weeks.slice(-SERIES_WEEKS);
      const seriesOf: ChannelGrowth['seriesOf'] = recent.some(w => w.followers != null) ? 'followers' : 'views';
      return {
        network,
        label: networkLabel(network),
        latest,
        previous: weeks.length > 1 ? weeks[weeks.length - 2] : null,
        seriesOf,
        series: recent.map(w => w[seriesOf]),
      };
    })
    .sort((a, b) => rank(a.network) - rank(b.network) || a.label.localeCompare(b.label));
}

/** 18,240 → "18.2k", 1,310 → "1,310", 2,400,000 → "2.4M". */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return Math.round(n).toLocaleString('en-US');
}

/** "+86", "−12", "0"; null when unknown. */
export function signed(n: number | null): string | null {
  if (n == null) return null;
  if (n > 0) return `+${compactNumber(n)}`;
  if (n < 0) return `−${compactNumber(-n)}`;
  return '0';
}

/** "12.4k reach · 30.1k views · 820 interactions · 6 posts", leaving out what the channel doesn't give. */
export function weekLine(week: Pick<SocialSnapshot, 'reach' | 'views' | 'interactions' | 'posts'>): string {
  const part = (n: number | null, one: string, many: string) => (n == null ? null : `${compactNumber(n)} ${n === 1 ? one : many}`);
  return [
    part(week.reach, 'reached', 'reached'),
    part(week.views, 'view', 'views'),
    part(week.interactions, 'interaction', 'interactions'),
    part(week.posts, 'post', 'posts'),
  ].filter(Boolean).join(' · ');
}

/** "2–8 Nov" */
export function weekRange(start: string, end: string): string {
  const fmt = (key: string, withMonth: boolean) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', withMonth ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { day: 'numeric', timeZone: 'UTC' });
  };
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${fmt(start, !sameMonth)}–${fmt(end, true)}`;
}
