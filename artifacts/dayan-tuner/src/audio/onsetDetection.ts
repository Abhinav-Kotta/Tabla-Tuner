import { rms } from './signalUtils';

export interface OnsetDetectionOptions {
  thresholdMultiplier?: number;
  minimumLevel?: number;
  cooldownMs?: number;
  noiseAdaptation?: number;
}

export interface OnsetState {
  level: number;
  noiseFloor: number;
  detected: boolean;
}

/**
 * Tabla attacks are short and loud compared with the room. We adapt a slow
 * noise floor, then require a sudden level jump and a cooldown so one strike
 * cannot be counted twice as it rings out.
 */
export class OnsetDetector {
  private readonly thresholdMultiplier: number;
  private readonly minimumLevel: number;
  private readonly cooldownMs: number;
  private readonly noiseAdaptation: number;
  private lastOnsetAt = -Infinity;
  private noiseFloor = 0.008;

  constructor(options: OnsetDetectionOptions = {}) {
    this.thresholdMultiplier = options.thresholdMultiplier ?? 3.3;
    this.minimumLevel = options.minimumLevel ?? 0.035;
    this.cooldownMs = options.cooldownMs ?? 550;
    this.noiseAdaptation = options.noiseAdaptation ?? 0.04;
  }

  process(samples: Float32Array, now = performance.now()): OnsetState {
    const level = rms(samples);
    const threshold = Math.max(
      this.minimumLevel,
      this.noiseFloor * this.thresholdMultiplier,
    );
    const detected =
      level >= threshold && now - this.lastOnsetAt >= this.cooldownMs;

    if (detected) {
      this.lastOnsetAt = now;
    } else if (level < threshold) {
      this.noiseFloor += (level - this.noiseFloor) * this.noiseAdaptation;
    }

    return { level, noiseFloor: this.noiseFloor, detected };
  }

  reset(): void {
    this.lastOnsetAt = -Infinity;
    this.noiseFloor = 0.008;
  }
}