/** @license SPDX-License-Identifier: Apache-2.0 */
/** Integrates one particle without allocating a return object. Output layout: x, y, vx, vy. */
export function integrateParticle(
  px: number, py: number, vx: number, vy: number,
  fx: number, fy: number, drag: number, dt: number,
  output: Float32Array, offset = 0,
): void {
  let nextVx = (vx + fx * dt) * Math.max(0, 1 - drag * dt);
  let nextVy = (vy + fy * dt) * Math.max(0, 1 - drag * dt);
  let nextX = px + nextVx * dt;
  let nextY = py + nextVy * dt;
  const margin = 0.02;
  if (nextX < margin) { nextX = margin; nextVx *= -0.3; }
  else if (nextX > 1 - margin) { nextX = 1 - margin; nextVx *= -0.3; }
  if (nextY < margin) { nextY = margin; nextVy *= -0.3; }
  else if (nextY > 1 - margin) { nextY = 1 - margin; nextVy *= -0.3; }
  output[offset] = nextX;
  output[offset + 1] = nextY;
  output[offset + 2] = nextVx;
  output[offset + 3] = nextVy;
}
