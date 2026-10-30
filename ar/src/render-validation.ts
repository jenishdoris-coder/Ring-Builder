export function inspectTransparency(data: Uint8ClampedArray, width: number, height: number) {
  let foreground = 0, blendedEdges = 0, borderAlpha = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = data[(y * width + x) * 4 + 3];
    if (alpha > 0) foreground++;
    if (alpha > 0 && alpha < 255) blendedEdges++;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) borderAlpha = Math.max(borderAlpha, alpha);
  }
  return { passed: foreground > 10 && borderAlpha === 0, foreground, blendedEdges, borderAlpha };
}

export function readCanvasPixels(canvas: HTMLCanvasElement) {
  const copy = document.createElement("canvas"); copy.width = canvas.width; copy.height = canvas.height;
  const context = copy.getContext("2d"); if (!context) throw new Error("Canvas readback is unavailable.");
  context.drawImage(canvas, 0, 0);
  return context.getImageData(0, 0, copy.width, copy.height);
}

export function inspectCanvasTransparency(canvas: HTMLCanvasElement) {
  const pixels = readCanvasPixels(canvas);
  return inspectTransparency(pixels.data, pixels.width, pixels.height);
}
