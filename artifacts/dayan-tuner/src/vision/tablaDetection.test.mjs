import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('./tablaDetection.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { detectTablaHead, renderTablaReference } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

// Synthetic circular head pixels exercise detection without a camera or browser.
class TestImage {
  constructor(width, height, blank = false) {
    this.naturalWidth = width;
    this.naturalHeight = height;
    this.blank = blank;
  }
}
globalThis.HTMLImageElement = TestImage;
globalThis.document = {
  createElement() {
    const calls = [];
    let drawnImage;
    const context = {
      drawImage: (...args) => { drawnImage = args[0]; calls.push(['drawImage', ...args]); },
      fillRect: (...args) => calls.push(['fillRect', ...args]),
      translate: (...args) => calls.push(['translate', ...args]),
      rotate: (...args) => calls.push(['rotate', ...args]),
      scale: (...args) => calls.push(['scale', ...args]),
      getImageData: (_x, _y, width, height) => {
        const data = new Uint8ClampedArray(width * height * 4);
        const radius = Math.min(width, height) * 0.36;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const value = !drawnImage.blank && Math.hypot(x - width / 2, y - height / 2) < radius ? 230 : 20;
            const index = (y * width + x) * 4;
            data.set([value, value, value, 255], index);
          }
        }
        return { data };
      },
    };
    return { width: 0, height: 0, calls, getContext: () => context };
  },
};

for (const [width, height] of [[1200, 800], [800, 1200], [800, 800]]) {
  test(`circular head stays circular in a ${width} × ${height} photo`, () => {
    const image = new TestImage(width, height);
    const result = detectTablaHead(image);
    assert.ok(result);
    assert.equal(result.geometry.radiusX, result.geometry.radiusY);
    assert.equal(result.geometry.centerX, width / 2);
    assert.equal(result.geometry.centerY, height / 2);
    assert.ok(Math.abs(result.geometry.radiusX - Math.min(width, height) * 0.36) < 15);
    const [, scaleX, scaleY] = result.normalizedCanvas.calls.find(([name]) => name === 'scale');
    assert.equal(scaleX, scaleY);
    assert.equal(scaleX * result.geometry.radiusX, 410);
    assert.equal(result.normalizedCanvas.calls.find(([name]) => name === 'drawImage')[1], image);
  });
}

test('manual off-center crop and quarter turn keep the head center fixed', () => {
  const image = new TestImage(1200, 800);
  const canvas = renderTablaReference(image, { centerX: 700, centerY: 300, radiusX: 250, radiusY: 250, rotation: 90, confidence: 0 });
  assert.deepEqual(canvas.calls, [
    ['fillRect', 0, 0, 820, 820],
    ['translate', 410, 410],
    ['rotate', Math.PI / 2],
    ['scale', 1.64, 1.64],
    ['drawImage', image, -700, -300],
  ]);
});

test('blank photo has no detection but still supports a manual crop', () => {
  const image = new TestImage(1200, 800, true);
  assert.equal(detectTablaHead(image), null);
  assert.ok(renderTablaReference(image, { centerX: 600, centerY: 400, radiusX: 360, radiusY: 360, rotation: 0, confidence: 0 }));
});

test('zero-size input cannot produce head geometry', () => {
  assert.equal(detectTablaHead(new TestImage(0, 0)), null);
});
