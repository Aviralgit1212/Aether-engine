/** @license SPDX-License-Identifier: Apache-2.0 */

/** Rasterize a signature at high resolution and assign targets in spatial order. */
export class TextTargetSampler {
  public sampleTextPoints(text: string, count: number, sourcePositions?: Float32Array): Float32Array {
    const width = 2048;
    const height = 512;
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const targets = new Float32Array(count * 2);
    if (!ctx) return this.makeFallback(targets, count);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const normalized = text.trim().slice(0, 12).toUpperCase() || "AVIRAL";
    // Scale the font with text length, then auto-fit to the actual alpha bounds below.
    const fontSize = Math.min(330, Math.max(150, 1800 / Math.max(1, normalized.length)));
    ctx.font = `800 ${fontSize}px 'Space Grotesk', 'Inter', 'Arial', sans-serif`;
    ctx.fillText(normalized, width / 2, height / 2, width * 0.92);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const xs: number[] = [];
    const ys: number[] = [];
    const weights: number[] = [];
    let minX = width, maxX = 0, minY = height, maxY = 0;
    const stride = 2;
    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        const alpha = pixels[(y * width + x) * 4 + 3];
        if (alpha < 80) continue;
        xs.push(x); ys.push(y);
        // Edge pixels are a little more likely to be chosen, preserving crisp outlines.
        const left = x > 0 ? pixels[(y * width + x - 1) * 4 + 3] : 0;
        const right = x + 1 < width ? pixels[(y * width + x + 1) * 4 + 3] : 0;
        const up = y > 0 ? pixels[((y - 1) * width + x) * 4 + 3] : 0;
        const down = y + 1 < height ? pixels[((y + 1) * width + x) * 4 + 3] : 0;
        const edge = (left < 80 || right < 80 || up < 80 || down < 80);
        weights.push(edge ? 1.7 : 1.0);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    if (xs.length === 0) return this.makeFallback(targets, count);

    const textW = Math.max(1, maxX - minX);
    const textH = Math.max(1, maxY - minY);
    const fitScale = Math.min(0.76 / textW, 0.34 / textH);
    const points: Array<{ x: number; y: number; weight: number }> = new Array(xs.length);
    for (let i = 0; i < xs.length; i++) {
      points[i] = {
        x: 0.5 + (xs[i] - (minX + maxX) * 0.5) * fitScale,
        y: 0.5 + (ys[i] - (minY + maxY) * 0.5) * fitScale,
        weight: weights[i],
      };
    }
    // Deterministic weighted sampling: duplicate edge samples a little more often.
    const weighted: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < points.length; i++) {
      const copies = points[i].weight > 1.5 ? 2 : 1;
      for (let j = 0; j < copies; j++) weighted.push(points[i]);
    }
    weighted.sort((a, b) => a.x - b.x || a.y - b.y);

    // Order the source particles and targets left-to-right, reducing criss-cross paths.
    if (sourcePositions && sourcePositions.length >= count * 2) {
      const order = new Array<number>(count);
      for (let i = 0; i < count; i++) order[i] = i;
      order.sort((a, b) => sourcePositions[a * 2] - sourcePositions[b * 2] || sourcePositions[a * 2 + 1] - sourcePositions[b * 2 + 1]);
      for (let rank = 0; rank < count; rank++) {
        const point = weighted[Math.floor(rank * weighted.length / count)];
        const particleIndex = order[rank];
        targets[particleIndex * 2] = point.x;
        targets[particleIndex * 2 + 1] = point.y;
      }
    } else {
      for (let i = 0; i < count; i++) {
        const point = weighted[Math.floor(i * weighted.length / count)];
        targets[i * 2] = point.x;
        targets[i * 2 + 1] = point.y;
      }
    }
    return targets;
  }

  private makeFallback(targets: Float32Array, count: number): Float32Array {
    for (let i = 0; i < count; i++) {
      const angle = (i / Math.max(1, count)) * Math.PI * 2;
      targets[i * 2] = 0.5 + Math.cos(angle) * 0.27;
      targets[i * 2 + 1] = 0.5 + Math.sin(angle) * 0.12;
    }
    return targets;
  }
}
export default TextTargetSampler;
