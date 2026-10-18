/** @license SPDX-License-Identifier: Apache-2.0 */
import { getNoiseVector } from "./NoiseField";

/** Writes acceleration, next velocity and next position into output[0..2]. */
export function computeSpringForce(current: number, target: number, velocity: number, strength: number, damping: number, dt: number, output: Float32Array): void {
  const acceleration = (target - current) * strength - velocity * (1 - damping);
  const nextVelocity = velocity + acceleration * dt;
  output[0] = acceleration; output[1] = nextVelocity; output[2] = current + nextVelocity * dt;
}

/** Writes x/y centering force into caller-owned output[0..1]. */
export function getCenteringForce(px: number, py: number, tx: number, ty: number, strength: number, output: Float32Array): void {
  const dx = tx - px, dy = ty - py;
  const distance = Math.sqrt(dx * dx + dy * dy + 0.001);
  const force = strength * distance;
  output[0] = distance > 0 ? dx / distance * force : 0;
  output[1] = distance > 0 ? dy / distance * force : 0;
}

export function getFingerAttraction(px: number, py: number, tx: number, ty: number, extension: number, maxStrength: number, maxRadius: number, output: Float32Array): void {
  output[0] = 0; output[1] = 0;
  if (extension <= 0.05) return;
  const dx = tx - px, dy = ty - py;
  const distSq = dx * dx + dy * dy;
  const distance = Math.sqrt(distSq);
  if (distance <= 0.0001 || distance > maxRadius) return;
  const attenuation = 1 - distance / maxRadius;
  const magnitude = maxStrength * extension * attenuation * attenuation;
  output[0] = dx / distance * magnitude;
  output[1] = dy / distance * magnitude;
}

export function getNoiseDrift(px: number, py: number, scale: number, time: number, strength: number, output: Float32Array): void {
  getNoiseVector(px * scale, py * scale, time, output);
  output[0] *= strength;
  output[1] *= strength;
}

export function getFistCompressionForce(px: number, py: number, cx: number, cy: number, gripValue: number, strength: number, output: Float32Array): void {
  output[0] = 0; output[1] = 0;
  if (gripValue <= 0.1) return;
  const dx = cx - px, dy = cy - py;
  const distance = Math.sqrt(dx * dx + dy * dy) + 0.001;
  const pull = (strength * gripValue) / (distance * 2 + 0.1);
  output[0] = dx / distance * pull;
  output[1] = dy / distance * pull;
}
