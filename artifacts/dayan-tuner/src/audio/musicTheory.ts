export const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

export type NoteName = `${(typeof NOTE_NAMES)[number]}${number}`;

export const SUPPORTED_NOTES = Array.from({ length: 24 }, (_, index) => {
  const midi = 48 + index;
  return midiToNoteName(midi);
});

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function frequencyToMidi(frequency: number): number {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return Number.NaN;
  }

  return 69 + 12 * Math.log2(frequency / 440);
}

export function midiToNoteName(midi: number): string {
  const roundedMidi = Math.round(midi);
  const octave = Math.floor(roundedMidi / 12) - 1;
  return `${NOTE_NAMES[((roundedMidi % 12) + 12) % 12]}${octave}`;
}

export function frequencyToNoteName(frequency: number): string {
  const midi = frequencyToMidi(frequency);
  return Number.isFinite(midi) ? midiToNoteName(midi) : '—';
}

export function noteNameToFrequency(noteName: string): number {
  const match = /^([A-G](?:#|b)?)(-?\d+)$/.exec(noteName.trim());
  if (!match) {
    return Number.NaN;
  }

  const accidental = match[1];
  const octave = Number(match[2]);
  const semitone = NOTE_NAMES.indexOf(accidental as (typeof NOTE_NAMES)[number]);
  const naturalSemitone = NOTE_NAMES.indexOf(
    accidental[0] as (typeof NOTE_NAMES)[number],
  );
  const normalizedSemitone =
    semitone >= 0
      ? semitone
      : accidental.endsWith('b') && naturalSemitone >= 0
        ? (naturalSemitone + 11) % 12
        : -1;

  if (normalizedSemitone < 0 || !Number.isFinite(octave)) {
    return Number.NaN;
  }

  return midiToFrequency((octave + 1) * 12 + normalizedSemitone);
}

export function centsDifference(measuredFrequency: number, targetFrequency: number): number {
  if (
    !Number.isFinite(measuredFrequency) ||
    measuredFrequency <= 0 ||
    !Number.isFinite(targetFrequency) ||
    targetFrequency <= 0
  ) {
    return Number.NaN;
  }

  return 1200 * Math.log2(measuredFrequency / targetFrequency);
}

export function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) {
    return '—';
  }

  const rounded = Math.round(cents);
  return `${rounded > 0 ? '+' : ''}${rounded}¢`;
}

export type TuningStatus = 'in-tune' | 'sharp' | 'flat';

export function tuningStatus(cents: number, tolerance: number): TuningStatus {
  if (Math.abs(cents) <= tolerance) {
    return 'in-tune';
  }

  return cents > 0 ? 'sharp' : 'flat';
}