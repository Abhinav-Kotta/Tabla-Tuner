export function rms(samples: Float32Array | ArrayLike<number>): number {
  if (samples.length === 0) {
    return 0;
  }

  let sumSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    sumSquares += sample * sample;
  }

  return Math.sqrt(sumSquares / samples.length);
}

export function mean(samples: ArrayLike<number>): number {
  if (samples.length === 0) {
    return 0;
  }

  let total = 0;
  for (let index = 0; index < samples.length; index += 1) {
    total += samples[index] ?? 0;
  }
  return total / samples.length;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return Number.NaN;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function hannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  if (length <= 1) {
    window.fill(1);
    return window;
  }

  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (length - 1)));
  }
  return window;
}

export function removeDcOffset(samples: Float32Array): Float32Array {
  const centered = new Float32Array(samples.length);
  const offset = mean(samples);
  for (let index = 0; index < samples.length; index += 1) {
    centered[index] = samples[index] - offset;
  }
  return centered;
}

export function normalizedAutocorrelation(
  samples: Float32Array,
  minLag: number,
  maxLag: number,
): Float32Array {
  const safeMinLag = Math.max(1, Math.floor(minLag));
  const safeMaxLag = Math.min(samples.length - 2, Math.floor(maxLag));
  const result = new Float32Array(Math.max(0, safeMaxLag + 1));

  let energy = 0;
  for (let index = 0; index < samples.length; index += 1) {
    energy += samples[index] * samples[index];
  }
  if (energy <= Number.EPSILON) {
    return result;
  }

  for (let lag = safeMinLag; lag <= safeMaxLag; lag += 1) {
    let correlation = 0;
    let laggedEnergy = 0;
    const limit = samples.length - lag;
    for (let index = 0; index < limit; index += 1) {
      const current = samples[index];
      const lagged = samples[index + lag];
      correlation += current * lagged;
      laggedEnergy += lagged * lagged;
    }
    result[lag] =
      laggedEnergy > Number.EPSILON
        ? correlation / Math.sqrt(energy * laggedEnergy)
        : 0;
  }

  return result;
}

export function parabolicPeak(values: ArrayLike<number>, index: number): number {
  const left = values[index - 1] ?? values[index];
  const center = values[index] ?? 0;
  const right = values[index + 1] ?? values[index];
  const denominator = left - 2 * center + right;
  if (Math.abs(denominator) < 1e-8) {
    return index;
  }

  return index + 0.5 * ((left - right) / denominator);
}