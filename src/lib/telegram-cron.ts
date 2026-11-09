import { NextRequest, NextResponse } from 'next/server';
import { pendingUnsent, sendPendingProposals } from '@/lib/proposals-data';
import { sendTelegramMessage, telegramConfigured, type InlineButton } from '@/lib/telegram';
import { ensureTelegramWebhook } from '@/lib/telegram-webhook';
import { businessDateKey } from '@/utils/business-time';

interface TelegramReport {
  text: string;
  isEmpty: boolean;
  counts: Record<string, number>;
  /** one-tap logging for the run; attached only when the bot's buttons can reach the app */
  buttons?: InlineButton[][];
}

// Shared by the scheduled Telegram routes (vercel.json).
//   GET <route>          builds the message and sends it to Telegram, then any enrichment
//                        proposals waiting for Pat (lib/proposals-data.ts)
//   GET <route>?dry=1    returns the message without sending it
// Every call needs `Authorization: Bearer $CRON_SECRET`, which Vercel adds to scheduled
// runs. Local development may preview with ?dry=1 without it.
export async function runTelegramCron(
  request: NextRequest,
  load: (today: string, appUrl: string) => Promise<TelegramReport>,
): Promise<NextResponse> {
  const dry = request.nextUrl.searchParams.get('dry') === '1';
  const secret = process.env.CRON_SECRET;
  const authorised = Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
  const localPreview = dry && process.env.NODE_ENV !== 'production';
  if (!authorised && !localPreview) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const report = await load(businessDateKey(), request.nextUrl.origin);
    if (dry) {
      const waiting = await pendingUnsent().then(rows => rows.length).catch(() => null);
      return NextResponse.json({ sent: false, reason: 'dry run', ...report, proposals_waiting: waiting });
    }
    if (!telegramConfigured()) {
      if (report.isEmpty) return NextResponse.json({ sent: false, reason: 'nothing due', counts: report.counts });
      return NextResponse.json({ sent: false, reason: 'TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not set' }, { status: 503 });
    }
    // Buttons only work once Telegram can reach us, so the webhook is checked first.
    // The production domain, not this deployment's own address: deployment URLs can sit behind
    // Vercel's deployment protection, which would turn Telegram's calls away.
    const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const webhook = await ensureTelegramWebhook(production ? `https://${production}` : request.nextUrl.origin)
      .catch(err => ({ status: 'failed' as const, reason: err instanceof Error ? err.message : 'webhook check failed' }));
    const buttonsReach = webhook.status === 'ok' || webhook.status === 'registered';
    if (!report.isEmpty) await sendTelegramMessage(report.text, buttonsReach && report.buttons?.length ? report.buttons : undefined);
    // Enrichment proposals ride along with every scheduled run, even on a day with nothing due,
    // but only once the buttons can reach us. A failure here never hides the report already sent.
    const proposals = buttonsReach
      ? await sendPendingProposals().catch(err => ({ error: err instanceof Error ? err.message : 'proposals failed' }))
      : { held: `buttons not connected: ${'reason' in webhook ? webhook.reason : webhook.status}` };
    return NextResponse.json({
      sent: !report.isEmpty,
      ...(report.isEmpty ? { reason: 'nothing due' } : {}),
      counts: report.counts,
      webhook,
      proposals,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Telegram cron failed' }, { status: 500 });
  }
}
