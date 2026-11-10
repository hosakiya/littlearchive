import { BlobNotFoundError, get, put } from '@vercel/blob';
import { randomBytes, randomUUID } from 'node:crypto';

const ROOM_LIFETIME_MS = 3 * 60 * 60 * 1000;
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;

function respond(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function roomPath(code) { return `little-archive/booths/${code}/room.json`; }
function personPath(code, role) { return `little-archive/booths/${code}/${role}.json`; }
function signalPath(code, role) { return `little-archive/booths/${code}/${role}-signal.json`; }

async function readJson(pathname) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const blob = await get(pathname, { access: 'private', useCache: false });
      if (!blob || blob.statusCode === 404) return null;
      if (blob.statusCode !== 200 || !blob.stream) throw new Error(`Vercel Blob returned ${blob.statusCode || 'an empty response'} while reading ${pathname}.`);
      return JSON.parse(await new Response(blob.stream).text());
    } catch (error) {
      if (error instanceof BlobNotFoundError || error?.name === 'BlobNotFoundError' || error?.statusCode === 404) return null;
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function writeJson(pathname, value, allowOverwrite = true) {
  return put(pathname, JSON.stringify(value), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite,
    contentType: 'application/json; charset=utf-8',
    cacheControlMaxAge: 60,
  });
}

function validateCode(value) {
  const code = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(code)) throw new Error('Enter the 6-letter code from your friend.');
  return code;
}

function validateParticipantId(value) {
  const id = String(value || '');
  if (!/^[\da-f-]{36}$/i.test(id)) throw new Error('This booth could not identify your device. Please try again.');
  return id;
}

function validatePhotos(value) {
  if (!Array.isArray(value) || value.length > 6) throw new Error('This booth can hold up to 6 photos per person.');
  for (const photo of value) {
    if (typeof photo !== 'string' || photo.length > 900_000 || !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(photo)) {
      throw new Error('A booth photo could not be shared. Try again with a smaller photo.');
    }
  }
  return value;
}

function publicRoom(room) {
  return {
    code: room.code,
    layoutId: room.layoutId,
    captureDelay: room.captureDelay ?? 3,
    sessionId: room.sessionId || null,
    sessionStartedAt: room.sessionStartedAt || null,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
  };
}

async function readRoomState(code) {
  const room = await readJson(roomPath(code));
  if (!room || room.expiresAt <= Date.now()) return null;
  const [host, guest, hostSignal, guestSignal] = await Promise.all([
    readJson(personPath(code, 'host')),
    readJson(personPath(code, 'guest')),
    readJson(signalPath(code, 'host')),
    readJson(signalPath(code, 'guest')),
  ]);
  return { room, host, guest, hostSignal, guestSignal };
}

function requireLiveRoom(state) {
  if (!state) {
    const error = new Error('That booth code was not found or has expired.');
    error.statusCode = 404;
    throw error;
  }
  return state;
}

function requireParticipant(state, participantId) {
  if (state.host?.id === participantId) return 'host';
  if (state.guest?.id === participantId) return 'guest';
  const error = new Error('This device is not connected to that booth. Check the code and join again.');
  error.statusCode = 403;
  throw error;
}

function responseState(state) {
  return {
    room: publicRoom(state.room),
    host: state.host,
    guest: state.guest,
    hostSignal: state.hostSignal || null,
    guestSignal: state.guestSignal || null,
    version: `${state.room.sessionId || ''}:${state.host?.lastSeenAt || 0}:${state.host?.ready ? 1 : 0}:${state.host?.left ? 1 : 0}:${state.host?.photos?.length || 0}:${state.guest?.lastSeenAt || 0}:${state.guest?.ready ? 1 : 0}:${state.guest?.left ? 1 : 0}:${state.guest?.photos?.length || 0}:${state.hostSignal?.updatedAt || 0}:${state.guestSignal?.updatedAt || 0}`,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respond(res, 405, { error: 'Method not allowed.' });
  }
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) {
    return respond(res, 503, { error: 'Shared booths need a Vercel Blob store connected to this project. Connect the store, then redeploy.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const action = String(body.action || '');

    if (action === 'create') {
      const participantId = validateParticipantId(body.participantId);
      const layoutId = String(body.layoutId || 'strip3');
      if (!/^(strip3|strip4|grid6|portrait1|landscape1|triple3|collage3a|collage3b|grid4|pair2|pair2stack)$/.test(layoutId)) {
        return respond(res, 400, { error: 'Choose a photo format before creating your booth.' });
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const bytes = randomBytes(CODE_LENGTH);
        const code = Array.from(bytes, byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
        const now = Date.now();
        const room = { code, layoutId, hostId: participantId, captureDelay: 3, createdAt: now, expiresAt: now + ROOM_LIFETIME_MS, sessionId: null, sessionStartedAt: null };
        try {
          await writeJson(roomPath(code), room, false);
          const host = { id: participantId, name: String(body.name || 'Host').slice(0, 24), photos: [], ready: false, left: false, lastSeenAt: now };
          await writeJson(personPath(code, 'host'), host, false);
          await Promise.all([
            writeJson(signalPath(code, 'host'), { description: null, candidates: [], updatedAt: now }, false),
            writeJson(signalPath(code, 'guest'), { description: null, candidates: [], updatedAt: now }, false),
          ]);
          return respond(res, 200, responseState({ room, host, guest: null, hostSignal: null, guestSignal: null }));
        } catch (error) {
          if (attempt === 4) throw error;
        }
      }
    }

    const code = validateCode(body.code);
    const state = requireLiveRoom(await readRoomState(code));

    if (action === 'join') {
      const participantId = validateParticipantId(body.participantId);
      if (state.host?.id === participantId) return respond(res, 200, responseState(state));
      if (state.guest?.id && state.guest.id !== participantId) {
        return respond(res, 409, { error: 'This booth already has two people in it.' });
      }
      let guest = state.guest;
      if (!guest) {
        const now = Date.now();
        guest = { id: participantId, name: String(body.name || 'Guest').slice(0, 24), photos: [], ready: false, left: false, lastSeenAt: now };
        try {
          await writeJson(personPath(code, 'guest'), guest, false);
        } catch {
          const latest = await readJson(personPath(code, 'guest'));
          if (latest?.id !== participantId) return respond(res, 409, { error: 'This booth already has two people in it.' });
          guest = latest;
        }
      } else if (guest.left) {
        guest = { ...guest, left: false, ready: false, lastSeenAt: Date.now() };
        await writeJson(personPath(code, 'guest'), guest);
      }
      return respond(res, 200, responseState({ ...state, guest }));
    }

    const participantId = validateParticipantId(body.participantId);
    const role = requireParticipant(state, participantId);

    if (action === 'read') {
      const current = responseState(state);
      if (body.version && body.version === current.version) return respond(res, 200, { unchanged: true, version: current.version });
      return respond(res, 200, current);
    }

    if (action === 'start') {
      if (role !== 'host') return respond(res, 403, { error: 'Ask the booth creator to start the shared photo session.' });
      if (!state.guest || state.guest.left || Date.now() - state.guest.lastSeenAt > 25_000) {
        return respond(res, 409, { error: 'Your friend needs to be in the booth and camera ready first.' });
      }
      if (!state.host.ready || !state.guest.ready) return respond(res, 409, { error: 'Both cameras need to be ready before you start.' });
      const now = Date.now();
      const host = { ...state.host, photos: [], ready: true, left: false, lastSeenAt: now };
      const guest = { ...state.guest, photos: [], ready: true, left: false, lastSeenAt: now };
      const captureDelay = [0, 3, 5, 10].includes(Number(body.delay)) ? Number(body.delay) : 3;
      const room = { ...state.room, captureDelay, sessionId: randomUUID(), sessionStartedAt: now + 4_000 };
      await Promise.all([
        writeJson(personPath(code, 'host'), host),
        writeJson(personPath(code, 'guest'), guest),
        writeJson(roomPath(code), room),
      ]);
      return respond(res, 200, responseState({ ...state, room, host, guest }));
    }

    if (action === 'signal') {
      const key = role === 'host' ? 'hostSignal' : 'guestSignal';
      const current = state[key] || { description: null, candidates: [], updatedAt: 0 };
      const next = { ...current, candidates: [...(current.candidates || [])] };
      if (body.description) {
        const expectedType = role === 'host' ? 'offer' : 'answer';
        if (body.description.type !== expectedType || typeof body.description.sdp !== 'string' || body.description.sdp.length > 20_000) {
          return respond(res, 400, { error: 'The live camera connection could not be prepared.' });
        }
        next.description = { type: expectedType, sdp: body.description.sdp };
      }
      if (body.candidate) {
        const candidate = body.candidate;
        if (typeof candidate.candidate !== 'string' || candidate.candidate.length > 4_000 || next.candidates.length >= 64) {
          return respond(res, 400, { error: 'The live camera connection sent an invalid network route.' });
        }
        if (!next.candidates.some(item => item.candidate === candidate.candidate)) {
          next.candidates.push({
            candidate: candidate.candidate,
            sdpMid: typeof candidate.sdpMid === 'string' ? candidate.sdpMid : null,
            sdpMLineIndex: Number.isInteger(candidate.sdpMLineIndex) ? candidate.sdpMLineIndex : null,
            usernameFragment: typeof candidate.usernameFragment === 'string' ? candidate.usernameFragment : undefined,
          });
        }
      }
      next.updatedAt = Date.now();
      await writeJson(signalPath(code, role), next);
      return respond(res, 200, responseState({ ...state, [key]: next }));
    }

    if (action === 'update' || action === 'ping') {
      const current = state[role];
      const next = {
        ...current,
        ...(action === 'update' && Object.hasOwn(body, 'photos') ? { photos: validatePhotos(body.photos) } : {}),
        ...(Object.hasOwn(body, 'ready') ? { ready: !!body.ready } : {}),
        ...(Object.hasOwn(body, 'left') ? { left: !!body.left, ready: body.left ? false : !!body.ready } : {}),
        lastSeenAt: Date.now(),
      };
      await writeJson(personPath(code, role), next);
      return respond(res, 200, responseState({ ...state, [role]: next }));
    }

    return respond(res, 400, { error: 'Choose a booth action and try again.' });
  } catch (error) {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : error?.name?.startsWith('Blob') ? 503 : 400;
    if (status >= 500) console.error('Shared booth request failed:', error);
    return respond(res, status, { error: status >= 500 ? 'The shared booth could not be updated. Please try again.' : error.message || 'The shared booth request could not be completed.' });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };
