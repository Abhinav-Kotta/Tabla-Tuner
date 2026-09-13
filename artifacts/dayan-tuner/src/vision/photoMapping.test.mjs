import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('./photoMapping.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { anchorFromPoint, panPhoto, zoomPhoto, photoZoom, MIN_PHOTO_ZOOM, MAX_PHOTO_ZOOM, autofillBoundaries, boundaryArc, moveBoundary, strapRange } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} should equal ${expected}`);

test('R1 preserves both selected straps, including a wrap past the top', () => {
  for (const [first, third] of [[110, 160], [350, 40], [320, 5]]) {
    const boundaries = autofillBoundaries(first, third);
    assert.ok(boundaries);
    assert.equal(boundaries.length, 8);
    assert.equal(boundaries[0], first);
    assert.equal(boundaries[1], third);
    let total = 0;
    for (let id = 1; id <= 8; id++) {
      const arc = boundaryArc(id, boundaries);
      const next = boundaryArc(id % 8 + 1, boundaries);
      closeTo(arc.end % 360, next.start);
      assert.ok(arc.end > arc.start);
      total += arc.end - arc.start;
    }
    closeTo(total, 360);
  }
});

test('region center and width come only from the two selected boundary straps', () => {
  const boundaries = autofillBoundaries(100, 160);
  const region = boundaryArc(1, boundaries);
  assert.equal(region.start, 100);
  assert.equal(region.end, 160);
  assert.equal(region.center, 130);
});

test('three-strap ranges share edges and close with straps 15, 16, 1', () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => strapRange(index + 1)), ['1–3', '3–5', '5–7', '7–9', '9–11', '11–13', '13–15', '15–1']);
});

test('duplicate, reversed, and overly wide selections are rejected', () => {
  assert.equal(autofillBoundaries(100, 100), null);
  assert.equal(autofillBoundaries(100, 105), null);
  assert.equal(autofillBoundaries(100, 80), null);
  assert.equal(autofillBoundaries(100, 250), null);
});

test('moving a shared boundary updates both neighbors without gaps', () => {
  const original = autofillBoundaries(350, 35);
  const moved = moveBoundary(original, 2, 85);
  assert.ok(moved);
  assert.equal(moved[0], 350);
  assert.equal(moved[1], 35);
  closeTo(boundaryArc(2, moved).end, boundaryArc(3, moved).start);
  closeTo(boundaryArc(2, moved).end, 85);
  closeTo(Array.from({ length: 8 }, (_, i) => boundaryArc(i + 1, moved)).reduce((sum, arc) => sum + arc.end - arc.start, 0), 360);
  assert.equal(moveBoundary(original, 2, 200), null);
  assert.ok(moveBoundary(original, 0, 20));
  assert.ok(moveBoundary(original, 1, 355));
});

test('anchor pin retains the clicked physical position', () => {
  for (const [x, y] of [[0.5, 0.04], [0.94, 0.5], [0.22, 0.2], [0.8, 0.8]]) {
    const anchor = anchorFromPoint(x, y);
    assert.ok(anchor);
    closeTo(0.5 + Math.sin(anchor.angle * Math.PI / 180) * anchor.radius, x);
    closeTo(0.5 - Math.cos(anchor.angle * Math.PI / 180) * anchor.radius, y);
  }
  assert.equal(anchorFromPoint(0.5, 0.5), null);
  assert.equal(anchorFromPoint(0.6, 0.6), null);
  assert.equal(anchorFromPoint(1, 1), null);
});

test('photo follows a screen drag at every rotation and zoom', () => {
  for (const rotation of [-180, -90, -37, 0, 45, 90, 180]) {
    for (const radius of [80, 250, 600]) {
      const start = { centerX: 700, centerY: 500, radiusX: radius, radiusY: radius, rotation, confidence: 1 };
      const moved = panPhoto(start, 32, -18, 400);
      const theta = rotation * Math.PI / 180;
      const scale = 400 * 0.96 / (radius * 2);
      const sourceDx = start.centerX - moved.centerX;
      const sourceDy = start.centerY - moved.centerY;
      closeTo((Math.cos(theta) * sourceDx - Math.sin(theta) * sourceDy) * scale, 32);
      closeTo((Math.sin(theta) * sourceDx + Math.cos(theta) * sourceDy) * scale, -18);
      assert.equal(moved.radiusX, radius);
      assert.equal(moved.rotation, rotation);
      const restored = panPhoto(moved, -32, 18, 400);
      closeTo(restored.centerX, start.centerX);
      closeTo(restored.centerY, start.centerY);
    }
  }
});


test('zoom in enlarges the photo, zoom out shrinks it, and a round trip restores geometry', () => {
  const start = { centerX: 500, centerY: 400, radiusX: 400, radiusY: 400, rotation: 0, confidence: 1 };
  const enlarged = zoomPhoto(start, 2, 800);
  assert.equal(photoZoom(enlarged, 800), 200);
  assert.equal(enlarged.radiusX, 200);
  assert.equal(enlarged.radiusY, 200);
  assert.deepEqual(zoomPhoto(enlarged, 0.5, 800), start);
  assert.equal(zoomPhoto(start, 0.5, 800).radiusX, 800);
});

function sourceAt(geometry, x, y) {
  const theta = geometry.rotation * Math.PI / 180;
  const scale = geometry.radiusX * 2 / 0.96;
  return {
    x: geometry.centerX + (Math.cos(theta) * (x - 0.5) + Math.sin(theta) * (y - 0.5)) * scale,
    y: geometry.centerY + (-Math.sin(theta) * (x - 0.5) + Math.cos(theta) * (y - 0.5)) * scale,
  };
}

test('pinch and wheel zoom keep the source point under the fingers at every rotation', () => {
  for (const rotation of [-180, -90, -37, 0, 45, 90, 180]) {
    const start = { centerX: 600, centerY: 400, radiusX: 300, radiusY: 300, rotation, confidence: 1 };
    for (const factor of [0.5, 1.2, 2]) {
      const before = sourceAt(start, 0.72, 0.23);
      const zoomed = zoomPhoto(start, factor, 800, 0.72, 0.23);
      const after = sourceAt(zoomed, 0.72, 0.23);
      closeTo(before.x, after.x);
      closeTo(before.y, after.y);
    }
  }
});

test('moving a pinch midpoint pans while zooming without losing the touched feature', () => {
  const start = { centerX: 600, centerY: 400, radiusX: 300, radiusY: 300, rotation: 63, confidence: 1 };
  const before = sourceAt(start, 0.3, 0.4);
  const zoomed = zoomPhoto(start, 1.8, 800, 0.3, 0.4);
  const moved = panPhoto(zoomed, 40, -20, 400);
  const after = sourceAt(moved, 0.4, 0.35);
  closeTo(before.x, after.x);
  closeTo(before.y, after.y);
});

test('all zoom controls share finite limits and reject invalid gesture distances', () => {
  const start = { centerX: 600, centerY: 400, radiusX: 400, radiusY: 400, rotation: 0, confidence: 1 };
  assert.equal(photoZoom(zoomPhoto(start, 0.001, 800), 800), MIN_PHOTO_ZOOM);
  assert.equal(photoZoom(zoomPhoto(start, 10000, 800), 800), MAX_PHOTO_ZOOM);
  for (const factor of [0, -1, NaN, Infinity]) assert.equal(zoomPhoto(start, factor, 800), start);
});


test('orientation mark can be inside the photo while boundary selection stays near the rim', () => {
  const mark = anchorFromPoint(0.6, 0.6, 0.05);
  assert.ok(mark);
  closeTo(mark.angle, 135);
  assert.equal(anchorFromPoint(0.6, 0.6), null);
  const boundaries = autofillBoundaries(250, 295);
  assert.ok(boundaries);
  assert.equal(boundaryArc(1, boundaries).start, 250);
  assert.equal(boundaryArc(1, boundaries).end, 295);
  const adjusted = moveBoundary(boundaries, 0, 245);
  assert.ok(adjusted);
  closeTo(mark.angle, 135);
  assert.equal(anchorFromPoint(0.5, 0.5, 0.05), null);
});
