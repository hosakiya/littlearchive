import type { FaceLandmarker as FaceLandmarkerTask, HandLandmarker as HandLandmarkerTask, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { motion } from 'motion/react';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { CaptureSettings, FaceFilterCanvasHandle, FaceFilterDefinition, FaceFilterId, FaceTrackingState } from './types';

export const faceFilters: FaceFilterDefinition[] = [
  { id: 'none', name: 'No AR', description: 'keep the camera natural' },
  { id: 'puppy', name: 'Puppy ears', description: 'soft floppy ears', asset: '/ar-filters/puppy-ears.svg' },
  { id: 'cat', name: 'Cat ears', description: 'pointed ears and whiskers', asset: '/ar-filters/cat-ears.svg' },
  { id: 'red-cat-ears', name: 'Red cat ears', description: 'sketched red ears', asset: '/ar-filters/red-cat-ears.png' },
  { id: 'star-glasses', name: 'Star glasses', description: 'round glasses with a star', asset: '/ar-filters/star-glasses.png' },
  { id: 'heart-halo', name: 'Heart halo', description: 'a little arc of floating hearts', asset: '/ar-filters/heart-halo.png' },
  { id: 'paw-blush', name: 'Paw blush', description: 'pink cheek accents with soft stripes', asset: '/ar-filters/pink-paw-blush.png' },
  { id: 'bubbles', name: 'Magic bubbles', description: 'raise or wiggle your fingers to release bubbles', asset: '/ar-filters/bubble-halo.png' },
];

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const BUBBLE_ASSETS = ['/ar-filters/bubble-halo.png', '/ar-filters/clear-bubble.png', '/ar-filters/pink-bubble.png'] as const;
const assetUrls = Object.fromEntries(faceFilters.flatMap(({ id, asset }) => asset ? [[id, asset]] : [])) as Partial<Record<FaceFilterId, string>>;
const landmark = (points: NormalizedLandmark[], index: number, width: number, height: number) => ({ x: points[index].x * width, y: points[index].y * height });

export function captureFaceFilterFrame(video: HTMLVideoElement, drawOverlay: ((context: CanvasRenderingContext2D, width: number, height: number) => void) | null, settings: CaptureSettings): string | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const width = settings.width || video.videoWidth;
  const height = settings.height || video.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.save();
  if (settings.mirrorPreview) {
    context.translate(width, 0);
    context.scale(-1, 1);
  }
  context.filter = settings.colorFilter;
  context.drawImage(video, 0, 0, width, height);
  context.filter = 'none';
  if (drawOverlay && settings.faceFilter !== 'none') drawOverlay(context, width, height);
  context.restore();
  return canvas.toDataURL(settings.mimeType, settings.quality);
}

function paintFilter(ctx: CanvasRenderingContext2D, points: NormalizedLandmark[] | null, filter: FaceFilterId, images: Partial<Record<FaceFilterId, HTMLImageElement>>, width: number, height: number, clear = true) {
  if (clear) ctx.clearRect(0, 0, width, height);
  if (!points || filter === 'none' || filter === 'bubbles' || width === 0 || height === 0) return;
  const leftFace = landmark(points, 234, width, height);
  const rightFace = landmark(points, 454, width, height);
  const leftEye = landmark(points, 33, width, height);
  const rightEye = landmark(points, 263, width, height);
  const eyeMid = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
  const faceWidth = Math.hypot(rightFace.x - leftFace.x, rightFace.y - leftFace.y);
  const angle = Math.atan2(rightFace.y - leftFace.y, rightFace.x - leftFace.x);
  const image = images[filter];
  if (!image?.complete || !image.naturalWidth || !faceWidth) return;

  const placements: Record<Exclude<FaceFilterId, 'none' | 'bubbles'>, { width: number; height: number; y: number }> = {
    puppy: { width: faceWidth * 1.55, height: faceWidth * .82, y: -faceWidth * .53 },
    cat: { width: faceWidth * 1.36, height: faceWidth * .65, y: -faceWidth * .73 },
    'red-cat-ears': { width: faceWidth * 1.34, height: faceWidth * .60, y: -faceWidth * .73 },
    'star-glasses': { width: faceWidth * 1.22, height: faceWidth * .52, y: faceWidth * .01 },
    'heart-halo': { width: faceWidth * 1.35, height: faceWidth * .54, y: -faceWidth * 1.02 },
    'paw-blush': { width: faceWidth * 1.35, height: faceWidth * .36, y: faceWidth * .29 },
  };
  const { width: drawWidth, height: drawHeight, y } = placements[filter];
  ctx.save();
  ctx.translate(eyeMid.x, eyeMid.y);
  ctx.rotate(angle);
  ctx.drawImage(image, -drawWidth / 2, y - drawHeight / 2, drawWidth, drawHeight);
  if (filter === 'cat') {
    const nose = landmark(points, 1, width, height);
    const localNoseY = (nose.y - eyeMid.y) / faceWidth;
    const noseY = localNoseY * faceWidth + faceWidth * .03;
    ctx.strokeStyle = '#604b61';
    ctx.lineWidth = Math.max(1.5, faceWidth * .006);
    ctx.lineCap = 'round';
    [-1, 1].forEach((side) => {
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.moveTo(side * faceWidth * .12, noseY + i * faceWidth * .045);
        ctx.quadraticCurveTo(side * faceWidth * .35, noseY - faceWidth * .03 + i * faceWidth * .07, side * faceWidth * .58, noseY - faceWidth * .08 + i * faceWidth * .16);
        ctx.stroke();
      }
    });
  }
  ctx.restore();
}

function smoothLandmarks(next: NormalizedLandmark[], previous: NormalizedLandmark[] | null): NormalizedLandmark[] {
  if (!previous || previous.length !== next.length) return next;
  const blend = .42;
  return next.map((point, index) => ({
    x: previous[index].x + (point.x - previous[index].x) * blend,
    y: previous[index].y + (point.y - previous[index].y) * blend,
    z: (previous[index].z ?? 0) + ((point.z ?? 0) - (previous[index].z ?? 0)) * blend,
    visibility: point.visibility,
  }));
}

interface BubbleParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  age: number;
  life: number;
  rotation: number;
  asset: (typeof BUBBLE_ASSETS)[number];
}

const fingerPoints = [
  { tip: 4, base: 2, thumb: true },
  { tip: 8, base: 6 },
  { tip: 12, base: 10 },
  { tip: 16, base: 14 },
  { tip: 20, base: 18 },
];

function createBubbleBurst(particles: BubbleParticle[], x: number, y: number, amount: number) {
  for (let index = 0; index < amount; index++) {
    const asset = BUBBLE_ASSETS[Math.floor(Math.random() * BUBBLE_ASSETS.length)];
    particles.push({
      x: x + (Math.random() - .5) * .025,
      y: y + (Math.random() - .5) * .02,
      vx: (Math.random() - .5) * .10,
      vy: -.045 - Math.random() * .12,
      size: .035 + Math.random() * .045,
      age: 0,
      life: 1.1 + Math.random() * .8,
      rotation: (Math.random() - .5) * .45,
      asset,
    });
  }
  if (particles.length > 70) particles.splice(0, particles.length - 70);
}

function detectRaisedFingers(hands: NormalizedLandmark[][], previousPositions: Map<string, { x: number; y: number }>, lastEmittedAt: Map<string, number>, particles: BubbleParticle[], now: number) {
  const seen = new Set<string>();
  hands.forEach((hand, handIndex) => {
    const wrist = hand[0];
    if (!wrist) return;
    fingerPoints.forEach(({ tip: tipIndex, base: baseIndex, thumb }) => {
      const tip = hand[tipIndex];
      const base = hand[baseIndex];
      if (!tip || !base) return;
      const wristToTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
      const wristToBase = Math.hypot(base.x - wrist.x, base.y - wrist.y);
      const isRaised = thumb ? wristToTip > wristToBase * 1.1 : wristToTip > wristToBase * 1.08;
      if (!isRaised) return;
      const key = `${handIndex}:${tipIndex}`;
      seen.add(key);
      const previous = previousPositions.get(key);
      const movement = previous ? Math.hypot(tip.x - previous.x, tip.y - previous.y) : 0;
      previousPositions.set(key, { x: tip.x, y: tip.y });
      const lastEmission = lastEmittedAt.get(key) ?? 0;
      const moving = movement > .012;
      if (moving || now - lastEmission > 180) {
        const numberOfBubbles = moving ? Math.min(5, Math.max(2, 1 + Math.floor(movement / .018))) : 1;
        createBubbleBurst(particles, tip.x, tip.y, numberOfBubbles);
        lastEmittedAt.set(key, now);
      }
    });
  });
  for (const key of previousPositions.keys()) if (!seen.has(key)) previousPositions.delete(key);
  for (const key of lastEmittedAt.keys()) if (!seen.has(key)) lastEmittedAt.delete(key);
}

function updateBubbles(particles: BubbleParticle[], previousTime: { value: number }, now: number) {
  const delta = Math.min(.05, Math.max(0, (now - previousTime.value) / 1000));
  previousTime.value = now;
  for (const particle of particles) {
    particle.age += delta;
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
    particle.vy -= .012 * delta;
  }
  for (let i = particles.length - 1; i >= 0; i--) if (particles[i].age >= particles[i].life) particles.splice(i, 1);
}

function drawBubbles(ctx: CanvasRenderingContext2D, particles: BubbleParticle[], images: Partial<Record<(typeof BUBBLE_ASSETS)[number], HTMLImageElement>>, width: number, height: number) {
  particles.forEach((particle) => {
    const image = images[particle.asset];
    if (!image?.complete || !image.naturalWidth) return;
    const progress = particle.age / particle.life;
    const scale = Math.min(1, particle.age * 9) * (1 - progress * .18);
    const drawWidth = particle.size * width * scale;
    const drawHeight = drawWidth * image.naturalHeight / image.naturalWidth;
    const opacity = Math.min(1, particle.age * 8, (1 - progress) * 2.3);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(particle.x * width, particle.y * height);
    ctx.rotate(particle.rotation);
    ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    ctx.restore();
  });
}

interface FaceFilterCanvasProps {
  video: HTMLVideoElement | null;
  selectedFilter: FaceFilterId;
  active: boolean;
  onStatus: (state: FaceTrackingState) => void;
}

export const FaceFilterCanvas = forwardRef<FaceFilterCanvasHandle, FaceFilterCanvasProps>(function FaceFilterCanvas({ video, selectedFilter, active, onStatus }, forwardedRef) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modelRef = useRef<FaceLandmarkerTask | null>(null);
  const handModelRef = useRef<HandLandmarkerTask | null>(null);
  const pointsRef = useRef<NormalizedLandmark[] | null>(null);
  const filterRef = useRef(selectedFilter);
  const imagesRef = useRef<Partial<Record<FaceFilterId, HTMLImageElement>>>({});
  const bubbleImagesRef = useRef<Partial<Record<(typeof BUBBLE_ASSETS)[number], HTMLImageElement>>>({});
  const bubblesRef = useRef<BubbleParticle[]>([]);
  const previousFingerPositionsRef = useRef(new Map<string, { x: number; y: number }>());
  const lastFingerEmissionRef = useRef(new Map<string, number>());
  const bubbleClockRef = useRef({ value: performance.now() });
  const statusCallbackRef = useRef(onStatus);
  filterRef.current = selectedFilter;
  statusCallbackRef.current = onStatus;
  useImperativeHandle(forwardedRef, () => ({
    getCanvas: () => canvasRef.current,
    drawTo: (context, width, height) => {
      if (modelRef.current && video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth) {
        try {
          const result = modelRef.current.detectForVideo(video, performance.now());
          const detected = result.faceLandmarks[0] ?? null;
          if (detected) pointsRef.current = smoothLandmarks(detected, pointsRef.current);
        } catch {
          // Keep the most recent tracked face so a transient inference hiccup does not block capture.
        }
        if (filterRef.current === 'bubbles' && handModelRef.current) {
          try {
            const hands = handModelRef.current.detectForVideo(video, performance.now());
            detectRaisedFingers(hands.landmarks, previousFingerPositionsRef.current, lastFingerEmissionRef.current, bubblesRef.current, performance.now());
          } catch {
            // The last bubble particles still render if a hand-tracking frame is skipped.
          }
        }
      }
      paintFilter(context, pointsRef.current, filterRef.current, imagesRef.current, width, height, false);
      if (filterRef.current === 'bubbles') {
        const now = performance.now();
        updateBubbles(bubblesRef.current, bubbleClockRef.current, now);
        drawBubbles(context, bubblesRef.current, bubbleImagesRef.current, width, height);
      }
    },
  }), [video]);

  useEffect(() => {
    faceFilters.forEach(({ id, asset }) => {
      if (!asset || imagesRef.current[id]) return;
      const image = new Image();
      image.src = asset;
      imagesRef.current[id] = image;
    });
    BUBBLE_ASSETS.forEach((asset) => {
      if (bubbleImagesRef.current[asset]) return;
      const image = new Image();
      image.src = asset;
      bubbleImagesRef.current[asset] = image;
    });
  }, []);

  useEffect(() => {
    if (!active || !video) return;
    let cancelled = false;
    let raf = 0;
    let previousVideoTime = -1;
    let lastDetectionAt = 0;
    let lastPublishedState: FaceTrackingState | null = null;
    let handLandmarker: HandLandmarkerTask | null = null;
    let handLoading = false;
    let handFailed = false;
    const publish = (state: FaceTrackingState) => {
      if (state !== lastPublishedState) {
        lastPublishedState = state;
        statusCallbackRef.current(state);
      }
    };
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: true, desynchronized: true });
    if (!canvas || !context) {
      publish('unsupported');
      return;
    }
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype) && typeof requestAnimationFrame !== 'function') {
      publish('unsupported');
      return;
    }
    publish('loading');

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
          publish('unsupported');
          return;
        }
        const { FaceLandmarker, HandLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
        if (cancelled) return;
        const wasm = await FilesetResolver.forVisionTasks(WASM_ROOT);
        if (cancelled) return;
        let landmarker: FaceLandmarkerTask;
        try {
          landmarker = await FaceLandmarker.createFromOptions(wasm, {
            baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numFaces: 1,
            minFaceDetectionConfidence: .55,
            minFacePresenceConfidence: .5,
            minTrackingConfidence: .5,
          });
        } catch {
          landmarker = await FaceLandmarker.createFromOptions(wasm, {
            baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' },
            runningMode: 'VIDEO',
            numFaces: 1,
            minFaceDetectionConfidence: .55,
            minFacePresenceConfidence: .5,
            minTrackingConfidence: .5,
          });
        }
        if (cancelled) {
          landmarker.close();
          return;
        }
        modelRef.current = landmarker;
        const loadHandTracker = async () => {
          if (handLandmarker || handLoading || handFailed) return;
          handLoading = true;
          try {
            let tracker: HandLandmarkerTask;
            try {
              tracker = await HandLandmarker.createFromOptions(wasm, {
                baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
                runningMode: 'VIDEO', numHands: 2,
                minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .5,
              });
            } catch {
              tracker = await HandLandmarker.createFromOptions(wasm, {
                baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'CPU' },
                runningMode: 'VIDEO', numHands: 2,
                minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .5,
              });
            }
            if (cancelled) tracker.close();
            else {
              handLandmarker = tracker;
              handModelRef.current = tracker;
            }
          } catch {
            handFailed = true;
            publish('error');
          } finally {
            handLoading = false;
          }
        };
        const renderFrame = (now: number) => {
          if (cancelled) return;
          raf = requestAnimationFrame(renderFrame);
          if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || video.currentTime === previousVideoTime || now - lastDetectionAt < 30) return;
          previousVideoTime = video.currentTime;
          lastDetectionAt = now;
          try {
            if (filterRef.current === 'bubbles') {
              if (!handLandmarker) void loadHandTracker();
              else {
                const hands = handLandmarker.detectForVideo(video, now);
                detectRaisedFingers(hands.landmarks, previousFingerPositionsRef.current, lastFingerEmissionRef.current, bubblesRef.current, now);
              }
            }
            const result = landmarker.detectForVideo(video, now);
            const face = result.faceLandmarks[0] ?? null;
            const smoothed = face ? smoothLandmarks(face, pointsRef.current) : null;
            pointsRef.current = smoothed;
            if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
            }
            paintFilter(context, smoothed, filterRef.current, imagesRef.current, canvas.width, canvas.height);
            updateBubbles(bubblesRef.current, bubbleClockRef.current, now);
            drawBubbles(context, bubblesRef.current, bubbleImagesRef.current, canvas.width, canvas.height);
            publish(smoothed ? 'ready' : 'no-face');
          } catch {
            publish('error');
            cancelAnimationFrame(raf);
          }
        };
        publish('ready');
        raf = requestAnimationFrame(renderFrame);
      } catch {
        publish('error');
      }
    };
    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      handLandmarker?.close();
      handModelRef.current = null;
      modelRef.current?.close();
      modelRef.current = null;
      pointsRef.current = null;
      bubblesRef.current = [];
      previousFingerPositionsRef.current.clear();
      lastFingerEmissionRef.current.clear();
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [active, video]);

  return <canvas ref={canvasRef} className="ar-filter-canvas" aria-hidden="true"/>;
});

interface FaceFilterPickerProps {
  value: FaceFilterId;
  onChange: (id: FaceFilterId) => void;
  tracking: FaceTrackingState;
}

const statusText: Record<FaceTrackingState, string> = {
  idle: 'face filters are ready when you are',
  loading: 'warming up face tracking…',
  ready: 'face tracking is following you',
  'no-face': 'move into frame to try your filter',
  unsupported: 'face tracking needs a supported browser on HTTPS',
  error: 'could not load face tracking; your camera still works',
};

export function FaceFilterPicker({ value, onChange, tracking }: FaceFilterPickerProps) {
  const helperText = value === 'bubbles' && tracking !== 'unsupported' && tracking !== 'error'
    ? 'raise a finger to release bubbles, then wiggle it for a bigger burst'
    : statusText[tracking];
  return <section className="ar-filter-control" aria-label="Real-time face filters">
    <div className="ar-filter-heading"><label>FACE FILTERS</label><span className={`ar-tracking-status is-${tracking}`} aria-live="polite"><i/> {helperText}</span></div>
    <div className="ar-filter-list" role="group" aria-label="Choose a face filter">
      {faceFilters.map((filter) => <motion.button key={filter.id} type="button" className={value === filter.id ? 'active' : ''} onClick={() => onChange(filter.id)} aria-pressed={value === filter.id} title={filter.description} whileTap={{ scale: .96 }} animate={{ y: value === filter.id ? -2 : 0 }} transition={{ type: 'spring', stiffness: 340, damping: 24 }}>
        <span className={`ar-filter-swatch swatch-${filter.id}`}>{filter.id === 'none' ? <span className="filter-none-mark"/> : <img src={assetUrls[filter.id]} alt=""/>}</span>
        <span>{filter.name}</span>
      </motion.button>)}
    </div>
  </section>;
}
