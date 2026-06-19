import imageCompression from "browser-image-compression";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function compressFiles(files: FileList): Promise<File[]> {
  const result: File[] = [];

  for (const file of Array.from(files)) {
    if (IMAGE_TYPES.includes(file.type)) {
      const compressed = await imageCompression(file, {
        maxSizeMB: 2,
        maxWidthOrHeight: 2048,
        useWebWorker: true,
      });
      result.push(compressed);
    } else {
      result.push(file);
    }
  }

  return result;
}
