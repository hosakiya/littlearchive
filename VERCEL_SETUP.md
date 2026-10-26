# QR download storage setup for Vercel

The Vercel QR endpoint stores finished strips in a **private Vercel Blob store**. Its one-time download link works on other devices for 24 hours; a daily Vercel Cron job removes expired files.

## Vercel setup

1. In the Blob store’s **Projects** tab, make sure `littlearchive` is connected to Production (and Preview if desired). If it is already listed, do not connect it again.
2. The current Vercel OIDC connection adds `BLOB_STORE_ID` and `BLOB_WEBHOOK_PUBLIC_KEY`; that is expected. The installed `@vercel/blob` SDK uses Vercel’s short-lived OIDC credentials automatically, so a long-lived `BLOB_READ_WRITE_TOKEN` is not required.
3. Add `CRON_SECRET` under the project’s **Settings → Environment Variables**, using a random value of at least 16 characters. This authenticates scheduled cleanup.
4. Redeploy the latest `main` commit after connecting the store and adding `CRON_SECRET`.

QR download URLs contain a random, unguessable file identifier and expire after 24 hours. The photo is stored in a private Blob store and streamed through the app’s Vercel Function.

The local Vite server keeps its same-Wi-Fi QR behavior; cross-device QR links are handled by the Vercel functions in production.
