import { memo } from 'react';
import { Button } from '@/components/ui/button';

// Keep the supplied geometry, but render it as ordinary SVG. Animating dozens
// of full-screen paths behind filtered text can cause browser paint artifacts.
const PATH_GROUPS = [1, -1].map((position) =>
  Array.from({ length: 36 }, (_, index) => ({
    d: `M-${380 - index * 5 * position} -${189 + index * 6}C-${
      380 - index * 5 * position
    } -${189 + index * 6} -${312 - index * 5 * position} ${216 - index * 6} ${
      152 - index * 5 * position
    } ${343 - index * 6}C${616 - index * 5 * position} ${470 - index * 6} ${
      684 - index * 5 * position
    } ${875 - index * 6} ${684 - index * 5 * position} ${875 - index * 6}`,
    width: 0.5 + index * 0.03,
    opacity: Math.min(1, 0.1 + index * 0.03) * 0.3,
  })),
);

export const BackgroundPaths = memo(function BackgroundPaths({
  title = 'Hear the whole head.',
  ctaLabel = 'Open tuning session',
  onCta,
}: {
  title?: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <section className="background-paths-hero" aria-labelledby="guide-hero-title">
      <div className="background-paths-art" aria-hidden="true">
        {PATH_GROUPS.map((paths, groupIndex) => (
          <svg key={groupIndex} viewBox="0 0 696 316" fill="none" focusable="false">
            {paths.map((path, index) => (
              <path
                key={index}
                d={path.d}
                stroke="currentColor"
                strokeWidth={path.width}
                strokeOpacity={path.opacity}
              />
            ))}
          </svg>
        ))}
      </div>

      <div className="background-paths-content">
        <h2 id="guide-hero-title">{title}</h2>
        <div className="background-paths-button-frame">
          <Button
            type="button"
            onClick={onCta}
            variant="ghost"
            className="h-auto min-h-12 rounded-[1.15rem] border border-white/20 bg-black px-8 py-3 text-lg font-semibold text-white hover:bg-neutral-900 hover:text-white"
          >
            {ctaLabel}
            <span className="ml-3" aria-hidden="true">→</span>
          </Button>
        </div>
      </div>
    </section>
  );
});
