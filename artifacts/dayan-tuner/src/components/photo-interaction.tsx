import { useEffect, useRef } from 'react';
import { anchorFromPoint, panPhoto, zoomPhoto, type PhotoAnchor } from '../vision/photoMapping';
import type { HeadGeometry } from '../vision/tablaDetection';

type Point = { x: number; y: number };
const centerOf = (points: Point[]) => ({ x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length });
const distanceOf = (points: Point[]) => points.length < 2 ? 0 : Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);

export function PhotoInteraction({ mode, geometry, shortestSide, onChange, onAnchor, onInvalidAnchor }: {
  mode: 'fit' | 'anchor' | 'boundaries' | 'review';
  geometry: HeadGeometry;
  shortestSide: number;
  onChange: (geometry: HeadGeometry) => void;
  onAnchor: (anchor: PhotoAnchor) => void;
  onInvalidAnchor: () => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const baseline = useRef<{ geometry: HeadGeometry; center: Point; distance: number } | null>(null);
  const tap = useRef<{ id: number; point: Point } | null>(null);
  const current = useRef({ geometry, onChange });
  current.current = { geometry, onChange };
  const update = (next: HeadGeometry) => {
    current.current.geometry = next;
    current.current.onChange(next);
  };
  const rebase = () => {
    const points = [...pointers.current.values()];
    baseline.current = points.length ? { geometry: current.current.geometry, center: centerOf(points), distance: distanceOf(points) } : null;
  };
  const release = (id: number) => {
    pointers.current.delete(id);
    rebase();
  };
  useEffect(() => {
    pointers.current.clear();
    baseline.current = null;
    tap.current = null;
    const element = surface.current;
    if (!element || mode !== 'fit') return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      const next = zoomPhoto(current.current.geometry, Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.005), shortestSide, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
      current.current.geometry = next;
      current.current.onChange(next);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [mode, shortestSide]);

  return <div
    ref={surface}
    data-testid="photo-interaction"
    role="group"
    tabIndex={mode === 'fit' ? 0 : -1}
    aria-label={mode === 'fit' ? 'Drag to move photo. Pinch, scroll, or use plus and minus to zoom. Arrow keys move the photo.' : mode === 'anchor' ? 'Click or tap a unique mark to add your orientation anchor' : 'Click or tap the requested boundary strap near the rim'}
    className={`absolute inset-0 z-20 touch-none rounded-full outline-none focus-visible:ring-4 focus-visible:ring-[#8ddbd5] ${mode === 'fit' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
    onPointerDown={(event) => {
      if (event.button !== 0 || pointers.current.size >= 2) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = { x: event.clientX, y: event.clientY };
      pointers.current.set(event.pointerId, point);
      if (mode !== 'fit') {
        tap.current = pointers.current.size === 1 ? { id: event.pointerId, point } : null;
        return;
      }
      rebase();
    }}
    onPointerMove={(event) => {
      if (!pointers.current.has(event.pointerId)) return;
      const point = { x: event.clientX, y: event.clientY };
      pointers.current.set(event.pointerId, point);
      if (mode !== 'fit') {
        if (tap.current && Math.hypot(point.x - tap.current.point.x, point.y - tap.current.point.y) > 8) tap.current = null;
        return;
      }
      const start = baseline.current;
      if (!start) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const points = [...pointers.current.values()];
      const center = centerOf(points);
      const zoomed = start.distance > 0 && points.length === 2
        ? zoomPhoto(start.geometry, distanceOf(points) / start.distance, shortestSide, (start.center.x - rect.left) / rect.width, (start.center.y - rect.top) / rect.height)
        : start.geometry;
      update(panPhoto(zoomed, center.x - start.center.x, center.y - start.center.y, rect.width));
    }}
    onPointerUp={(event) => {
      if (mode !== 'fit' && tap.current?.id === event.pointerId) {
        const rect = event.currentTarget.getBoundingClientRect();
        const anchor = anchorFromPoint((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height, mode === 'anchor' ? 0.05 : 0.3);
        if (anchor) onAnchor(anchor);
        else onInvalidAnchor();
      }
      tap.current = null;
      release(event.pointerId);
    }}
    onPointerCancel={(event) => { tap.current = null; release(event.pointerId); }}
    onLostPointerCapture={(event) => release(event.pointerId)}
    onKeyDown={(event) => {
      if (mode !== 'fit') return;
      if (['+', '=', '-'].includes(event.key)) {
        event.preventDefault();
        update(zoomPhoto(current.current.geometry, event.key === '-' ? 1 / 1.2 : 1.2, shortestSide));
        return;
      }
      const deltas: Record<string, [number, number]> = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, -5], ArrowDown: [0, 5] };
      const delta = deltas[event.key];
      if (!delta) return;
      event.preventDefault();
      update(panPhoto(current.current.geometry, ...delta, event.currentTarget.getBoundingClientRect().width));
    }}
  />;
}
