# QR download storage setup for Vercel

The Vercel QR endpoint stores finished strips in a **private Vercel Blob store**. It returns a signed download link that works on other devices for 24 hours. The signed link expires after 24 hours; a daily Vercel Cron job removes expired files.

## One-time Vercel setup

1. In the Little Archive project in Vercel, open **Storage** and create a **Private Blob** store. Connect it to this project and enable the Production environment (enable Preview too if you want QR downloads on preview deployments).
2. Confirm Vercel added `BLOB_READ_WRITE_TOKEN` to the project environment variables. Redeploy after connecting the store.
3. Add `CRON_SECRET` as an environment variable with a random value of at least 16 characters, then redeploy. Vercel uses it to authenticate the scheduled cleanup function.

`QR_SHARE_SECRET` is optional. When omitted, the signed QR links use the Blob token as their signing secret. No token or photo is sent to the browser except the user's finished image upload to the private store.

The local Vite server keeps its same-Wi-Fi QR behavior; cross-device QR links are handled by the Vercel functions in production.
