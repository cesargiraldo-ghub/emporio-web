// /api/lead.js  —  Registra un lead (agendar visita / solicitar información) en CRM RED
// POST JSON: { nombre, apellido?, email, telefono, whatsapp?, property?, interes?, mensaje?, fecha? }

const BASE = "https://crmred.co/api/external/v1";

function headers() {
  return {
    "X-Api-Key": process.env.CRMRED_API_KEY || "",
    "X-Api-Secret": process.env.CRMRED_API_SECRET || "",
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return await new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
    });
  });
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "Método no permitido" }));
  }
  if (!process.env.CRMRED_API_KEY || !process.env.CRMRED_API_SECRET) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: "Faltan variables de entorno CRMRED_API_KEY / CRMRED_API_SECRET." }));
  }
  try {
    const b = await readBody(req);
    if (!b.nombre || !b.email || !b.telefono) {
      res.statusCode = 422;
      return res.end(JSON.stringify({ ok: false, error: "Faltan campos: nombre, email y teléfono son obligatorios." }));
    }

    const obs = [
      b.interes ? `Interés: ${b.interes}` : "",
      b.fecha ? `Fecha sugerida de visita: ${b.fecha}` : "",
      b.propiedadTitulo ? `Inmueble: ${b.propiedadTitulo}` : "",
      b.mensaje ? `Mensaje: ${b.mensaje}` : "",
    ].filter(Boolean).join(" · ").slice(0, 2000);

    const payload = {
      nombre: String(b.nombre).slice(0, 120),
      apellido: b.apellido ? String(b.apellido).slice(0, 120) : undefined,
      main_mail: String(b.email).slice(0, 150),
      main_cell_phone: String(b.telefono).slice(0, 30),
      whatsapp: b.whatsapp ? String(b.whatsapp).slice(0, 30) : undefined,
      tipo_cliente: b.interes && /vender|propietario|arrendar mi/i.test(b.interes) ? "Propietario" : "Comprador",
      origin: "Web",
      property: b.property ? Number(b.property) : undefined,
      observaciones: obs || undefined,
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const r = await fetch(`${BASE}/clients`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) {
      res.statusCode = r.status;
      return res.end(JSON.stringify({ ok: false, error: "CRM RED " + r.status, detail: out }));
    }
    return res.end(JSON.stringify({ ok: true, data: out.data || out }));
  } catch (e) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: e.message }));
  }
};
