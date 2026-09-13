export interface HeadGeometry {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  rotation: number;
  confidence: number;
}

export interface TablaDetectionResult {
  geometry: HeadGeometry;
  normalizedCanvas: HTMLCanvasElement;
}

function sampleLuminance(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  const pixel = (Math.floor(y) * width + Math.floor(x)) * 4;
  return (
    0.2126 * (data[pixel] ?? 0) +
    0.7152 * (data[pixel + 1] ?? 0) +
    0.0722 * (data[pixel + 2] ?? 0)
  );
}

/**
 * Lightweight local head detection for a top-down photo. Instead of pulling
 * an ML model into the browser, we score a family of ellipse candidates by
 * how many dark-to-light boundaries they encounter around their perimeter.
 * A real dayan head is circular enough for this to be useful while still
 * producing a geometry that the overlay can reuse exactly.
 */
export function detectTablaHead(
  image: HTMLImageElement | HTMLCanvasElement,
): TablaDetectionResult | null {
  const sourceWidth = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const sourceHeight = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
  if (!sourceWidth || !sourceHeight) {
    return null;
  }

  const processScale = Math.min(1, 720 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * processScale));
  const height = Math.max(1, Math.round(sourceHeight * processScale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return null;
  }
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) * 0.48;
  const minRadius = Math.min(width, height) * 0.22;
  let best: HeadGeometry | null = null;

  for (let radius = maxRadius; radius >= minRadius; radius -= Math.max(2, maxRadius / 48)) {
    let edgeHits = 0;
    let contrastTotal = 0;
    const samples = 72;
    for (let index = 0; index < samples; index += 1) {
      const angle = (index / samples) * Math.PI * 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      const inner = sampleLuminance(pixels.data, width, centerX + Math.cos(angle) * (radius - 7), centerY + Math.sin(angle) * (radius - 7));
      const outer = sampleLuminance(pixels.data, width, centerX + Math.cos(angle) * (radius + 7), centerY + Math.sin(angle) * (radius + 7));
      const contrast = Math.abs(outer - inner);
      contrastTotal += contrast;
      if (contrast > 18 && x >= 0 && y >= 0 && x < width && y < height) {
        edgeHits += 1;
      }
    }

    const confidence = (edgeHits / samples) * 0.72 + Math.min(1, contrastTotal / samples / 70) * 0.28;
    if (!best || confidence > best.confidence) {
      best = {
        centerX,
        centerY,
        radiusX: radius,
        radiusY: radius * (height / width),
        rotation: 0,
        confidence,
      };
    }
  }

  if (!best || best.confidence < 0.12) {
    return null;
  }

  const normalizedCanvas = document.createElement('canvas');
  const size = 820;
  normalizedCanvas.width = size;
  normalizedCanvas.height = size;
  const normalizedContext = normalizedCanvas.getContext('2d');
  if (!normalizedContext) {
    return null;
  }
  normalizedContext.drawImage(
    canvas,
    best.centerX - best.radiusX,
    best.centerY - best.radiusY,
    best.radiusX * 2,
    best.radiusY * 2,
    0,
    0,
    size,
    size,
  );

  return {
    geometry: {
      ...best,
      centerX: size / 2,
      centerY: size / 2,
      radiusX: size / 2,
      radiusY: size / 2,
    },
    normalizedCanvas,
  };
}