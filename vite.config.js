import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

function localPhotoShares() {
  const shares = new Map();
  return {
    name: 'little-archive-local-photo-shares',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(req.url || '/', 'http://localhost');
        if (req.method === 'POST' && requestUrl.pathname === '/api/share') {
          if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Photo shares are only accepted from this local site.' }));
            return;
          }
          try {
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
              size += chunk.length;
              if (size > 30 * 1024 * 1024) throw new Error('The photo strip is too large for a QR download.');
              chunks.push(chunk);
            }
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl || '');
            if (!match) throw new Error('The photo strip could not be read. Please export it again.');
            const interfaces = Object.values(os.networkInterfaces()).flat().filter(entry => entry && entry.family === 'IPv4' && !entry.internal);
            const address = interfaces.find(entry => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address))?.address || interfaces[0]?.address;
            const serverAddress = server.httpServer?.address();
            const port = typeof serverAddress === 'object' && serverAddress ? serverAddress.port : server.config.server.port;
            if (!address) throw new Error('Could not find this computer’s local Wi-Fi address.');
            const id = randomUUID();
            const filename = String(body.filename || 'little-archive.png').replace(/[^a-zA-Z0-9._-]/g, '-');
            shares.set(id, { buffer: Buffer.from(match[2], 'base64'), type: match[1], filename, expires: Date.now() + 30 * 60 * 1000 });
            const expiry = setTimeout(() => shares.delete(id), 30 * 60 * 1000);
            expiry.unref?.();
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ url: `http://${address}:${port}/share/${id}` }));
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message || 'Could not create a QR download.' }));
          }
          return;
        }
        const shareMatch = /^\/share\/([\da-f-]{36})$/.exec(requestUrl.pathname);
        if (req.method === 'GET' && shareMatch) {
          const share = shares.get(shareMatch[1]);
          if (!share || share.expires < Date.now()) {
            shares.delete(shareMatch[1]);
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end('This photo download has expired.');
            return;
          }
          res.writeHead(200, {
            'Content-Type': share.type,
            'Content-Length': share.buffer.length,
            'Content-Disposition': `attachment; filename="${share.filename}"`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
          });
          res.end(share.buffer);
          return;
        }
        next();
      });
    }
  };
}

export default defineConfig({ plugins: [react(), localPhotoShares()] });
