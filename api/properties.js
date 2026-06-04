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

// ¿el inmueble está "Activo"? Detección defensiva sobre varios posibles campos.
function isActive(p) {
  var cands = [p.estado, p.status, p.state, p.estado_inmueble, p.estado_publicacion,
               p.activo, p.is_active, p.active, p.publicado, p.estado_nombre,
               (p.estado && (p.estado.nombre || p.estado.name))];
  for (var i = 0; i < cands.length; i++) {
    var c = cands[i];
    if (c == null) continue;
    var s = String(c).toLowerCase().trim();
    if (["activo", "active", "1", "true", "publicado", "disponible"].indexOf(s) !== -1) return true;
    if (["inactivo", "inactive", "0", "false", "vendido", "arrendado", "alquilado",
         "retirado", "pausado", "suspendido", "inhabilitado"].indexOf(s) !== -1) return false;
  }
  return null; // desconocido
}

function normalizeProperty(p, agentsById, typeMap, bizMap) {
  const rawImgs = p.images || p.imagenes || p.fotos || p.property_images ||
                  p.galeria || p.gallery || p.fotos_inmueble || p.imagenes_inmueble || [];
  const imgs = (Array.isArray(rawImgs) ? rawImgs : [])
    .map((i) => (typeof i === "string" ? i : (i && (i.url || i.src || i.image || i.path || i.foto || i.imagen || i.ruta))))
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
    garaje: num(p.garaje != null ? p.garaje : (p.garajes != null ? p.garajes : (p.parqueadero != null ? p.parqueadero : p.parqueaderos))),
    areaConstruida: num(p.area_contruida || p.area_construida),
    areaLote: num(p.area_lote),
    estrato: num(p.estrato != null ? p.estrato : p.stratum),
    descripcion: p.descripcion || p.description || p.descripcion_inmueble || "",
    lat: num(p.latitud != null ? p.latitud : (p.lat != null ? p.lat : p.latitude)),
    lng: num(p.longitud != null ? p.longitud : (p.lng != null ? p.lng : p.longitude)),
    video: p.url_video || p.video || "",
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

  // solo inmuebles "Activo" (con fallback: si no se detecta el estado, no filtra)
  var activos = all.filter(function (p) { return isActive(p) === true; });
  var inactivos = all.filter(function (p) { return isActive(p) === false; });
  var base = (activos.length > 0 && inactivos.length > 0) ? activos : all;

  const properties = base.map((p) => normalizeProperty(p, agentsById, typeMap, bizMap));

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
    // ---- modo diagnóstico: /api/properties?raw=1 -> muestra 1 inmueble crudo + sus campos ----
    if (/[?&]raw=/.test(req.url || "")) {
      const r1 = await getJSON(`${BASE}/properties?per_page=2&page=1`);
      const block = r1.data && r1.data.data ? r1.data.data : (r1.data || []);
      const first = Array.isArray(block) ? block[0] : null;
      return res.end(JSON.stringify({
        total: r1.data && r1.data.total,
        last_page: r1.data && r1.data.last_page,
        keys: first ? Object.keys(first) : [],
        primer_inmueble: first,
      }, null, 2));
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
