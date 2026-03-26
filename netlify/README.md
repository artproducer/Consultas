# Netlify Setup

## Environment Variables
Configura estas variables en `Site settings -> Environment variables`:

- `APP_PASSWORD`: contraseña para iniciar sesión en la web.
- `SESSION_SECRET`: secreto largo y aleatorio (ejemplo 64+ caracteres).
- `GAS_URL`: URL de tu Web App de Apps Script.
- `GAS_TOKEN`: token secreto de Apps Script.

## Flujo

- Frontend inicia sesión contra `/.netlify/functions/login`.
- Netlify Functions crea cookie `HttpOnly` (`inbox_session`) por 30 días.
- Frontend consulta correos por `/.netlify/functions/inbox`.
- Backend llama a GAS con `GAS_URL` + `GAS_TOKEN`.

## Logout

El botón "Cerrar sesión" llama `/.netlify/functions/logout` y elimina cookie de sesión.

## Notas

- La cookie usa `Secure`; funciona en HTTPS (Netlify).
- Si cambias `SESSION_SECRET`, se cerrarán todas las sesiones activas.
