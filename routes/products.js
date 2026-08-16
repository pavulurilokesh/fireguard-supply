const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const CATEGORIES = ['extinguisher', 'alarm', 'hose', 'sprinkler', 'ppe', 'hydrant'];

// GET /api/products -> list all products (public, no login required to browse)
router.get('/', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY name ASC').all();
  res.json({ products });
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  res.json({ product });
});

// POST /api/products -> admin only, add a new product
router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { sku, name, category, price, stock, description } = req.body || {};

  if (typeof sku !== 'string' || !sku.trim()) return res.status(400).json({ error: 'SKU is required.' });
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Product name is required.' });
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: `Category must be one of: ${CATEGORIES.join(', ')}` });
  const priceNum = Number(price);
  const stockNum = Number(stock);
  if (!Number.isFinite(priceNum) || priceNum < 0) return res.status(400).json({ error: 'Price must be a non-negative number.' });
  if (!Number.isInteger(stockNum) || stockNum < 0) return res.status(400).json({ error: 'Stock must be a non-negative whole number.' });

  const existing = db.prepare('SELECT id FROM products WHERE sku = ?').get(sku.trim());
  if (existing) return res.status(409).json({ error: 'A product with that SKU already exists.' });

  const info = db.prepare(
    'INSERT INTO products (sku, name, category, price, stock, description) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(sku.trim(), name.trim(), category, priceNum, stockNum, (description || '').trim());

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ product });
});

// PUT /api/products/:id -> admin only, update any editable field (commonly price/stock)
router.put('/:id', requireAuth, requireAdmin, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });

  const { name, category, price, stock, description, sku } = req.body || {};
  const next = {
    name: typeof name === 'string' && name.trim() ? name.trim() : product.name,
    category: CATEGORIES.includes(category) ? category : product.category,
    price: price !== undefined ? Number(price) : product.price,
    stock: stock !== undefined ? Number(stock) : product.stock,
    description: description !== undefined ? String(description) : product.description,
    sku: typeof sku === 'string' && sku.trim() ? sku.trim() : product.sku
  };

  if (!Number.isFinite(next.price) || next.price < 0) return res.status(400).json({ error: 'Price must be a non-negative number.' });
  if (!Number.isInteger(next.stock) || next.stock < 0) return res.status(400).json({ error: 'Stock must be a non-negative whole number.' });

  db.prepare(
    `UPDATE products SET name=?, category=?, price=?, stock=?, description=?, sku=?, updated_at=datetime('now') WHERE id=?`
  ).run(next.name, next.category, next.price, next.stock, next.description, next.sku, req.params.id);

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json({ product: updated });
});

// DELETE /api/products/:id -> admin only
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  try {
    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    const isForeignKeyViolation =
      err.code === 'ERR_SQLITE_ERROR' && /FOREIGN KEY constraint failed/i.test(err.message);
    if (isForeignKeyViolation) {
      return res.status(409).json({
        error: 'This product appears in past orders and cannot be deleted. Set its stock to 0 to retire it instead.'
      });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not delete product.' });
  }
});

module.exports = router;
