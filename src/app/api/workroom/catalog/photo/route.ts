import { NextResponse } from "next/server";
import { isWorkroomOwner } from "@/lib/workroom/auth";
import { getStore } from "@/lib/workroom/store";
import { forgetCatalog, getCatalog } from "@/lib/catalog-live";
import { PHOTO_MAX_BYTES, processProductPhoto } from "@/lib/catalog-photo";

/**
 * A PHOTOGRAPH FOR A DESIGN, from the owner's phone or desk, owner's PIN.
 * Multipart: `slug` and `file`. The server makes the three shapes the site
 * reads (lib/catalog-photo.ts), stores them, and stamps the product with a
 * new version so every page picks the new picture up at once.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isWorkroomOwner())) return NextResponse.json({ error: "The owner's PIN opens this." }, { status: 403 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Malformed." }, { status: 400 });
  const slug = String(form.get("slug") ?? "").trim();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Pick a photo first." }, { status: 400 });
  if (file.size > PHOTO_MAX_BYTES) return NextResponse.json({ error: "That photo is over 12MB. A phone's normal size is fine; a RAW file is not." }, { status: 413 });
  if (!/^image\//.test(file.type)) return NextResponse.json({ error: "That file is not a photo." }, { status: 415 });
  const cat = await getCatalog();
  const product = cat.bySlug.get(slug);
  if (!product) return NextResponse.json({ error: "No such design." }, { status: 404 });
  let shapes;
  try {
    shapes = await processProductPhoto(Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json({ error: "That photo could not be read. A JPEG or PNG from the phone works." }, { status: 415 });
  }
  const store = getStore();
  await store.putCatalogPhoto(`${slug}/full`, shapes.full.bytes, shapes.full.w, shapes.full.h);
  await store.putCatalogPhoto(`${slug}/sm`, shapes.sm.bytes, shapes.sm.w, shapes.sm.h);
  await store.putCatalogPhoto(`${slug}/og`, shapes.og.bytes, shapes.og.w, shapes.og.h);
  const photo = { v: Date.now(), w: shapes.full.w, h: shapes.full.h };
  // Stamp the photo onto the row AS IT IS NOW, not the copy read before the
  // resizing: a price or description saved in those seconds must survive.
  const current = (await store.listCatalogProducts()).find((x) => x.slug === slug) ?? product;
  await store.upsertCatalogProduct({ ...current, photo });
  forgetCatalog();
  return NextResponse.json({ ok: true, photo });
}
