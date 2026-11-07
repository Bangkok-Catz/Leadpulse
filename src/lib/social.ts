// ─── Social tab data: weekly channel numbers from Metricool ───
// Written by the weekly Claude task (supabase/migrations/20261108120000_social_snapshots.sql);
// the app only reads.

import { supabase } from '@/lib/supabase';
import type { SocialSnapshot } from '@/utils/social';

/** Weeks that started on or after `since` ('YYYY-MM-DD'). */
export async function getSocialSnapshots(since: string): Promise<SocialSnapshot[]> {
  const { data, error } = await supabase
    .from('social_snapshots')
    .select('network, period_start, period_end, followers, followers_change, reach, views, interactions, posts, fetched_at')
    .gte('period_start', since)
    .order('period_start', { ascending: true });
  if (error) throw error;
  return (data ?? []) as SocialSnapshot[];
}
