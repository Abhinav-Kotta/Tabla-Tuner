import type { ReactNode } from 'react';
import type { HeadGeometry } from '../vision/tablaDetection';
import { MAX_PHOTO_ZOOM, MIN_PHOTO_ZOOM, photoZoom, zoomPhoto, type PhotoAnchor } from '../vision/photoMapping';

export type PhotoSetupStep = 'fit' | 'anchor' | 'boundaries' | 'review' | 'ready';

export function PhotoAlignment({ image, geometry, locked, step, anchor, anchorName, onChange, onReset, onStep, onAnchor, onAnchorName, onConfirm, children }: {
  children?: ReactNode;
  image: HTMLImageElement;
  geometry: HeadGeometry;
  locked: boolean;
  step: PhotoSetupStep;
  anchor: PhotoAnchor | null;
  anchorName: string;
  onChange: (geometry: HeadGeometry) => void;
  onReset: () => void;
  onStep: (step: PhotoSetupStep) => void;
  onAnchor: (anchor: PhotoAnchor) => void;
  onAnchorName: (name: string) => void;
  onConfirm: () => void;
}) {
  const shortestSide = Math.min(image.naturalWidth, image.naturalHeight);
  const zoom = photoZoom(geometry, shortestSide);
  if (step === 'boundaries' || step === 'review') return <>{children}</>;
  return <div className="setup-controls">
    <div key={step} className="setup-fields">
      {step === 'fit' && <>
        <div className="setup-zoom-buttons">
          <button aria-label="Zoom out" disabled={locked || zoom <= MIN_PHOTO_ZOOM} onClick={() => onChange(zoomPhoto(geometry, 1 / 1.2, shortestSide))}>−</button>
          <output aria-live="polite" data-testid="text-photo-zoom">{Math.round(zoom)}%<span>Photo zoom</span></output>
          <button aria-label="Zoom in" disabled={locked || zoom >= MAX_PHOTO_ZOOM} onClick={() => onChange(zoomPhoto(geometry, 1.2, shortestSide))}>+</button>
        </div>
        <label className="setup-label">Zoom
          <input aria-label="Zoom" type="range" min={MIN_PHOTO_ZOOM} max={MAX_PHOTO_ZOOM} step={1} value={zoom} disabled={locked} onChange={(event) => onChange(zoomPhoto(geometry, Number(event.target.value) / zoom, shortestSide))} />
        </label>
        <label className="setup-label">Rotation <output>{Math.round(geometry.rotation)}°</output>
          <input aria-label="Photo rotation" type="range" min={-180} max={180} value={geometry.rotation} disabled={locked} onChange={(event) => onChange({ ...geometry, rotation: Number(event.target.value) })} />
        </label>
        <details className="setup-details"><summary>Fine positioning / keyboard controls</summary>
          {(['centerX', 'centerY'] as const).map((key) => <label key={key} className="setup-label">{key === 'centerX' ? 'Horizontal center' : 'Vertical center'}
            <input aria-label={key === 'centerX' ? 'Horizontal center' : 'Vertical center'} type="range" min={0} max={100} value={geometry[key] / (key === 'centerX' ? image.naturalWidth : image.naturalHeight) * 100} disabled={locked} onChange={(event) => onChange({ ...geometry, [key]: Number(event.target.value) / 100 * (key === 'centerX' ? image.naturalWidth : image.naturalHeight) })} />
          </label>)}
          <p>Focus the photo, then use arrow keys to move it and + / − to zoom.</p>
        </details>
      </>}
      {step === 'anchor' && <>
        <p className={`setup-feedback ${anchor ? 'success' : ''}`} role="status">{anchor ? '✓ Anchor added. Name the mark below.' : 'Click or tap a unique mark to recognize the tabla’s orientation.'}</p>
        <label className="setup-label">Name your orientation anchor
          <input data-testid="input-anchor-name" placeholder="e.g. red tape or a distinctive spot" maxLength={80} value={anchorName} disabled={locked} onChange={(event) => onAnchorName(event.target.value)} />
        </label>
        <p className="setup-help">Use a unique mark, logo, or colored tape visible on the real tabla. This identifies orientation. You will select the repeated straps separately to set the region edges.</p>
        <details className="setup-details"><summary>Fine-tune anchor position</summary>
          <input aria-label="Anchor position" type="range" min={0} max={360} step={0.5} value={anchor?.angle ?? 0} disabled={locked} onChange={(event) => onAnchor({ angle: Number(event.target.value) % 360, radius: anchor?.radius ?? 0.46 })} />
        </details>
      </>}
    </div>
    <div className="setup-actions">
      {step === 'fit' ? <>
        <button disabled={locked} onClick={onReset}>Reset fit</button>
        <button data-testid="button-fit-photo-done" className="setup-primary" disabled={locked} onClick={() => onStep('anchor')}>Photo fits → Add anchor</button>
      </> : <>
        <button disabled={locked} onClick={() => onStep('fit')}>Back</button>
        <button data-testid="button-confirm-anchor" className="setup-primary" disabled={locked || !anchor || !anchorName.trim()} onClick={onConfirm}>Anchor saved → Select straps</button>
      </>}
    </div>
  </div>;
}
