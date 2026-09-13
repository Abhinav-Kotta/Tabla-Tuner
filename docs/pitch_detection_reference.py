"""Readable Python reference for the Dayan Tuner pitch-detection pipeline.

The browser app runs the equivalent TypeScript in ``src/audio``. This file is
intentionally dependency-free so the math can be read, copied, and modified
with a normal Python installation.
"""

from dataclasses import dataclass
from math import ceil, cos, floor, isfinite, log2, pi, sqrt
from statistics import median
from time import perf_counter


DEFAULT_MIN_FREQUENCY = 110.0
DEFAULT_MAX_FREQUENCY = 620.0
DEFAULT_MIN_CONFIDENCE = 0.46


@dataclass(frozen=True)
class PitchResult:
    frequency: float | None
    confidence: float
    correlation: float
    harmonic_agreement: float


def rms(samples: list[float]) -> float:
    """Root-mean-square amplitude: a simple measure of signal energy."""

    if not samples:
        return 0.0
    return sqrt(sum(sample * sample for sample in samples) / len(samples))


def remove_dc_offset(samples: list[float]) -> list[float]:
    """Center the waveform around zero before measuring its repeating shape."""

    if not samples:
        return []
    average = sum(samples) / len(samples)
    return [sample - average for sample in samples]


def normalized_autocorrelation(
    samples: list[float], min_lag: int, max_lag: int
) -> list[float]:
    """Compare a signal with delayed copies of itself for each candidate lag."""

    output = [0.0] * (max_lag + 1)
    for lag in range(min_lag, max_lag + 1):
        pairs = len(samples) - lag
        if pairs <= 0:
            continue
        numerator = sum(samples[index] * samples[index + lag] for index in range(pairs))
        left_energy = sum(samples[index] ** 2 for index in range(pairs))
        right_energy = sum(samples[index + lag] ** 2 for index in range(pairs))
        denominator = sqrt(left_energy * right_energy)
        output[lag] = numerator / denominator if denominator else 0.0
    return output


def parabolic_peak(values: list[float], index: int) -> float:
    """Refine a discrete peak by fitting a parabola through three bins."""

    if index <= 0 or index >= len(values) - 1:
        return float(index)
    left, center, right = values[index - 1], values[index], values[index + 1]
    denominator = left - 2 * center + right
    if denominator == 0:
        return float(index)
    return index + 0.5 * (left - right) / denominator


def repeated_period_agreement(
    autocorrelation: list[float], lag: int, max_lag: int
) -> float:
    """Reward evidence at two and three repetitions of a candidate period.

    Notice that an unavailable lag is omitted. It is not clamped to max_lag,
    because clamping can make unrelated checks read the same endpoint bin.
    """

    checks = [(lag * 2, 0.16), (lag * 3, 0.09)]
    checks = [(index, weight) for index, weight in checks if index <= max_lag]
    if not checks:
        return 0.0
    total_weight = sum(weight for _, weight in checks)
    return sum(max(0.0, autocorrelation[index]) * weight for index, weight in checks) / total_weight


def estimate_pitch(
    input_samples: list[float],
    sample_rate: float,
    min_frequency: float = DEFAULT_MIN_FREQUENCY,
    max_frequency: float = DEFAULT_MAX_FREQUENCY,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
) -> PitchResult:
    """Estimate the fundamental frequency of one audio frame."""

    samples = remove_dc_offset(input_samples)
    if len(samples) < 128 or rms(samples) < 0.004 or sample_rate <= 0:
        return PitchResult(None, 0.0, 0.0, 0.0)

    min_lag = max(2, floor(sample_rate / max_frequency))
    max_lag = min(len(samples) - 2, ceil(sample_rate / min_frequency))
    if min_lag > max_lag:
        return PitchResult(None, 0.0, 0.0, 0.0)

    autocorrelation = normalized_autocorrelation(samples, min_lag, max_lag)
    best_lag = min_lag
    best_score = -1.0
    second_best_score = -1.0

    for lag in range(min_lag, max_lag + 1):
        correlation = autocorrelation[lag]
        if correlation <= 0:
            continue
        agreement = repeated_period_agreement(autocorrelation, lag, max_lag)
        score = correlation * 0.8 + agreement * 0.2
        if score > best_score:
            second_best_score = best_score
            best_score = score
            best_lag = lag
        elif score > second_best_score:
            second_best_score = score

    refined_lag = parabolic_peak(autocorrelation, best_lag)
    frequency = sample_rate / refined_lag if refined_lag > 0 else float("nan")
    correlation = autocorrelation[best_lag]
    agreement = repeated_period_agreement(autocorrelation, best_lag, max_lag)
    margin = max(0.0, best_score - second_best_score)
    confidence = min(1.0, max(0.0, correlation * 0.72 + agreement * 0.18 + margin * 0.35))

    return PitchResult(
        frequency=frequency if confidence >= min_confidence and isfinite(frequency) else None,
        confidence=confidence,
        correlation=correlation,
        harmonic_agreement=agreement,
    )


@dataclass(frozen=True)
class OnsetState:
    level: float
    noise_floor: float
    detected: bool


class OnsetDetector:
    """Detect the start of a strike from energy, noise, and a cooldown."""

    def __init__(
        self,
        threshold_multiplier: float = 3.3,
        minimum_level: float = 0.035,
        cooldown_ms: float = 550.0,
        noise_adaptation: float = 0.04,
    ) -> None:
        self.threshold_multiplier = threshold_multiplier
        self.minimum_level = minimum_level
        self.cooldown_ms = cooldown_ms
        self.noise_adaptation = noise_adaptation
        self.last_onset_at = float("-inf")
        self.noise_floor = 0.008

    def process(self, samples: list[float], now_ms: float | None = None) -> OnsetState:
        now = perf_counter() * 1000 if now_ms is None else now_ms
        level = rms(samples)
        threshold = max(self.minimum_level, self.noise_floor * self.threshold_multiplier)
        detected = level >= threshold and now - self.last_onset_at >= self.cooldown_ms
        if detected:
            self.last_onset_at = now
        elif level < threshold:
            self.noise_floor += (level - self.noise_floor) * self.noise_adaptation
        return OnsetState(level, self.noise_floor, detected)

    def reset(self) -> None:
        self.last_onset_at = float("-inf")
        self.noise_floor = 0.008


def aggregate_pitch_frames(results: list[PitchResult]) -> PitchResult | None:
    """Combine valid frames from one strike using medians."""

    valid = [result for result in results if result.frequency is not None]
    if not valid:
        return None
    return PitchResult(
        frequency=median([result.frequency for result in valid if result.frequency is not None]),
        confidence=median([result.confidence for result in valid]),
        correlation=median([result.correlation for result in valid]),
        harmonic_agreement=median([result.harmonic_agreement for result in valid]),
    )


NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


def frequency_to_midi(frequency: float) -> float:
    return 69.0 + 12.0 * log2(frequency / 440.0)


def midi_to_note_name(midi: int) -> str:
    octave = midi // 12 - 1
    return f"{NOTE_NAMES[midi % 12]}{octave}"


def frequency_to_note_name(frequency: float) -> str:
    """Return the nearest equal-tempered note using A4 = 440 Hz."""

    return midi_to_note_name(round(frequency_to_midi(frequency)))


def note_name_to_frequency(note_name: str) -> float:
    note = note_name[:-1]
    octave = int(note_name[-1])
    midi = (octave + 1) * 12 + NOTE_NAMES.index(note)
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)


def cents_difference(measured_frequency: float, target_frequency: float) -> float:
    return 1200.0 * log2(measured_frequency / target_frequency)


if __name__ == "__main__":
    target = note_name_to_frequency("D4")
    print(f"D4 target: {target:.2f} Hz")
    print(f"293.66 Hz is nearest to {frequency_to_note_name(293.66)}")
    print(f"300 Hz is {cents_difference(300.0, target):+.1f} cents from D4")
