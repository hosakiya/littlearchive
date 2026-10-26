import { randomUUID } from 'node:crypto';
import { get, put } from '@vercel/blob';

const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
const LINK_LIFETIME_MS = 24 * 60 * 60 * 1000;

function respond(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function validateSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return new URL(origin).host === host; } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    if (!validateSameOrigin(req)) return respond(res, 403, { error: 'Please create the QR from the Little Archive site.' });
    if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) return respond(res, 503, { error: 'QR downloads need a Vercel Blob store connected to this project. Redeploy after connecting it.' });
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(body?.dataUrl || '');
      if (!match) return respond(res, 400, { error: 'The photo strip could not be read. Please try again.' });
      const bytes = Buffer.from(match[2], 'base64');
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return respond(res, 413, { error: 'This strip is too large for a QR download. Try a smaller photo format.' });

      const expires = Date.now() + LINK_LIFETIME_MS;
      const pathname = `little-archive/qr/${expires}-${randomUUID()}.${match[1] === 'jpeg' ? 'jpg' : 'png'}`;
      await put(pathname, bytes, {
        access: 'private',
        contentType: match[1] === 'jpeg' ? 'image/jpeg' : 'image/png',
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
      });

      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const downloadUrl = new URL('/api/share', `${protocol}://${host}`);
      downloadUrl.searchParams.set('file', pathname);
      downloadUrl.searchParams.set('expires', String(expires));
      return respond(res, 200, { url: downloadUrl.toString(), expiresAt: new Date(expires).toISOString() });
    } catch (error) {
      console.error('QR share upload failed:', error);
      return respond(res, 500, { error: 'The private photo upload failed. Please try again in a moment.' });
    }
  }

  if (req.method === 'GET') {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const pathname = url.searchParams.get('file') || '';
    const expires = Number(url.searchParams.get('expires'));
    const pathMatch = /^little-archive\/qr\/(\d+)-[\da-f-]{36}\.(?:jpg|png)$/.exec(pathname);
    if (!pathMatch || !Number.isFinite(expires) || Number(pathMatch[1]) !== expires) {
      return res.status(400).send('This photo link is invalid.');
    }
    if (expires <= Date.now()) return res.status(410).send('This photo link has expired.');
    try {
      const result = await get(pathname, { access: 'private' });
      if (!result || result.statusCode !== 200 || !result.stream) return res.status(404).send('This photo could not be found.');
      const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
      const ext = pathname.endsWith('.png') ? 'png' : 'jpg';
      res.statusCode = 200;
      res.setHeader('Content-Type', ext === 'png' ? 'image/png' : 'image/jpeg');
      res.setHeader('Content-Disposition', `attachment; filename="little-archive-memory.${ext}"`);
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.end(bytes);
    } catch (error) {
      console.error('QR share download failed:', error);
      return res.status(500).send('The photo download could not be opened. Please try again.');
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return respond(res, 405, { error: 'Method not allowed.' });
}

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };
