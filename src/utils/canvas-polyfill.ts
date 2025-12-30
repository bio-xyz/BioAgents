// Polyfills for pdfjs-dist DOM APIs (needed for pdf-parse@2.x in server environments)

import * as nodeUrl from "url";
import * as nodeFs from "fs";
import nodeFsPromises from "fs/promises";
import * as nodePath from "path";
import * as nodeHttp from "http";
import * as nodeHttps from "https";
import * as nodeZlib from "zlib";

// Ensure fs.promises is available (some bundlers strip it)
const fsWithPromises = {
  ...nodeFs,
  promises: nodeFsPromises,
};

// Stub process.getBuiltinModule to prevent Bun runtime warning
// This must be first, before any imports
if (typeof process.getBuiltinModule !== "function") {
  (process as any).getBuiltinModule = (name: string) => {
    switch (name) {
      case "module":
        return {
          createRequire: () => {
            // Return a dummy require that returns empty objects
            return () => ({});
          },
        };
      case "url":
        return nodeUrl;
      case "fs":
        return fsWithPromises;
      case "fs/promises":
        return nodeFsPromises;
      case "path":
        return nodePath;
      case "http":
        return nodeHttp;
      case "https":
        return nodeHttps;
      case "zlib":
        return nodeZlib;
      default:
        return undefined;
    }
  };
}

let canvasModule: any = null;
try {
  canvasModule = await import("canvas");
} catch {
  // canvas not available
}

// Apply polyfills if canvas loaded successfully
if (canvasModule) {
  // @ts-ignore
  if (canvasModule.DOMMatrix) globalThis.DOMMatrix = canvasModule.DOMMatrix;
  // @ts-ignore
  if (canvasModule.ImageData) globalThis.ImageData = canvasModule.ImageData;
}

// Path2D stub - canvas package doesn't export it, but pdfjs-dist needs it
// @ts-ignore
if (!globalThis.Path2D) {
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
}
