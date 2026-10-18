/**
 * Improved Perlin noise plus a coarse, shared vector flow field.
 * The particle hot loop samples this field instead of evaluating 3D Perlin per particle.
 */
const PERMUTATION_256 = [
  151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,
  140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,
  247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,
  57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,
  74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,
  60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,
  65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,
  200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,
  52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,
  207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,
  119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,
  129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,
  218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,
  81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,
  184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,
  222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180,
];

if (PERMUTATION_256.length !== 256 || new Set(PERMUTATION_256).size !== 256 ||
    PERMUTATION_256.some((v) => v < 0 || v > 255)) {
  throw new Error("NoiseField: the canonical permutation must contain each integer 0..255 exactly once.");
}

class ImprovedNoise {
  private readonly p = new Uint16Array(512);
  constructor() {
    for (let i = 0; i < 256; i++) {
      this.p[i] = PERMUTATION_256[i];
      this.p[i + 256] = PERMUTATION_256[i];
    }
  }
  private fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }
  private lerp(t: number, a: number, b: number): number { return a + t * (b - a); }
  private grad(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }
  public noise(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = this.fade(x), v = this.fade(y), w = this.fade(z);
    const A = this.p[X] + Y, AA = this.p[A] + Z, AB = this.p[A + 1] + Z;
    const B = this.p[X + 1] + Y, BA = this.p[B] + Z, BB = this.p[B + 1] + Z;
    return this.lerp(w,
      this.lerp(v,
        this.lerp(u, this.grad(this.p[AA], x, y, z), this.grad(this.p[BA], x - 1, y, z)),
        this.lerp(u, this.grad(this.p[AB], x, y - 1, z), this.grad(this.p[BB], x - 1, y - 1, z))),
      this.lerp(v,
        this.lerp(u, this.grad(this.p[AA + 1], x, y, z - 1), this.grad(this.p[BA + 1], x - 1, y, z - 1)),
        this.lerp(u, this.grad(this.p[AB + 1], x, y - 1, z - 1), this.grad(this.p[BB + 1], x - 1, y - 1, z - 1))));
  }
}

const noise = new ImprovedNoise();
export function getNoise2D(x: number, y: number): number { return noise.noise(x, y, 0.5); }
export function getNoise3D(x: number, y: number, z: number): number { return noise.noise(x, y, z); }
export function getNoiseVector(x: number, y: number, z: number, output: Float32Array): void {
  output[0] = noise.noise(x, y, z);
  output[1] = noise.noise(x + 11.5, y + 21.3, z + 3.14);
}

/** 64x64-ish reusable grid. Sampling writes to a caller-owned scratch array. */
export class FlowField {
  public readonly size: number;
  private readonly vectors: Float32Array;
  private tick = 0;
  constructor(size = 64) {
    this.size = Math.max(8, Math.floor(size));
    this.vectors = new Float32Array(this.size * this.size * 2);
  }
  public update(time: number, scale: number, strength: number): void {
    if ((this.tick++ & 1) === 1) return;
    const size = this.size;
    let offset = 0;
    for (let y = 0; y < size; y++) {
      const py = (y / (size - 1)) * scale;
      for (let x = 0; x < size; x++) {
        const px = (x / (size - 1)) * scale;
        this.vectors[offset++] = noise.noise(px, py, time) * strength;
        this.vectors[offset++] = noise.noise(px + 11.5, py + 21.3, time + 3.14) * strength;
      }
    }
  }
  public sample(x: number, y: number, out: Float32Array): void {
    const max = this.size - 1;
    const gx = Math.max(0, Math.min(max, x * max));
    const gy = Math.max(0, Math.min(max, y * max));
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const x1 = Math.min(max, x0 + 1), y1 = Math.min(max, y0 + 1);
    const tx = gx - x0, ty = gy - y0;
    const i00 = (y0 * this.size + x0) * 2;
    const i10 = (y0 * this.size + x1) * 2;
    const i01 = (y1 * this.size + x0) * 2;
    const i11 = (y1 * this.size + x1) * 2;
    const a0 = this.vectors[i00] + (this.vectors[i10] - this.vectors[i00]) * tx;
    const a1 = this.vectors[i01] + (this.vectors[i11] - this.vectors[i01]) * tx;
    const b0 = this.vectors[i00 + 1] + (this.vectors[i10 + 1] - this.vectors[i00 + 1]) * tx;
    const b1 = this.vectors[i01 + 1] + (this.vectors[i11 + 1] - this.vectors[i01 + 1]) * tx;
    out[0] = a0 + (a1 - a0) * ty;
    out[1] = b0 + (b1 - b0) * ty;
  }
}
