import { useEffect, useRef, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import type { PhotoSetupStep } from './photo-alignment';

export function PhotoSetupModal({ open, onOpenChange, step, firstBoundary, selectedBoundary, anchorPlaced, anchorName, preview, controls, error }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: PhotoSetupStep;
  firstBoundary: number | null;
  selectedBoundary: number;
  anchorPlaced: boolean;
  anchorName: string;
  preview: ReactNode;
  controls: ReactNode;
  error: string;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const stepIndex = step === 'fit' ? 0 : step === 'anchor' ? 1 : step === 'boundaries' ? 2 : 3;
  const title = step === 'fit' ? 'Fit your photo inside the circle' : step === 'anchor' ? (anchorPlaced ? 'Anchor placed — give it a name' : 'Tap the photo to add your anchor') : step === 'boundaries' ? `Tap boundary strap ${firstBoundary === null ? 1 : 3}` : 'Check the filled regions';
  const description = step === 'fit' ? 'Drag to move. Pinch or use + / − to zoom. Match the outer head to the gold circle.' : step === 'anchor' ? 'Choose a unique mark or colored tape to recognize the tabla’s orientation. The cyan diamond is independent of the strap boundaries.' : step === 'boundaries' ? (firstBoundary === null ? 'Your anchor is saved. Separately select the strap at the start of R1 to define its first edge.' : 'Move clockwise past one middle strap, then select strap 3. These two straps define R1’s width; your anchor stays where you placed it.') : `Check the shared edges. Tap the photo to move strap ${selectedBoundary * 2 + 1}, or choose another strap below.`;
  useEffect(() => {
    if (open) titleRef.current?.focus({ preventScroll: true });
  }, [step, open]);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent data-testid="photo-setup-modal" className="photo-setup-modal" onOpenAutoFocus={(event) => { event.preventDefault(); titleRef.current?.focus(); }} onPointerDownOutside={(event) => event.preventDefault()}>
      <header className="setup-header">
        <div className="setup-steps" aria-label="Photo setup progress">{['Fit photo', 'Add anchor', 'Set straps', 'Review'].map((label, index) => <span key={label} aria-current={index === stepIndex ? 'step' : undefined} className={index === stepIndex ? 'current' : index < stepIndex ? 'complete' : ''}>{index + 1}<span className="step-label"> {label}</span></span>)}</div>
        <DialogTitle ref={titleRef} tabIndex={-1} className="setup-title outline-none">{title}</DialogTitle>
        <DialogDescription className="setup-description">{description}</DialogDescription>
      </header>
      <div className="setup-workspace">
        <div className="setup-preview-area">{preview}
          <p key={`${step}-${firstBoundary}-${anchorPlaced}`} className="setup-photo-cue" aria-live="polite">{step === 'fit' ? '↔ Drag to move · Pinch to zoom' : step === 'anchor' ? (anchorPlaced ? '◆ Anchor added — tap again to reposition' : '⊕ Click / tap a unique mark to add orientation anchor') : step === 'boundaries' ? `⊕ Click / tap strap ${firstBoundary === null ? 1 : 3} on the rim` : `⊕ Click / tap to move strap ${selectedBoundary * 2 + 1}`}</p>
        </div>
        <div className="setup-control-area">
          {anchorPlaced && step !== 'fit' && <p data-testid="anchor-strap-legend" className="setup-reference-legend"><strong>◆ A: {anchorName || 'Orientation mark'}</strong><span>Orientation only · numbered straps define region edges</span></p>}
          {error && <p className="setup-error" role="alert">{error}</p>}
          {controls}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
