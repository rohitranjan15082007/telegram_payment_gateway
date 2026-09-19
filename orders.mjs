import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export class OrderStore {
  constructor(dataDirectory = path.join(process.cwd(), 'data')) {
    mkdirSync(dataDirectory, { recursive: true });
    this.database = new DatabaseSync(path.join(dataDirectory, 'orders.sqlite'));
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        payload TEXT PRIMARY KEY, chat_id TEXT NOT NULL, user_id TEXT NOT NULL,
        product_key TEXT NOT NULL, currency TEXT NOT NULL, amount INTEGER NOT NULL,
        status TEXT NOT NULL, precheckout_query_id TEXT, telegram_payment_charge_id TEXT UNIQUE,
        provider_payment_charge_id TEXT, created_at TEXT NOT NULL, paid_at TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
    `);
    this.insertOrder = this.database.prepare(`INSERT INTO orders (payload, chat_id, user_id, product_key, currency, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'created', ?)`);
    this.getOrder = this.database.prepare('SELECT * FROM orders WHERE payload = ?');
    this.approveOrder = this.database.prepare(`UPDATE orders SET status = 'approved', precheckout_query_id = ? WHERE payload = ? AND status = 'created'`);
    this.payOrder = this.database.prepare(`UPDATE orders SET status = 'paid', telegram_payment_charge_id = ?, provider_payment_charge_id = ?, paid_at = ? WHERE payload = ? AND status IN ('created', 'approved')`);
  }

  create({ chatId, userId, productKey, currency, amount }) {
    const payload = `order_${randomUUID().replaceAll('-', '')}`;
    this.insertOrder.run(payload, String(chatId), String(userId), productKey, currency, amount, new Date().toISOString());
    return this.find(payload);
  }
  find(payload) { return this.getOrder.get(payload); }
  approve(payload, precheckoutQueryId) {
    const result = this.approveOrder.run(precheckoutQueryId, payload);
    const order = this.find(payload);
    return { order, approved: result.changes === 1 || order?.status === 'approved' };
  }
  markPaid({ payload, telegramChargeId, providerChargeId }) {
    const result = this.payOrder.run(telegramChargeId, providerChargeId || null, new Date().toISOString(), payload);
    return result.changes === 1;
  }
}
