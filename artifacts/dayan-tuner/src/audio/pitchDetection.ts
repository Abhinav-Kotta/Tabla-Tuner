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

  let bestLag = minLag;
  let bestScore = -1;
  let secondBestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const correlation = autocorrelation[lag] ?? 0;
    if (correlation <= 0) {
      continue;
    }

    // A period that repeats at 2x and 3x is much more likely to be the
    // fundamental than a short period caused by a dominant overtone.
    const secondHarmonic = autocorrelation[Math.min(maxLag, lag * 2)] ?? 0;
    const thirdHarmonic = autocorrelation[Math.min(maxLag, lag * 3)] ?? 0;
    const harmonicAgreement =
      Math.max(0, secondHarmonic) * 0.16 + Math.max(0, thirdHarmonic) * 0.09;
    const score = correlation * 0.75 + harmonicAgreement;

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
  const harmonicAgreement =
    Math.max(0, autocorrelation[Math.min(maxLag, bestLag * 2)] ?? 0) * 0.65 +
    Math.max(0, autocorrelation[Math.min(maxLag, bestLag * 3)] ?? 0) * 0.35;
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