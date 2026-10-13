# 🗳️ Votación en grupo

Elige lugares de tu mapa, crea una votación, comparte el QR y tus amigos votan desde sus teléfonos. Resultados en vivo.

## Cómo funciona

1. **Organizador**: abre la página, busca lugares del mapa, elige 2 o más, le pone título (ej. "Cena del viernes") y crea la votación.
2. **Compartir**: la app genera un enlace y un código QR (descargable). Compártelo por WhatsApp o muéstralo en persona.
3. **Votar**: cada amigo abre el enlace, ve los candidatos con foto e info, y vota (un voto por teléfono).
4. **Resultados**: se ven en vivo. El organizador puede cerrar la votación antes y se muestra el ganador. Las salas se vencen solas a las 24 horas.

## Ponerla en internet (paso a paso)

Necesitas: una cuenta de GitHub (gratis) y una cuenta de Render (gratis). Toma unos 15 minutos.

### Paso 1 — Sube el código a GitHub
1. Entra a [github.com](https://github.com) y crea una cuenta (o inicia sesión).
2. Clic en **+** (arriba a la derecha) → **New repository**.
3. Ponle nombre `group-vote`, déjalo **Public**, y clic en **Create repository**.
4. En la página del repositorio, clic en **uploading an existing file** → arrastra TODA la carpeta `group-vote` (o usa el botón para subir los archivos) → **Commit changes**.

### Paso 2 — Crea la cuenta de Render
1. Entra a [render.com](https://render.com) y crea una cuenta gratis (puedes usar "Sign up with GitHub").
2. Verifica tu correo si te lo pide.

### Paso 3 — Despliega la app
1. En Render, clic en **New +** → **Web Service**.
2. Conecta tu cuenta de GitHub y elige el repositorio `group-vote`.
3. Render detecta el archivo `render.yaml` y llena todo solo. Verifica:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free
4. Clic en **Create Web Service**. Espera unos minutos a que termine el deploy.
5. Cuando diga **Live**, abre la URL que te da Render (algo como `https://group-vote-xxxx.onrender.com`). ¡Listo!

### Notas importantes
- El plan gratis "duerme" la app si nadie la usa por un rato: la primera visita puede tardar ~30 segundos en despertar. Es normal.
- Los votos y las salas viven solo 24 horas y se borran solos. La base de datos del plan gratis no guarda datos entre reinicios, pero como todo expira en 24h no importa.
- Los lugares del mapa ya vienen incluidos en la app (se importan automáticamente al arrancar).

## Actualizar los lugares del mapa

Si agregas lugares nuevos a tu mapa y quieres que aparezcan aquí:

```bash
node scripts/import-places.js
```

Luego sube los cambios a GitHub (los archivos en `data/places.json` y `public/images/`) y Render redespliega solo.

## Probar en tu computadora

```bash
npm install
npm run import     # importa los lugares del mapa
npm start          # abre http://localhost:3000
```

## Archivos

- `server.js` — servidor (Express + SQLite)
- `scripts/import-places.js` — importa lugares del mapa
- `public/` — páginas web (organizador y votación)
- `render.yaml` — configuración de deploy en Render
