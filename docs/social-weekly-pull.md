# Social tab: the weekly Metricool pull

Pat is on Metricool's **free plan**, which has no API. So LeadPulse never calls Metricool itself and holds no Metricool key. Every Monday morning (Bangkok), a Claude scheduled task (`social-weekly-pull` in the Claude desktop app) runs these steps:

1. It reads which channels are linked to Metricool brand **7936170**, through the Metricool connector's brand settings.
2. For each linked channel, it reads last week (Monday 00:00 to Sunday 23:59:59, `+07:00`) with `getAnalyticsDataByMetrics`, using the field IDs below.
3. It upserts one row per channel into `social_snapshots` (Supabase project `mkyhikarlxuwvprjabbi`). The key is `(network, period_start)`, so a rerun overwrites rather than duplicates.

The Social tab's **Channel growth** card only reads that table. The task runs while the Claude app is open; if the app is closed on Monday, it runs on the next launch.

## Field IDs per channel

| network (stored) | followers | gained / lost | reach | views | interactions | posts |
|---|---|---|---|---|---|---|
| instagram | IGEV01 | IGEV43 / IGEV44 | IGEV06 | IGEV05 | IGEV38 | IGEV37 |
| facebook | FBEV17 | FBEV47 / FBEV48 | none | FBEV49 | FBEV34 | FBEV33 |
| tiktok | TKEV07 | TKEV16 / TKEV17 | TKEV11 | TKEV12 | TKEV06 | TKEV01 |
| youtube | YTEV01 | YTEV05 / YTEV06 | none | YTEV02 | none | YTEV04 |
| threads | THEV01 | THEV03 (net change) | none | THEV06 | THEV05 | THEV02 |
| googleBusinessProfile | none | none | GMEV20 | GMEV16 | GMEV24 | GMEV17 |

- `followers_change` is gained minus lost; for Threads it is the net change THEV03.
- Google Business has no followers, so its line on the Social tab follows views.
- "none" is stored as null.
- The free plan leaves out LinkedIn and X.

The first run also fills the previous 12 weeks, so the line has history from day one.
