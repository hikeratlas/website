// Photos for tracks and reviews (com.hikeratlas.temp.defs#photo), within the
// lexicon's 2 MB. A JPEG that fits is uploaded as it is; a bigger photo is
// re-encoded as a JPEG of at most MAX_SIDE pixels a side, with the
// original's EXIF put back. Either way it keeps where and when it was
// taken: photos of places are much of what's worth sharing. Where and when
// also go in the record (at, takenAt), from EXIF, so apps needn't read the
// image for them.
import { readExif, withExif } from './exif';

const MAX_SIDE = 2048;
const MAX_BYTES = 2_000_000;

export interface PreparedPhoto {
  blob: Blob;
  // Where it was taken (from its EXIF GPS, or later its time on a track),
  // and when.
  lat: number | null;
  lon: number | null;
  takenAt: string | null;
  // Whether takenAt came with its time zone (EXIF often has local time only).
  offsetKnown: boolean;
  // Its size as displayed (EXIF orientation applied), for the record's
  // aspectRatio, which the lexicon requires (website#177).
  width: number;
  height: number;
}

// A photo's size as displayed, from its URL (an old photo, posted before
// aspectRatio, when its review is edited): browsers apply its EXIF
// orientation to the natural size.
export function measurePhoto(url: string): Promise<{ width: number; height: number }> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => (img.naturalWidth > 0 && img.naturalHeight > 0
      ? ok({ width: img.naturalWidth, height: img.naturalHeight })
      : fail(new Error("Couldn't read a photo's size")));
    img.onerror = () => fail(new Error("Couldn't load a photo to read its size"));
    img.src = url;
  });
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const exif = readExif(bytes);
  const info = { lat: exif.lat, lon: exif.lon, takenAt: exif.takenAt, offsetKnown: exif.offsetKnown };
  if (file.type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && file.size <= MAX_BYTES) {
    // Uploaded as it is; decoded only for its size, as displayed (the
    // record's aspectRatio, which is required: a photo that can't be decoded
    // isn't uploaded).
    const b = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const [width, height] = [b.width, b.height];
    b.close();
    return { blob: file, ...info, width, height };
  }

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const room = MAX_BYTES - (exif.segment?.length ?? 0);
  for (let quality = 0.85; ; ) {
    const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', quality));
    if (!blob) throw new Error(`Couldn't read ${file.name}`);
    if (blob.size <= room) {
      bitmap.close();
      if (!exif.segment) return { blob, ...info, width: w, height: h };
      const out = withExif(new Uint8Array(await blob.arrayBuffer()), exif.segment);
      return { blob: new Blob([out as BlobPart], { type: 'image/jpeg' }), ...info, width: w, height: h };
    }
    if (quality > 0.6) quality -= 0.1; else scale *= 0.8;
  }
}
