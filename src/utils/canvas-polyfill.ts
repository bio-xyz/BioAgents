// Polyfills for pdfjs-dist DOM APIs (needed for pdf-parse@2.x in server environments)
import canvas from "canvas";

// @ts-ignore
globalThis.DOMMatrix = canvas.DOMMatrix;
// @ts-ignore
globalThis.ImageData = canvas.ImageData;

// Path2D stub - canvas package doesn't export it, but pdfjs-dist needs it
// @ts-ignore
globalThis.Path2D = class Path2D {
  constructor(_path?: string | Path2D) {}
  addPath(_path: Path2D, _transform?: DOMMatrix2DInit) {}
  closePath() {}
  moveTo(_x: number, _y: number) {}
  lineTo(_x: number, _y: number) {}
  bezierCurveTo(_cp1x: number, _cp1y: number, _cp2x: number, _cp2y: number, _x: number, _y: number) {}
  quadraticCurveTo(_cpx: number, _cpy: number, _x: number, _y: number) {}
  arc(_x: number, _y: number, _radius: number, _startAngle: number, _endAngle: number, _counterclockwise?: boolean) {}
  arcTo(_x1: number, _y1: number, _x2: number, _y2: number, _radius: number) {}
  ellipse(_x: number, _y: number, _radiusX: number, _radiusY: number, _rotation: number, _startAngle: number, _endAngle: number, _counterclockwise?: boolean) {}
  rect(_x: number, _y: number, _w: number, _h: number) {}
  roundRect(_x: number, _y: number, _w: number, _h: number, _radii?: number | number[]) {}
};
