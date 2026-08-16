/**
 * Basic smoke test for FireGuard Supply Co.
 *
 * Boots the server against a throwaway SQLite file, then exercises the
 * core flow: health check, product listing, admin login, add/update/delete
 * a product, customer signup, checkout, and stock enforcement.
 *
 * Not a substitute for a real test suite (e.g. Jest + supertest) — this is
 * meant to catch "the server doesn't even boot" / "auth is broken" level
 * regressions in CI without adding test framework dependencies.
 *
 * Run with: node scripts/smoke-test.js
 * (CI sets PORT, JWT_SECRET, DB_PATH, SEED_ADMIN_* via env before running this.)
 */

const BASE = `http://localhost:${process.env.PORT || 3000}/api`;

function assert(cond, message) {
  if (!cond) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`OK: ${message}`);
}

async function json(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  let body = null;
  try { body = await res.json(); } catch (e) { /* no body */ }
  return { status: res.status, body };
}

async function waitForServer(retries = 20) {
  for (let i = 0; i < retries; i++) {
    try {
      const { status } = await json('/health');
      if (status === 200) return;
    } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Server did not become healthy in time.');
}

async function main() {
  await waitForServer();

  const health = await json('/health');
  assert(health.status === 200 && health.body.ok === true, 'health check responds 200');

  const products = await json('/products');
  assert(products.status === 200 && Array.isArray(products.body.products), 'product list loads');
  assert(products.body.products.length > 0, 'seed products are present');

  const adminUser = process.env.SEED_ADMIN_USERNAME || 'admin';
  const adminPass = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const login = await json('/auth/login', { method: 'POST', body: JSON.stringify({ username: adminUser, password: adminPass }) });
  assert(login.status === 200 && login.body.token, 'admin can log in and receives a token');
  const adminToken = login.body.token;

  const badLogin = await json('/auth/login', { method: 'POST', body: JSON.stringify({ username: adminUser, password: 'definitely-wrong' }) });
  assert(badLogin.status === 401, 'wrong password is rejected with 401');

  const noAuthAdd = await json('/products', { method: 'POST', body: JSON.stringify({ sku: 'X', name: 'X', category: 'alarm', price: 1, stock: 1 }) });
  assert(noAuthAdd.status === 401, 'unauthenticated product creation is rejected with 401');

  const created = await json('/products', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ sku: `CI-TEST-${Date.now()}`, name: 'CI Smoke Test Beacon', category: 'alarm', price: 10, stock: 5, description: 'created by CI' })
  });
  assert(created.status === 201 && created.body.product, 'admin can create a product');
  const productId = created.body.product.id;

  const custUsername = `ci_customer_${Date.now()}`;
  const signup = await json('/auth/signup', { method: 'POST', body: JSON.stringify({ username: custUsername, password: 'password123' }) });
  assert(signup.status === 201 && signup.body.token, 'customer signup succeeds and returns a token');
  const custToken = signup.body.token;

  const forbidden = await json('/products', {
    method: 'POST',
    headers: { Authorization: `Bearer ${custToken}` },
    body: JSON.stringify({ sku: 'NOPE', name: 'NOPE', category: 'alarm', price: 1, stock: 1 })
  });
  assert(forbidden.status === 403, 'customer cannot create products (403)');

  const order = await json('/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${custToken}` },
    body: JSON.stringify({ items: [{ productId, qty: 2 }] })
  });
  assert(order.status === 201 && order.body.order.total === 20, 'checkout succeeds and totals correctly');

  const afterStock = await json(`/products/${productId}`);
  assert(afterStock.body.product.stock === 3, 'stock is decremented after checkout');

  const oversell = await json('/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${custToken}` },
    body: JSON.stringify({ items: [{ productId, qty: 999 }] })
  });
  assert(oversell.status === 409, 'ordering more than available stock is rejected (409)');

  const mine = await json('/orders/mine', { headers: { Authorization: `Bearer ${custToken}` } });
  assert(mine.status === 200 && mine.body.orders.length === 1, "customer's order history shows their order");

  const del = await json(`/products/${productId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } });
  assert(del.status === 409, 'deleting a product referenced by an order is blocked with a clear 409');

  console.log('\nAll smoke tests passed.');
}

main().catch((err) => {
  console.error('\nSmoke test failed:', err.message);
  process.exit(1);
});
