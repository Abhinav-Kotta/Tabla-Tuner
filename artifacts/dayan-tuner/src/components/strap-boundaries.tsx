import { useState } from 'react';
import { strapRange } from '../vision/photoMapping';

export function StrapBoundaries({ boundaries, firstBoundary, selected, locked, onSelect, onPlace, onRestart, onConfirm, onBack }: {
  boundaries: number[] | null;
  firstBoundary: number | null;
  selected: number;
  error: string;
  locked: boolean;
  onSelect: (index: number) => void;
  onPlace: (angle: number) => void;
  onRestart: () => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const [draftAngle, setDraftAngle] = useState(0);
  const angle = boundaries?.[selected] ?? draftAngle;
  return <div className="setup-controls">
    <div key={boundaries ? 'review' : 'boundaries'} className="setup-fields">
      {!boundaries ? <>
        <p data-testid="text-boundary-prompt" className="setup-feedback" role="status">{firstBoundary === null ? '① Tap strap 1 on the photo.' : '✓ Strap 1 added. Tap strap 3 next.'}</p>
        <p className="setup-help">Your orientation anchor is already saved. Now define R1 separately using straps 1, 2, and 3. Leave one middle strap between your two selections. R2 starts at the shared strap 3.</p>
      </> : <>
        <p className="setup-feedback success">✓ All eight regions filled</p>
        <p className="setup-help">These are estimated positions. Choose a boundary, then tap its actual strap to correct it.</p>
        <div className="setup-boundary-buttons">{boundaries.map((_, index) => <button key={index} data-testid={`button-boundary-${index * 2 + 1}`} aria-pressed={selected === index} disabled={locked} onClick={() => onSelect(index)}>Strap {index * 2 + 1}</button>)}</div>
        <p className="setup-help">Editing strap <strong>{selected * 2 + 1}</strong>. Each region contains three straps and shares its edges.</p>
      </>}
      <details className="setup-details"><summary>Fine adjustment / keyboard controls</summary>
        <label className="setup-label">Strap {boundaries ? selected * 2 + 1 : firstBoundary === null ? 1 : 3} position
          <input aria-label="Boundary strap position" type="range" min={0} max={360} step={0.5} value={angle} disabled={locked} onChange={(event) => { const value = Number(event.target.value); if (boundaries) onPlace(value); else setDraftAngle(value); }} />
        </label>
        {!boundaries && <button className="setup-secondary" disabled={locked} onClick={() => onPlace(draftAngle)}>Place strap at slider position</button>}
      </details>
      {boundaries && <details className="setup-details"><summary>Region strap numbers</summary><div className="grid grid-cols-2 gap-2">{boundaries.map((_, index) => <span key={index}>R{index + 1}: {strapRange(index + 1)}</span>)}</div></details>}
      {(firstBoundary !== null || boundaries) && <button className="setup-text-button" disabled={locked} onClick={onRestart}>Reselect the two R1 boundaries</button>}
    </div>
    <div className="setup-actions">
      <button disabled={locked} onClick={onBack}>Back</button>
      {boundaries ? <button data-testid="button-confirm-regions" className="setup-primary" disabled={locked} onClick={onConfirm}>Save map → Start tuning</button> : <span className="setup-help">Tap the photo to continue ↑</span>}
    </div>
  </div>;
}
