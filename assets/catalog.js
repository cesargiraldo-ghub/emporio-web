/* ===========================================================
   EMPORIO — catalog.js
   Catálogo de inmuebles conectado a CRM RED vía /api/properties
   Maneja: destacados (home), catálogo (inmuebles.html) y ficha (inmueble.html)
   =========================================================== */
(function () {
  "use strict";

  var PER_PAGE = 12;
  var cache = null;

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtCOP(n) {
    if (n == null || isNaN(n)) return "";
    return "$" + Number(n).toLocaleString("es-CO", { maximumFractionDigits: 0 });
  }
  function qp() {
    var o = {}, q = location.search.replace(/^\?/, "");
    q.split("&").forEach(function (kv) {
      if (!kv) return; var p = kv.split("="); o[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || "");
    });
    return o;
  }
  function priceHTML(p) {
    var arr = /arriendo|alquiler/i.test(p.negocio || "");
    var ven = /venta/i.test(p.negocio || "");
    var parts = [];
    if (arr && p.precioArriendo) parts.push(fmtCOP(p.precioArriendo) + ' <small>/mes</small>');
    if (ven && p.precioVenta) parts.push(fmtCOP(p.precioVenta));
    if (!parts.length) {
      if (p.precioVenta) parts.push(fmtCOP(p.precioVenta));
      else if (p.precioArriendo) parts.push(fmtCOP(p.precioArriendo) + ' <small>/mes</small>');
    }
    return parts.length ? parts.join(" · ") : "Precio a consultar";
  }
  function metaHTML(p) {
    var s = [];
    if (p.habitaciones) s.push('<span title="Habitaciones"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a2 2 0 012-2h14a2 2 0 012 2v6M3 18h18M5 10V7a2 2 0 012-2h10a2 2 0 012 2v3"/></svg>' + p.habitaciones + '</span>');
    if (p.banos) s.push('<span title="Baños"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16v3a4 4 0 01-4 4H8a4 4 0 01-4-4zM6 12V6a2 2 0 012-2"/></svg>' + p.banos + '</span>');
    if (p.areaConstruida) s.push('<span title="Área construida"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3z"/><path d="M9 3v18M3 9h18"/></svg>' + p.areaConstruida + ' m²</span>');
    if (p.garaje) s.push('<span title="Garajes"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 11l1.5-4.5A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5L19 11v6h-2v-2H7v2H5z"/></svg>' + p.garaje + '</span>');
    return s.join("");
  }
  function img0(p) {
    return p.imagenes && p.imagenes.length ? p.imagenes[0] : "";
  }
  function cardHTML(p) {
    var im = img0(p);
    return '' +
      '<a class="pcard glass reveal" href="inmueble.html?slug=' + encodeURIComponent(p.slug) + '" data-track="VerPropiedades" data-track-label="ficha">' +
        '<div class="ph" data-pid="' + p.id + '">' +
          (im ? '<img loading="lazy" src="' + esc(im) + '" alt="' + esc(p.titulo) + '">' : '') +
          (p.negocio ? '<span class="pbadge">' + esc(p.negocio) + '</span>' : '') +
          (p.tipo ? '<span class="pbadge alt">' + esc(p.tipo) + '</span>' : '') +
        '</div>' +
        '<div class="pbody">' +
          '<div class="pprice">' + priceHTML(p) + '</div>' +
          '<div class="ptitle">' + esc(p.titulo) + '</div>' +
          '<div class="pcity"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
            esc([p.barrio, p.ciudad].filter(Boolean).join(", ") || "Colombia") + '</div>' +
          '<div class="pmeta">' + metaHTML(p) + '</div>' +
        '</div>' +
      '</a>';
  }

  function load() {
    if (cache) return Promise.resolve(cache);
    return fetch("/api/properties").then(function (r) { return r.json(); }).then(function (d) {
      cache = d; return d;
    });
  }

  /* ---------- imágenes bajo demanda (/api/images) ---------- */
  var imgCache = {};
  function fetchImages(id) {
    if (imgCache[id]) return Promise.resolve(imgCache[id]);
    return fetch("/api/images?id=" + id).then(function (r) { return r.json(); })
      .then(function (d) { var u = (d && d.images) || []; imgCache[id] = u; return u; })
      .catch(function () { imgCache[id] = []; return []; });
  }
  function fillPh(ph) {
    if (ph.dataset.done || ph.querySelector("img")) return;
    ph.dataset.done = "1";
    fetchImages(ph.getAttribute("data-pid")).then(function (urls) {
      if (urls && urls[0]) {
        var im = new Image(); im.loading = "lazy"; im.src = urls[0]; im.alt = "";
        ph.insertBefore(im, ph.firstChild);
      } else {
        var d = document.createElement("div"); d.className = "noimg"; d.textContent = "Sin foto"; ph.appendChild(d);
      }
    });
  }
  function lazyImages(container) {
    var phs = container.querySelectorAll(".ph[data-pid]");
    if (!("IntersectionObserver" in window)) { phs.forEach(fillPh); return; }
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); fillPh(en.target); } });
    }, { rootMargin: "300px" });
    phs.forEach(function (ph) { if (!ph.querySelector("img")) io.observe(ph); });
  }

  /* ============ DESTACADOS (home) ============ */
  function initFeatured(el) {
    el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    load().then(function (d) {
      if (!d.ok || !d.properties || !d.properties.length) { el.innerHTML = '<p class="empty">Pronto verás aquí nuestros inmuebles destacados.</p>'; return; }
      var list = d.properties.slice(0, 6);
      el.innerHTML = list.map(cardHTML).join("");
      lazyImages(el);
    }).catch(function () { el.innerHTML = '<p class="empty">No se pudieron cargar los inmuebles en este momento.</p>'; });
  }

  /* ============ CATÁLOGO ============ */
  function initCatalog() {
    var grid = document.getElementById("catGrid");
    var count = document.getElementById("catCount");
    var pager = document.getElementById("catPager");
    var fOp = document.getElementById("cfOp"), fType = document.getElementById("cfType"),
        fQ = document.getElementById("cfQ");
    var pre = qp();
    var state = { page: 1 };

    grid.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';

    load().then(function (d) {
      if (!d.ok) { grid.innerHTML = '<p class="empty">' + esc(d.error || "Error al cargar inmuebles.") + '</p>'; count.textContent = ""; return; }
      // poblar selects
      function fill(sel, vals, label) {
        sel.innerHTML = '<option value="">' + label + '</option>' + vals.map(function (v) { return '<option>' + esc(v) + '</option>'; }).join("");
      }
      fill(fOp, d.filters.negocios, "Cualquier operación");
      fill(fType, d.filters.tipos, "Todos los tipos");
      // presets desde URL
      if (pre.op) fOp.value = pre.op;
      if (pre.tipo) fType.value = pre.tipo;
      if (pre.q) fQ.value = pre.q;
      else if (pre.ciudad) fQ.value = pre.ciudad;

      function matchOp(neg, op) {
        if (!op) return true;
        var n = (neg || "").toLowerCase(), o = op.toLowerCase();
        if (/arriendo|alquiler/.test(o)) return /arriendo|alquiler/.test(n);
        if (/venta/.test(o)) return /venta/.test(n);
        return n.indexOf(o) !== -1;
      }
      function apply() {
        var op = fOp.value, ty = fType.value, q = (fQ.value || "").toLowerCase().trim();
        return d.properties.filter(function (p) {
          if (!matchOp(p.negocio, op)) return false;
          if (ty && p.tipo !== ty) return false;
          if (q) {
            var hay = (p.titulo + " " + p.ciudad + " " + p.barrio + " " + p.zona + " " + p.direccion + " " + p.descripcion).toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });
      }
      function render() {
        var res = apply();
        count.textContent = res.length + (res.length === 1 ? " inmueble encontrado" : " inmuebles encontrados");
        var pages = Math.max(1, Math.ceil(res.length / PER_PAGE));
        if (state.page > pages) state.page = 1;
        var slice = res.slice((state.page - 1) * PER_PAGE, state.page * PER_PAGE);
        grid.innerHTML = slice.length ? slice.map(cardHTML).join("") : '<p class="empty">No hay inmuebles que coincidan con tu búsqueda. Prueba con otros filtros.</p>';
        // pager
        if (pages <= 1) { pager.innerHTML = ""; }
        else {
          var html = '<button ' + (state.page === 1 ? "disabled" : "") + ' data-p="' + (state.page - 1) + '">‹</button>';
          for (var i = 1; i <= pages; i++) html += '<button class="' + (i === state.page ? "active" : "") + '" data-p="' + i + '">' + i + '</button>';
          html += '<button ' + (state.page === pages ? "disabled" : "") + ' data-p="' + (state.page + 1) + '">›</button>';
          pager.innerHTML = html;
        }
        document.querySelectorAll(".reveal").forEach(function (e) { e.classList.add("in"); });
        lazyImages(grid);
      }
      [fOp, fType].forEach(function (s) { s.addEventListener("change", function () { state.page = 1; render(); }); });
      fQ.addEventListener("input", function () { state.page = 1; render(); });
      pager.addEventListener("click", function (e) {
        var b = e.target.closest("button[data-p]"); if (!b) return;
        state.page = parseInt(b.getAttribute("data-p"), 10); render();
        window.scrollTo({ top: grid.offsetTop - 120, behavior: "smooth" });
      });
      render();
    }).catch(function () { grid.innerHTML = '<p class="empty">No se pudieron cargar los inmuebles.</p>'; });
  }

  /* ============ FICHA / DETALLE ============ */
  function initDetail() {
    var root = document.getElementById("propDetail");
    var p0 = qp();
    load().then(function (d) {
      if (!d.ok || !d.properties) { root.innerHTML = '<p class="empty">No se pudo cargar el inmueble.</p>'; return; }
      var p = d.properties.filter(function (x) {
        return String(x.slug) === String(p0.slug) || String(x.id) === String(p0.id);
      })[0];
      if (!p) { root.innerHTML = '<p class="empty">Inmueble no encontrado. <a href="inmuebles.html" style="color:var(--rojo-soft)">Ver catálogo</a></p>'; return; }
      document.title = p.titulo + " | Emporio Bienes y Capitales";

      var imgsReady = (p.imagenes && p.imagenes.length) ? Promise.resolve(p.imagenes) : fetchImages(p.id);
      imgsReady.then(function (imgs) {
      var mainImg = imgs.length ? imgs[0] : "";
      var thumbs = imgs.map(function (u, i) { return '<img class="' + (i === 0 ? "active" : "") + '" data-i="' + i + '" src="' + esc(u) + '" alt="foto ' + (i + 1) + '">'; }).join("");

      var ag = p.agente || { nombre: "Equipo Emporio", whatsapp: "573145590000", celular: "", email: "servicioalcliente@emporiobienes.com" };
      var waNum = (ag.whatsapp || ag.celular || "573145590000").replace(/\D/g, "");
      if (waNum && !waNum.startsWith("57")) waNum = "57" + waNum;
      var initials = (ag.nombre || "E").split(" ").map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase();

      var specs = [
        p.habitaciones ? { v: p.habitaciones, l: "Habitaciones" } : null,
        p.banos ? { v: p.banos, l: "Baños" } : null,
        p.garaje ? { v: p.garaje, l: "Garajes" } : null,
        p.areaConstruida ? { v: p.areaConstruida + " m²", l: "Área const." } : null,
        p.areaLote ? { v: p.areaLote + " m²", l: "Área lote" } : null,
        p.estrato ? { v: p.estrato, l: "Estrato" } : null,
      ].filter(Boolean);

      var mapEmbed = (p.lat && p.lng)
        ? '<iframe loading="lazy" style="width:100%;height:260px;border:0;border-radius:var(--radius);margin-top:1.4rem" src="https://www.google.com/maps?q=' + p.lat + ',' + p.lng + '&z=15&output=embed"></iframe>'
        : "";

      root.innerHTML =
        '<nav style="font-size:.85rem;color:var(--gris);margin-bottom:1.2rem"><a href="index.html" style="color:var(--gris)">Inicio</a> / <a href="inmuebles.html" style="color:var(--gris)">Inmuebles</a> / <span style="color:#fff">' + esc(p.titulo) + '</span></nav>' +
        '<div class="detail-wrap">' +
          '<div>' +
            (imgs.length
              ? '<div class="carousel-main"><img id="galMain" src="' + esc(imgs[0]) + '" alt="' + esc(p.titulo) + '">' +
                  (imgs.length > 1 ? '<button class="cnav prev" id="galPrev" aria-label="Anterior">‹</button><button class="cnav next" id="galNext" aria-label="Siguiente">›</button><span class="ccount" id="galCount">1 / ' + imgs.length + '</span>' : '') +
                '</div>'
              : '<div class="gallery-main"><div class="noimg" style="display:grid;place-items:center;height:100%;color:var(--gris)">Sin fotos disponibles</div></div>') +
            (imgs.length > 1 ? '<div class="gallery-thumbs" id="galThumbs">' + thumbs + '</div>' : '') +
            '<div style="margin-top:1.8rem">' +
              '<span class="eyebrow">' + esc([p.negocio, p.tipo].filter(Boolean).join(" · ")) + '</span>' +
              '<h1 style="font-size:clamp(1.8rem,4vw,2.6rem);margin:.4rem 0">' + esc(p.titulo) + '</h1>' +
              '<div class="pcity" style="color:var(--gris)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> ' + esc([p.direccion, p.barrio, p.ciudad].filter(Boolean).join(", ") || "Colombia") + '</div>' +
              '<div class="detail-price" style="margin-top:1rem">' + priceHTML(p) + '</div>' +
              (specs.length ? '<div class="spec-grid">' + specs.map(function (s) { return '<div class="spec glass"><div class="v">' + esc(s.v) + '</div><div class="l">' + esc(s.l) + '</div></div>'; }).join("") + '</div>' : '') +
              (p.descripcion ? '<h3 style="margin:1.6rem 0 .6rem">Descripción</h3><p style="color:var(--gris-soft);white-space:pre-line">' + esc(p.descripcion) + '</p>' : '') +
              (p.video ? '<div class="video-wrap" style="margin-top:1.4rem"><iframe src="' + esc(toEmbed(p.video)) + '" loading="lazy" allowfullscreen></iframe></div>' : '') +
              mapEmbed +
            '</div>' +
          '</div>' +
          '<div>' +
            '<div class="advisor glass">' +
              '<div class="who"><div class="avatar">' + (ag.foto ? '<img src="' + esc(ag.foto) + '">' : esc(initials)) + '</div>' +
                '<div><div class="nm">' + esc(ag.nombre) + '</div><div class="rl">Asesor del inmueble</div></div></div>' +
              (waNum ? '<a href="https://wa.me/' + waNum + '?text=' + encodeURIComponent("Hola, me interesa el inmueble: " + p.titulo) + '" target="_blank" class="btn btn-rojo" style="width:100%;margin-bottom:.6rem" data-track="SolicitudSoporte">WhatsApp</a>' : '') +
              '<h3 style="font-family:var(--ff-body);font-size:1.05rem;margin:.6rem 0 .9rem">Agenda una visita</h3>' +
              '<form id="visitaForm">' +
                '<div class="input-group full"><input type="text" name="nombre" placeholder="Nombre" required></div>' +
                '<div class="input-group full"><input type="email" name="email" placeholder="Correo" required></div>' +
                '<div class="input-group full"><input type="tel" name="telefono" placeholder="Teléfono / WhatsApp" required></div>' +
                '<div class="input-group full"><input type="date" name="fecha"></div>' +
                '<div class="input-group full"><textarea name="mensaje" placeholder="Mensaje (opcional)" style="min-height:80px"></textarea></div>' +
                '<button type="submit" class="btn btn-rojo" style="width:100%">Solicitar información</button>' +
              '</form>' +
              '<div id="leadOk" style="display:none;text-align:center;padding:.8rem"><strong>¡Gracias!</strong><br>Un asesor te contactará pronto.</div>' +
            '</div>' +
          '</div>' +
        '</div>';

      // carrusel
      var cur = 0;
      var galMain = document.getElementById("galMain");
      var thumbsEl = document.getElementById("galThumbs");
      var galCount = document.getElementById("galCount");
      function show(i) {
        if (!imgs.length) return;
        cur = (i + imgs.length) % imgs.length;
        if (galMain) galMain.src = imgs[cur];
        if (galCount) galCount.textContent = (cur + 1) + " / " + imgs.length;
        if (thumbsEl) thumbsEl.querySelectorAll("img").forEach(function (x, k) { x.classList.toggle("active", k === cur); });
      }
      var prev = document.getElementById("galPrev"), next = document.getElementById("galNext");
      if (prev) prev.addEventListener("click", function () { show(cur - 1); });
      if (next) next.addEventListener("click", function () { show(cur + 1); });
      if (thumbsEl) thumbsEl.addEventListener("click", function (e) {
        var t = e.target.closest("img[data-i]"); if (!t) return;
        show(parseInt(t.getAttribute("data-i"), 10));
      });

      // formulario lead -> /api/lead
      var form = document.getElementById("visitaForm");
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var btn = form.querySelector("button"); btn.disabled = true; btn.textContent = "Enviando...";
        var body = {
          nombre: form.nombre.value, email: form.email.value, telefono: form.telefono.value,
          whatsapp: form.telefono.value, fecha: form.fecha.value, mensaje: form.mensaje.value,
          interes: "Información/visita de inmueble", property: p.id, propiedadTitulo: p.titulo
        };
        if (window.EMP) window.EMP.lead({ inmueble: p.titulo, ciudad: p.ciudad });
        fetch("/api/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res.ok) { form.style.display = "none"; document.getElementById("leadOk").style.display = "block"; }
            else { btn.disabled = false; btn.textContent = "Solicitar información"; alert("No se pudo enviar: " + (res.error || "intenta de nuevo")); }
          })
          .catch(function () { btn.disabled = false; btn.textContent = "Solicitar información"; alert("Error de conexión. Intenta de nuevo."); });
      });
      }); // fin imgsReady
    }).catch(function () { root.innerHTML = '<p class="empty">No se pudo cargar el inmueble.</p>'; });
  }

  function toEmbed(url) {
    var m = url.match(/(?:youtu\.be\/|v=)([\w-]{11})/);
    return m ? "https://www.youtube.com/embed/" + m[1] : url;
  }

  /* ---------- bootstrap ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    var feat = document.getElementById("featuredGrid");
    if (feat) initFeatured(feat);
    if (document.getElementById("catGrid")) initCatalog();
    if (document.getElementById("propDetail")) initDetail();
  });
})();
