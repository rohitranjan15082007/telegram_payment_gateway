import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { config } from './config.mjs';
import { OrderStore } from './orders.mjs';
import { deliveryIsAvailable, sendDelivery, telegram } from './telegram.mjs';
















const siteRoot = resolve(process.cwd());
const store = new OrderStore();
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
















function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}
async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Request body too large');
  }
  return JSON.parse(body || '{}');
}
function getStartParameter(text) {
  const match = text?.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
  return match?.[1]?.trim() || '';
}
function isExpectedOrder(order, from, payment) {
  return Boolean(order && String(order.user_id) === String(from.id) && order.currency === payment.currency && order.amount === payment.total_amount && order.status !== 'paid');
}
















let webhookRegistration;
function ensureTelegramWebhook() {
  if (!webhookRegistration) {
    webhookRegistration = telegram('setWebhook', {
      url: `${config.publicBaseUrl}/telegram/webhook`,
      secret_token: config.webhookSecret,
      allowed_updates: ['message', 'pre_checkout_query'],
      drop_pending_updates: false,
    }).then(() => {
      console.log('Telegram webhook configured.');
    }).catch((error) => {
      webhookRegistration = undefined;
      throw error;
    });
  }
  return webhookRegistration;
}

async function sendInvoice(message) {
  if (message.chat.type !== 'private') {
    await telegram('sendMessage', { chat_id: message.chat.id, text: 'For privacy, please open a private chat with this bot to purchase.' });
    return;
  }
  const order = await store.create({ chatId: message.chat.id, userId: message.from.id, productKey: config.product.key, currency: 'XTR', amount: config.product.priceStars });
  await telegram('sendInvoice', {
    chat_id: message.chat.id, title: config.product.title, description: config.product.description,
    payload: order.payload, provider_token: '', currency: 'XTR',
    prices: [{ label: config.product.title, amount: config.product.priceStars }],
    start_parameter: `buy_${config.product.key}`,
  });
}
async function handleMessage(message) {
  if (message.successful_payment) {
    const payment = message.successful_payment;
    const order = await store.find(payment.invoice_payload);
    if (!isExpectedOrder(order, message.from, payment)) return;
    const firstReceipt = await store.markPaid({ payload: order.payload, telegramChargeId: payment.telegram_payment_charge_id, providerChargeId: payment.provider_payment_charge_id });
    if (firstReceipt) {
      try {
        await sendDelivery(message.chat.id);
      } catch (error) {
        console.error('Payment verified but delivery failed:', error);
        await telegram('sendMessage', { chat_id: message.chat.id, text: 'Your payment was verified, but delivery needs support. Please send /support and include your Telegram payment receipt.' });
      }
    }
    return;
  }
  const startParameter = getStartParameter(message.text);
  if (startParameter === `buy_${config.product.key}`) return sendInvoice(message);
  if (/^\/terms(?:@\w+)?$/i.test(message.text || '')) return telegram('sendMessage', { chat_id: message.chat.id, text: config.termsText });
  if (/^\/support(?:@\w+)?$/i.test(message.text || '')) return telegram('sendMessage', { chat_id: message.chat.id, text: config.supportText });
  if (/^\/start(?:@\w+)?$/i.test(message.text || '')) return telegram('sendMessage', { chat_id: message.chat.id, text: `Welcome! Use the shop link to buy ${config.product.title}.` });
}
async function handleUpdate(update) {
  if (update.pre_checkout_query) {
    const query = update.pre_checkout_query;
    const order = await store.find(query.invoice_payload);
    if (!isExpectedOrder(order, query.from, query)) {
      await telegram('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok: false, error_message: 'This order is unavailable. Please open a new invoice from the bot.' });
      return;
    }
    if (!(await deliveryIsAvailable())) {
      await telegram('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok: false, error_message: 'This item is temporarily unavailable. Please try again later.' });
      return;
    }
    const { approved } = await store.approve(order.payload, query.id);
    await telegram('answerPreCheckoutQuery', approved
      ? { pre_checkout_query_id: query.id, ok: true }
      : { pre_checkout_query_id: query.id, ok: false, error_message: 'This order cannot be processed.' });
    return;
  }
  if (update.message) await handleMessage(update.message);
}
function serveStatic(response, pathname) {
  const requestPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(siteRoot, `.${requestPath}`);
  const permittedPrefix = `${siteRoot}${sep}`;
  if ((!filePath.startsWith(permittedPrefix) && filePath !== siteRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' });
  createReadStream(filePath).pipe(response);
}



const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, config.publicBaseUrl);
    if (request.method === 'GET' && url.pathname === '/health') {
      await store.ready;
      await ensureTelegramWebhook();
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/api/public-config') return sendJson(response, 200, {
      botUsername: config.botUsername,
      product: { key: config.product.key, title: config.product.title, description: config.product.description, priceStars: config.product.priceStars },
    });
    if (request.method === 'POST' && url.pathname === '/telegram/webhook') {
      if (request.headers['x-telegram-bot-api-secret-token'] !== config.webhookSecret) return sendJson(response, 401, { ok: false });
      await handleUpdate(await readJson(request));
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === 'GET') return serveStatic(response, decodeURIComponent(url.pathname));
    return sendJson(response, 405, { error: 'Method not allowed' });
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: 'Internal server error' });
  }
});
server.listen(config.port, () => console.log(`Shop server listening on port ${config.port}`));
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { config } from './config.mjs';
import { OrderStore } from './orders.mjs';
import { deliveryIsAvailable, sendDelivery, telegram } from './telegram.mjs';








const siteRoot = resolve(process.cwd());
const store = new OrderStore();
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };








function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}
async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Request body too large');
  }
  return JSON.parse(body || '{}');
}
function getStartParameter(text) {
  const match = text?.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
  return match?.[1]?.trim() || '';
}
function isExpectedOrder(order, from, payment) {
  return Boolean(order && String(order.user_id) === String(from.id) && order.currency === payment.currency && order.amount === payment.total_amount && order.status !== 'paid');
}








async function sendInvoice(message) {
  if (message.chat.type !== 'private') {
    await telegram('sendMessage', { chat_id: message.chat.id, text: 'For privacy, please open a private chat with this bot to purchase.' });
    return;
  }
  const order = await store.create({ chatId: message.chat.id, userId: message.from.id, productKey: config.product.key, currency: 'XTR', amount: config.product.priceStars });
  await telegram('sendInvoice', {
    chat_id: message.chat.id, title: config.product.title, description: config.product.description,
    payload: order.payload, provider_token: '', currency: 'XTR',
    prices: [{ label: config.product.title, amount: config.product.priceStars }],
    start_parameter: `buy_${config.product.key}`,
  });
}
async function handleMessage(message) {
  if (message.successful_payment) {
    const payment = message.successful_payment;
    const order = await store.find(payment.invoice_payload);
    if (!isExpectedOrder(order, message.from, payment)) return;
    const firstReceipt = await store.markPaid({ payload: order.payload, telegramChargeId: payment.telegram_payment_charge_id, providerChargeId: payment.provider_payment_charge_id });
    if (firstReceipt) {
      try {
        await sendDelivery(message.chat.id);
      } catch (error) {
        console.error('Payment verified but delivery failed:', error);
        await telegram('sendMessage', { chat_id: message.chat.id, text: 'Your payment was verified, but delivery needs support. Please send /support and include your Telegram payment receipt.' });
      }
    }
    return;
  }
  const startParameter = getStartParameter(message.text);
  if (startParameter === `buy_${config.product.key}`) return sendInvoice(message);
  if (/^\/terms(?:@\w+)?$/i.test(message.text || '')) return telegram('sendMessage', { chat_id: message.chat.id, text: config.termsText });
  if (/^\/support(?:@\w+)?$/i.test(message.text || '')) return telegram('sendMessage', { chat_id: message.chat.id, text: config.supportText });
  if (/^\/start(?:@\w+)?$/i.test(message.text || '')) return telegram('sendMessage', { chat_id: message.chat.id, text: `Welcome! Use the shop link to buy ${config.product.title}.` });
}
async function handleUpdate(update) {
  if (update.pre_checkout_query) {
    const query = update.pre_checkout_query;
    const order = await store.find(query.invoice_payload);
    if (!isExpectedOrder(order, query.from, query)) {
      await telegram('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok: false, error_message: 'This order is unavailable. Please open a new invoice from the bot.' });
      return;
    }
    if (!(await deliveryIsAvailable())) {
      await telegram('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok: false, error_message: 'This item is temporarily unavailable. Please try again later.' });
      return;
    }
    const { approved } = await store.approve(order.payload, query.id);
    await telegram('answerPreCheckoutQuery', approved
      ? { pre_checkout_query_id: query.id, ok: true }
      : { pre_checkout_query_id: query.id, ok: false, error_message: 'This order cannot be processed.' });
    return;
  }
  if (update.message) await handleMessage(update.message);
}
function serveStatic(response, pathname) {
  const requestPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(siteRoot, `.${requestPath}`);
  const permittedPrefix = `${siteRoot}${sep}`;
  if ((!filePath.startsWith(permittedPrefix) && filePath !== siteRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, config.publicBaseUrl);
    if (request.method === 'GET' && url.pathname === '/health') {
        await store.ready;
        return sendJson(response, 200, { ok: true });
      }
    if (request.method === 'GET' && url.pathname === '/api/public-config') return sendJson(response, 200, { botUsername: config.botUsername, product: { key: config.product.key, title: config.product.title, description: config.product.description, priceStars: config.product.priceStars } });
    if (request.method === 'POST' && url.pathname === '/telegram/webhook') {
      if (request.headers['x-telegram-bot-api-secret-token'] !== config.webhookSecret) return sendJson(response, 401, { ok: false });
