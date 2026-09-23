import { useState } from "react";
import { strapRange } from "../vision/photoMapping";

// This is an illustrative, evenly spaced map. Uploaded photos use the user's
// actual strap boundaries in the tuning workspace.
const point = (angle: number, radius: number) => ({
  x: 50 + Math.sin((angle * Math.PI) / 180) * radius,
  y: 50 - Math.cos((angle * Math.PI) / 180) * radius,
});

function sectorPath(index: number) {
  const start = index * 45 - 22.5;
  const end = start + 45;
  const a = point(start, 36.5);
  const b = point(end, 36.5);
  const c = point(end, 21);
  const d = point(start, 21);
  return `M ${a.x} ${a.y} A 36.5 36.5 0 0 1 ${b.x} ${b.y} L ${c.x} ${c.y} A 21 21 0 0 0 ${d.x} ${d.y} Z`;
}

export function RegionReference() {
  const [selected, setSelected] = useState(1);
  return (
    <figure
      className="region-reference"
      aria-label="Illustrative clockwise map of eight dayan tuning regions"
    >
      <div className="tune-empty-art region-reference-art">
        <img
          src={`${import.meta.env.BASE_URL}images/dayan-region-reference.png`}
          alt="Top-down wooden dayan with a centered black syahi and leather strap rim"
          width={640}
          height={640}
        />
        <svg
          viewBox="0 0 100 100"
          className="region-reference-overlay"
          aria-hidden="true"
        >
          <path
            d={sectorPath(selected - 1)}
            className="reference-selected-sector"
          />
          <circle cx="50" cy="50" r="21" className="reference-dotted" />
          <circle cx="50" cy="50" r="36.5" className="reference-dotted" />
          {Array.from({ length: 8 }, (_, index) => {
            const angle = index * 45 - 22.5;
            const inner = point(angle, 21);
            const outer = point(angle, 41.5);
            const isEdge = index === selected - 1 || index === selected % 8;
            return (
              <g key={index}>
                <line
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  className={`reference-dotted ${isEdge ? "reference-selected-edge" : ""}`}
                />
                <circle
                  cx={outer.x}
                  cy={outer.y}
                  r={isEdge ? 1.25 : 0.8}
                  className={
                    isEdge
                      ? "reference-strap-pin selected"
                      : "reference-strap-pin"
                  }
                />
              </g>
            );
          })}
          {Array.from({ length: 16 }, (_, index) => {
            const angle = index * 22.5 - 22.5;
            const label = point(angle, 46);
            const start = (selected - 1) * 2;
            const inRegion = [
              start,
              (start + 1) % 16,
              (start + 2) % 16,
            ].includes(index);
            return (
              <text
                key={index}
                x={label.x}
                y={label.y}
                className={`reference-strap-number ${inRegion ? "selected" : ""}`}
              >
                {index + 1}
              </text>
            );
          })}
        </svg>
        <div className="reference-center" aria-hidden="true">
          <small>DAYAN</small>
          <strong>R{selected}</strong>
          <span>STRAPS {strapRange(selected)}</span>
        </div>
        {Array.from({ length: 8 }, (_, index) => {
          const location = point(index * 45, 28.5);
          return (
            <button
              key={index}
              type="button"
              className={`reference-region-label ${selected === index + 1 ? "selected" : ""}`}
              style={{ left: `${location.x}%`, top: `${location.y}%` }}
              onClick={() => setSelected(index + 1)}
              onMouseEnter={() => setSelected(index + 1)}
              onFocus={() => setSelected(index + 1)}
              aria-pressed={selected === index + 1}
              aria-label={`Show region ${index + 1}, straps ${strapRange(index + 1)}`}
            >
              R{index + 1}
            </button>
          );
        })}
      </div>
      <figcaption className="reference-caption">
        <span>ILLUSTRATIVE MAP</span>
        <span>STRAP NUMBERS ON THE RIM · CLOCKWISE ↻</span>
      </figcaption>
    </figure>
  );
}
