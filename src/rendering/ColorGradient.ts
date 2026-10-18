/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ColorStop {
  value: number; // position from 0.0 to 1.0
  color: RGBA;
}

/**
 * Interpolates along a series of color stops.
 * value is clamped between 0 and 1.
 */
export function interpolateColor(stops: ColorStop[], value: number): RGBA {
  const t = Math.max(0.0, Math.min(1.0, value));
  
  if (stops.length === 0) {
    return { r: 1, g: 1, b: 1, a: 1 };
  }
  if (stops.length === 1) {
    return stops[0].color;
  }
  
  // Find the interval
  let lowerStop = stops[0];
  let upperStop = stops[stops.length - 1];
  
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].value && t <= stops[i + 1].value) {
      lowerStop = stops[i];
      upperStop = stops[i + 1];
      break;
    }
  }
  
  const range = upperStop.value - lowerStop.value;
  const factor = range > 0 ? (t - lowerStop.value) / range : 0;
  
  return {
    r: lowerStop.color.r + (upperStop.color.r - lowerStop.color.r) * factor,
    g: lowerStop.color.g + (upperStop.color.g - lowerStop.color.g) * factor,
    b: lowerStop.color.b + (upperStop.color.b - lowerStop.color.b) * factor,
    a: lowerStop.color.a + (upperStop.color.a - lowerStop.color.a) * factor,
  };
}
