import "server-only";
import sharp from "sharp";

/**
 * A PHOTOGRAPH FROM THE OWNER'S PHONE INTO THE THREE SHAPES THE SITE READS,
 * the same shapes tools/ingest-photo.mjs makes from a file on disk: the
 * 1000-wide detail image, the 400-wide card, both webp at quality 84 on a
 * white ground, and the 1200x630 link card for a shared product page. Done
 * on the server at upload, once, so every later view is a plain file read.
 *
 * rotate() honors the phone's orientation tag; without it a portrait shot
 * from an iPhone lands on its side. withoutEnlargement keeps a small photo
 * small rather than blurring it up to 1000.
 */
export type ProcessedPhoto = {
  full: { bytes: Buffer; w: number; h: number };
  sm: { bytes: Buffer; w: number; h: number };
  og: { bytes: Buffer; w: number; h: number };
};

/** Under the platform's 4.5MB request cap; the tab downscales in the
    browser first, so a real photo arrives well below this. */
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;

export async function processProductPhoto(input: Buffer): Promise<ProcessedPhoto> {
  const base = sharp(input, { failOn: "none" }).rotate().flatten({ background: "#ffffff" });
  const full = await base.clone().resize({ width: 1000, withoutEnlargement: true }).webp({ quality: 84 }).toBuffer({ resolveWithObject: true });
  const sm = await base.clone().resize({ width: 400, withoutEnlargement: true }).webp({ quality: 84 }).toBuffer({ resolveWithObject: true });
  const og = await base.clone().resize({ width: 1200, height: 630, fit: "cover", position: "centre" }).jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
  return {
    full: { bytes: full.data, w: full.info.width, h: full.info.height },
    sm: { bytes: sm.data, w: sm.info.width, h: sm.info.height },
    og: { bytes: og.data, w: og.info.width, h: og.info.height },
  };
}
