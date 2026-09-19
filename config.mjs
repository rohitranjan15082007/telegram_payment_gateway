import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function loadDotEnv(filePath = path.join(process.cwd(), '.env')) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

function requireValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function requirePositiveInteger(name) {
  const value = Number(requireValue(name));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

loadDotEnv();

export const config = {
  port: Number(process.env.PORT || 3000),
  botToken: requireValue('TELEGRAM_BOT_TOKEN'),
  botUsername: requireValue('TELEGRAM_BOT_USERNAME').replace(/^@/, ''),
  webhookSecret: requireValue('TELEGRAM_WEBHOOK_SECRET'),
  publicBaseUrl: requireValue('PUBLIC_BASE_URL').replace(/\/$/, ''),
  product: {
    key: process.env.PRODUCT_KEY || 'creative_starter',
    title: process.env.PRODUCT_TITLE || 'Creative Starter Pack',
    description: process.env.PRODUCT_DESCRIPTION || '12 editable templates',
    priceStars: requirePositiveInteger('PRODUCT_PRICE_STARS'),
    deliveryFile: process.env.PRODUCT_DELIVERY_FILE || '',
  },
  supportText: process.env.SUPPORT_TEXT || 'Please reply with your order number and we will help you.',
  termsText: process.env.TERMS_TEXT || 'Add your terms, refund policy, and support contact in TERMS_TEXT before accepting payments.',
};

if (!/^[A-Za-z0-9_]{1,48}$/.test(config.product.key)) throw new Error('PRODUCT_KEY may only contain letters, numbers, and underscores.');
if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(config.botUsername)) throw new Error('TELEGRAM_BOT_USERNAME is not a valid bot username.');
if (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('PORT must be a valid TCP port.');
if (!/^[A-Za-z0-9_-]{1,256}$/.test(config.webhookSecret)) throw new Error('TELEGRAM_WEBHOOK_SECRET must use only letters, numbers, underscores, and hyphens.');
const publicUrl = new URL(config.publicBaseUrl);
if (publicUrl.protocol !== 'https:') throw new Error('PUBLIC_BASE_URL must use HTTPS for a Telegram webhook.');
if (publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) throw new Error('PUBLIC_BASE_URL must be the HTTPS site origin, without a path, query, or hash.');
if (config.product.title.length < 1 || config.product.title.length > 32) throw new Error('PRODUCT_TITLE must be 1-32 characters for Telegram invoices.');
if (config.product.description.length < 1 || config.product.description.length > 255) throw new Error('PRODUCT_DESCRIPTION must be 1-255 characters for Telegram invoices.');
