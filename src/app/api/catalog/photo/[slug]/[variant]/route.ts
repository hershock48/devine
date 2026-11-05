import { NextResponse } from "next/server";
import { getStore } from "@/lib/workroom/store";

/**
 * A product photograph the owner uploaded, out of the database and onto the
 * page: /api/catalog/photo/<slug>/full (1000 wide), /sm (400) or /og (the
 * 1200x630 link card). The URL carries ?v=<version> from the product row, so
 * the response can be cached for a year: a replaced photograph is a new URL,
 * never a stale hit.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VARIANTS = new Set(["full", "sm", "og"]);

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; variant: string }> }) {
  const { slug, variant } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug) || !VARIANTS.has(variant)) return NextResponse.json({ error: "No such photo." }, { status: 404 });
  const photo = await getStore().getCatalogPhoto(`${slug}/${variant}`);
  if (!photo) return NextResponse.json({ error: "No such photo." }, { status: 404 });
  return new NextResponse(new Uint8Array(photo.bytes), {
    status: 200,
    headers: {
      "Content-Type": variant === "og" ? "image/jpeg" : "image/webp",
      "Content-Length": String(photo.bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
