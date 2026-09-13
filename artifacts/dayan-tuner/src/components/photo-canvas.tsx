import { useLayoutEffect, useRef } from 'react';
import { renderTablaReference, type HeadGeometry } from '../vision/tablaDetection';

export function PhotoCanvas({ image, geometry }: { image: HTMLImageElement; geometry: HeadGeometry }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (canvas.current) renderTablaReference(image, geometry, canvas.current);
  }, [image, geometry]);
  return <canvas ref={canvas} role="img" aria-label="Your dayan photo aligned to the numbered regions" className="absolute inset-[2%] h-[96%] w-[96%] rounded-full" />;
}
