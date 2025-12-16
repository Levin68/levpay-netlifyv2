const axios = require("axios");
const { loadDb, saveDb } = require("../../lib/github");
const {
  ensureDbShape,
  getDeviceKey,
  applyDiscount,
  recordPromoUsage,
  adminUpsertCustomPromo,
  adminSetMonthlyPromo,
} = require("../../lib/voucher");

const VPS_BASE = process.env.VPS_BASE || "http://82.27.2.229:5021";
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const DEVICE_PEPPER = process.env.DEVICE_PEPPER || "c98e5480457017e9b604ed077350fb53ecfac0ee3c73fc6538610596a295";

const GH_OWNER = process.env.GH_OWNER || "";
const GH_REPO = process.env.GH_REPO || "";
const GH_BRANCH = process.env.GH_BRANCH || "main";
const GH_PATH = process.env.GH_PATH || "database.json";
const GH_TOKEN = process.env.GH_TOKEN || "";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Callback-Secret, X-Admin-Key",
    "Cache-Control": "no-store",
  };
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

function baseUrlFromEvent(event) {
  const proto = (event.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = event.headers["x-forwarded-host"] || event.headers.host;
  return `${proto}://${host}`;
}

function requireCallbackSecret(event) {
  if (!CALLBACK_SECRET) return true;
  const got =
    (event.headers["x-callback-secret"] || "").toString().trim() ||
    (event.headers.authorization || "").toString().replace(/^Bearer\s+/i, "").trim();
  return got === CALLBACK_SECRET;
}

function requireAdmin(event) {
  if (!ADMIN_KEY) return false;
  const got =
    (event.headers["x-admin-key"] || "").toString().trim() ||
    (event.headers.authorization || "").toString().replace(/^Bearer\s+/i, "").trim();
  return got === ADMIN_KEY;
}

function requireGhEnv() {
  return GH_OWNER && GH_REPO && GH_BRANCH && GH_PATH && GH_TOKEN;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders(), body: "" };

  const qs = event.queryStringParameters || {};
  const action = String(qs.action || "").toLowerCase().trim();
  const baseUrl = baseUrlFromEvent(event);

  if (!action || action === "ping") {
    return json(200, {
      success: true,
      service: "levpay-netlify-proxy",
      vps: VPS_BASE,
      routes: [
        "POST /api/orkut?action=createqr",
        "GET  /api/orkut?action=status&idTransaksi=...",
        "POST /api/orkut?action=cancel",
        "GET  /api/orkut?action=qr&idTransaksi=...",
        "POST /api/orkut?action=setstatus",
        "POST /api/orkut?action=admin_setpromo",
        "POST /api/orkut?action=admin_setmonthly",
        "GET  /api/orkut?action=admin_promos",
      ],
    });
  }

  if (action === "admin_promos") {
    if (!requireAdmin(event)) return json(401, { success: false, error: "Unauthorized" });
    if (!requireGhEnv()) return json(500, { success: false, error: "GitHub env missing" });

    try {
      const { db } = await loadDb({ owner: GH_OWNER, repo: GH_REPO, branch: GH_BRANCH, path: GH_PATH, token: GH_TOKEN });
      const safe = ensureDbShape(db);
      return json(200, { success: true, data: { monthly: safe.promos.monthly, custom: safe.promos.custom } });
    } catch (e) {
      return json(500, { success: false, error: e.message || "admin_promos error" });
    }
  }

  if (action === "admin_setpromo") {
    if (event.httpMethod !== "POST") return json(405, { success: false, error: "Method Not Allowed" });
    if (!requireAdmin(event)) return json(401, { success: false, error: "Unauthorized" });
    if (!requireGhEnv()) return json(500, { success: false, error: "GitHub env missing" });

    try {
      const body = parseBody(event);
      const { code, percent, fixed, expiresAt, active } = body || {};

      const loaded = await loadDb({ owner: GH_OWNER, repo: GH_REPO, branch: GH_BRANCH, path: GH_PATH, token: GH_TOKEN });
      let db = ensureDbShape(loaded.db);

      db = adminUpsertCustomPromo(db, { code, percent, fixed, expiresAt, active });
      db.updatedAt = new Date().toISOString();

      await saveDb({
        owner: GH_OWNER,
        repo: GH_REPO,
        branch: GH_BRANCH,
        path: GH_PATH,
        token: GH_TOKEN,
        db,
        sha: loaded.sha,
        message: `admin upsert promo ${String(code || "").toUpperCase()}`,
      });

      return json(200, { success: true, data: db.promos.custom[String(code || "").toUpperCase()] });
    } catch (e) {
      return json(500, { success: false, error: e.message || "admin_setpromo error" });
    }
  }

  if (action === "admin_setmonthly") {
    if (event.httpMethod !== "POST") return json(405, { success: false, error: "Method Not Allowed" });
    if (!requireAdmin(event)) return json(401, { success: false, error: "Unauthorized" });
    if (!requireGhEnv()) return json(500, { success: false, error: "GitHub env missing" });

    try {
      const body = parseBody(event);
      const { percent, fixed, active } = body || {};

      const loaded = await loadDb({ owner: GH_OWNER, repo: GH_REPO, branch: GH_BRANCH, path: GH_PATH, token: GH_TOKEN });
      let db = ensureDbShape(loaded.db);

      db = adminSetMonthlyPromo(db, { percent, fixed, active });
      db.updatedAt = new Date().toISOString();

      await saveDb({
        owner: GH_OWNER,
        repo: GH_REPO,
        branch: GH_BRANCH,
        path: GH_PATH,
        token: GH_TOKEN,
        db,
        sha: loaded.sha,
        message: "admin set monthly promo",
      });

      return json(200, { success: true, data: db.promos.monthly });
    } catch (e) {
      return json(500, { success: false, error: e.message || "admin_setmonthly error" });
    }
  }

  if (action === "createqr") {
    if (event.httpMethod !== "POST") return json(405, { success: false, error: "Method Not Allowed" });

    const body = parseBody(event);
    const amount = Number(body.amount);
    const theme = body.theme === "theme2" ? "theme2" : "theme1";
    const deviceId = String(body.deviceId || "").trim();
    const promoCode = String(body.promoCode || "").trim();

    if (!Number.isFinite(amount) || amount < 1) return json(400, { success: false, error: "amount invalid" });

    if (!requireGhEnv()) return json(500, { success: false, error: "GitHub env missing" });

    try {
      const loaded = await loadDb({ owner: GH_OWNER, repo: GH_OWNER ? GH_REPO : "", branch: GH_BRANCH, path: GH_PATH, token: GH_TOKEN });
      let db = ensureDbShape(loaded.db);

      const deviceKey = deviceId ? getDeviceKey(deviceId, DEVICE_PEPPER) : null;

      const discRes = applyDiscount(db, { amount, deviceKey, promoCode: promoCode || null });
      if (!discRes.ok) {
        return json(400, { success: false, error: discRes.reason || "PROMO_REJECTED" });
      }

      const finalAmount = discRes.amount;
      const discount = discRes.discount;

      const r = await axios.post(
        `${VPS_BASE}/api/createqr`,
        { amount: finalAmount, theme },
        { timeout: 20000, validateStatus: () => true, headers: { "Content-Type": "application/json" } }
      );

      const data = r.data;
      if (r.status !== 200) return json(r.status, { success: false, error: "VPS createqr failed", provider: data });

      const idTransaksi = data?.data?.idTransaksi || data?.idTransaksi;
      const vpsQrPngUrl = data?.data?.qrPngUrl || data?.qrPngUrl || (idTransaksi ? `/api/qr/${idTransaksi}.png` : null);

      const qrUrl = idTransaksi
        ? `${baseUrl}/api/orkut?action=qr&idTransaksi=${encodeURIComponent(idTransaksi)}`
        : null;

      if (idTransaksi) {
        db = recordPromoUsage(db, {
          deviceKey,
          promoType: discRes.promoType,
          promoCode: discRes.promoCode,
          monthKey: discRes.monthKey,
        });

        db.tx[idTransaksi] = {
          deviceKey,
          deviceId: deviceId || null,
          originalAmount: amount,
          amount: finalAmount,
          discount,
          promoType: discRes.promoType,
          promoCode: discRes.promoCode,
          createdAt: new Date().toISOString(),
        };

        db.updatedAt = new Date().toISOString();

        await saveDb({
          owner: GH_OWNER,
          repo: GH_REPO,
          branch: GH_BRANCH,
          path: GH_PATH,
          token: GH_TOKEN,
          db,
          sha: loaded.sha,
          message: `tx ${idTransaksi}`,
        });
      }

      return json(200, {
        ...data,
        data: {
          ...(data?.data || {}),
          idTransaksi,
          qrUrl,
          qrVpsUrl: idTransaksi && vpsQrPngUrl ? `${VPS_BASE}${vpsQrPngUrl}` : null,
          originalAmount: amount,
          finalAmount,
          discount,
          promoType: discRes.promoType,
          promoCode: discRes.promoCode,
        },
      });
    } catch (e) {
      return json(500, { success: false, error: e.message || "createqr error" });
    }
  }

  if (action === "status") {
    if (event.httpMethod !== "GET") return json(405, { success: false, error: "Method Not Allowed" });

    const idTransaksi = String(qs.idTransaksi || "").trim();
    if (!idTransaksi) return json(400, { success: false, error: "idTransaksi required" });

    try {
      const r = await axios.get(`${VPS_BASE}/api/status?idTransaksi=${encodeURIComponent(idTransaksi)}`, {
        timeout: 15000,
        validateStatus: () => true,
      });

      return json(r.status, r.data);
    } catch (e) {
      return json(500, { success: false, error: e.message || "status error" });
    }
  }

  if (action === "cancel") {
    if (event.httpMethod !== "POST") return json(405, { success: false, error: "Method Not Allowed" });

    const body = parseBody(event);
    const idTransaksi = String(body.idTransaksi || qs.idTransaksi || "").trim();
    if (!idTransaksi) return json(400, { success: false, error: "idTransaksi required" });

    try {
      const r = await axios.post(
        `${VPS_BASE}/api/cancel`,
        { idTransaksi },
        { timeout: 15000, validateStatus: () => true, headers: { "Content-Type": "application/json" } }
      );
      return json(r.status, r.data);
    } catch (e) {
      return json(500, { success: false, error: e.message || "cancel error" });
    }
  }

  if (action === "qr") {
    if (event.httpMethod !== "GET") return json(405, { success: false, error: "Method Not Allowed" });

    const idTransaksi = String(qs.idTransaksi || "").trim();
    if (!idTransaksi) return json(400, { success: false, error: "idTransaksi required" });

    try {
      const r = await axios.get(`${VPS_BASE}/api/qr/${encodeURIComponent(idTransaksi)}.png`, {
        responseType: "arraybuffer",
        timeout: 20000,
        validateStatus: () => true,
      });

      if (r.status !== 200) return json(r.status, { success: false, error: "QR not found on VPS" });

      const b64 = Buffer.from(r.data).toString("base64");
      return {
        statusCode: 200,
        headers: { ...corsHeaders(), "Content-Type": "image/png" },
        body: b64,
        isBase64Encoded: true,
      };
    } catch (e) {
      return json(500, { success: false, error: e.message || "qr error" });
    }
  }

  if (action === "setstatus") {
    if (event.httpMethod !== "POST") return json(405, { success: false, error: "Method Not Allowed" });
    if (!requireCallbackSecret(event)) return json(401, { success: false, error: "Unauthorized" });

    const body = parseBody(event);
    const { idTransaksi, status, paidAt, note, paidVia } = body || {};
    if (!idTransaksi || !status) return json(400, { success: false, error: "idTransaksi & status required" });

    try {
      const r = await axios.post(
        `${VPS_BASE}/api/status`,
        { idTransaksi, status, paidAt, note, paidVia },
        { timeout: 15000, validateStatus: () => true, headers: { "Content-Type": "application/json" } }
      );
      return json(r.status, r.data);
    } catch (e) {
      return json(500, { success: false, error: e.message || "setstatus error" });
    }
  }

  return json(404, { success: false, error: "Unknown action", hint: "action=createqr|status|cancel|qr|setstatus|admin_setpromo|admin_setmonthly|admin_promos" });
};
