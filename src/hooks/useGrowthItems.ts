'use client';

import { useCallback, useEffect, useState } from 'react';
import * as growth from '@/lib/growth';
import type { GrowthItem } from '@/utils/growth';

/** Funding and PR rows for the Growth page and This week. A failed load keeps the last rows and says so. */
export function useGrowthItems() {
  const [items, setItems] = useState<GrowthItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadCount, setLoadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    growth.getGrowthItems().then(
      rows => {
        if (cancelled) return;
        setItems(rows);
        setError(null);
        setLoading(false);
      },
      err => {
        if (cancelled) return;
        // Supabase errors are plain objects with a message, not Error instances.
        setError(err && typeof err === 'object' && 'message' in err ? String(err.message) : 'unknown error');
        setLoading(false);
      },
    );
    return () => { cancelled = true; };
  }, [loadCount]);

  const reload = useCallback(() => setLoadCount(n => n + 1), []);
  return { items, loading, error, reload };
}
