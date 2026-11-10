import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';

function localPhotoShares() {
  const shares = new Map();
  const boothRooms = new Map();
  return {
    name: 'little-archive-local-photo-shares',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(req.url || '/', 'http://localhost');
      if (req.method === 'POST' && requestUrl.pathname === '/api/booth-room') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Shared booths are only accepted from this local site.' }));
          return;
        }
        try {
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 4 * 1024 * 1024) throw new Error('A booth update is too large. Try again with fewer photos.');
            chunks.push(chunk);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const send = (status, value) => {
            res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(value));
          };
          const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
          const validateCode = value => {
            const code = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (!new RegExp(`^[${alphabet}]{6}$`).test(code)) throw new Error('Enter the 6-letter code from your friend.');
            return code;
          };
          const validateId = value => {
            const id = String(value || '');
            if (!/^[\da-f-]{36}$/i.test(id)) throw new Error('This booth could not identify your device. Please try again.');
            return id;
          };
          const stateFor = room => ({ room: { code: room.code, layoutId: room.layoutId, captureDelay: room.captureDelay ?? 3, sessionId: room.sessionId, sessionStartedAt: room.sessionStartedAt, createdAt: room.createdAt, expiresAt: room.expiresAt }, host: room.host, guest: room.guest, hostSignal: room.hostSignal || null, guestSignal: room.guestSignal || null, version: `${room.sessionId || ''}:${room.host?.lastSeenAt || 0}:${room.host?.ready ? 1 : 0}:${room.host?.left ? 1 : 0}:${room.host?.photos?.length || 0}:${room.guest?.lastSeenAt || 0}:${room.guest?.ready ? 1 : 0}:${room.guest?.left ? 1 : 0}:${room.guest?.photos?.length || 0}:${room.hostSignal?.updatedAt || 0}:${room.guestSignal?.updatedAt || 0}` });
          if (body.action === 'create') {
            const participantId = validateId(body.participantId);
            if (!/^(strip3|strip4|grid6|portrait1|landscape1|triple3|collage3a|collage3b|grid4|pair2|pair2stack)$/.test(body.layoutId || '')) throw new Error('Choose a photo format before creating your booth.');
            let code;
            do { code = Array.from(randomBytes(6), byte => alphabet[byte % alphabet.length]).join(''); } while (boothRooms.has(code));
            const now = Date.now();
            const room = { code, layoutId: body.layoutId, captureDelay: 3, createdAt: now, expiresAt: now + 3 * 60 * 60 * 1000, sessionId: null, sessionStartedAt: null, hostSignal: null, guestSignal: null, host: { id: participantId, name: String(body.name || 'Host').slice(0, 24), photos: [], ready: false, left: false, lastSeenAt: now }, guest: null };
            boothRooms.set(code, room);
            return send(200, stateFor(room));
          }
          const code = validateCode(body.code);
          const room = boothRooms.get(code);
          if (!room || room.expiresAt <= Date.now()) { boothRooms.delete(code); return send(404, { error: 'That booth code was not found or has expired.' }); }
          if (body.action === 'join') {
            const participantId = validateId(body.participantId);
            if (room.host.id !== participantId && room.guest && room.guest.id !== participantId) return send(409, { error: 'This booth already has two people in it.' });
            if (room.host.id !== participantId && !room.guest) room.guest = { id: participantId, name: String(body.name || 'Guest').slice(0, 24), photos: [], ready: false, left: false, lastSeenAt: Date.now() };
            else if (room.guest?.id === participantId && room.guest.left) room.guest = { ...room.guest, left: false, ready: false, lastSeenAt: Date.now() };
            return send(200, stateFor(room));
          }
          const participantId = validateId(body.participantId);
          const role = room.host.id === participantId ? 'host' : room.guest?.id === participantId ? 'guest' : null;
          if (!role) return send(403, { error: 'This device is not connected to that booth. Check the code and join again.' });
          if (body.action === 'signal') {
            const key = role === 'host' ? 'hostSignal' : 'guestSignal';
            const current = room[key] || { description: null, candidates: [], updatedAt: 0 };
            const next = { ...current, candidates: [...(current.candidates || [])] };
            if (body.description) {
              const expectedType = role === 'host' ? 'offer' : 'answer';
              if (body.description.type !== expectedType || typeof body.description.sdp !== 'string' || body.description.sdp.length > 20000) throw new Error('The live camera connection could not be prepared.');
              next.description = { type: expectedType, sdp: body.description.sdp };
            }
            if (body.candidate) {
              const candidate = body.candidate;
              if (typeof candidate.candidate !== 'string' || candidate.candidate.length > 4000 || next.candidates.length >= 64) throw new Error('The live camera connection sent an invalid network route.');
              if (!next.candidates.some(item => item.candidate === candidate.candidate)) next.candidates.push({ candidate: candidate.candidate, sdpMid: typeof candidate.sdpMid === 'string' ? candidate.sdpMid : null, sdpMLineIndex: Number.isInteger(candidate.sdpMLineIndex) ? candidate.sdpMLineIndex : null, usernameFragment: typeof candidate.usernameFragment === 'string' ? candidate.usernameFragment : undefined });
            }
            next.updatedAt = Date.now();
            room[key] = next;
            return send(200, stateFor(room));
          }
          if (body.action === 'read') {
            const current = stateFor(room);
            if (body.version && body.version === current.version) return send(200, { unchanged: true, version: current.version });
            return send(200, current);
          }
          if (body.action === 'start') {
            if (role !== 'host') return send(403, { error: 'Ask the booth creator to start the shared photo session.' });
            if (!room.guest || room.guest.left || Date.now() - room.guest.lastSeenAt > 25_000) return send(409, { error: 'Your friend needs to be in the booth and camera ready first.' });
            if (!room.host.ready || !room.guest.ready) return send(409, { error: 'Both cameras need to be ready before you start.' });
            const now = Date.now();
            room.host = { ...room.host, photos: [], ready: true, lastSeenAt: now };
            room.guest = { ...room.guest, photos: [], ready: true, lastSeenAt: now };
            room.captureDelay = [0, 3, 5, 10].includes(Number(body.delay)) ? Number(body.delay) : 3;
            room.sessionId = randomUUID();
            room.sessionStartedAt = now + 4_000;
            return send(200, stateFor(room));
          }
          if (body.action === 'update' || body.action === 'ping') {
            const current = room[role];
            if (body.action === 'update' && Object.hasOwn(body, 'photos')) {
              if (!Array.isArray(body.photos) || body.photos.length > 6 || body.photos.some(photo => typeof photo !== 'string' || photo.length > 900_000 || !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(photo))) throw new Error('A booth photo could not be shared. Try again with a smaller photo.');
              current.photos = body.photos;
            }
            if (Object.hasOwn(body, 'ready')) current.ready = !!body.ready;
            if (Object.hasOwn(body, 'left')) { current.left = !!body.left; if (body.left) current.ready = false; }
            current.lastSeenAt = Date.now();
            return send(200, stateFor(room));
          }
          return send(400, { error: 'Choose a booth action and try again.' });
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: error.message || 'The shared booth request could not be completed.' }));
          return;
        }
      }
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
