const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const root = __dirname;
const publicDir = path.join(root, 'public');
const cardsPath = path.join(root, 'data', 'cards.json');
const dbPath = path.join(root, 'data', 'db.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

async function readCards() {
  return JSON.parse(await fs.readFile(cardsPath, 'utf-8'));
}

async function readDb() {
  return JSON.parse(await fs.readFile(dbPath, 'utf-8'));
}

async function writeDb(db) {
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2), 'utf-8');
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
  });
  res.end(JSON.stringify(body));
}

function validateCartItem(payload) {
  if (!payload || typeof payload.cardId !== 'string') return 'cardId обязателен';
  if (!Number.isInteger(payload.qty) || payload.qty < 1 || payload.qty > 30) {
    return 'qty должен быть целым числом от 1 до 30';
  }
  return null;
}

function validateOrder(payload) {
  if (!payload || typeof payload !== 'object') return 'Неверное тело запроса';
  const c = payload.customer;
  if (!c || typeof c.name !== 'string' || c.name.length < 2) return 'Некорректное имя';
  if (!c.email || !String(c.email).includes('@')) return 'Некорректный email';
  if (!c.address || c.address.length < 8) return 'Некорректный адрес';

  if (payload.items !== undefined) {
    if (!Array.isArray(payload.items)) return 'items должен быть массивом';
    for (const item of payload.items) {
      const err = validateCartItem(item);
      if (err) return `items: ${err}`;
    }
  }
  return null;
}

function withCardData(items, cards) {
  return items
    .map((item) => {
      const card = cards.find((c) => c.id === item.cardId);
      if (!card) return null;
      return {
        cardId: item.cardId,
        qty: item.qty,
        card,
        lineTotal: Number((card.price * item.qty).toFixed(2))
      };
    })
    .filter(Boolean);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(urlPath, res) {
  let filePath = path.join(publicDir, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    const ext = path.extname(filePath);
    const content = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname, searchParams } = url;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
    });
    res.end();
    return;
  }

  try {
    if (pathname === '/api/meta' && req.method === 'GET') {
      const cards = await readCards();
      const types = [...new Set(cards.map((c) => c.type))].sort();
      const rarities = [...new Set(cards.map((c) => c.rarity))].sort();
      return sendJson(res, 200, { types, rarities });
    }

    if (pathname === '/api/cards' && req.method === 'GET') {
      const cards = await readCards();
      const search = (searchParams.get('search') || '').toLowerCase();
      const type = searchParams.get('type') || '';
      const rarity = searchParams.get('rarity') || '';
      const sort = searchParams.get('sort') || 'featured';
      const minPrice = Number(searchParams.get('minPrice') || 0);
      const maxPrice = Number(searchParams.get('maxPrice') || Number.MAX_SAFE_INTEGER);
      const page = Math.max(1, Number(searchParams.get('page') || 1));
      const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || 12)));

      let items = cards.filter((card) => {
        const matchesSearch = card.name.toLowerCase().includes(search);
        const matchesType = !type || card.type === type;
        const matchesRarity = !rarity || card.rarity === rarity;
        const matchesPrice = card.price >= minPrice && card.price <= maxPrice;
        return matchesSearch && matchesType && matchesRarity && matchesPrice;
      });

      if (sort === 'price_asc') items.sort((a, b) => a.price - b.price);
      if (sort === 'price_desc') items.sort((a, b) => b.price - a.price);
      if (sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name));

      const total = items.length;
      items = items.slice((page - 1) * limit, page * limit);
      return sendJson(res, 200, { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    }

    if (pathname.startsWith('/api/cards/') && req.method === 'GET') {
      const cardId = pathname.split('/').pop();
      const cards = await readCards();
      const card = cards.find((c) => c.id === cardId);
      if (!card) return sendJson(res, 404, { error: 'Карта не найдена' });
      return sendJson(res, 200, card);
    }

    if (pathname === '/api/cart' && req.method === 'GET') {
      const [db, cards] = await Promise.all([readDb(), readCards()]);
      const items = withCardData(db.cart, cards);
      const total = Number(items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
      return sendJson(res, 200, { items, total });
    }

    if (pathname === '/api/cart' && req.method === 'POST') {
      const payload = await parseBody(req);
      const err = validateCartItem(payload);
      if (err) return sendJson(res, 400, { error: err });

      const [db, cards] = await Promise.all([readDb(), readCards()]);
      const card = cards.find((c) => c.id === payload.cardId);
      if (!card) return sendJson(res, 404, { error: 'Карта не найдена' });

      const existing = db.cart.find((i) => i.cardId === payload.cardId);
      const nextQty = (existing?.qty || 0) + payload.qty;
      if (nextQty > card.stock) return sendJson(res, 409, { error: `Доступно только ${card.stock} шт.` });

      if (existing) existing.qty = nextQty;
      else db.cart.push(payload);

      await writeDb(db);
      return sendJson(res, 201, { message: 'Товар добавлен в корзину' });
    }

    if (pathname.startsWith('/api/cart/') && req.method === 'PATCH') {
      const cardId = pathname.split('/').pop();
      const payload = await parseBody(req);
      const qty = Number(payload.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 30) return sendJson(res, 400, { error: 'qty должен быть целым числом от 1 до 30' });

      const [db, cards] = await Promise.all([readDb(), readCards()]);
      const item = db.cart.find((i) => i.cardId === cardId);
      if (!item) return sendJson(res, 404, { error: 'Товар не найден в корзине' });

      const card = cards.find((c) => c.id === cardId);
      if (!card) return sendJson(res, 404, { error: 'Карта не найдена' });
      if (qty > card.stock) return sendJson(res, 409, { error: `Доступно только ${card.stock} шт.` });

      item.qty = qty;
      await writeDb(db);
      return sendJson(res, 200, { message: 'Количество обновлено' });
    }

    if (pathname.startsWith('/api/cart/') && req.method === 'DELETE') {
      const cardId = pathname.split('/').pop();
      const db = await readDb();
      db.cart = db.cart.filter((i) => i.cardId !== cardId);
      await writeDb(db);
      return sendJson(res, 200, { message: 'Товар удален из корзины' });
    }

    if (pathname === '/api/orders' && req.method === 'POST') {
      const payload = await parseBody(req);
      const validationError = validateOrder(payload);
      if (validationError) return sendJson(res, 400, { error: validationError });

      const [db, cards] = await Promise.all([readDb(), readCards()]);
      const orderItems = payload.items?.length ? payload.items : db.cart;
      if (!orderItems.length) return sendJson(res, 400, { error: 'Корзина пуста' });

      for (const item of orderItems) {
        const card = cards.find((c) => c.id === item.cardId);
        if (!card) return sendJson(res, 404, { error: `Карта ${item.cardId} не найдена` });
        if (item.qty > card.stock) return sendJson(res, 409, { error: `Недостаточно ${card.name}. В наличии ${card.stock}` });
      }

      orderItems.forEach((item) => {
        const card = cards.find((c) => c.id === item.cardId);
        card.stock -= item.qty;
      });

      const total = Number(withCardData(orderItems, cards).reduce((sum, i) => sum + i.lineTotal, 0).toFixed(2));
      const order = {
        id: `ord-${Date.now()}`,
        createdAt: new Date().toISOString(),
        customer: payload.customer,
        items: orderItems,
        total,
        status: 'confirmed'
      };

      db.orders.unshift(order);
      db.cart = [];
      await Promise.all([
        fs.writeFile(cardsPath, JSON.stringify(cards, null, 2), 'utf-8'),
        writeDb(db)
      ]);

      return sendJson(res, 201, { message: 'Заказ успешно оформлен', order });
    }

    if (pathname === '/api/orders' && req.method === 'GET') {
      const db = await readDb();
      return sendJson(res, 200, { items: db.orders });
    }

    if (!pathname.startsWith('/api/')) return serveStatic(pathname, res);
    sendJson(res, 404, { error: 'Маршрут не найден' });
  } catch (error) {
    sendJson(res, 500, { error: 'Внутренняя ошибка сервера', details: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Pokemon store running on http://localhost:${PORT}`);
});
