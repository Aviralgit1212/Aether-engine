/**
 * Local webcam + MediaPipe hand tracking. No camera frames leave this browser.
 */
import { FilesetResolver, HandLandmarker, HandLandmarkerResult } from "@mediapipe/tasks-vision";

const MEDIAPIPE_VERSION = "0.10.35"; // pinned to package.json

export interface TrackerCallbacks {
  onLoaded?: () => void;
  onError?: (err: string) => void;
  onTrackingResult?: (result: HandLandmarkerResult) => void;
}

function errorName(error: unknown): string {
  if (error && typeof error === "object" && "name" in error) return String((error as { name?: unknown }).name ?? "");
  return "";
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function describeCameraError(error: unknown): string {
  switch (errorName(error)) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera permission was denied. Allow camera access in your browser settings, then retry.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found. Connect or enable a webcam, then retry.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera is already in use or could not be opened. Close other camera apps/tabs, then retry.";
    case "OverconstrainedError":
      return "The camera cannot satisfy the requested video settings. Try another camera or browser.";
    case "SecurityError":
      return "Camera access is blocked in this page context. Open the app on localhost or HTTPS and allow camera access.";
    default:
      return `Could not start the camera or hand tracker: ${errorMessage(error)}`;
  }
}

export class HandTracker {
  private handLandmarker: HandLandmarker | null = null;
  private activeToken: symbol | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private mediaStream: MediaStream | null = null;
  private isTrackerActive = false;
  private isLoading = false;
  private isLoaded = false;
  private callbacks: TrackerCallbacks | null = null;
  private inferenceEmaMs = 0;
  private lastVideoTime = -1;

  private ensureVideoElement(): HTMLVideoElement {
    if (!this.videoElement) {
      const video = document.createElement("video");
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.setAttribute("aria-hidden", "true");
      video.style.position = "fixed";
      video.style.width = "1px";
      video.style.height = "1px";
      video.style.opacity = "0";
      video.style.pointerEvents = "none";
      video.style.left = "-2px";
      video.style.top = "-2px";
      document.body.appendChild(video);
      this.videoElement = video;
    }
    return this.videoElement;
  }

  public async initialize(callbacks?: TrackerCallbacks): Promise<void> {
    if (this.isLoading) throw new Error("Hand tracker initialization is already in progress.");
    if (this.isLoaded && this.isTrackerActive) return;
    this.isLoading = true;
    const token = Symbol("hand-tracker-init");
    this.activeToken = token;
    this.callbacks = callbacks ?? this.callbacks;

    try {
      const video = this.ensureVideoElement();
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access requires a supported browser and a localhost/HTTPS page.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      if (this.activeToken !== token) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.mediaStream = stream;
      video.srcObject = stream;
      await this.waitForMetadata(video, token);
      if (this.activeToken !== token) return;
      await video.play();
      if (this.activeToken !== token) return;

      const vision = await FilesetResolver.forVisionTasks(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`,
      );
      if (this.activeToken !== token) return;
      const landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      if (this.activeToken !== token) {
        landmarker.close();
        return;
      }
      this.handLandmarker = landmarker;
      this.isLoaded = true;
      this.isTrackerActive = true;
      this.inferenceEmaMs = 0;
      this.lastVideoTime = -1;
      this.callbacks?.onLoaded?.();
    } catch (error) {
      if (this.activeToken === token) {
        const message = describeCameraError(error);
        this.callbacks?.onError?.(message);
        this.releaseResources();
        throw new Error(message);
      }
    } finally {
      if (this.activeToken === token) this.isLoading = false;
    }
  }

  private waitForMetadata(video: HTMLVideoElement, token: symbol): Promise<void> {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let timer = 0;
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
        window.clearTimeout(timer);
      };
      const onLoaded = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error("The camera started but video metadata could not be loaded.")); };
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onError, { once: true });
      timer = window.setTimeout(() => {
        cleanup();
        if (this.activeToken !== token) resolve();
        else reject(new Error("Timed out waiting for camera video metadata."));
      }, 10000);
    });
  }

  /** Synchronous inference; the measured duration is an EMA of detectForVideo itself. */
  public update(callbacks?: TrackerCallbacks): void {
    const video = this.videoElement;
    const landmarker = this.handLandmarker;
    if (!this.isTrackerActive || !landmarker || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;
    const startedAt = performance.now();
    try {
      const result = landmarker.detectForVideo(video, startedAt);
      const elapsed = performance.now() - startedAt;
      this.inferenceEmaMs = this.inferenceEmaMs === 0 ? elapsed : this.inferenceEmaMs * 0.85 + elapsed * 0.15;
      (callbacks ?? this.callbacks)?.onTrackingResult?.(result);
    } catch (error) {
      console.error("[HandTracker] Hand inference failed:", error);
    }
  }

  public getInferenceMs(): number { return this.inferenceEmaMs; }
  public isReady(): boolean { return this.isLoaded && this.isTrackerActive; }
  public getVideoElement(): HTMLVideoElement | null { return this.videoElement; }

  private releaseResources(): void {
    this.isTrackerActive = false;
    this.isLoaded = false;
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
      this.videoElement.remove();
      this.videoElement = null;
    }
    if (this.handLandmarker) {
      try { this.handLandmarker.close(); } catch (error) { console.warn("Could not close MediaPipe model:", error); }
      this.handLandmarker = null;
    }
  }

  public destroy(): void {
    this.activeToken = null;
    this.isLoading = false;
    this.callbacks = null;
    this.releaseResources();
  }
}

export default HandTracker;
