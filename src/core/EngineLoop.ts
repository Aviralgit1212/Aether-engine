/** @license SPDX-License-Identifier: Apache-2.0 */
import { Config } from "./Config";
import { ParticleSystem } from "../particles/ParticleSystem";
import { WebGLRenderer } from "../rendering/WebGLRenderer";
import { HandTracker } from "../hand-tracking/HandTracker";
import { HandHistory, analyzeHandLandmarks, HandState } from "../hand-tracking/HandGeometry";
import { SignatureStateMachine, MachineState } from "../signature/SignatureStateMachine";
import { EnergyEstimator } from "../signature/EnergyEstimator";
import { TextTargetSampler } from "../signature/TextTargetSampler";

export interface BenchmarkResult {
  particles: number;
  avgFps: number;
  frameMsP95: number;
  physicsMs: number;
  renderMs: number;
}

export interface EngineStats {
  fps: number;
  energyLevel: number;
  gripValue: number;
  stability: number | null;
  state: MachineState;
  stateProgress: number;
  handDetected: boolean;
  handInGracePeriod: boolean;
  inferenceMs: number;
  physicsMs: number;
  renderMs: number;
  frameMsP95: number;
  activeCount: number;
  qualityLevel: number;
  qualityReason: string;
  averageFps1s: number;
  pinchValue: number;
  openPalmValue: number;
  benchmarkRunning: boolean;
  benchmarkResults: BenchmarkResult[];
  bloomEnabled: boolean;
  trailsEnabled: boolean;
  signatureText: string;
}

const BENCHMARK_COUNTS = [5000, 10000, 20000] as const;
const P95_WINDOW = 120;
const BENCHMARK_SAMPLE_CAPACITY = 4096;

export class EngineLoop {
  private readonly particleSystem: ParticleSystem;
  private readonly renderer: WebGLRenderer;
  private readonly handTracker: HandTracker;
  private readonly handHistory: HandHistory;
  private readonly stateMachine: SignatureStateMachine;
  private readonly energyEstimator: EnergyEstimator;
  private readonly textSampler: TextTargetSampler;

  private animationFrameId: number | null = null;
  private lastFrameTime = 0;
  private accumulatedTime = 0;
  private running = false;
  private started = false;
  private stopped = false;

  private handDetectedThisFrame = false;
  private lastHandState: HandState | null = null;
  private lastHandDetectionTime = 0;
  private handInfluenceFactor = 0;
  private previousGrip = 0;

  private fps = 0;
  private physicsMs = 0;
  private renderMs = 0;

  private frameMs = new Float32Array(P95_WINDOW);
  private frameMsWrite = 0;
  private frameMsCount = 0;
  private statsAccumulator = 0;
  private statsFrameCount = 0;

  private adaptiveAccumulator = 0;
  private adaptiveFrames = 0;
  private averageFps1s = 0;

  private qualityIndex = 0;
  private qualityReason = "Fixed quality: 20,000 particles";

  private bloomEnabled = true;
  private trailsEnabled = true;

  private benchmarkRunning = false;
  private benchmarkIndex = 0;
  private benchmarkElapsed = 0;
  private benchmarkFrames = 0;
  private readonly benchmarkFrameMs =
    new Float32Array(BENCHMARK_SAMPLE_CAPACITY);
  private benchmarkFrameCount = 0;
  private benchmarkPhysicsSum = 0;
  private benchmarkRenderSum = 0;
  private previousQualityCount = Config.PARTICLE_COUNT;
  private benchmarkResults: BenchmarkResult[] = [];

  private onStatsUpdate:
    ((stats: EngineStats) => void) | null = null;
  private onError: ((err: string) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.particleSystem = new ParticleSystem(Config.PARTICLE_MAX);
    this.renderer = new WebGLRenderer(canvas, Config.PARTICLE_MAX);
    this.handTracker = new HandTracker();
    this.handHistory = new HandHistory(Config.STABILITY_WINDOW_MS);
    this.stateMachine = new SignatureStateMachine();
    this.energyEstimator = new EnergyEstimator();
    this.textSampler = new TextTargetSampler();

    this.stateMachine.registerOnStateChange(
      (from, to) => this.handleStateTransition(from, to),
    );
  }

  public registerOnStatsUpdate(
    callback: (stats: EngineStats) => void,
  ): void {
    this.onStatsUpdate = callback;
  }

  private interactiveState(state: MachineState): boolean {
    return (
      state === "IDLE" ||
      state === "GATHERING" ||
      state === "READY"
    );
  }

  private updateTextTargets(): void {
    this.particleSystem.setTargetPositions(
      this.textSampler.sampleTextPoints(
        Config.SIGNATURE_TEXT,
        this.particleSystem.activeCount,
        this.particleSystem.positions,
      ),
    );
  }

  private handleStateTransition(
    from: MachineState,
    to: MachineState,
  ): void {
    if (to === "FORMING_TEXT") {
      this.updateTextTargets();
    } else if (
      to === "IDLE" ||
      (
        from === "DISSOLVING" &&
        (to === "GATHERING" || to === "READY")
      )
    ) {
      this.particleSystem.clearTargetPositions();
    }
  }

  public async start(
    onError?: (err: string) => void,
  ): Promise<void> {
    if (this.running) return;

    if (this.started || this.stopped) {
      throw new Error(
        "This EngineLoop instance has already been stopped. Create a fresh instance to restart.",
      );
    }

    this.started = true;
    this.onError = onError ?? null;
    this.lastFrameTime = performance.now();
    this.lastHandDetectionTime = 0;
    this.handInfluenceFactor = 0;
    this.running = true;

    try {
      await this.handTracker.initialize({
        onLoaded: () =>
          console.info("[Aether V2] HandLandmarker ready."),

        onError: (message) => {
          this.onError?.(message);
        },

        onTrackingResult: (result) => {
          if (
            result.landmarks &&
            result.landmarks.length > 0
          ) {
            this.handDetectedThisFrame = true;
            this.lastHandDetectionTime = performance.now();

            const landmarks = result.landmarks[0].map(
              (point) => ({
                x: 1 - point.x,
                y: point.y,
                z: point.z,
              }),
            );

            this.lastHandState = analyzeHandLandmarks(
              landmarks,
              this.handHistory,
              this.lastHandDetectionTime,
            );
          } else {
            this.handDetectedThisFrame = false;
          }
        },
      });

      if (!this.running) return;

      this.lastFrameTime = performance.now();
      this.statsAccumulator = 0;
      this.statsFrameCount = 0;
      this.loop(this.lastFrameTime);

      if (
        new URLSearchParams(window.location.search).get("bench") === "1"
      ) {
        this.startBenchmark();
      }
    } catch (error) {
      this.running = false;
      this.handTracker.destroy();

      const message =
        error instanceof Error ? error.message : String(error);

      this.onError?.(message);
      throw new Error(message);
    }
  }

  /** Idempotent cleanup. Return true when a lost context should be awaited before restarting. */
  public stop(final = false): boolean {
    if (this.stopped) return false;

    this.stopped = true;
    this.running = false;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.handTracker.destroy();

    const contextWillRestore =
      this.renderer.destroy(true, !final);

    this.stateMachine.reset();
    this.energyEstimator.reset();
    this.particleSystem.resetToCenter();
    this.handHistory.clear();

    this.lastHandState = null;
    this.handDetectedThisFrame = false;
    this.onStatsUpdate = null;
    this.onError = null;

    return final ? false : contextWillRestore;
  }

  public resetParticles(): void {
    this.particleSystem.resetToCenter();
    this.energyEstimator.reset();
    this.stateMachine.reset();
    this.previousGrip = 0;
  }

  public setSignatureText(text: string): void {
    const sanitized = text
      .toUpperCase()
      .replace(/[^A-Z0-9 ._-]/g, "")
      .slice(0, 12)
      .trim();

    Config.SIGNATURE_TEXT = sanitized || "AVIRAL";

    if (
      this.stateMachine.getState() === "FORMING_TEXT" ||
      this.stateMachine.getState() === "TEXT_HOLD"
    ) {
      this.updateTextTargets();
    }
  }

  public replaySignature(): void {
    this.stateMachine.replaySignature();
  }

  public setVisualEffects(
    bloom: boolean,
    trails: boolean,
  ): void {
    this.bloomEnabled = bloom;
    this.trailsEnabled = trails;
    this.renderer.setEffectsEnabled(bloom, trails);
  }

  public toggleBloom(): void {
    this.setVisualEffects(!this.bloomEnabled, this.trailsEnabled);
  }

  public toggleTrails(): void {
    this.setVisualEffects(this.bloomEnabled, !this.trailsEnabled);
  }

  public startBenchmark(): void {
    if (!this.running || this.benchmarkRunning) return;

    this.benchmarkRunning = true;
    this.previousQualityCount = this.particleSystem.activeCount;
    this.benchmarkResults = [];
    this.benchmarkIndex = 0;
    this.benchmarkElapsed = 0;
    this.benchmarkFrames = 0;
    this.benchmarkFrameCount = 0;

    this.frameMs.fill(0);
    this.frameMsWrite = 0;
    this.frameMsCount = 0;

    this.benchmarkPhysicsSum = 0;
    this.benchmarkRenderSum = 0;

    this.setActiveCount(
      BENCHMARK_COUNTS[0],
      "Benchmark running: 5,000 particles",
    );
  }

  private setActiveCount(
    count: number,
    reason: string,
  ): void {
    this.particleSystem.setActiveCount(count);
    this.qualityReason = reason;

    if (
      this.stateMachine.getState() === "FORMING_TEXT" ||
      this.stateMachine.getState() === "TEXT_HOLD"
    ) {
      this.updateTextTargets();
    }
  }

  /**
   * Keep runtime count fixed at Config.PARTICLE_COUNT.
   * FPS remains available for diagnostics. Only benchmark mode
   * intentionally changes the particle count.
   */
  private updateAdaptiveQuality(dt: number): void {
    this.adaptiveAccumulator += Math.max(0, dt);
    this.adaptiveFrames++;

    if (this.adaptiveAccumulator >= 1) {
      this.averageFps1s =
        this.adaptiveFrames /
        Math.max(0.001, this.adaptiveAccumulator);

      this.adaptiveAccumulator = 0;
      this.adaptiveFrames = 0;
    }

    if (this.benchmarkRunning) return;

    this.qualityIndex = 0;

    if (
      this.particleSystem.activeCount !== Config.PARTICLE_COUNT
    ) {
      this.setActiveCount(
        Config.PARTICLE_COUNT,
        `Fixed quality: ${Config.PARTICLE_COUNT.toLocaleString()} particles`,
      );
    }
  }

  private updateBenchmark(dt: number): void {
    if (!this.benchmarkRunning) return;

    this.benchmarkElapsed += dt;
    this.benchmarkFrames++;
    this.benchmarkPhysicsSum += this.physicsMs;
    this.benchmarkRenderSum += this.renderMs;

    if (this.benchmarkElapsed < 5) return;

    this.benchmarkResults.push({
      particles: BENCHMARK_COUNTS[this.benchmarkIndex],
      avgFps:
        this.benchmarkFrames /
        Math.max(0.001, this.benchmarkElapsed),
      frameMsP95: this.getBenchmarkFrameP95(),
      physicsMs:
        this.benchmarkPhysicsSum /
        Math.max(1, this.benchmarkFrames),
      renderMs:
        this.benchmarkRenderSum /
        Math.max(1, this.benchmarkFrames),
    });

    this.benchmarkIndex++;

    if (this.benchmarkIndex >= BENCHMARK_COUNTS.length) {
      this.benchmarkRunning = false;

      this.setActiveCount(
        this.previousQualityCount,
        "Benchmark complete; restored previous active count",
      );

      console.table(this.benchmarkResults);
      return;
    }

    this.benchmarkElapsed = 0;
    this.benchmarkFrames = 0;
    this.benchmarkFrameCount = 0;

    this.frameMs.fill(0);
    this.frameMsWrite = 0;
    this.frameMsCount = 0;

    this.benchmarkPhysicsSum = 0;
    this.benchmarkRenderSum = 0;

    const count = BENCHMARK_COUNTS[this.benchmarkIndex];

    this.setActiveCount(
      count,
      `Benchmark running: ${count.toLocaleString()} particles`,
    );
  }

  private getFrameP95(): number {
    if (this.frameMsCount === 0) return 0;

    const sorted = Array.from(
      this.frameMs.slice(0, this.frameMsCount),
    ).sort((a, b) => a - b);

    return (
      sorted[
        Math.min(
          sorted.length - 1,
          Math.floor(sorted.length * 0.95),
        )
      ] ?? 0
    );
  }

  private getBenchmarkFrameP95(): number {
    if (this.benchmarkFrameCount === 0) return 0;

    const sorted = Array.from(
      this.benchmarkFrameMs.subarray(
        0,
        this.benchmarkFrameCount,
      ),
    ).sort((a, b) => a - b);

    return (
      sorted[
        Math.min(
          sorted.length - 1,
          Math.floor(sorted.length * 0.95),
        )
      ] ?? 0
    );
  }

  private publishStats(
    energy: number,
    grip: number,
    stability: number,
    handPresent: boolean,
    grace: boolean,
  ): void {
    if (!this.onStatsUpdate) return;

    const hand = this.lastHandState;

    this.onStatsUpdate({
      fps: this.fps,
      energyLevel: energy,
      gripValue: grip,
      stability: handPresent ? stability : null,
      state: this.stateMachine.getState(),
      stateProgress: this.stateMachine.getStateProgress(),
      handDetected: handPresent,
      handInGracePeriod: grace,
      inferenceMs: this.handTracker.getInferenceMs(),
      physicsMs: this.physicsMs,
      renderMs: this.renderMs,
      frameMsP95: this.getFrameP95(),
      activeCount: this.particleSystem.activeCount,
      qualityLevel: this.qualityIndex,
      qualityReason: this.qualityReason,
      averageFps1s: this.averageFps1s,
      pinchValue: handPresent && hand ? hand.pinchValue : 0,
      openPalmValue: handPresent && hand ? hand.openPalmValue : 0,
      benchmarkRunning: this.benchmarkRunning,
      benchmarkResults: this.benchmarkResults,
      bloomEnabled: this.bloomEnabled && this.qualityIndex < 3,
      trailsEnabled: this.trailsEnabled && this.qualityIndex < 3,
      signatureText: Config.SIGNATURE_TEXT,
    });
  }

  private loop = (timestamp: number): void => {
    if (!this.running) return;

    this.animationFrameId = requestAnimationFrame(this.loop);

    const rawDt = Math.max(
      0,
      (timestamp - this.lastFrameTime) / 1000,
    );

    const dt = Math.min(0.04, rawDt || 1 / 60);

    this.lastFrameTime = timestamp;
    this.accumulatedTime += dt;

    this.frameMs[this.frameMsWrite] = rawDt * 1000;
    this.frameMsWrite = (this.frameMsWrite + 1) % P95_WINDOW;

    if (
      this.benchmarkRunning &&
      this.benchmarkFrameCount < this.benchmarkFrameMs.length
    ) {
      this.benchmarkFrameMs[this.benchmarkFrameCount++] =
        rawDt * 1000;
    }

    this.frameMsCount = Math.min(
      P95_WINDOW,
      this.frameMsCount + 1,
    );

    // Inference is measured inside HandTracker.detectForVideo.
    this.handTracker.update();

    const now = performance.now();
    let handPresent = this.handDetectedThisFrame;
    let grace = false;

    if (
      !handPresent &&
      this.lastHandDetectionTime > 0 &&
      now - this.lastHandDetectionTime <
        Config.HAND_LOST_GRACE_DURATION_MS
    ) {
      handPresent = true;
      grace = true;
    }

    const blendSpeed = handPresent ? 4 : 0.6;

    this.handInfluenceFactor +=
      (
        (handPresent ? 1 : 0) -
        this.handInfluenceFactor
      ) *
      blendSpeed *
      dt;

    const handState = this.lastHandState;
    const palmIsOpen = Boolean(
      handPresent &&
      handState &&
      (
        handState.isOpenPalm ||
        handState.openPalmValue >= 0.62
      )
    );

    // HandGeometry now smooths grip, with a quick close response
    // and a softer release so small landmark changes do not flicker.
    // Do not apply another strict finger-extension threshold here:
    // that duplicated gate rejected natural fist poses from side angles.
    // Keep the open-palm guard so an extended hand is not treated as a fist.
    // The state machine still applies its configured threshold and hold time.
    const rawGrip =
      handPresent &&
      handState &&
      !palmIsOpen
        ? handState.gripValue
        : 0;

    const grip =
      rawGrip *
      this.handInfluenceFactor;

    const interactive = this.interactiveState(
      this.stateMachine.getState(),
    );

    const releaseBurst =
      interactive &&
      this.previousGrip > 0.65 &&
      grip < 0.35 &&
      this.previousGrip - grip > 0.3;

    this.previousGrip = grip;

    const physicsStart = performance.now();

    let energyPct: number;

    if (handPresent && this.lastHandState) {
      energyPct =
        this.energyEstimator.update(
          this.particleSystem,
          dt,
        ) * 100;
    } else {
      energyPct =
        this.energyEstimator.decay(dt, 0.35) * 100;
    }

    const stability =
      handPresent && this.lastHandState
        ? this.lastHandState.stability
        : Number.POSITIVE_INFINITY;

    this.stateMachine.update(
      dt,
      this.handInfluenceFactor > 0.02,
      energyPct,
      grip,
      stability,
    );

    const state = this.stateMachine.getState();
    const progress = this.stateMachine.getStateProgress();
    const gestureAllowed = this.interactiveState(state);

    this.particleSystem.update(
      dt,
      this.accumulatedTime,
      this.handInfluenceFactor > 0.01,
      this.lastHandState,
      state,
      progress,
      {
        interactiveGestures: gestureAllowed,
        releaseBurst,
        effectsEnabled: true,
        handInfluence: this.handInfluenceFactor,
        gripValue: grip,
      },
    );

    this.physicsMs = performance.now() - physicsStart;

    const renderStart = performance.now();

    this.renderer.setEffectsEnabled(
      this.bloomEnabled,
      this.trailsEnabled,
    );

    this.renderer.render(
      this.particleSystem.positions,
      this.particleSystem.colors,
      this.particleSystem.sizes,
      this.particleSystem.depths,
      this.particleSystem.activeCount,
      this.handTracker.getVideoElement(),
      this.qualityIndex,
    );

    this.renderMs = performance.now() - renderStart;

    this.statsAccumulator += rawDt;
    this.statsFrameCount++;

    if (this.statsAccumulator >= 0.5) {
      this.fps =
        this.statsFrameCount / this.statsAccumulator;

      this.statsAccumulator = 0;
      this.statsFrameCount = 0;

      this.publishStats(
        energyPct,
        grip,
        stability,
        handPresent,
        grace,
      );
    }

    this.updateAdaptiveQuality(rawDt);
    this.updateBenchmark(rawDt);
  };
}

export default EngineLoop;