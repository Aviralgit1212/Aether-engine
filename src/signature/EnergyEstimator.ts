/** @license SPDX-License-Identifier: Apache-2.0 */
import { Config } from "../core/Config";
import { ParticleSystem } from "../particles/ParticleSystem";

export class EnergyEstimator {
  private currentEnergy = 0;

  public update(particleSystem: ParticleSystem, dt: number): number {
    const ax = particleSystem.anchorX;
    const ay = particleSystem.anchorY;
    const radius = Config.ENERGY_CAPTURE_RADIUS;
    const radiusSq = radius * radius;
    let weightedCount = 0;
    const positions = particleSystem.positions;
    const count = particleSystem.activeCount;
    for (let i = 0; i < count; i++) {
      const dx = positions[i * 2] - ax;
      const dy = positions[i * 2 + 1] - ay;
      const distSq = dx * dx + dy * dy;
      if (distSq <= radiusSq) weightedCount += 1 - Math.sqrt(distSq) / radius;
    }
    const target = Math.max(0, Math.min(1, weightedCount / Math.max(1, count * 0.28)));
    const alpha = 1 - Math.pow(1 - Math.min(1, Config.ENERGY_SMOOTHING), Math.max(0, dt * 60));
    this.currentEnergy += (target - this.currentEnergy) * alpha;
    return this.currentEnergy;
  }

  /** Smooth decay is explicit so the loop never needs to poke private estimator state. */
  public decay(dt: number, ratePerSec: number): number {
    this.currentEnergy = Math.max(0, this.currentEnergy - Math.max(0, ratePerSec) * Math.max(0, dt));
    return this.currentEnergy;
  }
  public getEnergyLevel(): number { return this.currentEnergy * 100; }
  public getEnergyFraction(): number { return this.currentEnergy; }
  public reset(): void { this.currentEnergy = 0; }
}
export default EnergyEstimator;
