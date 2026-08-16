# FireGuard Supply Co. — Backend Edition

A fire safety equipment ordering app with a **real backend**: hashed passwords, signed login sessions, and a persistent SQLite database. This replaces the front-end-only prototype with something you can actually run as a service and trust with real accounts.

## What's real now

| | Prototype | This version |
|---|---|---|
| Passwords | stored in plain text in the browser | hashed with **bcrypt**, never stored or logged in plain text |
| Sessions | none | signed **JWT** tokens, 7-day expiry |
| Data | browser-side key/value storage | **SQLite** database file on disk (`fireguard.db`), via Node's built-in `node:sqlite` — no native module to compile |
| Stock control | client trusts itself | server checks stock and decrements it **inside a database transaction**, so two people can't both buy the last item |
| Admin actions | anyone could open dev tools and call the functions | every write endpoint checks a valid admin token **on the server** |
| Rate limiting | none | basic limiter on login/signup to slow down brute-force attempts |
| Tests | none | a smoke test script exercises the full flow, and runs in CI on every push |

## Project structure

```
fireguard-backend/
├── server.js              # Express app entrypoint
├── db/
│   ├── schema.sql          # table definitions
│   └── index.js            # opens the DB, runs schema, seeds admin + demo products
├── middleware/
│   └── auth.js              # JWT verification + admin guard
├── routes/
│   ├── auth.js               # signup, login, /me
│   ├── products.js           # catalog CRUD
│   └── orders.js              # checkout + order history
├── public/
│   └── index.html              # the front-end (calls the API with fetch)
├── scripts/
│   └── smoke-test.js            # end-to-end check of the whole flow
├── .github/workflows/ci.yml     # runs the smoke test on every push/PR
├── .env.example
├── LICENSE
└── package.json
```

## Setup

**Requirements:** Node.js **22.5 or later** (the app uses Node's built-in `node:sqlite` module — no native compilation, no `npm rebuild` headaches, and it's why there's no C++ toolchain requirement at all). Run `node -v` to check yours; on startup you'll see a one-line `ExperimentalWarning: SQLite is an experimental feature` — that's expected and harmless.

```bash
cd fireguard-backend
npm install
cp .env.example .env
```

Open `.env` and set:
- `JWT_SECRET` — a long random string. Generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` — the admin account created the *first* time the database is built. Change the password after your first login regardless.

Then start it:

```bash
npm start
```

Visit **http://localhost:3000**. The database file `fireguard.db` is created automatically on first run, seeded with the admin account and 15 sample products.

For local development with auto-restart on file changes: `npm run dev`.

## How auth works

- `POST /api/auth/signup` — creates a `customer` account. Passwords must be 8+ characters. The password is hashed with bcrypt before it touches the database.
- `POST /api/auth/login` — checks the hash, returns a JWT containing `{ id, username, role }`.
- The front end stores that token in `localStorage` and sends it as `Authorization: Bearer <token>` on every request.
- `middleware/auth.js` verifies the token on protected routes. `requireAdmin` additionally checks `role === 'admin'`.
- There's no public "become admin" endpoint — admin accounts are only created by seeding or by promoting a user directly in the database (see below).

## API reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | — | Create a customer account |
| POST | `/api/auth/login` | — | Log in, get a token |
| GET | `/api/auth/me` | any | Get the current user |
| GET | `/api/products` | — | List all products |
| GET | `/api/products/:id` | — | Get one product |
| POST | `/api/products` | admin | Add a product |
| PUT | `/api/products/:id` | admin | Update name/category/price/stock/description/sku |
| DELETE | `/api/products/:id` | admin | Delete a product (blocked if it appears in past orders — retire it by setting stock to 0 instead) |
| POST | `/api/orders` | any | Checkout: `{ items: [{ productId, qty }] }`. Stock is checked and decremented atomically. |
| GET | `/api/orders/mine` | any | Your own order history |
| GET | `/api/orders` | admin | Every order, across all customers |

## Testing & CI

`scripts/smoke-test.js` boots against the running server and walks through the real flow: health check, product listing, admin login, wrong-password rejection, unauthenticated/unauthorized write attempts, product creation, customer signup, checkout, stock decrement, oversell rejection, order history, and the delete-blocked-by-order-history case.

Run it yourself against a local server:
```bash
npm start &
npm test
```

`.github/workflows/ci.yml` runs the same script automatically on every push and pull request to `main`, against Node 22.x and 24.x, so a broken build gets caught before it's merged.

## Promoting a user to admin

There's intentionally no API for this (an "add admin" button that any customer could reach would be a real vulnerability). Do it directly against the database instead:

```bash
node -e "
const db = require('./db');
db.prepare(\"UPDATE users SET role='admin' WHERE username=?\").run('the_username');
console.log('done');
"
```

## Taking this to production

This is a solid, honest backend for a small catalog — but "production" also means:

- **HTTPS** in front of it (a reverse proxy like Caddy or nginx, or your hosting platform's built-in TLS).
- **A managed Postgres/MySQL database** instead of a single SQLite file once you have concurrent write load or need backups/replication beyond copying a file.
- **A real payment processor** (Stripe, etc.) — right now "Place Order" just records the order and decrements stock; no money moves.
- **Email verification** on signup, and a password-reset flow.
- **Stronger rate limiting** (the in-memory limiter here resets if the process restarts and won't work across multiple server instances — swap in Redis-backed limiting like `rate-limiter-flexible` at that point).
- **Structured logging & monitoring** so you know when something breaks.
- **Environment secrets** managed by your host (not committed `.env` files) — `.gitignore` already excludes `.env` and the `.db` files here.

## Notes on the demo data

On first run only, `db/index.js` seeds one admin account and 15 fire-safety products (extinguishers, alarms, hoses, sprinkler parts, PPE, hydrants) so the app isn't empty. Delete `fireguard.db` and restart to reseed from scratch.
