// ─── Growth page data: funding rows and what was logged on them ───
// Tables from supabase/migrations/20261108090000_growth_page.sql. Rows are archived
// (deleted_at), never deleted, so Undo can bring them back.

import { supabase } from '@/lib/supabase';
import type { GrowthItem, GrowthPayload, GrowthUpdate } from '@/utils/growth';

export async function getGrowthItems(): Promise<GrowthItem[]> {
  const { data, error } = await supabase
    .from('growth_items')
    .select('*')
    // The PR tab was dropped before launch (2026-11-08); only funding rows are shown anywhere.
    .eq('track', 'funding')
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as GrowthItem[];
}

export async function createGrowthItem(payload: GrowthPayload): Promise<GrowthItem> {
  const { data, error } = await supabase.from('growth_items').insert(payload).select('*').single();
  if (error) throw error;
  return data as GrowthItem;
}

export async function updateGrowthItem(id: string, patch: Partial<Omit<GrowthItem, 'id' | 'created_at' | 'updated_at'>>): Promise<GrowthItem> {
  const { data, error } = await supabase.from('growth_items').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data as GrowthItem;
}

export async function archiveGrowthItem(id: string): Promise<void> {
  const { error } = await supabase.from('growth_items').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function restoreGrowthItem(id: string): Promise<void> {
  const { error } = await supabase.from('growth_items').update({ deleted_at: null }).eq('id', id);
  if (error) throw error;
}

export async function getGrowthUpdates(itemId: string): Promise<GrowthUpdate[]> {
  const { data, error } = await supabase
    .from('growth_updates')
    .select('*')
    .eq('item_id', itemId)
    .order('happened_on', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as GrowthUpdate[];
}

export async function addGrowthUpdate(update: { item_id: string; happened_on: string; note: string }): Promise<void> {
  const { error } = await supabase.from('growth_updates').insert(update);
  if (error) throw error;
}
