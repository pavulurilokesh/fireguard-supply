const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// POST /api/orders -> checkout. body: { items: [{ productId, qty }] }
router.post('/', requireAuth, (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty.' });
  }

  const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
  const decrementStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
  const insertOrder = db.prepare('INSERT INTO orders (user_id, total) VALUES (?, ?)');
  const insertItem = db.prepare(
    'INSERT INTO order_items (order_id, product_id, name, sku, price, qty) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const placeOrder = db.transaction((userId, cartItems) => {
    let total = 0;
    const resolved = [];

    for (const raw of cartItems) {
      const qty = Number(raw.qty);
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new HttpError(400, 'Each item must have a positive whole quantity.');
      }
      const product = getProduct.get(raw.productId);
      if (!product) throw new HttpError(404, `Product ${raw.productId} no longer exists.`);
      if (product.stock < qty) {
        throw new HttpError(409, `Not enough stock for "${product.name}" (only ${product.stock} left).`);
      }
      resolved.push({ product, qty });
      total += product.price * qty;
    }

    const orderInfo = insertOrder.run(userId, total);
    const orderId = orderInfo.lastInsertRowid;

    for (const { product, qty } of resolved) {
      decrementStock.run(qty, product.id);
      insertItem.run(orderId, product.id, product.name, product.sku, product.price, qty);
    }

    return { orderId, total };
  });

  try {
    const { orderId, total } = placeOrder(req.user.id, items);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    res.status(201).json({ order: { ...order, items: orderItems } });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Could not place order.' });
  }
});

// GET /api/orders/mine -> current user's order history
router.get('/mine', requireAuth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  const withItems = orders.map(o => ({ ...o, items: itemsStmt.all(o.id) }));
  res.json({ orders: withItems });
});

// GET /api/orders -> admin only, all orders across all customers
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const orders = db.prepare(
    `SELECT orders.*, users.username FROM orders JOIN users ON users.id = orders.user_id ORDER BY orders.created_at DESC`
  ).all();
  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  const withItems = orders.map(o => ({ ...o, items: itemsStmt.all(o.id) }));
  res.json({ orders: withItems });
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = router;
