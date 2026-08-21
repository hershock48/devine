import { NextResponse } from "next/server";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { getStore, normalizeVariety, type Recipe } from "@/lib/workroom/store";
import { bySlug } from "@/lib/catalog";

/**
 * One recipe per catalog product: which stems, how many. PUT replaces the
 * whole recipe — a recipe is one thought, not a list to patch. An empty parts
 * list is a valid recipe meaning "costed at zero, deliberately" (a gift item,
 * a chocolate box); no recipe at all means "not costed yet" and the tracker
 * says so rather than printing a margin it invented.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p) return NextResponse.json({ error: "Malformed." }, { status: 400 });

  const slug = typeof p.slug === "string" ? p.slug : "";
  if (!bySlug.has(slug)) {
    return NextResponse.json({ error: "Recipes hang off catalog products; that slug is not one." }, { status: 400 });
  }

  const parts: Recipe["parts"] = [];
  for (const raw of (Array.isArray(p.parts) ? p.parts : []).slice(0, 30)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const variety = normalizeVariety(typeof r.variety === "string" ? r.variety : "");
    const stems = Math.round(Number(r.stems));
    if (variety && Number.isFinite(stems) && stems >= 1 && stems <= 999) parts.push({ variety, stems });
  }

  await getStore().upsertRecipe({ slug, parts });
  return NextResponse.json({ ok: true });
}
