/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface HandState {
  palmCentroid: { x: number; y: number; z: number };
  handScale: number;
  gripValue: number; // 0 = open hand, 1 = closed fist
  fingerExtensions: number[]; // [thumb, index, middle, ring, pinky], 0..1
  fingertips: { x: number; y: number; z: number }[];
  velocity: { x: number; y: number };
  stability: number; // lower means steadier
  pinchValue: number;
  openPalmValue: number;
  pinchPoint: { x: number; y: number; z: number };
  isPinching: boolean;
  isOpenPalm: boolean;
}

// MediaPipe landmark indices.
const FINGER_TIPS = [4, 8, 12, 16, 20] as const;

// For each non-thumb finger: MCP, PIP, DIP, TIP.
const FINGER_JOINTS = [
  { mcp: 5, pip: 6, dip: 7, tip: 8 },
  { mcp: 9, pip: 10, dip: 11, tip: 12 },
  { mcp: 13, pip: 14, dip: 15, tip: 16 },
  { mcp: 17, pip: 18, dip: 19, tip: 20 },
] as const;

const EPSILON = 1e-8;

function clamp(
  value: number,
  min = 0,
  max = 1,
): number {
  return Math.max(min, Math.min(max, value));
}

function mapRange(
  value: number,
  minValue: number,
  maxValue: number,
): number {
  if (maxValue <= minValue) return 0;

  return clamp(
    (value - minValue) / (maxValue - minValue),
  );
}

function distance3D(
  a: Landmark,
  b: Landmark,
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;

  return Math.sqrt(
    dx * dx + dy * dy + dz * dz,
  );
}

function distance2D(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;

  return Math.sqrt(dx * dx + dy * dy);
}

/** Returns the inner angle ABC in degrees. A straight finger is near 180°. */
function angleAtJoint(
  a: Landmark,
  b: Landmark,
  c: Landmark,
): number {
  const bax = a.x - b.x;
  const bay = a.y - b.y;
  const baz = a.z - b.z;

  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const bcz = c.z - b.z;

  const lengthBA = Math.sqrt(
    bax * bax + bay * bay + baz * baz,
  );

  const lengthBC = Math.sqrt(
    bcx * bcx + bcy * bcy + bcz * bcz,
  );

  if (
    lengthBA < EPSILON ||
    lengthBC < EPSILON
  ) {
    return 0;
  }

  const dot =
    bax * bcx +
    bay * bcy +
    baz * bcz;

  const cosine = clamp(
    dot / (lengthBA * lengthBC),
    -1,
    1,
  );

  return (
    Math.acos(cosine) * 180
  ) / Math.PI;
}

/**
 * Estimate how straight a finger is from its joint angles.
 * A curled finger may have a long fingertip-to-base distance,
 * so joint angles are more useful than distance alone.
 */
function calculateFingerExtensions(
  landmarks: Landmark[],
  handScale: number,
): number[] {
  // Thumb extension uses the thumb joint angle and its
  // separation from the index-finger base.
  const thumbAngle = angleAtJoint(
    landmarks[2],
    landmarks[3],
    landmarks[4],
  );

  const thumbAngleScore = mapRange(
    thumbAngle,
    85,
    165,
  );

  const thumbSpread =
    handScale > EPSILON
      ? distance3D(
          landmarks[4],
          landmarks[5],
        ) / handScale
      : 0;

  const thumbSpreadScore = mapRange(
    thumbSpread,
    0.45,
    1.35,
  );

  const thumbExtension = clamp(
    thumbAngleScore * 0.6 +
    thumbSpreadScore * 0.4,
  );

  const extensions = [thumbExtension];

  // Index, middle, ring and little fingers.
  for (const finger of FINGER_JOINTS) {
    const pipAngle = angleAtJoint(
      landmarks[finger.mcp],
      landmarks[finger.pip],
      landmarks[finger.dip],
    );

    const dipAngle = angleAtJoint(
      landmarks[finger.pip],
      landmarks[finger.dip],
      landmarks[finger.tip],
    );

    // Straight joints score near one.
    // Curled joints score nearer zero.
    const pipExtension = mapRange(
      pipAngle,
      100,
      165,
    );

    const dipExtension = mapRange(
      dipAngle,
      90,
      165,
    );

    extensions.push(
      clamp(
        pipExtension * 0.65 +
        dipExtension * 0.35,
      ),
    );
  }

  return extensions;
}

/** Smooths hand-centre movement and gesture values across frames. */
export class HandHistory {
  private history: {
    centroid: {
      x: number;
      y: number;
      z: number;
    };
    time: number;
  }[] = [];

  private readonly maxDurationMs: number;

  private pinchEma = 0;
  private openPalmEma = 0;
  private gripEma = 0;

  private pinching = false;
  private openPalm = false;

  constructor(maxDurationMs = 2000) {
    this.maxDurationMs = maxDurationMs;
  }

  public add(
    centroid: {
      x: number;
      y: number;
      z: number;
    },
    time: number,
  ): void {
    this.history.push({
      centroid: { ...centroid },
      time,
    });

    this.clean(time);
  }

  private clean(now: number): void {
    const cutoff = now - this.maxDurationMs;

    while (
      this.history.length > 0 &&
      this.history[0].time < cutoff
    ) {
      this.history.shift();
    }
  }

  public getVelocity(
    _now: number,
  ): { x: number; y: number } {
    if (this.history.length < 2) {
      return { x: 0, y: 0 };
    }

    // Compare with a recent sample approximately
    // 100 ms earlier instead of using all old samples.
    const end = this.history[this.history.length - 1];
    const targetTime = end.time - 100;

    let start = this.history[0];

    for (
      let i = this.history.length - 2;
      i >= 0;
      i--
    ) {
      if (this.history[i].time <= targetTime) {
        start = this.history[i];
        break;
      }
    }

    const dt =
      (end.time - start.time) / 1000;

    if (dt <= EPSILON) {
      return { x: 0, y: 0 };
    }

    return {
      x: (end.centroid.x - start.centroid.x) / dt,
      y: (end.centroid.y - start.centroid.y) / dt,
    };
  }

  /** Maximum 2D separation between samples in the history window. */
  public getStabilityMetric(): number {
    if (this.history.length < 2) {
      return 0;
    }

    let maxDistance = 0;

    for (
      let i = 0;
      i < this.history.length;
      i++
    ) {
      for (
        let j = i + 1;
        j < this.history.length;
        j++
      ) {
        const current = distance2D(
          this.history[i].centroid,
          this.history[j].centroid,
        );

        if (current > maxDistance) {
          maxDistance = current;
        }
      }
    }

    return maxDistance;
  }

  /** Smooth grip; close quickly, release gradually to reduce jitter. */
  public smoothGrip(rawGrip: number): number {
    const target = clamp(rawGrip);
    const alpha = target > this.gripEma ? 0.60 : 0.28;

    this.gripEma += (target - this.gripEma) * alpha;
    this.gripEma = clamp(this.gripEma);

    return this.gripEma;
  }

  public smoothGestures(
    rawPinch: number,
    rawOpenPalm: number,
  ): {
    pinchValue: number;
    openPalmValue: number;
    isPinching: boolean;
    isOpenPalm: boolean;
  } {
    const alpha = 0.28;

    this.pinchEma +=
      (clamp(rawPinch) - this.pinchEma) *
      alpha;

    this.openPalmEma +=
      (clamp(rawOpenPalm) - this.openPalmEma) *
      alpha;

    // Different activation and release thresholds
    // reduce flickering between gesture states.
    if (
      !this.pinching &&
      this.pinchEma >= 0.72
    ) {
      this.pinching = true;
    } else if (
      this.pinching &&
      this.pinchEma <= 0.48
    ) {
      this.pinching = false;
    }

    if (
      !this.openPalm &&
      this.openPalmEma >= 0.58
    ) {
      this.openPalm = true;
    } else if (
      this.openPalm &&
      this.openPalmEma <= 0.42
    ) {
      this.openPalm = false;
    }

    return {
      pinchValue: this.pinchEma,
      openPalmValue: this.openPalmEma,
      isPinching: this.pinching,
      isOpenPalm: this.openPalm,
    };
  }

  public clear(): void {
    this.history = [];
    this.pinchEma = 0;
    this.openPalmEma = 0;
    this.gripEma = 0;
    this.pinching = false;
    this.openPalm = false;
  }
}

/** Derive palm location, finger extension, grip and gestures from 21 landmarks. */
export function analyzeHandLandmarks(
  landmarks: Landmark[],
  history?: HandHistory,
  now: number = Date.now(),
): HandState {
  if (
    !Array.isArray(landmarks) ||
    landmarks.length < 21
  ) {
    throw new Error(
      "Invalid or incomplete landmarks list. Minimum 21 landmarks required.",
    );
  }

  const wrist = landmarks[0];
  const middleMcp = landmarks[9];

  const handScale = distance3D(
    wrist,
    middleMcp,
  );

  // Approximate palm centre: wrist and four MCP joints.
  const palmCentroid = {
    x:
      (
        wrist.x +
        landmarks[5].x +
        landmarks[9].x +
        landmarks[13].x +
        landmarks[17].x
      ) / 5,

    y:
      (
        wrist.y +
        landmarks[5].y +
        landmarks[9].y +
        landmarks[13].y +
        landmarks[17].y
      ) / 5,

    z:
      (
        wrist.z +
        landmarks[5].z +
        landmarks[9].z +
        landmarks[13].z +
        landmarks[17].z
      ) / 5,
  };

  history?.add(palmCentroid, now);

  const fingertips = FINGER_TIPS.map(
    (index) => ({
      x: landmarks[index].x,
      y: landmarks[index].y,
      z: landmarks[index].z,
    }),
  );

  const fingerExtensions =
    calculateFingerExtensions(
      landmarks,
      handScale,
    );

  const averageNonThumbExtension =
    (
      fingerExtensions[1] +
      fingerExtensions[2] +
      fingerExtensions[3] +
      fingerExtensions[4]
    ) / 4;

  // Four curled fingers mean higher grip.
  // Remap the score so a naturally imperfect fist can reach the state threshold.
  const rawGripValue = clamp(
    (0.70 - averageNonThumbExtension) / 0.48,
  );
  const gripValue = history
    ? history.smoothGrip(rawGripValue)
    : rawGripValue;

  // Pinch becomes stronger as thumb and index tips get closer.
  const pinchDistance = distance3D(
    landmarks[4],
    landmarks[8],
  );

  const normalizedPinchDistance =
    handScale > EPSILON
      ? pinchDistance / handScale
      : 1;

  const rawPinch = clamp(
    (0.95 - normalizedPinchDistance) / 0.62,
  );

  // A fully extended hand should approach an open-palm score of 1.
  const rawOpenPalm = mapRange(
    averageNonThumbExtension,
    0.30,
    0.88,
  );

  const gestures = history
    ? history.smoothGestures(
        rawPinch,
        rawOpenPalm,
      )
    : {
        pinchValue: rawPinch,
        openPalmValue: rawOpenPalm,
        isPinching: rawPinch >= 0.72,
        isOpenPalm: rawOpenPalm >= 0.58,
      };

  // Midpoint between thumb and index fingertips.
  const pinchPoint = {
    x: (landmarks[4].x + landmarks[8].x) * 0.5,
    y: (landmarks[4].y + landmarks[8].y) * 0.5,
    z: (landmarks[4].z + landmarks[8].z) * 0.5,
  };

  const velocity = history
    ? history.getVelocity(now)
    : { x: 0, y: 0 };

  const stability = history
    ? history.getStabilityMetric()
    : 0;

  return {
    palmCentroid,
    handScale,
    gripValue,
    fingerExtensions,
    fingertips,
    velocity,
    stability,
    pinchValue: gestures.pinchValue,
    openPalmValue: gestures.openPalmValue,
    pinchPoint,
    isPinching: gestures.isPinching,
    isOpenPalm: gestures.isOpenPalm,
  };
}