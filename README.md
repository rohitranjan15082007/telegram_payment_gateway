# Telegram Stars shop

This project is a real Telegram bot payment starter for a **digital** product. It uses Telegram Stars (`XTR`), which is required for digital goods and services sold inside Telegram. It does not collect card details or use a card-provider token.

## Before you start

1. Create a bot with [@BotFather](https://t.me/BotFather) and enable 2-step verification on its owner account.
2. Deploy this project to a host with a public HTTPS domain. Telegram cannot call a webhook at `localhost`.
3. Copy `.env.example` to `.env` and replace every placeholder. Never commit `.env` or share your bot token.
4. Put the digital file to deliver in `content/` and set `PRODUCT_DELIVERY_FILE` to its path. The directory is intentionally ignored by Git.
5. Write real customer-support, refund, and terms text in `.env` before accepting payment.

## Run it

Use Node 22.13 or newer. There are no third-party packages to install.

```powershell
Copy-Item .env.example .env
node server.mjs
```

After the site is live at the HTTPS `PUBLIC_BASE_URL`, register the webhook once:

```powershell
node setup-webhook.mjs
```

Open `https://your-domain.example` and use **Open @YourShopBot**. The bot will send a unique invoice. Do not share the bot token, webhook secret, or `.env` file.

## What the server verifies

- The webhook includes Telegram’s configured secret token.
- The invoice payload maps to a locally stored order, payer, `XTR` currency, and expected Stars amount.
- The pre-checkout query is answered only after validation.
- The file is delivered only after a `successful_payment` update.
- Telegram’s payment charge ID is saved in SQLite, and duplicate webhook deliveries do not resend the item.

If Telegram has confirmed a payment but file delivery has a transient failure, the bot preserves the payment record and directs the buyer to `/support`; it does not reprocess a confirmed payment.

`data/orders.sqlite` is appropriate for one server instance. For multiple instances or serverless hosting, replace `orders.mjs` with a shared, transactional database before launch.

## Important scope

This implementation is for digital goods. For physical goods or services, use a Telegram-supported third-party payment provider, obtain its provider token through BotFather, and add shipping/order-fulfilment logic. Telegram’s official payment guidance: [digital goods and Stars](https://core.telegram.org/bots/payments-stars) and [physical goods/services](https://core.telegram.org/bots/payments).
