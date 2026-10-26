import { del, list } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'Vercel Blob is not configured.' });
  }
  try {
    const expired = [];
    let cursor;
    do {
      const page = await list({ prefix: 'little-archive/qr/', limit: 1000, cursor, access: 'private' });
      for (const blob of page.blobs) {
        const match = /\/qr\/(\d+)-[\da-f-]{36}\.(?:jpg|png)$/.exec(blob.pathname);
        if (match && Number(match[1]) <= Date.now()) expired.push(blob.pathname);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    if (expired.length) await del(expired, { access: 'private' });
    return res.status(200).json({ deleted: expired.length });
  } catch (error) {
    console.error('Expired QR cleanup failed:', error);
    return res.status(500).json({ error: 'Could not clean expired photo shares.' });
  }
}
