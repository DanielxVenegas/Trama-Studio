# Trama Studio

## Abrir el sitio
- Solo archivos: abre `index.html` en el navegador (carrito y personalización funcionan, pero el pago requiere el servidor).
- Con servidor: instala Node 22.13 o superior y ejecuta `npm start`, luego abre http://localhost:3000

Todo el stack del proyecto es gratuito: Node, SQLite, Three.js y Google Fonts (CDN). Stripe se usa en modo de prueba para pagos; no hay servicios externos de mockups.

## Pedidos y panel del administrador
Con el servidor corriendo (`npm start`), los pedidos del checkout se guardan en una base de datos SQLite local (`server/data/trama.db`, se crea sola). Los precios y el stock se validan y recalculan siempre en el servidor, nunca se confía en lo que manda el navegador. Stripe Checkout recopila los datos de pago fuera del sitio.

## Pagos de prueba con Stripe
El checkout usa Stripe Checkout alojado. Para habilitarlo:
1. Copia `.env.example` a `.env` y define `STRIPE_SECRET_KEY` con una clave **de prueba** (`sk_test_...`). No pongas claves en archivos Markdown, HTML o JavaScript ni compartas una clave secreta.
2. Instala y autentica Stripe CLI. Con el servidor ejecutándose, inicia el reenvío local del webhook:
   `stripe listen --forward-to localhost:3000/api/stripe/webhook`
3. Copia el secreto `whsec_...` que muestra Stripe CLI a `STRIPE_WEBHOOK_SECRET` en `.env` y reinicia el servidor.
4. Abre el sitio mediante `http://localhost:3000` (no abras `checkout.html` directamente como archivo). Stripe redirige de vuelta al checkout después del pago; solo entonces se guarda el pedido y se descuenta el stock.

Stripe Checkout recibe el total calculado por el servidor en MXN. Las tarjetas de prueba y otros datos aceptados para pruebas están documentados en la [documentación de Stripe](https://docs.stripe.com/testing). Las claves secretas de prueba siguen siendo credenciales: si una se incluyó en Markdown o se compartió, rótala desde Stripe antes de continuar.

Para activar el panel del administrador (`/admin.html`):
1. Copia `.env.example` como `.env` si no lo has hecho.
2. Define `ADMIN_PASSWORD` (la contraseña de acceso) y `SESSION_SECRET` (una cadena larga y aleatoria para firmar la sesión).
3. Opcional en producción con https: pon `PUBLIC_URL` con la URL pública del sitio (activa la cookie `Secure` del panel).
4. Reinicia con `npm start` y abre http://localhost:3000/admin.html

Desde ahí puedes ver los pedidos, filtrarlos por estado o buscarlos por folio/correo, cambiar su estado (al cancelar uno se repone automáticamente el stock de las prendas de catálogo que llevaba) y editar las existencias de cada producto. Hay un tope de 10 pedidos por hora por visitante y de 5 intentos de inicio de sesión cada 15 minutos por IP.

## Ticket de compra en PDF
Cuando se confirma el pago, la ventana "Pedido recibido" ofrece **Descargar ticket (PDF)**: folio, fecha, datos de contacto y envío, prendas con su miniatura, descuento, envío y total, con los colores y el estilo del sitio.

El PDF se genera en el navegador con `js/ticket-pdf.js` (sin librerías ni servicios externos). Como al volver de Stripe el formulario ya está vacío y el servidor solo confirma folio, correo y total, el checkout guarda una copia del pedido en `sessionStorage` justo antes de salir hacia Stripe y la borra al confirmar el pago. Por eso el botón solo aparece si el pago se confirma en la misma pestaña donde se inició, y únicamente cuando el total de esa copia coincide con el que confirmó el servidor. Para conservar el ticket sin depender de la pestaña, el servidor tendría que devolver el pedido completo al confirmar el pago.

## Personalizar en 3D
En `personalizar.html` eliges corte, color, arte y texto y los ves al momento sobre una playera en 3D que puedes girar (arrastrando, o con los botones de vista). Desde ahí mismo puedes **descargar una captura PNG** o **ver vista previa** de la escena 3D y agregar la playera al carrito, sin servicios externos. Si el navegador no tiene WebGL o Three.js no carga, la página muestra una vista plana equivalente.

El texto se ajusta solo al área de impresión: ocupa todo el ancho disponible sin deformar las letras y, si así queda más grande, se reparte en dos renglones cortando en los espacios. Hay cinco tipografías de estilos distintos (moderna, condensada, serif, manuscrita y monoespaciada). Para agregar otra, añádela a `FONTS` en `js/data.js` (con su `avg` y `lh`) y pídela en el enlace de Google Fonts del `<head>` de `index.html`, `checkout.html`, `personalizar.html` y `404.html`; una prueba verifica que ambas cosas coincidan. El servidor toma la lista de `FONTS` de ese mismo archivo, así que no necesita cambios.
