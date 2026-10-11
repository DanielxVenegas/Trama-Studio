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

## Visor 3D
En `visor-3d.html` puedes girar la playera, cambiar corte y color, y **descargar una captura PNG** o **ver vista previa** de la escena 3D en el navegador, sin servicios externos.
