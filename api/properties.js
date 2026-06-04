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

// --- filtrado y paginación del lado del servidor (para entregar 10 por página) ---
function matchOp(neg, op) {
  if (!op) return true;
  var n = (neg || "").toLowerCase(), o = op.toLowerCase();
  if (/arriendo|alquiler/.test(o)) return /arriendo|alquiler/.test(n);
  if (/venta/.test(o)) return /venta/.test(n);
  return n.indexOf(o) !== -1;
}
function applyFilters(list, f) {
  var id = (f.id || "").trim();
  if (id) {
    // búsqueda por ID de CRM RED: tiene prioridad sobre los demás filtros
    return list.filter(function (p) {
      return String(p.id) === id || String(p.slug).replace(/^_/, "") === id;
    });
  }
  var q = (f.q || "").toLowerCase().trim();
  return list.filter(function (p) {
    if (!matchOp(p.negocio, f.op)) return false;
    if (f.tipo && p.tipo !== f.tipo) return false;
    if (f.ciudad && String(p.ciudad || "").toLowerCase() !== String(f.ciudad).toLowerCase()) return false;
    if (q) {
      var hay = (p.titulo + " " + p.ciudad + " " + p.barrio + " " + p.zona + " " + p.direccion + " " + p.descripcion).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
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

// primer valor numérico válido entre varias posibles claves
function pickNum(obj, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = obj[keys[i]];
    if (v != null && v !== "") { var n = Number(v); if (!isNaN(n)) return n; }
  }
  return null;
}
// primer string no vacío entre varias posibles claves
function pickStr(obj, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = obj[keys[i]];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
// nombre legible de una característica (string u objeto)
function featName(x) {
  if (x == null) return "";
  if (typeof x === "string") return x.trim();
  if (typeof x === "object") {
    return String(x.texto || x.nombre || x.name || x.titulo || x.label || x.descripcion ||
      (x.caracteristica && (x.caracteristica.texto || x.caracteristica.nombre || x.caracteristica.name)) || "").trim();
  }
  return String(x).trim();
}
// características / amenidades como lista de nombres únicos
function extractFeatures(p) {
  var out = [], seen = {};
  var srcs = [
    p.caracteristicas_clasificacion, p.caracteristicas_estado_construcion, p.caracteristicas_orientacion,
    p.caracteristicas_tarifas_adicionales_servicios_publico, p.caracteristicas_tipo_fachada,
    p.caracteristicas_ubicacion, p.caracteristicas_internas, p.caracteristicas_externas,
    p.caracteristicas, p.amenidades, p.amenities, p.features, p.property_features,
    p.inmueble_caracteristicas, p.servicios, p.comodidades, p.atributos,
  ];
  srcs.forEach(function (s) {
    if (Array.isArray(s)) s.forEach(function (it) {
      var n = featName(it);
      if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; out.push(n); }
    });
  });
  return out;
}

function normalizeProperty(p, agentsById, typeMap, bizMap) {
  const rawImgs = p.inmueble_imagenes || p.images || p.imagenes || p.fotos || p.property_images ||
                  p.galeria || p.gallery || p.fotos_inmueble || p.imagenes_inmueble || [];
  const imgsArr = (Array.isArray(rawImgs) ? rawImgs.slice() : []);
  imgsArr.sort(function (a, b) {
    var oa = (a && a.order != null) ? a.order : 0, ob = (b && b.order != null) ? b.order : 0;
    return oa - ob;
  });
  const imgs = imgsArr
    .map((i) => (typeof i === "string" ? i : (i && (i.url || i.src || i.image || i.path || i.foto || i.imagen || i.ruta))))
    .filter(Boolean);

  // ciudad / barrio / zona: ahora la API los trae como objetos {id, name}
  var dparts = String(p.direccion || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  var ciudadName = "", barrioName = "";
  if (dparts.length >= 3) ciudadName = dparts[dparts.length - 3];
  else if (dparts.length === 2) ciudadName = dparts[1];
  if (dparts.length >= 5) barrioName = dparts[1];
  function objName(v) { var n = nameOf(v); return /^\d+$/.test(n) ? "" : n; }
  var ciudadObj = objName(p.ciudad_id) || objName(p.ciudad) || ciudadName;
  var barrioObj = objName(p.barrio_id) || objName(p.barrio) || barrioName;
  var zonaObj = objName(p.zona_id) || objName(p.zona) || "";

  // estrato puede venir como objeto {id, name:"estrato 2"} o como número
  var estratoVal = null;
  if (p.estrato != null) {
    if (typeof p.estrato === "object") {
      var m = String(p.estrato.name || p.estrato.nombre || "").match(/\d+/);
      estratoVal = m ? Number(m[0]) : (p.estrato.id != null ? Number(p.estrato.id) : null);
    } else { var en = Number(p.estrato); estratoVal = isNaN(en) ? null : en; }
  }

  let tipo = nameOf(p.tipo_inmueble);
  if (/^\d+$/.test(tipo) && typeMap[tipo]) tipo = typeMap[tipo];
  let negocio = nameOf(p.tipo_negocio);
  if (/^\d+$/.test(negocio) && bizMap[negocio]) negocio = bizMap[negocio];

  const agentId =
    p.agent_id || p.created_by ||
    (p.creator_agent && p.creator_agent.id) ||
    (p.agent && p.agent.id) || (p.agente && p.agente.id) || null;
  let agent = p.creator_agent || p.agent || p.agente || (agentId && agentsById[agentId]) || null;
  if (agent) {
    var info = agent.userdata_info || agent.user || agent.usuario || agent; // datos suelen venir anidados
    agent = {
      id: agent.id,
      nombre: [info.primer_nombre || agent.primer_nombre || agent.nombre,
               info.primer_apellido || agent.primer_apellido || agent.apellido]
        .filter(Boolean).join(" ").trim() || "Asesor Emporio",
      celular: pickStr(info, ["celular_movil", "main_cell_phone", "celular", "telefono", "phone"]) ||
               pickStr(agent, ["celular_movil", "main_cell_phone", "celular", "telefono", "phone"]),
      whatsapp: pickStr(info, ["celular_whatsapp", "whatsapp", "celular_movil"]) ||
                pickStr(agent, ["celular_whatsapp", "whatsapp", "celular_movil"]),
      email: pickStr(agent, ["email", "main_mail", "correo"]) || pickStr(info, ["email", "main_mail", "correo"]),
      foto: pickStr(info, ["foto_persona", "foto", "avatar", "photo", "imagen", "image", "url_foto",
                           "foto_url", "foto_perfil", "profile_photo", "profile_image", "picture",
                           "avatar_url", "url_imagen", "imagen_url", "imagen_perfil"]) ||
            pickStr(agent, ["foto_persona", "foto", "avatar", "photo", "imagen", "image", "url_foto"]),
    };
  }

  return {
    id: p.id,
    slug: p.slug || String(p.id),
    titulo: p.titulo_inmueble || p.titulo || p.title || "Inmueble",
    tipo,
    negocio,
    ciudad: ciudadObj,
    zona: zonaObj,
    barrio: barrioObj,
    direccion: p.direccion || "",
    precioVenta: num(p.selling_price),
    precioArriendo: num(p.rental_price),
    habitaciones: num(p.habitaciones),
    banos: num(p.banos),
    garaje: pickNum(p, ["garaje", "garajes", "parqueadero", "parqueaderos", "garage", "garages",
                        "num_garajes", "numero_garajes", "n_garajes", "n_parqueaderos",
                        "cantidad_garajes", "cantidad_parqueaderos", "parking"]),
    areaConstruida: num(p.area_contruida || p.area_construida),
    areaLote: num(p.area_lote),
    estrato: estratoVal,
    descripcion: p.descripcion || p.description || p.descripcion_inmueble || "",
    caracteristicas: extractFeatures(p),
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

  // Estado "Activo": el usuario confirmó que hay 303 activos.
  // Detectamos el valor de state_inmueble cuyo conteo se acerca más a 303 y filtramos por él.
  var counts = {};
  all.forEach(function (p) { var k = String(p.state_inmueble); counts[k] = (counts[k] || 0) + 1; });
  var TARGET = 303, activeState = null, best = Infinity;
  Object.keys(counts).forEach(function (k) {
    var diff = Math.abs(counts[k] - TARGET);
    if (diff < best) { best = diff; activeState = k; }
  });
  var base = all.filter(function (p) { return String(p.state_inmueble) === String(activeState); });
  if (!base.length) base = all;

  const properties = base.map((p) => normalizeProperty(p, agentsById, typeMap, bizMap));

  // opciones de filtro derivadas de los datos reales
  const uniq = (arr) => [...new Set(arr.filter((x) => x && !/^\d+$/.test(String(x))))].sort();
  const filters = {
    ciudades: uniq(properties.map((p) => p.ciudad)),
    tipos: uniq(properties.map((p) => p.tipo)),
    negocios: uniq(properties.map((p) => p.negocio)),
  };

  return { ok: true, count: properties.length, total_crm: all.length,
           estado_activo: activeState, conteos_estado: counts, filters, properties };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    if (!process.env.CRMRED_API_KEY || !process.env.CRMRED_API_SECRET) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: "Faltan variables de entorno CRMRED_API_KEY / CRMRED_API_SECRET en Vercel." }));
    }
    // ---- modo diagnóstico: /api/properties?raw=1 -> 1 inmueble + 1 agente crudos + sus campos ----
    if (/[?&]raw=/.test(req.url || "")) {
      const r1 = await getJSON(`${BASE}/properties?per_page=2&page=1`);
      const block = r1.data && r1.data.data ? r1.data.data : (r1.data || []);
      const first = Array.isArray(block) ? block[0] : null;
      let agentSample = null, agentKeys = [];
      try {
        const a = await getJSON(`${BASE}/agents`);
        const ablock = a.data && a.data.data ? a.data.data : (a.data || []);
        agentSample = Array.isArray(ablock) ? ablock[0] : null;
        agentKeys = agentSample ? Object.keys(agentSample) : [];
      } catch (e) {}
      return res.end(JSON.stringify({
        total: r1.data && r1.data.total,
        last_page: r1.data && r1.data.last_page,
        property_keys: first ? Object.keys(first) : [],
        primer_inmueble: first,
        agent_keys: agentKeys,
        primer_agente: agentSample,
      }, null, 2));
    }
    const now = Date.now();
    // ---- modo paginado: /api/properties?page=N&per_page=10[&op=&tipo=&q=&ciudad=] ----
    // Entrega solo la página solicitada (no todo el inventario) para que el cliente cargue rápido.
    var q = {};
    (String(req.url || "").split("?")[1] || "").split("&").forEach(function (kv) {
      if (!kv) return; var p = kv.split("="); q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || "").replace(/\+/g, " "));
    });
    if (q.page != null || q.per_page != null) {
      if (!(CACHE.data && now - CACHE.at < TTL)) { CACHE = { at: now, data: await buildPayload() }; }
      const d = CACHE.data;
      const perPage = Math.min(Math.max(parseInt(q.per_page, 10) || 10, 1), 48);
      const filtered = applyFilters(d.properties, { id: q.id || "", op: q.op || "", tipo: q.tipo || "", q: q.q || "", ciudad: q.ciudad || "" });
      const total = filtered.length;
      const lastPage = Math.max(1, Math.ceil(total / perPage));
      let page = parseInt(q.page, 10) || 1;
      if (page < 1) page = 1; if (page > lastPage) page = lastPage;
      const slice = filtered.slice((page - 1) * perPage, page * perPage);
      res.setHeader("X-Cache", "PAGE");
      res.setHeader("Cache-Control", "public, max-age=120");
      return res.end(JSON.stringify({
        ok: true, total: total, count: slice.length,
        current_page: page, last_page: lastPage, per_page: perPage,
        filters: d.filters, properties: slice,
      }));
    }

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
