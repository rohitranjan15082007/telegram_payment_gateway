const openButtons = [document.getElementById('openTelegram'), document.getElementById('chatPay')];
const status = document.getElementById('launchStatus');

function setEnabled(buttons, enabled) {
  buttons.forEach((button) => { button.disabled = !enabled; });
}

async function loadShop() {
  try {
    const response = await fetch('/api/public-config', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Shop is not configured');
    const shop = await response.json();
    document.getElementById('botName').textContent = `@${shop.botUsername}`;
    document.getElementById('invoiceTitle').textContent = shop.product.title;
    document.getElementById('invoiceDescription').textContent = shop.product.description;
    document.getElementById('invoicePrice').textContent = `${shop.product.priceStars} Stars`;
    const checkoutUrl = `https://t.me/${encodeURIComponent(shop.botUsername)}?start=${encodeURIComponent(`buy_${shop.product.key}`)}`;
    openButtons.forEach((button) => button.addEventListener('click', () => window.location.assign(checkoutUrl)));
    setEnabled(openButtons, true);
    openButtons[0].innerHTML = `Open @${shop.botUsername} <span>→</span>`;
    status.textContent = `Checkout opens securely in Telegram · ${shop.product.priceStars} Stars`;
    status.classList.add('ready');
  } catch {
    status.textContent = 'This shop is not connected yet. Add the server configuration before sharing this page.';
    status.classList.add('warning');
  }
}

loadShop();
