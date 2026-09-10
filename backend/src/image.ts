import sharp from 'sharp';

const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export class ImageError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_image' | 'unsupported_type',
  ) {
    super(message);
  }
}

export function normalizeMime(mime: string | undefined, filename?: string): string {
  const lower = (mime || '').toLowerCase();
  if (lower === 'image/jpg') return 'image/jpeg';
  if (ALLOWED.has(lower)) return lower === 'image/jpg' ? 'image/jpeg' : lower;
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.heic') || name.endsWith('.heif')) return 'image/heic';
  return lower;
}

export function isAllowedMime(mime: string): boolean {
  return ALLOWED.has(mime);
}

export async function optimizeForVision(
  input: Buffer,
  options: { maxEdge: number; jpegQuality: number },
): Promise<{ buffer: Buffer; mimeType: 'image/jpeg'; width: number; height: number }> {
  try {
    const image = sharp(input, { failOn: 'none' }).rotate();
    const meta = await image.metadata();
    if (!meta.width || !meta.height) {
      throw new ImageError('Could not read image dimensions', 'invalid_image');
    }
    const longest = Math.max(meta.width, meta.height);
    const pipeline =
      longest > options.maxEdge
        ? image.resize({
            width: meta.width >= meta.height ? options.maxEdge : undefined,
            height: meta.height > meta.width ? options.maxEdge : undefined,
            fit: 'inside',
            withoutEnlargement: true,
          })
        : image;

    const buffer = await pipeline.jpeg({ quality: options.jpegQuality, mozjpeg: true }).toBuffer();
    const out = await sharp(buffer).metadata();
    return {
      buffer,
      mimeType: 'image/jpeg',
      width: out.width ?? 0,
      height: out.height ?? 0,
    };
  } catch (err) {
    if (err instanceof ImageError) throw err;
    throw new ImageError('File is not a usable image', 'invalid_image');
  }
}

export function toDataUrl(mimeType: string, bytes: Buffer): string {
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}
