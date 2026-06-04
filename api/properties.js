// /api/properties.js  —  Proxy seguro a CRM RED (lista de inmuebles + agentes)
// Las credenciales se leen de variables de entorno (NUNCA en el cliente):
//   CRMRED_API_KEY, CRMRED_API_SECRET
// Cachea el resultado en memoria por 5 minutos para respetar el rate limit (60 req/min).

const BASE = "https://crmred.co/api/external/v1";
let CACHE = { at: 0, data: null };
const TTL = 5 * 60 * 1000; // 5 min

function headers() {
  return {
    "X-Api-Key": process.env.CRMRED_API_KEY || "",
    "X-Api-Secret": process.env.CRMRED_API_SECRET || "",
    "Accept": "application/json",
  };
}

async function getJSON(url) {
  const r = await fetch(url, { headers: headers() });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok) {
    const err = new Error("CRM RED " + r.status);
    err.status = r.status;
    err.body = json;
    throw err;
  }
  return json;
}

// nombre legible de un campo que puede venir como objeto / string / id
function nameOf(v) {
  if (v == null) return "";
  if (typeof v === "object") return v.name || v.nombre || v.tipo || v.titulo || "";
  return String(v);
}
function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function normalizeProperty(p, agentsById, typeMap, bizMap) {
  const imgs = (p.images || p.imagenes || p.fotos || [])
    .map((i) => (typeof i === "string" ? i : i.url || i.src || i.image))
    .filter(Boolean);

  let tipo = nameOf(p.tipo_inmueble);
  if (/^\d+$/.test(tipo) && typeMap[tipo]) tipo = typeMap[tipo];
  let negocio = nameOf(p.tipo_negocio);
  if (/^\d+$/.test(negocio) && bizMap[negocio]) negocio = bizMap[negocio];

  const agentId =
    p.agent_id || p.created_by ||
    (p.agent && p.agent.id) || (p.agente && p.agente.id) || null;
  let agent = p.agent || p.agente || (agentId && agentsById[agentId]) || null;
  if (agent) {
    agent = {
      id: agent.id,
      nombre: [agent.primer_nombre || agent.nombre, agent.primer_apellido || agent.apellido]
        .filter(Boolean).join(" ").trim() || "Asesor Emporio",
      celular: agent.celular_movil || agent.main_cell_phone || agent.celular || "",
      whatsapp: agent.celular_whatsapp || agent.whatsapp || agent.celular_movil || "",
      email: agent.email || agent.main_mail || "",
      foto: agent.foto || agent.avatar || agent.photo || "",
    };
  }

  return {
    id: p.id,
    slug: p.slug || String(p.id),
    titulo: p.titulo_inmueble || p.titulo || p.title || "Inmueble",
    tipo,
    negocio,
    ciudad: nameOf(p.ciudad || p.ciudad_nombre || p.ciudad_id),
    zona: nameOf(p.zona || p.zona_nombre || p.zona_id),
    barrio: nameOf(p.barrio || p.barrio_nombre || p.barrio_id),
    direccion: p.direccion || "",
    precioVenta: num(p.selling_price),
    precioArriendo: num(p.rental_price),
    habitaciones: num(p.habitaciones),
    banos: num(p.banos),
    garaje: num(p.garaje),
    areaConstruida: num(p.area_contruida || p.area_construida),
    areaLote: num(p.area_lote),
    estrato: num(p.estrato),
    descripcion: p.descripcion || "",
    lat: num(p.latitud),
    lng: num(p.longitud),
    video: p.url_video || "",
    imagenes: imgs,
    agente: agent,
    createdAt: p.created_at || null,
  };
}

async function buildPayload() {
  // catálogos (para resolver IDs -> nombres si hace falta)
  let typeMap = {}, bizMap = {};
  try {
    const t = await getJSON(`${BASE}/catalogs/property-types`);
    (t.data || []).forEach((x) => (typeMap[x.id] = x.tipo || x.name || x.nombre));
  } catch (e) {}
  try {
    const b = await getJSON(`${BASE}/catalogs/business-types`);
    (b.data || []).forEach((x) => (bizMap[x.id] = x.tipo || x.name || x.nombre));
  } catch (e) {}

  // agentes
  let agentsById = {};
  try {
    const a = await getJSON(`${BASE}/agents`);
    (a.data || []).forEach((ag) => (agentsById[ag.id] = ag));
  } catch (e) {}

  // inmuebles (paginado)
  let all = [];
  let page = 1;
  const MAX_PAGES = 15;
  while (page <= MAX_PAGES) {
    const res = await getJSON(`${BASE}/properties?per_page=100&page=${page}`);
    const block = res.data && res.data.data ? res.data.data : (res.data || []);
    if (!Array.isArray(block) || block.length === 0) break;
    all = all.concat(block);
    const lastPage = res.data && res.data.last_page ? res.data.last_page : page;
    if (page >= lastPage || block.length < 100) break;
    page++;
  }

  const properties = all.map((p) => normalizeProperty(p, agentsById, typeMap, bizMap));

  // opciones de filtro derivadas de los datos reales
  const uniq = (arr) => [...new Set(arr.filter((x) => x && !/^\d+$/.test(String(x))))].sort();
  const filters = {
    ciudades: uniq(properties.map((p) => p.ciudad)),
    tipos: uniq(properties.map((p) => p.tipo)),
    negocios: uniq(properties.map((p) => p.negocio)),
  };

  return { ok: true, count: properties.length, filters, properties };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    if (!process.env.CRMRED_API_KEY || !process.env.CRMRED_API_SECRET) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: "Faltan variables de entorno CRMRED_API_KEY / CRMRED_API_SECRET en Vercel." }));
    }
    const now = Date.now();
    if (CACHE.data && now - CACHE.at < TTL) {
      res.setHeader("X-Cache", "HIT");
      return res.end(JSON.stringify(CACHE.data));
    }
    const data = await buildPayload();
    CACHE = { at: now, data };
    res.setHeader("X-Cache", "MISS");
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.end(JSON.stringify(data));
  } catch (e) {
    res.statusCode = e.status || 500;
    return res.end(JSON.stringify({ ok: false, error: e.message, detail: e.body || null }));
  }
};
