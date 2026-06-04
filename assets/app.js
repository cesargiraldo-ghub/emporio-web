/* =========================================================
   EMPORIO BIENES Y CAPITALES — app.js
   Meta Pixel + tracking de eventos + interacciones de UI
   ========================================================= */

/* ---------- 1) META PIXEL (ID: 1219816251738070) ---------- */
!(function (f, b, e, v, n, t, s) {
  if (f.fbq) return; n = f.fbq = function () {
    n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
  };
  if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
  t = b.createElement(e); t.async = !0; t.src = v;
  s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
})(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '1219816251738070');
fbq('track', 'PageView');

/* ---------- 2) Helpers de tracking ----------
   Eventos personalizados que medimos en Emporio:
   - BusquedaPropiedad      (buscador de inmuebles)
   - VerPropiedades         (botón / catálogo)
   - PagarArriendo          (botón pagar arriendo)
   - ConsultaEstadoCuenta   (estado de cuenta)
   - SolicitudSoporte       (botón soporte / WhatsApp)
   - SeccionArrendatario    (interés arrendatarios)
   - SeccionPropietario     (interés propietarios)
   - VerTestimonio          (play en videos)
   Además 'Lead' (estándar) cuando se envía el formulario.
*/
window.EMP = {
  track: function (evt, params) {
    params = params || {};
    try { fbq('trackCustom', evt, params); } catch (e) {}
    // Listo para Google Analytics 4 si se agrega gtag:
    if (typeof gtag === 'function') { gtag('event', evt, params); }
    console.log('[EMP track]', evt, params);
  },
  lead: function (params) {
    try { fbq('track', 'Lead', params || {}); } catch (e) {}
    if (typeof gtag === 'function') { gtag('event', 'generate_lead', params || {}); }
    console.log('[EMP Lead]', params || {});
  }
};

/* Bind automático: cualquier elemento con data-track="EventoNombre" */
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-track]');
  if (!el) return;
  var evt = el.getAttribute('data-track');
  var label = el.getAttribute('data-track-label') || el.textContent.trim().slice(0, 40);
  window.EMP.track(evt, { label: label, page: location.pathname });
});

/* ---------- 3) Navegación móvil ---------- */
document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.getElementById('navToggle');
  var menu = document.getElementById('mobileMenu');
  if (toggle && menu) {
    toggle.addEventListener('click', function () { menu.classList.toggle('open'); });
    menu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { menu.classList.remove('open'); });
    });
  }

  /* ---------- 4) Reveal on scroll ---------- */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

  /* ---------- 5) Buscador de inmuebles ---------- */
  var searchBtn = document.getElementById('searchBtn');
  if (searchBtn) {
    searchBtn.addEventListener('click', function () {
      var op = (document.getElementById('fOp') || {}).value || '';
      var ciudad = (document.getElementById('fCiudad') || {}).value || '';
      var tipo = (document.getElementById('fTipo') || {}).value || '';
      window.EMP.track('BusquedaPropiedad', { operacion: op, ciudad: ciudad, tipo: tipo });
      // En producción: redirigir al catálogo con filtros
      window.open('https://www.emporiobienesycapitalessas.inmob.site/inmuebles/catalogo/', '_blank');
    });
  }

  /* ---------- 6) Formulario de captación (Lead) ---------- */
  var form = document.getElementById('leadForm');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {
        nombre: form.nombre.value, email: form.email.value,
        telefono: form.telefono.value, interes: form.interes.value
      };
      window.EMP.lead({ interes: data.interes, ciudad: form.ciudad ? form.ciudad.value : '' });
      var ok = document.getElementById('formOk');
      if (ok) { form.style.display = 'none'; ok.style.display = 'block'; }
      // En producción: POST a CRM RED /clients endpoint
      console.log('Lead capturado (demo):', data);
    });
  }

  /* ---------- 7) Tracking de reproducción de videos (iframes YouTube) ---------- */
  document.querySelectorAll('[data-video]').forEach(function (w) {
    w.addEventListener('click', function () {
      window.EMP.track('VerTestimonio', { video: w.getAttribute('data-video') });
    }, { once: true });
  });
});
