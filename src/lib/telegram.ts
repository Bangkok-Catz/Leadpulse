// Telegram delivery for the digest, the afternoon nudge and enrichment proposals. Server only:
// the bot token never reaches the browser. All values come from the host's environment.

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

async function callTelegram<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Telegram is not configured');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; result?: T; description?: string } | null;
  if (!response.ok || !payload?.ok) {
    // Telegram's own description only; never echo the request URL, which holds the token.
    const detail = payload?.description;
    throw new Error(`Telegram rejected ${method} (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  return payload.result as T;
}

/** Sends one HTML-formatted message to the configured chat; returns its message id. */
export async function sendTelegramMessage(html: string, buttons?: InlineButton[][]): Promise<number> {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) throw new Error('Telegram is not configured');
  const message = await callTelegram<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
  return message.message_id;
}

/** Replaces a sent message's text and removes its buttons. */
export async function editTelegramMessage(messageId: number, html: string): Promise<void> {
  await callTelegram('editMessageText', {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    message_id: messageId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: [] },
  });
}

/** Replaces a sent message's buttons, leaving its text as it is. */
export async function editTelegramButtons(messageId: number, buttons: InlineButton[][]): Promise<void> {
  await callTelegram('editMessageReplyMarkup', {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    message_id: messageId,
    reply_markup: { inline_keyboard: buttons },
  });
}

/** Stops the button's spinner and shows a short toast. */
export async function answerTelegramCallback(callbackId: string, text: string): Promise<void> {
  await callTelegram('answerCallbackQuery', { callback_query_id: callbackId, text: text.slice(0, 190) });
}

export interface WebhookInfo {
  url: string;
  pending_update_count?: number;
  last_error_message?: string;
}

export function getTelegramBot(): Promise<{ id: number; username?: string }> {
  return callTelegram('getMe', {});
}

export function getTelegramWebhook(): Promise<WebhookInfo> {
  return callTelegram('getWebhookInfo', {});
}

export async function setTelegramWebhook(url: string, secretToken: string): Promise<void> {
  await callTelegram('setWebhook', { url, secret_token: secretToken, allowed_updates: ['callback_query'] });
}
