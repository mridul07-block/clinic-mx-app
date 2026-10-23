/** The longest side of a report photo once shrunk on the device (TAD: resized before upload). */
const PHOTO_SIDE = 1600;

/**
 * A photo redrawn at most PHOTO_SIDE pixels on its longest side, as a JPEG, in the browser
 * (INT-02, INT-05): it saves mobile data and keeps photos under the upload limit.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((done) => {
    canvas.toBlob(done, 'image/jpeg', 0.82);
  });
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

/** Photos shrunk, PDFs as they are; a photo the browser cannot redraw goes as it is. */
export function shrinkPhotos(files: File[]): Promise<File[]> {
  return Promise.all(
    files.map((file) =>
      file.type.startsWith('image/') ? shrinkPhoto(file).catch(() => file) : Promise.resolve(file),
    ),
  );
}
