import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';

const apiBase = `https://api.telegram.org/bot${config.botToken}`;
async function parseResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(body.description || `Telegram API request failed (${response.status})`);
  return body.result;
}
export async function telegram(method, body) {
  const response = await fetch(`${apiBase}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return parseResponse(response);
}
function deliveryPath() {
  if (!config.product.deliveryFile) return null;
  const configuredPath = path.resolve(process.cwd(), config.product.deliveryFile);
  const contentRoot = `${path.resolve(process.cwd(), 'content')}${path.sep}`;
  if (!configuredPath.startsWith(contentRoot)) throw new Error('PRODUCT_DELIVERY_FILE must be inside the content directory.');
  return configuredPath;
}
export async function deliveryIsAvailable() {
  const configuredPath = deliveryPath();
  if (!configuredPath) return true;
  try {
    await access(configuredPath);
    return true;
  } catch {
    return false;
  }
}
export async function sendDelivery(chatId) {
  if (!config.product.deliveryFile) return telegram('sendMessage', { chat_id: chatId, text: 'Payment received and verified. Your purchase will be delivered shortly.' });
  const configuredPath = deliveryPath();
  const form = new FormData();
  form.set('chat_id', String(chatId));
  form.set('caption', 'Thanks! Here is your purchase.');
  form.set('document', new Blob([await readFile(configuredPath)]), path.basename(configuredPath));
  const response = await fetch(`${apiBase}/sendDocument`, { method: 'POST', body: form });
  return parseResponse(response);
}
