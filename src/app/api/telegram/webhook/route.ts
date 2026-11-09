import { NextRequest, NextResponse } from 'next/server';
import { handleTelegramUpdate } from '@/lib/proposals-data';
import { handleQuickLogTap } from '@/lib/quick-log-telegram';
import { webhookSecret } from '@/lib/telegram-webhook';

// Telegram calls this when Pat taps a button: Save / Not theirs on a proposal, or a run
// step's "✓ Called" in the morning message or the 4 pm nudge (lib/quick-log-telegram.ts).
// The scheduled runs register it themselves (lib/telegram-webhook.ts) with a secret derived
// from CRON_SECRET; Telegram sends that secret in a header on every call, so a request
// without it is refused. Only button presses from TELEGRAM_CHAT_ID are acted on.
export async function POST(request: NextRequest) {
  const secret = webhookSecret();
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!secret || !chatId) return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  if (request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const update = await request.json().catch(() => null);
  if (!update || typeof update !== 'object') return NextResponse.json({ ok: true, result: 'ignored: not JSON' });
  try {
    const data = (update as { callback_query?: { data?: unknown } }).callback_query?.data;
    const result = typeof data === 'string' && data.startsWith('ql:')
      ? await handleQuickLogTap(update, chatId)
      : await handleTelegramUpdate(update, chatId);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    // 200 so Telegram does not redeliver the same tap in a loop; the proposal stays as it was.
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'failed' });
  }
}
