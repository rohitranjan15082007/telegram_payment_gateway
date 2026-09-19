import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

export class OrderStore {
  constructor(databaseUrl = process.env.DATABASE_URL) {
    if (!databaseUrl) {
      throw new Error('Missing required environment variable: DATABASE_URL');
    }

    this.sql = neon(databaseUrl);
    this.ready = this.sql`
      CREATE TABLE IF NOT EXISTS orders (
        payload TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        product_key TEXT NOT NULL,
        currency TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK (amount > 0),
        status TEXT NOT NULL CHECK (status IN ('created', 'approved', 'paid')),
        precheckout_query_id TEXT,
        telegram_payment_charge_id TEXT UNIQUE,
        provider_payment_charge_id TEXT,
        created_at TEXT NOT NULL,
        paid_at TEXT
      )
    `.then(() => this.sql`
      CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status)
    `);
  }

  async create({ chatId, userId, productKey, currency, amount }) {
    await this.ready;
    const payload = `order_${randomUUID().replaceAll('-', '')}`;
    const [order] = await this.sql`
      INSERT INTO orders (payload, chat_id, user_id, product_key, currency, amount, status, created_at)
      VALUES (${payload}, ${String(chatId)}, ${String(userId)}, ${productKey}, ${currency}, ${amount}, 'created', ${new Date().toISOString()})
      RETURNING *
    `;
    return order;
  }

  async find(payload) {
    await this.ready;
    const [order] = await this.sql`SELECT * FROM orders WHERE payload = ${payload}`;
    return order;
  }

  async approve(payload, precheckoutQueryId) {
    await this.ready;
    const approvedOrders = await this.sql`
      UPDATE orders
      SET status = 'approved', precheckout_query_id = ${precheckoutQueryId}
      WHERE payload = ${payload} AND status = 'created'
      RETURNING *
    `;
    const order = approvedOrders[0] ?? await this.find(payload);
    return {
      order,
      approved: approvedOrders.length === 1 || order?.status === 'approved',
    };
  }

  async markPaid({ payload, telegramChargeId, providerChargeId }) {
    await this.ready;
    const paidOrders = await this.sql`
      UPDATE orders
      SET status = 'paid',
          telegram_payment_charge_id = ${telegramChargeId},
          provider_payment_charge_id = ${providerChargeId || null},
          paid_at = ${new Date().toISOString()}
      WHERE payload = ${payload} AND status IN ('created', 'approved')
      RETURNING payload
    `;
    return paidOrders.length === 1;
  }
}
