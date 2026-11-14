// Photos for tracks and reviews (com.hikeratlas.temp.defs#photo): made into
// JPEGs of at most MAX_SIDE pixels a side and under the lexicon's 2 MB, in
// the browser. Re-encoding drops the photo's EXIF, its location included:
// a photo shows where it was taken only if the post says so.

const MAX_SIDE = 2048;
const MAX_BYTES = 2_000_000;

export interface PreparedPhoto { blob: Blob; width: number; height: number; takenAt: string | null }

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  for (let quality = 0.85; ; ) {
    const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', quality));
    if (!blob) throw new Error(`Couldn't read ${file.name}`);
    if (blob.size <= MAX_BYTES) {
      bitmap.close();
      // When it was taken isn't known: EXIF isn't read.
      return { blob, width: w, height: h, takenAt: null };
    }
    if (quality > 0.6) quality -= 0.1; else scale *= 0.8;
  }
}
