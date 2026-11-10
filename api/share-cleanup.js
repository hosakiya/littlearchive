import { del, get, list } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) {
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
    const boothBlobs = [];
    cursor = undefined;
    do {
      const page = await list({ prefix: 'little-archive/booths/', limit: 1000, cursor, access: 'private' });
      boothBlobs.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    const expiredBoothPrefixes = [];
    for (const blob of boothBlobs.filter(item => /\/room\.json$/.test(item.pathname))) {
      const stored = await get(blob.pathname, { access: 'private', useCache: false });
      if (!stored || stored.statusCode !== 200 || !stored.stream) continue;
      const room = JSON.parse(await new Response(stored.stream).text());
      if (Number(room.expiresAt) <= Date.now()) expiredBoothPrefixes.push(blob.pathname.replace(/room\.json$/, ''));
    }
    const expiredBoothBlobs = boothBlobs.filter(blob => expiredBoothPrefixes.some(prefix => blob.pathname.startsWith(prefix))).map(blob => blob.pathname);
    if (expiredBoothBlobs.length) await del(expiredBoothBlobs, { access: 'private' });
    return res.status(200).json({ deleted: expired.length, deletedBooths: expiredBoothPrefixes.length });
  } catch (error) {
    console.error('Expired private storage cleanup failed:', error);
    return res.status(500).json({ error: 'Could not clean expired private shares.' });
  }
}
