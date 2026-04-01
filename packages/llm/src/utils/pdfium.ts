import path from "node:path";
import { pathToFileURL } from "node:url";

import pdfiumWasmAsset from "@hyzyla/pdfium/pdfium.wasm?url";
import { PDFiumLibrary } from "@hyzyla/pdfium";
import { PNG } from "pngjs";

export type PdfiumBitmap = {
  width: number;
  height: number;
  data: Uint8Array;
};

export type PdfiumNormBBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function resolvePdfiumWasmAssetUrl(options: {
  assetUrl: string;
  moduleUrl?: string;
}): string {
  const moduleUrl = options.moduleUrl ?? import.meta.url;
  const { assetUrl } = options;

  if (assetUrl.startsWith("file:")) {
    return assetUrl;
  }

  if (assetUrl.startsWith("http:") || assetUrl.startsWith("https:")) {
    const parsedAssetUrl = new URL(assetUrl);
    if (parsedAssetUrl.pathname.startsWith("/@fs/")) {
      return pathToFileURL(parsedAssetUrl.pathname.slice("/@fs".length)).href;
    }
    return assetUrl;
  }

  if (assetUrl.startsWith("/@fs/")) {
    return pathToFileURL(assetUrl.slice("/@fs".length)).href;
  }

  if (assetUrl.startsWith("/_app/")) {
    return new URL(`..${assetUrl}`, moduleUrl).href;
  }

  if (path.isAbsolute(assetUrl)) {
    return pathToFileURL(assetUrl).href;
  }

  return new URL(assetUrl, moduleUrl).href;
}

function getPdfiumWasmUrl(): string {
  return resolvePdfiumWasmAssetUrl({ assetUrl: pdfiumWasmAsset });
}

async function initPdfiumLibrary(): Promise<PDFiumLibrary> {
  return PDFiumLibrary.init({ wasmUrl: getPdfiumWasmUrl() });
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export async function renderPdfPagesBgra(options: {
  pdfBytes: Uint8Array;
  pageNumbers: number[];
  scale?: number;
}): Promise<Map<number, PdfiumBitmap>> {
  const uniquePageNumbers = [...new Set(options.pageNumbers)].sort((a, b) => a - b);
  if (uniquePageNumbers.length === 0) {
    return new Map<number, PdfiumBitmap>();
  }
  for (const pageNumber of uniquePageNumbers) {
    assertPositiveInteger(pageNumber, "pageNumber");
  }

  const scale =
    typeof options.scale === "number" && Number.isFinite(options.scale) && options.scale > 0
      ? options.scale
      : 3;

  const library = await initPdfiumLibrary();
  try {
    const document = await library.loadDocument(options.pdfBytes);
    try {
      const pageCount = document.getPageCount();
      const renderedByPage = new Map<number, PdfiumBitmap>();
      for (const pageNumber of uniquePageNumbers) {
        if (pageNumber > pageCount) {
          throw new Error(
            `Requested page ${pageNumber.toString()} exceeds document page count ${pageCount.toString()}.`,
          );
        }
        const page = document.getPage(pageNumber - 1);
        const rendered = await page.render({
          scale,
          colorSpace: "BGRA",
          renderFormFields: true,
        });
        renderedByPage.set(pageNumber, {
          width: rendered.width,
          height: rendered.height,
          data: Uint8Array.from(rendered.data),
        });
      }
      return renderedByPage;
    } finally {
      document.destroy();
    }
  } finally {
    library.destroy();
  }
}

export async function getPdfPageCount(options: {
  pdfBytes: Uint8Array;
}): Promise<number> {
  const library = await initPdfiumLibrary();
  try {
    const document = await library.loadDocument(options.pdfBytes);
    try {
      return document.getPageCount();
    } finally {
      document.destroy();
    }
  } finally {
    library.destroy();
  }
}

export function cropBgraBitmapByNorm(options: {
  bitmap: PdfiumBitmap;
  bboxNorm: PdfiumNormBBox;
}): PdfiumBitmap {
  const { bitmap, bboxNorm } = options;
  assertPositiveInteger(bitmap.width, "bitmap.width");
  assertPositiveInteger(bitmap.height, "bitmap.height");

  const leftNorm = clamp01(bboxNorm.left);
  const topNorm = clamp01(bboxNorm.top);
  const rightNorm = clamp01(bboxNorm.left + bboxNorm.width);
  const bottomNorm = clamp01(bboxNorm.top + bboxNorm.height);

  const leftPx = Math.max(0, Math.min(bitmap.width - 1, Math.floor(leftNorm * bitmap.width)));
  const topPx = Math.max(0, Math.min(bitmap.height - 1, Math.floor(topNorm * bitmap.height)));
  const rightPx = Math.max(leftPx + 1, Math.min(bitmap.width, Math.ceil(rightNorm * bitmap.width)));
  const bottomPx = Math.max(topPx + 1, Math.min(bitmap.height, Math.ceil(bottomNorm * bitmap.height)));

  const cropWidth = rightPx - leftPx;
  const cropHeight = bottomPx - topPx;
  const cropped = new Uint8Array(cropWidth * cropHeight * 4);

  for (let row = 0; row < cropHeight; row += 1) {
    const srcOffset = ((topPx + row) * bitmap.width + leftPx) * 4;
    const dstOffset = row * cropWidth * 4;
    const rowSlice = bitmap.data.subarray(srcOffset, srcOffset + cropWidth * 4);
    cropped.set(rowSlice, dstOffset);
  }

  return {
    width: cropWidth,
    height: cropHeight,
    data: cropped,
  };
}

export function encodeBgraBitmapToPng(bitmap: PdfiumBitmap): Uint8Array {
  assertPositiveInteger(bitmap.width, "bitmap.width");
  assertPositiveInteger(bitmap.height, "bitmap.height");
  const expectedBytes = bitmap.width * bitmap.height * 4;
  if (bitmap.data.byteLength !== expectedBytes) {
    throw new Error(
      `Bitmap byte length mismatch: expected ${expectedBytes.toString()}, received ${bitmap.data.byteLength.toString()}.`,
    );
  }

  const png = new PNG({ width: bitmap.width, height: bitmap.height });
  for (let i = 0; i < bitmap.width * bitmap.height; i += 1) {
    const src = i * 4;
    const dst = i * 4;
    // PDFium BGRA -> PNG RGBA
    png.data[dst] = bitmap.data[src + 2] ?? 0;
    png.data[dst + 1] = bitmap.data[src + 1] ?? 0;
    png.data[dst + 2] = bitmap.data[src] ?? 0;
    png.data[dst + 3] = bitmap.data[src + 3] ?? 255;
  }

  return PNG.sync.write(png);
}
