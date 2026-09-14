import * as React from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const PATHS = Array.from({ length: 18 }, (_, index) => {
  const y = 74 + index * 46;
  const bend = index % 2 === 0 ? 82 : -82;
  return `M-${180 + index * 12} ${y} C ${280 + bend} ${y - 120}, ${660 - bend} ${y + 120}, ${1660 - index * 12} ${y - 12}`;
});

export interface BackgroundPathsProps extends React.HTMLAttributes<HTMLElement> {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  ctaLabel?: string;
  onCta?: () => void;
}

/** The How It Works hero, adapted from the animated BackgroundPaths prompt. */
export function BackgroundPaths({
  eyebrow = '03 / field guide',
  title = 'Hear the whole head.',
  subtitle = 'A photo gives the tuner its map. A clean strike gives it a note. Follow the pass from orientation to balance.',
  ctaLabel = 'Open tuning session',
  onCta,
  className,
  ...props
}: BackgroundPathsProps) {
  return (
    <section {...props} className={cn('guide-hero guide-background-paths', className)}>
      <svg className="guide-background-paths-art" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
        {PATHS.map((path, index) => (
          <motion.path
            key={path}
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth={index % 4 === 0 ? 1.4 : 0.8}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: index % 4 === 0 ? 0.18 : 0.08 }}
            transition={{ duration: 1.5, delay: index * 0.045, ease: 'easeOut' }}
          />
        ))}
      </svg>

      <div className="guide-background-paths-copy">
        <span className="guide-kicker"><i />{eyebrow}</span>
        <h2 aria-label={title}>
          {title.split('').map((character, index) => (
            <motion.span
              key={`${character}-${index}`}
              aria-hidden="true"
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.18 + index * 0.025, ease: 'easeOut' }}
            >
              {character === ' ' ? '\u00a0' : character}
            </motion.span>
          ))}
        </h2>
        <p>{subtitle}</p>
        <Button type="button" onClick={onCta} className="guide-background-paths-cta" variant="outline">
          {ctaLabel}
          <span aria-hidden="true">↗</span>
        </Button>
      </div>

      <div className="guide-background-paths-index" aria-hidden="true">
        <span>DAYAN</span>
        <strong>01</strong>
        <small>region first</small>
      </div>
      <span className="guide-background-paths-scroll" aria-hidden="true">SCROLL TO FOLLOW THE PASS</span>
    </section>
  );
}
