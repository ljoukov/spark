import path from "node:path";

const PDF_MIME = "application/pdf";
const JPEG_MIME = "image/jpeg";
const PNG_MIME = "image/png";

export function detectMimeType(filePathOrExtension: string): string {
  const ext = normaliseExtension(filePathOrExtension);
  switch (ext) {
    case ".pdf":
      return PDF_MIME;
    case ".jpg":
    case ".jpeg":
      return JPEG_MIME;
    case ".png":
      return PNG_MIME;
    default:
      return "application/octet-stream";
  }
}

function normaliseExtension(value: string): string {
  const hasDotPrefix = value.startsWith(".");
  const ext = hasDotPrefix ? value : path.extname(value);
  return ext.toLowerCase();
}
