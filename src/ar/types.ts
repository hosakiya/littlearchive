import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export type FaceFilterId = 'none' | 'puppy' | 'cat' | 'heart-glasses' | 'bow' | 'heart-halo' | 'paw-blush';
export type FaceTrackingState = 'idle' | 'loading' | 'ready' | 'no-face' | 'unsupported' | 'error';
export type CameraPermissionState = 'idle' | 'requesting' | 'ready' | 'denied' | 'unavailable' | 'error';

export interface FaceFilterDefinition {
  id: FaceFilterId;
  name: string;
  description: string;
  asset?: string;
}

export interface LandmarkProcessingResult {
  landmarks: NormalizedLandmark[];
  timestamp: number;
  faceFound: boolean;
}

export interface CameraState {
  permission: CameraPermissionState;
  tracking: FaceTrackingState;
  mirrored: boolean;
  message: string;
}

export interface CaptureSettings {
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/webp' | 'image/jpeg';
  quality: number;
  mirrorPreview: boolean;
  faceFilter: FaceFilterId;
  colorFilter: string;
}

export interface FaceFilterCanvasHandle {
  getCanvas(): HTMLCanvasElement | null;
  drawTo(context: CanvasRenderingContext2D, width: number, height: number): void;
}
