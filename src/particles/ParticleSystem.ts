/** @license SPDX-License-Identifier: Apache-2.0 */
import { Config } from "../core/Config";
import { createParticles, resetParticle } from "./ParticleFactory";
import type { HandState } from "../hand-tracking/HandGeometry";
import { FlowField } from "../physics/NoiseField";
import { ColorStop, interpolateColor } from "../rendering/ColorGradient";

const COLOR_STOPS: ColorStop[] = [
  { value: 0, color: { r: 0.08, g: 0.35, b: 1.0, a: 0.72 } },
  { value: 0.5, color: { r: 0.48, g: 0.12, b: 1.0, a: 0.84 } },
  { value: 1, color: { r: 0.9, g: 0.035, b: 0.16, a: 0.96 } },
];

const GOLD = { r: 1.0, g: 0.72, b: 0.18, a: 1.0 };
const BLUE = COLOR_STOPS[0].color;
const MAX_WAVES = 4;

export interface ParticleUpdateOptions {
  interactiveGestures: boolean;
  releaseBurst: boolean;
  effectsEnabled: boolean;
  handInfluence: number;
  gripValue: number;
}

export class ParticleSystem {
  public readonly maxCount: number;
  public activeCount: number;
  public readonly positions: Float32Array;
  public readonly velocities: Float32Array;
  public readonly colors: Float32Array;
  public readonly shimmerPhase: Float32Array;
  public readonly sizes: Float32Array;
  public readonly depths: Float32Array;
  public readonly baseDepths: Float32Array;
  public readonly depthPhases: Float32Array;

  public targetPositions: Float32Array | null = null;

  public anchorX = 0.5;
  public anchorY = 0.5;
  public anchorVx = 0;
  public anchorVy = 0;

  private readonly flowField: FlowField;
  private readonly flowScratch = new Float32Array(2);

  private readonly waveX = new Float32Array(MAX_WAVES);
  private readonly waveY = new Float32Array(MAX_WAVES);
  private readonly waveAge = new Float32Array(MAX_WAVES);

  private waveCursor = 0;
  private lastWaveTime = -10;
  private burstX = 0.5;
  private burstY = 0.5;

  constructor(count = Config.PARTICLE_MAX) {
    this.maxCount = Math.max(
      1,
      Math.min(Config.PARTICLE_MAX, Math.floor(count)),
    );

    this.activeCount = Math.min(
      Config.PARTICLE_COUNT,
      this.maxCount,
    );

    const data = createParticles(this.maxCount);

    this.positions = data.positions;
    this.velocities = data.velocities;
    this.colors = data.colors;
    this.shimmerPhase = data.shimmerPhase;
    this.sizes = data.sizes;
    this.depths = data.depths;
    this.baseDepths = data.baseDepths;
    this.depthPhases = data.depthPhases;

    this.flowField = new FlowField(Config.FLOW_FIELD_SIZE);
    this.waveAge.fill(Config.WAVE_LIFETIME + 1);
  }

  /** Returns the current number of particles to draw. */
  public get count(): number {
    return this.activeCount;
  }

  public setActiveCount(count: number): void {
    this.activeCount = Math.max(
      1,
      Math.min(this.maxCount, Math.floor(count)),
    );
  }

  public setTargetPositions(targets: Float32Array): void {
    this.targetPositions = targets;
  }

  public clearTargetPositions(): void {
    this.targetPositions = null;
  }

  public resetToCenter(): void {
    for (let i = 0; i < this.maxCount; i++) {
      resetParticle(
        i,
        this.positions,
        this.velocities,
        0.5,
        0.5,
        0.12,
      );

      this.shimmerPhase[i] = Math.random() * Math.PI * 2;

      this.colors[i * 4] = BLUE.r;
      this.colors[i * 4 + 1] = BLUE.g;
      this.colors[i * 4 + 2] = BLUE.b;
      this.colors[i * 4 + 3] = BLUE.a;

      this.depths[i] = this.baseDepths[i];
    }

    this.anchorX = 0.5;
    this.anchorY = 0.5;
    this.anchorVx = 0;
    this.anchorVy = 0;

    this.targetPositions = null;
    this.waveAge.fill(Config.WAVE_LIFETIME + 1);
  }

  public spawnWave(
    x: number,
    y: number,
    time: number,
  ): void {
    if (time - this.lastWaveTime < 0.16) return;

    const slot = this.waveCursor++ % MAX_WAVES;

    this.waveX[slot] = x;
    this.waveY[slot] = y;
    this.waveAge[slot] = 0;
    this.lastWaveTime = time;
  }

  public update(
    dt: number,
    time: number,
    handDetected: boolean,
    handState: HandState | null,
    machineState: string,
    stateProgress: number,
    options: ParticleUpdateOptions = {
      interactiveGestures: true,
      releaseBurst: false,
      effectsEnabled: true,
      handInfluence: 1,
      gripValue: handState?.gripValue ?? 0,
    },
  ): void {
    const clampedDt = Math.min(0.04, Math.max(0, dt));

    let targetX = 0.5;
    let targetY = 0.5;
    let grip = 0;

    if (handDetected && handState) {
      targetX = handState.palmCentroid.x;
      targetY = handState.palmCentroid.y;
      grip = Math.max(0, Math.min(1, options.gripValue));
    }

    // Smoothly follow the palm using a damped spring.
    this.anchorVx +=
      (
        (targetX - this.anchorX) * 9 -
        this.anchorVx * 5.5
      ) * clampedDt;

    this.anchorVy +=
      (
        (targetY - this.anchorY) * 9 -
        this.anchorVy * 5.5
      ) * clampedDt;

    this.anchorX += this.anchorVx * clampedDt;
    this.anchorY += this.anchorVy * clampedDt;

    this.anchorX = Math.max(
      0.02,
      Math.min(0.98, this.anchorX),
    );

    this.anchorY = Math.max(
      0.02,
      Math.min(0.98, this.anchorY),
    );

    this.flowField.update(
      time * Config.IDLE_NOISE_SPEED,
      Config.IDLE_NOISE_SCALE,
      Config.IDLE_NOISE_STRENGTH,
    );

    // Fast hand movement emits a radial wave.
    if (
      handDetected &&
      handState &&
      options.interactiveGestures &&
      Math.hypot(
        handState.velocity.x,
        handState.velocity.y,
      ) >= Config.WAVE_SPEED_THRESHOLD
    ) {
      this.spawnWave(
        handState.palmCentroid.x,
        handState.palmCentroid.y,
        time,
      );
    }

    for (let w = 0; w < MAX_WAVES; w++) {
      if (this.waveAge[w] <= Config.WAVE_LIFETIME) {
        this.waveAge[w] += clampedDt;
      }
    }

    if (
      options.releaseBurst &&
      handState &&
      options.interactiveGestures
    ) {
      this.burstX = handState.palmCentroid.x;
      this.burstY = handState.palmCentroid.y;
    }

    let colorR = 0;
    let colorG = 0;
    let colorB = 0;
    let colorA = 0;

    const base = interpolateColor(COLOR_STOPS, grip);

    const signatureState =
      machineState === "FORMING_TEXT" ||
      machineState === "TEXT_HOLD";

    if (signatureState) {
      const goldBlend =
        machineState === "FORMING_TEXT"
          ? smoothstep(stateProgress)
          : 1;

      colorR = base.r * (1 - goldBlend) + GOLD.r * goldBlend;
      colorG = base.g * (1 - goldBlend) + GOLD.g * goldBlend;
      colorB = base.b * (1 - goldBlend) + GOLD.b * goldBlend;
      colorA = base.a * (1 - goldBlend) + GOLD.a * goldBlend;
    } else if (machineState === "DISSOLVING") {
      const dissolve = smoothstep(stateProgress);

      colorR = GOLD.r * (1 - dissolve) + BLUE.r * dissolve;
      colorG = GOLD.g * (1 - dissolve) + BLUE.g * dissolve;
      colorB = GOLD.b * (1 - dissolve) + BLUE.b * dissolve;
      colorA = GOLD.a * (1 - dissolve) + BLUE.a * dissolve;
    } else {
      colorR = base.r;
      colorG = base.g;
      colorB = base.b;
      colorA = base.a;
    }

    const isTextForming =
      machineState === "FORMING_TEXT" ||
      machineState === "TEXT_HOLD";

    const isCompression =
      machineState === "COMPRESSING" ||
      machineState === "VIBRATING" ||
      machineState === "VIBRATION_DECAY" ||
      machineState === "STILL";

    const isInteractive =
      options.interactiveGestures &&
      !isTextForming &&
      machineState !== "DISSOLVING" &&
      !isCompression;

    const palmX = handState?.palmCentroid.x ?? this.anchorX;
    const palmY = handState?.palmCentroid.y ?? this.anchorY;

    const palmZScale = handState
      ? Math.max(
          0.85,
          Math.min(
            1.18,
            1 - handState.palmCentroid.z * 0.45,
          ),
        )
      : 1;

    const pinchX = handState?.pinchPoint.x ?? palmX;
    const pinchY = handState?.pinchPoint.y ?? palmY;

    // Begin expansion progressively as the palm opens.
    const openPalm =
      isInteractive && handDetected && handState
        ? Math.max(
            0,
            Math.min(
              1,
              (handState.openPalmValue - 0.20) / 0.55,
            ),
          ) * options.handInfluence
        : 0;

    const pinch =
      isInteractive && handState?.isPinching
        ? handState.pinchValue * options.handInfluence
        : 0;

    const drag =
      machineState === "STILL"
        ? 4.5
        : Config.DRAG_COEFFICIENT;

    const flowScratch = this.flowScratch;
    const count = this.activeCount;
    const pos = this.positions;
    const vel = this.velocities;
    const color = this.colors;
    const targets = this.targetPositions;
    const waveEnabled = options.effectsEnabled && isInteractive;

    // Keep noise gentle so the open palm does not scatter
    // the whole particle field toward the screen edges.
    const noiseMultiplier =
      (machineState === "DISSOLVING" ? 1.5 : 1) *
      (1 + openPalm * 0.35);

    for (let i = 0; i < count; i++) {
      const p = i * 2;
      const c = i * 4;

      const px = pos[p];
      const py = pos[p + 1];

      let vx = vel[p];
      let vy = vel[p + 1];
      let fx = 0;
      let fy = 0;

      this.shimmerPhase[i] +=
        Config.IDLE_SHIMMER_SPEED * clampedDt;

      const shimmer =
        0.78 + 0.22 * Math.sin(this.shimmerPhase[i]);

      const depth = Math.max(
        0,
        Math.min(
          1,
          this.baseDepths[i] +
            Math.sin(
              time * 0.22 + this.depthPhases[i],
            ) * 0.025,
        ),
      );

      this.depths[i] = depth;

      if (isTextForming && targets) {
        const tx = targets[p];
        const ty = targets[p + 1];

        const progress =
          machineState === "FORMING_TEXT"
            ? smoothstep(stateProgress)
            : 1;

        const k = 3.2 + 8.8 * progress;
        const damping = 2 * Math.sqrt(k) * 0.94;

        fx += (tx - px) * k - vx * damping;
        fy += (ty - py) * k - vy * damping;

        flowScratch[0] = 0;
        flowScratch[1] = 0;

        if (machineState === "TEXT_HOLD") {
          this.flowField.sample(px, py, flowScratch);
          fx += flowScratch[0] * 0.1;
          fy += flowScratch[1] * 0.1;
        }
      } else if (isCompression) {
        const pull = machineState === "STILL" ? 8 : 14;

        fx += (palmX - px) * pull;
        fy += (palmY - py) * pull;

        if (
          machineState === "VIBRATING" ||
          machineState === "VIBRATION_DECAY"
        ) {
          const decay =
            machineState === "VIBRATION_DECAY"
              ? 1 - stateProgress
              : 1;

          fx += Math.sin(time * 55 + i * 1.5) * 7 * decay;
          fy += Math.cos(time * 57 + i * 2.1) * 7 * decay;
        }
      } else {
        // Natural movement from the shared flow field.
        this.flowField.sample(px, py, flowScratch);
        fx += flowScratch[0] * noiseMultiplier;
        fy += flowScratch[1] * noiseMultiplier;

        // Keep the cloud near the palm but allow it to expand.
        const centerStrength = handDetected
          ? 0.85 - openPalm * 0.15 + grip * 0.5
          : 0.16;

        fx += (this.anchorX - px) * centerStrength;
        fy += (this.anchorY - py) * centerStrength;

        // Closed fist gathers particles toward the palm.
        if (handDetected && grip > 0.05) {
          const dx = this.anchorX - px;
          const dy = this.anchorY - py;
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.001;

          const force =
            (Config.FIST_COMPRESSION_STRENGTH * grip) /
            (dist * 2 + 0.1);

          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }

        // Finger attraction is reduced when opening the hand.
        if (handDetected && handState) {
          for (let f = 0; f < 5; f++) {
            const tip = handState.fingertips[f];

            const ext =
              handState.fingerExtensions[f] *
              options.handInfluence *
              (1 - grip) *
              (1 - pinch) *
              (1 - openPalm);

            if (ext <= 0.05) continue;

            const dx = tip.x - px;
            const dy = tip.y - py;
            const distSq = dx * dx + dy * dy;

            const radiusSq =
              Config.ATTRACTOR_RADIUS *
              Config.ATTRACTOR_RADIUS;

            if (distSq < radiusSq && distSq > 1e-8) {
              const dist = Math.sqrt(distSq);
              const attenuation =
                1 - dist / Config.ATTRACTOR_RADIUS;

              const mag =
                Config.ATTRACTOR_STRENGTH *
                ext *
                attenuation *
                attenuation;

              fx += (dx / dist) * mag;
              fy += (dy / dist) * mag;
            }
          }
        }

        // Open palm: bounded outward force. This avoids
        // an unbounded impulse that throws particles to the walls.
        if (openPalm > 0.01) {
          const dx = px - this.anchorX;
          const dy = py - this.anchorY;
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.0001;

          const spread =
            openPalm *
            1.05 *
            Math.max(0, 1 - dist / 0.35);

          fx += (dx / dist) * spread;
          fy += (dy / dist) * spread;

          // Give the particle cloud some movement from the
          // palm's current travel direction.
          fx += this.anchorVx * openPalm * 1.2;
          fy += this.anchorVy * openPalm * 1.2;
        }

        // Pinch: attract particles toward the thumb-index midpoint.
        if (pinch > 0.01) {
          const dx = pinchX - px;
          const dy = pinchY - py;

          fx += dx * (2.0 + pinch * 7.0) * pinch;
          fy += dy * (2.0 + pinch * 7.0) * pinch;
        }

        // Expanding radial ring waves, limited to four active waves.
        if (waveEnabled) {
          for (let w = 0; w < MAX_WAVES; w++) {
            const age = this.waveAge[w];

            if (age < 0 || age >= Config.WAVE_LIFETIME) {
              continue;
            }

            const dx = px - this.waveX[w];
            const dy = py - this.waveY[w];
            const dist = Math.sqrt(dx * dx + dy * dy) + 0.0001;

            const radius =
              (age / Config.WAVE_LIFETIME) * 0.42;

            const band = (dist - radius) / 0.055;

            const ring =
              Math.exp(-band * band * 0.5) *
              (1 - age / Config.WAVE_LIFETIME);

            fx += (dx / dist) * ring * 1.8;
            fy += (dy / dist) * ring * 1.8;
          }
        }

        // One-frame release impulse, only in interactive states.
        if (options.releaseBurst && isInteractive) {
          const dx = px - this.burstX;
          const dy = py - this.burstY;
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.02;
          const impulse = Config.ENERGY_BURST_STRENGTH / dist;

          vx += (dx / dist) * impulse;
          vy += (dy / dist) * impulse;
        }

        if (machineState === "DISSOLVING") {
          const dx = px - this.anchorX;
          const dy = py - this.anchorY;

          fx += dx * (1.2 + stateProgress * 2.8);
          fy += dy * (1.2 + stateProgress * 2.8);
        }
      }

      // Semi-implicit Euler integration, without per-particle objects.
      vx =
        (vx + fx * clampedDt) *
        Math.max(0, 1 - drag * clampedDt);

      vy =
        (vy + fy * clampedDt) *
        Math.max(0, 1 - drag * clampedDt);

      let nx = px + vx * clampedDt;
      let ny = py + vy * clampedDt;

      if (nx < 0.015) {
        nx = 0.015;
        vx *= -0.3;
      } else if (nx > 0.985) {
        nx = 0.985;
        vx *= -0.3;
      }

      if (ny < 0.015) {
        ny = 0.015;
        vy *= -0.3;
      } else if (ny > 0.985) {
        ny = 0.985;
        vy *= -0.3;
      }

      pos[p] = nx;
      pos[p + 1] = ny;
      vel[p] = vx;
      vel[p + 1] = vy;

      // Faster particles receive a slightly warmer tint.
      const speed = Math.min(1, Math.hypot(vx, vy) * 2.8);

      color[c] = Math.min(1, colorR + speed * 0.12);
      color[c + 1] = Math.min(1, colorG + speed * 0.07);
      color[c + 2] = Math.min(1, colorB + speed * 0.025);
      color[c + 3] =
        colorA * shimmer * (0.72 + depth * 0.28);

      this.sizes[i] =
        (
          Config.PARTICLE_MIN_SIZE +
          depth *
            (Config.PARTICLE_MAX_SIZE - Config.PARTICLE_MIN_SIZE)
        ) * palmZScale;
    }
  }
}

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export default ParticleSystem;