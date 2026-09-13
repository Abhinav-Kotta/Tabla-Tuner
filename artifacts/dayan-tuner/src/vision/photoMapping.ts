import type { HeadGeometry } from './tablaDetection';

export type PhotoAnchor = { angle: number; radius: number };

export const MIN_PHOTO_ZOOM = 25;
export const MAX_PHOTO_ZOOM = 500;

export function photoZoom(geometry: HeadGeometry, shortestSide: number): number {
  return shortestSide * 50 / geometry.radiusX;
}

/** Scale uniformly around the gesture's focal point, rather than jumping to center. */
export function zoomPhoto(geometry: HeadGeometry, factor: number, shortestSide: number, x = 0.5, y = 0.5): HeadGeometry {
  if (!Number.isFinite(factor) || factor <= 0 || shortestSide <= 0) return geometry;
  const zoom = Math.max(MIN_PHOTO_ZOOM, Math.min(MAX_PHOTO_ZOOM, photoZoom(geometry, shortestSide) * factor));
  const radius = shortestSide * 50 / zoom;
  const sourceDelta = (geometry.radiusX - radius) * 2 / 0.96;
  const theta = geometry.rotation * Math.PI / 180;
  return {
    ...geometry,
    radiusX: radius,
    radiusY: radius,
    centerX: geometry.centerX + (Math.cos(theta) * (x - 0.5) + Math.sin(theta) * (y - 0.5)) * sourceDelta,
    centerY: geometry.centerY + (-Math.sin(theta) * (x - 0.5) + Math.cos(theta) * (y - 0.5)) * sourceDelta,
  };
}

export const clockwiseSpan = (start: number, end: number) => ((end - start) % 360 + 360) % 360;

export function strapRange(regionId: number): string {
  return `${regionId * 2 - 1}–${regionId === 8 ? 1 : regionId * 2 + 1}`;
}

/** Preserve both chosen straps, then evenly divide the remaining circumference. */
export function autofillBoundaries(first: number, third: number): number[] | null {
  const width = clockwiseSpan(first, third);
  if (width < 10 || width > 100) return null;
  const remainingWidth = (360 - width) / 7;
  return Array.from({ length: 8 }, (_, index) =>
    ((index === 0 ? first : third + (index - 1) * remainingWidth) % 360 + 360) % 360,
  );
}

export function boundaryArc(regionId: number, boundaries: number[]) {
  const start = boundaries[regionId - 1];
  const span = clockwiseSpan(start, boundaries[regionId % 8]);
  return { start, end: start + span, center: (start + span / 2) % 360 };
}

export function moveBoundary(boundaries: number[], index: number, angle: number): number[] | null {
  const next = boundaries.map((value, i) => i === index ? (angle % 360 + 360) % 360 : value);
  const spans = next.map((start, i) => clockwiseSpan(start, next[(i + 1) % 8]));
  if (spans.some((span) => span < 5 || span > 170) || Math.abs(spans.reduce((sum, span) => sum + span, 0) - 360) > 0.001) return null;
  return next;
}

/** Coordinates are relative to the square overlay, from 0 to 1. */
export function anchorFromPoint(x: number, y: number, minRadius = 0.3): PhotoAnchor | null {
  const dx = x - 0.5;
  const dy = y - 0.5;
  const radius = Math.hypot(dx, dy);
  // Boundaries stay near the rim; an orientation mark may be anywhere off-center.
  if (radius < minRadius || radius > 0.49) return null;
  return { angle: (Math.atan2(dy, dx) * 180 / Math.PI + 450) % 360, radius };
}

/** Invert photo rotation so dragging always follows the pointer on screen. */
export function panPhoto(geometry: HeadGeometry, dx: number, dy: number, overlayWidth: number): HeadGeometry {
  if (overlayWidth <= 0) return geometry;
  const radians = geometry.rotation * Math.PI / 180;
  const sourcePerPixel = geometry.radiusX * 2 / (overlayWidth * 0.96);
  return {
    ...geometry,
    centerX: geometry.centerX - (Math.cos(radians) * dx + Math.sin(radians) * dy) * sourcePerPixel,
    centerY: geometry.centerY - (-Math.sin(radians) * dx + Math.cos(radians) * dy) * sourcePerPixel,
  };
}
