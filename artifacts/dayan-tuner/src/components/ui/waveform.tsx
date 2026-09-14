import * as React from 'react';
import { cn } from '@/lib/utils';

type WaveformVariant = 'default' | 'success' | 'warning' | 'danger';
type WaveformIntensity = 'low' | 'medium' | 'high';

export interface WaveformProps extends React.HTMLAttributes<HTMLDivElement> {
  bars?: number;
  playing?: boolean;
  variant?: WaveformVariant;
  label?: string;
  intensity?: WaveformIntensity;
  audioSrc?: string;
}

const intensityRange: Record<WaveformIntensity, { min: number; max: number }> = {
  low: { min: 20, max: 46 },
  medium: { min: 30, max: 72 },
  high: { min: 42, max: 96 },
};

/** A small, dependency-light animated waveform for the How It Works visual. */
export function Waveform({
  bars = 28,
  playing = false,
  variant = 'default',
  label,
  intensity = 'medium',
  audioSrc,
  className,
  ...props
}: WaveformProps) {
  const [heights, setHeights] = React.useState<number[]>(() =>
    Array.from({ length: bars }, (_, index) => 34 + ((index * 17) % 34)),
  );
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const range = intensityRange[intensity];

  React.useEffect(() => {
    if (!playing) return;

    let frame = 0;
    let lastUpdate = 0;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const animate = (timestamp: number) => {
      if (prefersReducedMotion || timestamp - lastUpdate > 110) {
        lastUpdate = timestamp;
        setHeights(Array.from({ length: bars }, (_, index) => {
          const wave = Math.abs(Math.sin(timestamp / 420 + index * 0.72));
          const variation = Math.random() * 16;
          return Math.round(Math.min(range.max, range.min + wave * (range.max - range.min) + variation));
        }));
      }

      if (!prefersReducedMotion) frame = requestAnimationFrame(animate);
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [bars, playing, range.max, range.min]);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, [playing]);

  return (
    <div
      {...props}
      className={cn('guide-waveform', `guide-waveform-${variant}`, className)}
      role="img"
      aria-label={label || 'Animated recording waveform'}
    >
      <div className="guide-waveform-bars" aria-hidden="true">
        {heights.map((height, index) => (
          <span key={index} style={{ height: `${height}%` }} />
        ))}
      </div>
      {label ? <span className="guide-waveform-label">{label}</span> : null}
      {audioSrc ? <audio ref={audioRef} src={audioSrc} loop preload="metadata" /> : null}
    </div>
  );
}
