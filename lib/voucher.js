const crypto = require("crypto");

function wibMonthKey() {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" });
  return s.slice(0, 7);
}

function getDeviceKey(deviceId, pepper) {
  const id = String(deviceId || "").trim();
  if (!id) return null;
  return crypto.createHmac("sha256", String(pepper || "pepper")).update(id).digest("hex");
}

function normCode(code) {
  return String(code || "").trim().toUpperCase();
}

function ensureDbShape(db) {
  if (!db || typeof db !== "object") db = {};
  if (!db.devices || typeof db.devices !== "object") db.devices = {};
  if (!db.promos || typeof db.promos !== "object") db.promos = {};
  if (!db.promos.monthly || typeof db.promos.monthly !== "object") {
    db.promos.monthly = { active: true, percent: 10, fixed: 0 };
  }
  if (!db.promos.custom || typeof db.promos.custom !== "object") db.promos.custom = {};
  if (!db.tx || typeof db.tx !== "object") db.tx = {};
  return db;
}

function calcDiscount(amount, promo) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a < 1) return { discount: 0, finalAmount: a };

  let disc = 0;
  const percent = Number(promo?.percent || 0);
  const fixed = Number(promo?.fixed || 0);

  if (percent > 0) disc += Math.floor((a * percent) / 100);
  if (fixed > 0) disc += fixed;

  if (disc < 0) disc = 0;
  if (disc >= a) disc = Math.max(0, a - 1);

  return { discount: disc, finalAmount: a - disc };
}

function applyDiscount(db, { amount, deviceKey, promoCode }) {
  db = ensureDbShape(db);
  const a = Number(amount);
  const monthKey = wibMonthKey();

  const dev = deviceKey ? (db.devices[deviceKey] || {}) : {};
  if (!dev.customUsed || typeof dev.customUsed !== "object") dev.customUsed = {};

  const code = normCode(promoCode);

  if (code) {
    const p = db.promos.custom[code];
    if (!p || p.active === false) return { ok: false, reason: "PROMO_NOT_FOUND" };
    if (p.expiresAt && Date.now() > Date.parse(p.expiresAt)) return { ok: false, reason: "PROMO_EXPIRED" };
    if (!deviceKey) return { ok: false, reason: "DEVICE_REQUIRED" };
    if (dev.customUsed[code]) return { ok: false, reason: "PROMO_ALREADY_USED" };

    const { discount, finalAmount } = calcDiscount(a, p);
    return {
      ok: true,
      amount: finalAmount,
      discount,
      promoType: "custom",
      promoCode: code,
      device: dev,
      monthKey,
    };
  }

  const m = db.promos.monthly;
  if (m && m.active !== false && deviceKey) {
    const lastKey = dev.monthlyKey || null;
    if (lastKey !== monthKey) {
      const { discount, finalAmount } = calcDiscount(a, m);
      return {
        ok: true,
        amount: finalAmount,
        discount,
        promoType: "monthly",
        promoCode: null,
        device: dev,
        monthKey,
      };
    }
  }

  return {
    ok: true,
    amount: a,
    discount: 0,
    promoType: "none",
    promoCode: null,
    device: dev,
    monthKey,
  };
}

function recordPromoUsage(db, { deviceKey, promoType, promoCode, monthKey }) {
  db = ensureDbShape(db);
  if (!deviceKey) return db;

  const dev = db.devices[deviceKey] || {};
  if (!dev.customUsed || typeof dev.customUsed !== "object") dev.customUsed = {};

  if (promoType === "monthly") {
    dev.monthlyKey = monthKey;
  }
  if (promoType === "custom" && promoCode) {
    dev.customUsed[normCode(promoCode)] = new Date().toISOString();
  }

  db.devices[deviceKey] = dev;
  return db;
}

function adminUpsertCustomPromo(db, { code, percent, fixed, expiresAt, active }) {
  db = ensureDbShape(db);
  const c = normCode(code);
  if (!c) throw new Error("code required");

  db.promos.custom[c] = {
    active: active !== false,
    percent: Number(percent || 0),
    fixed: Number(fixed || 0),
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    updatedAt: new Date().toISOString(),
  };

  return db;
}

function adminSetMonthlyPromo(db, { percent, fixed, active }) {
  db = ensureDbShape(db);
  db.promos.monthly = {
    active: active !== false,
    percent: Number(percent || 0),
    fixed: Number(fixed || 0),
    updatedAt: new Date().toISOString(),
  };
  return db;
}

module.exports = {
  ensureDbShape,
  getDeviceKey,
  applyDiscount,
  recordPromoUsage,
  adminUpsertCustomPromo,
  adminSetMonthlyPromo,
};
