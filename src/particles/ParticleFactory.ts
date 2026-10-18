/** @license SPDX-License-Identifier: Apache-2.0 */
import { Config } from "../core/Config";

export interface ParticleInitializationData {
  positions: Float32Array;
  velocities: Float32Array;
  colors: Float32Array;
  shimmerPhase: Float32Array;
  sizes: Float32Array;
  depths: Float32Array;
  baseDepths: Float32Array;
  depthPhases: Float32Array;
}

/** Allocates each typed array once. Subsequent resets mutate these arrays in place. */
export function createParticles(count: number): ParticleInitializationData {
  const positions = new Float32Array(count * 2);
  const velocities = new Float32Array(count * 2);
  const colors = new Float32Array(count * 4);
  const shimmerPhase = new Float32Array(count);
  const sizes = new Float32Array(count);
  const depths = new Float32Array(count);
  const baseDepths = new Float32Array(count);
  const depthPhases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u1 = Math.random() || 0.0001;
    const u2 = Math.random();
    const radius = Math.sqrt(-2 * Math.log(u1));
    positions[i * 2] = Math.max(0.02, Math.min(0.98, 0.5 + radius * Math.cos(2 * Math.PI * u2) * 0.08));
    positions[i * 2 + 1] = Math.max(0.02, Math.min(0.98, 0.5 + radius * Math.sin(2 * Math.PI * u2) * 0.08));
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 0.008;
    velocities[i * 2] = Math.cos(angle) * speed;
    velocities[i * 2 + 1] = Math.sin(angle) * speed;
    shimmerPhase[i] = Math.random() * Math.PI * 2;
    sizes[i] = Config.PARTICLE_MIN_SIZE + Math.random() * (Config.PARTICLE_MAX_SIZE - Config.PARTICLE_MIN_SIZE);
    depths[i] = Math.random();
    baseDepths[i] = depths[i];
    depthPhases[i] = Math.random() * Math.PI * 2;
    colors[i * 4] = 0.1;
    colors[i * 4 + 1] = 0.4;
    colors[i * 4 + 2] = 1.0;
    colors[i * 4 + 3] = 0.65;
  }
  return { positions, velocities, colors, shimmerPhase, sizes, depths, baseDepths, depthPhases };
}

export function resetParticle(
  i: number,
  positions: Float32Array,
  velocities: Float32Array,
  centerX = 0.5,
  centerY = 0.5,
  spread = 0.1,
): void {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * spread;
  positions[i * 2] = Math.max(0.02, Math.min(0.98, centerX + Math.cos(angle) * radius));
  positions[i * 2 + 1] = Math.max(0.02, Math.min(0.98, centerY + Math.sin(angle) * radius));
  velocities[i * 2] = 0;
  velocities[i * 2 + 1] = 0;
}
