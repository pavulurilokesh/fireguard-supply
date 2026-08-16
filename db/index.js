const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'fireguard.db');

// Ensure the directory for the database file actually exists before opening it.
// On platforms like Railway, this is usually a mounted volume (e.g. /data) —
// if the volume isn't attached yet or DB_PATH points somewhere unexpected,
// this creates the folder instead of crashing with ERR_SQLITE_ERROR.
const dbDir = path.dirname(DB_PATH);
fs.mkdirSync(dbDir, { recursive: true });

const raw = new DatabaseSync(DB_PATH);
raw.exec('PRAGMA journal_mode = WAL');
raw.exec('PRAGMA foreign_keys = ON');

// Run schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
raw.exec(schema);

// --- thin wrapper so the rest of the app can use a better-sqlite3-like API
// (db.prepare(sql).get/all/run, plus a transaction() helper), while the
// underlying driver stays Node's built-in, zero-native-dependency node:sqlite.
const db = {
  prepare(sql) {
    const stmt = raw.prepare(sql);
    return {
      get: (...params) => stmt.get(...params),
      all: (...params) => stmt.all(...params),
      run: (...params) => {
        const info = stmt.run(...params);
        return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
      }
    };
  },
  exec(sql) {
    return raw.exec(sql);
  },
  // Runs `fn` inside BEGIN/COMMIT, rolling back on any thrown error.
  // Mirrors the ergonomics of better-sqlite3's db.transaction(fn).
  transaction(fn) {
    return (...args) => {
      raw.exec('BEGIN');
      try {
        const result = fn(...args);
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    };
  }
};

// Seed an admin account on first run (only if no users exist yet)
function seedSync() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    const adminUser = process.env.SEED_ADMIN_USERNAME || 'admin';
    const adminPass = process.env.SEED_ADMIN_PASSWORD || 'admin123';
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(adminUser, hash, 'admin');
    console.log(`Seeded admin account "${adminUser}". Change the password after first login!`);
  }

  const productCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  if (productCount === 0) {
    const seedProducts = [
      ['FE-ABC-5KG', 'ABC Dry Powder Extinguisher 5kg', 'extinguisher', 54.99, 42, 'Multi-purpose dry powder extinguisher rated for Class A, B & C fires.'],
      ['FE-CO2-2KG', 'CO2 Extinguisher 2kg', 'extinguisher', 61.50, 18, 'Clean-agent CO2 extinguisher, ideal for electrical fire risk areas.'],
      ['FE-FOAM-6L', 'Foam Spray Extinguisher 6L', 'extinguisher', 58.00, 0, 'AFFF foam extinguisher for Class A & B fires.'],
      ['SA-ION-100', 'Ionisation Smoke Alarm', 'alarm', 14.25, 120, 'Battery powered ionisation smoke alarm, 10-year sensor life.'],
      ['SA-OPT-200', 'Optical Smoke Alarm', 'alarm', 17.75, 8, 'Photoelectric smoke alarm, reduced false alarms from cooking fumes.'],
      ['HA-HEAT-50', 'Heat Alarm - Kitchen Rated', 'alarm', 19.99, 35, 'Fixed-temperature heat alarm designed for kitchens and garages.'],
      ['FH-30M-LAY', 'Fire Hose 30m Layflat', 'hose', 210.00, 6, '30 metre layflat fire hose with coupling, 45mm diameter.'],
      ['FH-REEL-25', 'Fire Hose Reel 25m', 'hose', 340.00, 3, 'Wall-mounted swing hose reel with automatic shut-off nozzle.'],
      ['SP-HEAD-68', 'Sprinkler Head 68°C Pendant', 'sprinkler', 8.40, 200, 'Standard response pendant sprinkler head, glass bulb type.'],
      ['SP-VALVE-4', 'Sprinkler Alarm Valve 4in', 'sprinkler', 410.00, 2, 'Wet alarm check valve for fire sprinkler risers.'],
      ['PPE-JKT-XL', 'Firefighter Turnout Jacket XL', 'ppe', 295.00, 11, 'NFPA-compliant structural firefighting jacket, moisture barrier lining.'],
      ['PPE-GLV-L', 'Heat Resistant Gloves (Pair)', 'ppe', 38.50, 60, 'Kevlar-lined gloves rated to 350°C for structural fire response.'],
      ['PPE-HLM-01', 'Structural Fire Helmet', 'ppe', 189.00, 4, 'Composite shell helmet with integrated visor and chin strap.'],
      ['HY-STD-BR', 'Standpipe Fire Hydrant - Brass', 'hydrant', 520.00, 5, 'Above-ground standpipe hydrant, dual outlet, brass fitting.'],
      ['HY-WKEY-01', 'Hydrant Standpipe Key & Bar', 'hydrant', 44.00, 25, 'Standard fire brigade standpipe key and bar set.']
    ];
    const insert = db.prepare('INSERT INTO products (sku, name, category, price, stock, description) VALUES (?, ?, ?, ?, ?, ?)');
    const insertMany = db.transaction((rows) => rows.forEach(r => insert.run(...r)));
    insertMany(seedProducts);
    console.log(`Seeded ${seedProducts.length} products.`);
  }
}
// Runs the (synchronous, potentially slow-on-a-mounted-volume) seed logic
// off the main require() chain via setImmediate/queueMicrotask semantics,
// so importing this module never blocks server startup. Callers should
// await initializeDb() before relying on seeded data being present, but
// the module itself, its exports, and the underlying connection are all
// ready to use synchronously as soon as require('./db') returns.
let initPromise = null;
function initializeDb() {
  if (!initPromise) {
    initPromise = new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          seedSync();
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }
  return initPromise;
}

module.exports = db;
module.exports.initializeDb = initializeDb;

