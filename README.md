# Trama Studio

## Abrir el sitio
- Sin API: abre `index.html` en el navegador (el botón de foto realista queda oculto).
- Con servidor: instala Node 18+ y ejecuta `npm start`, luego abre http://localhost:3000

## Activar la foto realista (Dynamic Mockups)
1. Crea una cuenta en https://app.dynamicmockups.com y genera tu API key en el panel de API.
2. En su biblioteca de mockups, guarda una plantilla de playera en "My Templates" (debe tener una capa de diseño o "smart object").
3. Copia `.env.example` como `.env` y pon tu `DM_API_KEY`.
4. Reinicia con `npm start` y abre http://localhost:3000/api/mockups para ver tus plantillas. Copia el `uuid` de la plantilla a `DM_MOCKUP_UUID` y el del smart object a `DM_SMART_OBJECT_UUID`.
5. Pon en `PUBLIC_URL` la dirección pública de tu sitio. La API descarga el diseño desde ahí, así que en tu computadora no funciona; publica el sitio o usa un túnel (ngrok, cloudflared).
6. Reinicia. En el visor 3D aparecerá el botón "Ver foto realista".

La llave vive solo en el servidor. Hay un tope de 10 fotos por hora por visitante para cuidar tus créditos.
