import { config } from './config.mjs';
import { telegram } from './telegram.mjs';

const result = await telegram('setWebhook', {
  url: `${config.publicBaseUrl}/telegram/webhook`,
  secret_token: config.webhookSecret,
  allowed_updates: ['message', 'pre_checkout_query'],
  drop_pending_updates: false,
});
console.log(result ? 'Telegram webhook configured.' : 'Telegram did not confirm the webhook.');
