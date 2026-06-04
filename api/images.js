// /api/images.js  —  Trae las imágenes de un inmueble: GET /api/images?id=123
// Proxy a CRM RED GET /properties/{id}/images con caché en memoria (60 min)
// para no saturar el rate limit (60 req/min).

const BASE = "https://crmred.co/api/external/v1";
const CACHE = new Map();          // id -> { at, urls }
const TTL = 60 * 60 * 1000;       // 60 min

function headers() {
  return {
    "X-Api-Key": process.env.CRMRED_API_KEY || "",
    "X-Api-Secret": process.env.CRMRED_API_SECRET || "",
    "Accept": "application/json",
  };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    if (!process.env.CRMRED_API_KEY || !process.env.CRMRED_API_SECRET) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: "Faltan variables de entorno." }));
    }
    const m = (req.url || "").match(/[?&]id=(\d+)/);
    const id = m && m[1];
    if (!id) { res.statusCode = 422; return res.end(JSON.stringify({ ok: false, error: "Falta id" })); }

    const now = Date.now();
    const hit = CACHE.get(id);
    if (hit && now - hit.at < TTL) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.end(JSON.stringify({ ok: true, id: Number(id), images: hit.urls }));
    }

    const r = await fetch(`${BASE}/properties/${id}/images`, { headers: headers() });
    if (!r.ok) {
      // 429 u otros: devolvemos vacío sin romper la UI
      res.setHeader("X-Cache", "MISS");
      return res.end(JSON.stringify({ ok: true, id: Number(id), images: [], note: "crm " + r.status }));
    }
    const data = await r.json().catch(() => ({}));
    const arr = data.data || data.images || [];
    const urls = arr
      .map((i) => (typeof i === "string" ? i : i.url || i.src || i.image || i.path || ""))
      .filter(Boolean);

    CACHE.set(id, { at: now, urls });
    res.setHeader("X-Cache", "MISS");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.end(JSON.stringify({ ok: true, id: Number(id), images: urls }));
  } catch (e) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: e.message }));
  }
};
