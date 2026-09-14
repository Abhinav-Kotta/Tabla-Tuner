import * as React from 'react';
import { useInView, useReducedMotion } from 'framer-motion';
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
  const waveformRef = React.useRef<HTMLDivElement | null>(null);
  const inView = useInView(waveformRef);
  const reducedMotion = useReducedMotion();
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const range = intensityRange[intensity];
  const heights = React.useMemo(() => Array.from(
    { length: Math.max(1, Math.min(100, Math.floor(bars) || 28)) },
    (_, index) => range.min + Math.abs(Math.sin(index * 0.72)) * (range.max - range.min),
  ), [bars, range.max, range.min]);

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
      ref={waveformRef}
      data-animated={playing && inView && !reducedMotion}
      className={cn('guide-waveform', `guide-waveform-${variant}`, className)}
      role="img"
      aria-label={label || 'Animated recording waveform'}
    >
      <div className="guide-waveform-bars" aria-hidden="true">
        {heights.map((height, index) => (
          <span key={index} style={{
            height: `${height}%`,
            '--wave-low': range.min / height,
            animationDelay: `${-index * 0.13}s`,
            animationDuration: `${1.2 + (index % 5) * 0.2}s`,
          } as React.CSSProperties} />
        ))}
      </div>
      {label ? <span className="guide-waveform-label">{label}</span> : null}
      {audioSrc ? <audio ref={audioRef} src={audioSrc} loop preload="metadata" /> : null}
    </div>
  );
}
