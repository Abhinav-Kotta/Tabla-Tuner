import {
  normalizedAutocorrelation,
  parabolicPeak,
  removeDcOffset,
  rms,
} from './signalUtils';

export interface PitchResult {
  frequency: number | null;
  confidence: number;
  correlation: number;
  /** Repetition evidence at two and three candidate periods. */
  harmonicAgreement: number;
}

export interface PitchDetectionOptions {
  minFrequency?: number;
  maxFrequency?: number;
  minConfidence?: number;
}

const DEFAULT_OPTIONS: Required<PitchDetectionOptions> = {
  minFrequency: 110,
  maxFrequency: 620,
  minConfidence: 0.46,
};

/**
 * A tabla's loudest FFT bin is often a harmonic, not the perceived pitch.
 * This detector searches for repeating waveform periods using autocorrelation
 * and rewards candidate periods whose second and third harmonics agree. That
 * makes a louder 2f partial less likely to become an octave-up answer.
 */
export function estimatePitch(
  input: Float32Array,
  sampleRate: number,
  options: PitchDetectionOptions = {},
): PitchResult {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const samples = removeDcOffset(input);
  if (samples.length < 128 || rms(samples) < 0.004 || sampleRate <= 0) {
    return { frequency: null, confidence: 0, correlation: 0, harmonicAgreement: 0 };
  }

  const minLag = Math.max(2, Math.floor(sampleRate / settings.maxFrequency));
  const maxLag = Math.min(
    samples.length - 2,
    Math.ceil(sampleRate / settings.minFrequency),
  );
  const autocorrelation = normalizedAutocorrelation(samples, minLag, maxLag);

  const repeatedPeriodAgreement = (lag: number): number => {
    const checks = [
      { index: lag * 2, weight: 0.16 },
      { index: lag * 3, weight: 0.09 },
    ].filter((check) => check.index <= maxLag);

    if (checks.length === 0) return 0;

    const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
    return checks.reduce(
      (sum, check) => sum + Math.max(0, autocorrelation[check.index] ?? 0) * check.weight,
      0,
    ) / totalWeight;
  };

  let bestLag = minLag;
  let bestScore = -1;
  let secondBestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const correlation = autocorrelation[lag] ?? 0;
    if (correlation <= 0) {
      continue;
    }

    // Only use real two-period and three-period samples. An out-of-range
    // check is omitted instead of being clamped to the final search bin.
    const harmonicAgreement = repeatedPeriodAgreement(lag);
    const score = correlation * 0.8 + harmonicAgreement * 0.2;

    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestLag = lag;
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  const refinedLag = parabolicPeak(autocorrelation, bestLag);
  const frequency = sampleRate / refinedLag;
  const correlation = autocorrelation[bestLag] ?? 0;
  const harmonicAgreement = repeatedPeriodAgreement(bestLag);
  const margin = Math.max(0, bestScore - secondBestScore);
  const confidence = Math.min(
    1,
    Math.max(0, correlation * 0.72 + harmonicAgreement * 0.18 + margin * 0.35),
  );

  return {
    frequency: confidence >= settings.minConfidence ? frequency : null,
    confidence,
    correlation,
    harmonicAgreement,
  };
}
