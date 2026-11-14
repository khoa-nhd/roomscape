/** Browser-only helpers for preparing wall photos before they leave the device. */

export type PreparedImage = {
  blob: Blob;
  /** Object URL for previews. Revoke when replaced. */
  url: string;
  /** width / height */
  aspect: number;
};

const MAX_SIDE = 1280;
const JPEG_QUALITY = 0.82;

/**
 * Downscale and re-encode a photo as JPEG.
 * Re-encoding through a canvas drops all EXIF metadata, including GPS location,
 * while `imageOrientation: "from-image"` keeps the picture the right way up.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the photo."))), "image/jpeg", JPEG_QUALITY),
  );
  return { blob, url: URL.createObjectURL(blob), aspect: width / height };
}

/**
 * Pixelate regions of a photo (x, y, width, height as fractions) so faces,
 * screens and papers cannot be read. Returns a new JPEG; the original is untouched.
 */
export async function pixelate(image: PreparedImage, regions: [number, number, number, number][]): Promise<Blob> {
  if (regions.length === 0) return image.blob;
  const bitmap = await createImageBitmap(image.blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const small = document.createElement("canvas");
  for (const [fx, fy, fw, fh] of regions) {
    const x = Math.floor(fx * canvas.width);
    const y = Math.floor(fy * canvas.height);
    const w = Math.max(1, Math.ceil(fw * canvas.width));
    const h = Math.max(1, Math.ceil(fh * canvas.height));
    // Shrink the region to a handful of blocks, then stretch it back without smoothing.
    small.width = Math.max(1, Math.round(w / 24));
    small.height = Math.max(1, Math.round(h / 24));
    small.getContext("2d")!.drawImage(canvas, x, y, w, h, 0, 0, small.width, small.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
  }
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the photo."))), "image/jpeg", JPEG_QUALITY),
  );
}
