import type { FaceLandmarker as FaceLandmarkerTask, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { motion } from 'motion/react';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { CaptureSettings, FaceFilterCanvasHandle, FaceFilterDefinition, FaceFilterId, FaceTrackingState } from './types';

export const faceFilters: FaceFilterDefinition[] = [
  { id: 'none', name: 'No AR', description: 'keep the camera natural' },
  { id: 'puppy', name: 'Puppy ears', description: 'soft floppy ears', asset: '/ar-filters/puppy-ears.svg' },
  { id: 'cat', name: 'Cat ears', description: 'pointed ears and whiskers', asset: '/ar-filters/cat-ears.svg' },
  { id: 'heart-glasses', name: 'Heart glasses', description: 'blush tinted frames', asset: '/ar-filters/heart-glasses.svg' },
  { id: 'bow', name: 'Pink bow', description: 'a little ribbon above your hair', asset: '/ar-filters/bow.svg' },
];

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
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
  if (!points || filter === 'none' || width === 0 || height === 0) return;
  const leftFace = landmark(points, 234, width, height);
  const rightFace = landmark(points, 454, width, height);
  const leftEye = landmark(points, 33, width, height);
  const rightEye = landmark(points, 263, width, height);
  const eyeMid = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
  const faceWidth = Math.hypot(rightFace.x - leftFace.x, rightFace.y - leftFace.y);
  const angle = Math.atan2(rightFace.y - leftFace.y, rightFace.x - leftFace.x);
  const image = images[filter];
  if (!image?.complete || !image.naturalWidth || !faceWidth) return;

  const placements: Record<Exclude<FaceFilterId, 'none'>, { width: number; height: number; y: number }> = {
    puppy: { width: faceWidth * 1.55, height: faceWidth * .82, y: -faceWidth * .53 },
    cat: { width: faceWidth * 1.36, height: faceWidth * .65, y: -faceWidth * .73 },
    'heart-glasses': { width: faceWidth * 1.24, height: faceWidth * .47, y: faceWidth * .015 },
    bow: { width: faceWidth * .74, height: faceWidth * .47, y: -faceWidth * .82 },
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

interface FaceFilterCanvasProps {
  video: HTMLVideoElement | null;
  selectedFilter: FaceFilterId;
  active: boolean;
  onStatus: (state: FaceTrackingState) => void;
}

export const FaceFilterCanvas = forwardRef<FaceFilterCanvasHandle, FaceFilterCanvasProps>(function FaceFilterCanvas({ video, selectedFilter, active, onStatus }, forwardedRef) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modelRef = useRef<FaceLandmarkerTask | null>(null);
  const pointsRef = useRef<NormalizedLandmark[] | null>(null);
  const filterRef = useRef(selectedFilter);
  const imagesRef = useRef<Partial<Record<FaceFilterId, HTMLImageElement>>>({});
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
      }
      paintFilter(context, pointsRef.current, filterRef.current, imagesRef.current, width, height, false);
    },
  }), [video]);

  useEffect(() => {
    faceFilters.forEach(({ id, asset }) => {
      if (!asset || imagesRef.current[id]) return;
      const image = new Image();
      image.src = asset;
      imagesRef.current[id] = image;
    });
  }, []);

  useEffect(() => {
    if (!active || !video) return;
    let cancelled = false;
    let raf = 0;
    let previousVideoTime = -1;
    let lastDetectionAt = 0;
    let lastPublishedState: FaceTrackingState | null = null;
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
        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
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
        const renderFrame = (now: number) => {
          if (cancelled) return;
          raf = requestAnimationFrame(renderFrame);
          if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || video.currentTime === previousVideoTime || now - lastDetectionAt < 30) return;
          previousVideoTime = video.currentTime;
          lastDetectionAt = now;
          try {
            const result = landmarker.detectForVideo(video, now);
            const face = result.faceLandmarks[0] ?? null;
            const smoothed = face ? smoothLandmarks(face, pointsRef.current) : null;
            pointsRef.current = smoothed;
            if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
            }
            paintFilter(context, smoothed, filterRef.current, imagesRef.current, canvas.width, canvas.height);
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
      modelRef.current?.close();
      modelRef.current = null;
      pointsRef.current = null;
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
  return <section className="ar-filter-control" aria-label="Real-time face filters">
    <div className="ar-filter-heading"><label>FACE FILTERS</label><span className={`ar-tracking-status is-${tracking}`} aria-live="polite"><i/> {statusText[tracking]}</span></div>
    <div className="ar-filter-list" role="group" aria-label="Choose a face filter">
      {faceFilters.map((filter) => <motion.button key={filter.id} type="button" className={value === filter.id ? 'active' : ''} onClick={() => onChange(filter.id)} aria-pressed={value === filter.id} title={filter.description} whileTap={{ scale: .96 }} animate={{ y: value === filter.id ? -2 : 0 }} transition={{ type: 'spring', stiffness: 340, damping: 24 }}>
        <span className={`ar-filter-swatch swatch-${filter.id}`}>{filter.id === 'none' ? <span className="filter-none-mark"/> : <img src={assetUrls[filter.id]} alt=""/>}</span>
        <span>{filter.name}</span>
      </motion.button>)}
    </div>
  </section>;
}
