const catalogEl = document.getElementById('catalog');
const statsEl = document.getElementById('stats');
const searchInput = document.getElementById('searchInput');
const typeFilter = document.getElementById('typeFilter');
const rarityFilter = document.getElementById('rarityFilter');
const sortFilter = document.getElementById('sortFilter');
const cartButton = document.getElementById('cartButton');
const cartModal = document.getElementById('cartModal');
const closeCart = document.getElementById('closeCart');
const cartItems = document.getElementById('cartItems');
const cartTotal = document.getElementById('cartTotal');
const cartCount = document.getElementById('cartCount');
const checkoutForm = document.getElementById('checkoutForm');

const state = {
  cards: [],
  cart: { items: [], total: 0 }
};

function showError(error) {
  alert(error?.message || 'Произошла ошибка');
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

function cardTemplate(card) {
  return `
    <article class="card glass">
      <img src="${card.image}" alt="${card.name}">
      <div class="card-content">
        <h3>${card.name}</h3>
        <p class="price">$${card.price.toFixed(2)}</p>
        <div class="badges">
          <span class="badge">${card.type}</span>
          <span class="badge">${card.rarity}</span>
          <span class="badge">В наличии: ${card.stock}</span>
        </div>
        <button data-add="${card.id}">Добавить в корзину</button>
      </div>
    </article>
  `;
}

function renderCatalog(items) {
  statsEl.textContent = `Найдено карт: ${items.length}`;
  catalogEl.innerHTML = items.map(cardTemplate).join('');
}

function renderCart() {
  cartItems.innerHTML = state.cart.items.length
    ? state.cart.items
        .map(
          (item) => `
        <div class="cart-item">
          <div>
            <strong>${item.card.name}</strong><br>
            <small>${item.qty} × $${item.card.price.toFixed(2)}</small>
          </div>
          <button data-remove="${item.cardId}" class="secondary">Удалить</button>
        </div>`
        )
        .join('')
    : '<p>Корзина пуста</p>';

  cartTotal.textContent = `Итого: $${state.cart.total.toFixed(2)}`;
  cartCount.textContent = state.cart.items.reduce((sum, i) => sum + i.qty, 0);
}

async function loadFilters() {
  const meta = await api('/api/meta');
  for (const type of meta.types) typeFilter.insertAdjacentHTML('beforeend', `<option value="${type}">${type}</option>`);
  for (const rarity of meta.rarities)
    rarityFilter.insertAdjacentHTML('beforeend', `<option value="${rarity}">${rarity}</option>`);
}

async function loadCards() {
  const q = new URLSearchParams({
    search: searchInput.value,
    type: typeFilter.value,
    rarity: rarityFilter.value,
    sort: sortFilter.value,
    limit: '100'
  });
  const data = await api(`/api/cards?${q}`);
  state.cards = data.items;
  renderCatalog(state.cards);
}

async function loadCart() {
  state.cart = await api('/api/cart');
  renderCart();
}

async function addToCart(cardId) {
  await api('/api/cart', { method: 'POST', body: JSON.stringify({ cardId, qty: 1 }) });
  await loadCart();
}

catalogEl.addEventListener('click', async (e) => {
  const cardId = e.target.dataset.add;
  if (!cardId) return;
  try {
    await addToCart(cardId);
  } catch (error) {
    showError(error);
  }
});

cartItems.addEventListener('click', async (e) => {
  const cardId = e.target.dataset.remove;
  if (!cardId) return;
  try {
    await api(`/api/cart/${cardId}`, { method: 'DELETE' });
    await loadCart();
  } catch (error) {
    showError(error);
  }
});

[searchInput, typeFilter, rarityFilter, sortFilter].forEach((el) => {
  el.addEventListener('input', () => loadCards().catch(showError));
});

cartButton.addEventListener('click', () => cartModal.showModal());
closeCart.addEventListener('click', () => cartModal.close());

checkoutForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(checkoutForm);
  const customer = Object.fromEntries(formData.entries());

  try {
    const result = await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ customer })
    });
    alert(`Заказ оформлен! № ${result.order.id}`);
    checkoutForm.reset();
    cartModal.close();
    await Promise.all([loadCart(), loadCards()]);
  } catch (error) {
    showError(error);
  }
});

(async function init() {
  try {
    await Promise.all([loadFilters(), loadCards(), loadCart()]);
  } catch (error) {
    showError(error);
  }
})();
