# Emporio Bienes y Capitales — Sitio web (prototipo)

Sitio estático (HTML + CSS + JS) listo para desplegar en Vercel.
Estética *Liquid Glass* · rojo `#f4060a` · Playfair Display + Inter.

## Estructura
```
/
├── index.html            Home
├── nosotros.html         Quiénes somos / historia / equipo
├── arrendatarios.html    Landing arrendatarios
├── propietarios.html     Landing propietarios
├── contacto.html         Formulario y canales
├── admin.html            Login director + dashboard (DEMO front-end)
├── privacidad.html       Política de privacidad
├── terminos.html         Términos de uso
├── assets/
│   ├── styles.css        Sistema de diseño
│   └── app.js            Meta Pixel + tracking + interacciones
├── vercel.json           Headers de seguridad y caché
├── robots.txt            Reglas de rastreo (incluye bots de IA)
└── sitemap.xml           Mapa del sitio
```

## Desplegar en Vercel

### Opción A — Arrastrar y soltar (más rápido)
1. Entra a https://vercel.com/new
2. Arrastra la carpeta completa (o sube el `.zip` descomprimido).
3. Framework Preset: **Other**. No requiere build. Deploy.

### Opción B — GitHub + Vercel (recomendado para ti)
```bash
git init
git add .
git commit -m "Sitio Emporio - prototipo"
git branch -M main
git remote add origin git@github.com:cesargiraldo-ghub/emporio-web.git
git push -u origin main
```
Luego en Vercel: **Add New → Project → Import** el repo. Build command vacío, Output directory `.`.

### Opción C — Vercel CLI
```bash
npm i -g vercel
vercel        # preview
vercel --prod # producción
```

## Dominio
En Vercel → Project → Settings → Domains, añade `emporiobienes.com`
y configura los registros en HostGator (A/CNAME según indique Vercel).

## Pendientes antes de producción
- **admin.html**: login y métricas son DEMO de front-end. Conectar a backend seguro,
  Google Analytics 4 y CRM RED. Las gráficas usan datos de ejemplo.
- **Formulario de contacto**: hacer POST real al endpoint `/clients` de CRM RED.
- **WhatsApp**: reemplazar `https://wa.me/57` por el número real.
- **Testimonio 3**: falta la URL del video (hay tarjeta placeholder).
- **Equipo y roadmap**: nombres, fotos y fechas son placeholders editables.
- **Meta Pixel** activo con ID `1219816251738070`.
