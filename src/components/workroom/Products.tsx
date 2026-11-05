"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Category, Product } from "@/lib/catalog";
import ProductImage from "@/components/ProductImage";
import { toJpegDataUrl } from "@/components/PhotoDrop";
import { field, labelText, money, textButton, MemoryWarning, PinGate } from "@/components/workroom/ui";

/**
 * THE PRODUCTS TAB (Kevin, 2026-11-05: "they have been messaging emailing me
 * a lot about, hey add this thing or edit this description or add this
 * photo... can we make some sort of admin panel thing where they can do
 * this themselves?"). The shop's catalog, owned by the owner: every design's
 * name, price, sale price, description, shelves, on or off the menu, and its
 * photograph, plus the shelves themselves. Saves go to the live catalog and
 * the shop reads them within seconds; no deploy, no email.
 *
 * Owner's PIN, like the dashboard: prices are the business.
 *
 * What stays with us: copy that needs writing from a flower list. She can
 * type a description here; the catalog's voice is in the ones already
 * written.
 */

type Catalog = { products: Product[]; categories: Category[]; backend?: string };

type Draft = {
  name: string;
  price: string;
  was: string;
  desc: string;
  cats: string[];
  offMenu: boolean;
  noSubs: boolean;
};

const draftOf = (p?: Product): Draft => ({
  name: p?.name ?? "",
  price: p ? String(p.price) : "",
  was: p?.regularPrice ? String(p.regularPrice) : "",
  desc: p?.desc.startsWith("PLACEHOLDER") ? "" : (p?.desc ?? ""),
  cats: p?.cats ?? [],
  offMenu: !!p?.offMenu,
  noSubs: !!p?.noSubs,
});

const asNumber = (s: string): number => Number(s.replace(/[$,\s]/g, ""));

async function call(method: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  const r = await fetch("/api/workroom/catalog", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: r.ok && data?.ok !== false, status: r.status, data };
}

export default function Products({ initialAuthed, initialOwner }: { initialAuthed: boolean; initialOwner: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [owner, setOwner] = useState(initialOwner);
  const [ownerHint, setOwnerHint] = useState("");
  const [cat, setCat] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [find, setFind] = useState("");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const r = await fetch("/api/workroom/catalog", { cache: "no-store" });
    if (r.status === 401) {
      setAuthed(false);
      return;
    }
    if (r.status === 403) {
      setOwner(false);
      return;
    }
    const d = (await r.json().catch(() => null)) as Catalog | null;
    if (!r.ok || !d) {
      setError("The catalog did not load.");
      return;
    }
    setCat(d);
    setError("");
  }, []);

  useEffect(() => {
    if (!authed || !owner) return;
    load().catch(() => setError("The catalog did not load."));
  }, [authed, owner, load]);

  const shown = useMemo(() => {
    if (!cat) return [];
    const q = find.trim().toLowerCase();
    const list = [...cat.products].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return list;
    const catNames = new Map(cat.categories.map((c) => [c.slug, c.name.toLowerCase()]));
    return list.filter((p) => p.name.toLowerCase().includes(q) || p.slug.includes(q) || p.cats.some((c) => (catNames.get(c) ?? c).includes(q)));
  }, [cat, find]);

  if (!authed) {
    return (
      <>
        <h1>Products</h1>
        <PinGate
          onAuthed={(info) => {
            setAuthed(true);
            setOwner(!!info?.owner);
          }}
        />
      </>
    );
  }

  if (!owner) {
    return (
      <>
        <h1>Products</h1>
        <p className="lede" style={{ margin: "4px 0 10px" }}>
          Prices and the shop&rsquo;s catalog live here, so this one screen asks for the owner&rsquo;s PIN. Everything else
          in the workroom is open as usual.
        </p>
        <PinGate
          onAuthed={(info) => {
            if (info?.owner) {
              setOwner(true);
              setOwnerHint("");
            } else {
              setOwnerHint("That is the staff PIN; it opens the rest of the workroom, but this screen needs the owner's.");
            }
          }}
        />
        <p aria-live="polite" style={{ color: "var(--rose-ink)", fontWeight: 600, minHeight: "1.4em", maxWidth: 420 }}>
          {ownerHint}
        </p>
      </>
    );
  }

  const counts = new Map<string, number>();
  for (const p of cat?.products ?? []) for (const c of p.cats) counts.set(c, (counts.get(c) ?? 0) + 1);

  return (
    <>
      <style>{`.product-thumb img, .product-thumb svg { width: 100%; height: 100%; object-fit: cover; display: block; }`}</style>
      <h1>Products</h1>
      <MemoryWarning backend={cat?.backend ?? null} />
      <p className="lede" style={{ maxWidth: 640 }}>
        What the shop sells, in your hands. Change a price, rewrite a description, move a design to another shelf, take
        one off the menu, or put a photo on it from your phone. The website shows the change within a few seconds.
      </p>
      {error && <p role="alert" style={{ color: "var(--rose-ink)", fontWeight: 600 }}>{error}</p>}
      {notice && <p role="status" style={{ color: "var(--green)", fontWeight: 600 }}>{notice}</p>}

      {cat && (
        <>
          <Shelves cat={cat} counts={counts} onChanged={load} onError={setError} />

          <section style={{ marginTop: 28 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>Designs</h2>
              <span className="muted">{cat.products.length} in the catalog, {cat.products.filter((p) => !p.offMenu).length} on the menu</span>
              <button type="button" className="btn btn--solid" onClick={() => setAdding((a) => !a)}>
                {adding ? "Close the new design" : "Add a design"}
              </button>
            </div>
            {adding && (
              <DesignForm
                cat={cat}
                onSaved={() => load().catch(() => {})}
                onDone={(what) => {
                  setAdding(false);
                  setNotice(what);
                  load().catch(() => {});
                }}
                onError={setError}
              />
            )}
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find: a design or a shelf"
              aria-label="Find a design"
              style={{ ...field, maxWidth: 420, margin: "10px 0 14px" }}
            />
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
              {shown.map((p) => (
                <DesignRow
                  key={p.slug}
                  p={p}
                  cat={cat}
                  onChanged={(what) => {
                    setNotice(what);
                    load().catch(() => {});
                  }}
                  onError={setError}
                />
              ))}
              {shown.length === 0 && <li className="muted">No design matches.</li>}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

/* ------------------------------- shelves ------------------------------- */

function Shelves({ cat, counts, onChanged, onError }: { cat: Catalog; counts: Map<string, number>; onChanged: () => Promise<void>; onError: (e: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  async function reorder(slug: string, dir: -1 | 1) {
    const order = cat.categories.map((c) => c.slug);
    const i = order.indexOf(slug);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setBusy(slug);
    const r = await call("PUT", { order });
    setBusy(null);
    if (!r.ok) return onError(String(r.data?.error ?? "The shelves did not reorder."));
    onError("");
    await onChanged();
  }

  async function add() {
    const name = newName.trim();
    if (!name) return;
    setBusy("new");
    const r = await call("PUT", { name });
    setBusy(null);
    if (!r.ok) return onError(String(r.data?.error ?? "The shelf did not save."));
    setNewName("");
    onError("");
    await onChanged();
  }

  return (
    <section>
      <h2 style={{ margin: "18px 0 6px" }}>Shelves</h2>
      <p className="muted" style={{ margin: "0 0 10px", maxWidth: 640, fontSize: 14 }}>
        The shop&rsquo;s sections, in the order they show. A shelf appears on the site once a design is on it. A hidden
        shelf keeps its designs but is not shown; a design on no shelf can still be sold at the counter.
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
        {cat.categories.map((c, i) => (
          <ShelfRow
            key={c.slug}
            c={c}
            count={counts.get(c.slug) ?? 0}
            first={i === 0}
            last={i === cat.categories.length - 1}
            busy={busy === c.slug}
            onUp={() => reorder(c.slug, -1)}
            onDown={() => reorder(c.slug, 1)}
            onChanged={onChanged}
            onError={onError}
          />
        ))}
      </ul>
      <p style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "12px 0 0" }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="A new shelf, e.g. Holiday" aria-label="New shelf name" style={{ ...field, width: 240 }} />
        <button type="button" className="btn" disabled={busy === "new" || !newName.trim()} onClick={add}>
          Add a shelf
        </button>
      </p>
    </section>
  );
}

function ShelfRow({
  c,
  count,
  first,
  last,
  busy,
  onUp,
  onDown,
  onChanged,
  onError,
}: {
  c: Category;
  count: number;
  first: boolean;
  last: boolean;
  busy: boolean;
  onUp: () => void;
  onDown: () => void;
  onChanged: () => Promise<void>;
  onError: (e: string) => void;
}) {
  const [name, setName] = useState(c.name);
  const [blurb, setBlurb] = useState(c.blurb);
  const [hidden, setHidden] = useState(!!c.hidden);
  const [saving, setSaving] = useState(false);
  const dirty = name !== c.name || blurb !== c.blurb || hidden !== !!c.hidden;

  async function save() {
    setSaving(true);
    const r = await call("PUT", { slug: c.slug, name, blurb, hidden });
    setSaving(false);
    if (!r.ok) return onError(String(r.data?.error ?? "The shelf did not save."));
    onError("");
    await onChanged();
  }
  async function remove() {
    if (!window.confirm(`Remove the empty shelf "${c.name}"?`)) return;
    setSaving(true);
    const r = await call("DELETE", { slug: c.slug });
    setSaving(false);
    if (!r.ok) return onError(String(r.data?.error ?? "The shelf did not go."));
    onError("");
    await onChanged();
  }

  return (
    <li className="panel" style={{ padding: "10px 12px", display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", gap: 2 }}>
          <button type="button" aria-label={`Move ${c.name} up`} disabled={first || busy} onClick={onUp} style={{ ...textButton, fontSize: 16 }}>
            &#9650;
          </button>
          <button type="button" aria-label={`Move ${c.name} down`} disabled={last || busy} onClick={onDown} style={{ ...textButton, fontSize: 16 }}>
            &#9660;
          </button>
        </span>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label={`Shelf name for ${c.name}`} style={{ ...field, width: 200 }} />
        <span className="muted" style={{ fontSize: 14 }}>
          {count} design{count === 1 ? "" : "s"} · /shop/{c.slug}
        </span>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 14 }}>
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hidden from the shop
        </label>
        {dirty && (
          <button type="button" className="btn btn--solid" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </button>
        )}
        {count === 0 && (
          <button type="button" onClick={remove} disabled={saving} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
            Remove this empty shelf
          </button>
        )}
      </div>
      <input
        value={blurb}
        onChange={(e) => setBlurb(e.target.value)}
        placeholder="One line under the shelf's name on the site (optional)"
        aria-label={`Blurb for ${c.name}`}
        style={{ ...field, maxWidth: 640 }}
      />
    </li>
  );
}

/* ------------------------------- designs ------------------------------- */

function DesignRow({ p, cat, onChanged, onError }: { p: Product; cat: Catalog; onChanged: (what: string) => void; onError: (e: string) => void }) {
  const [open, setOpen] = useState(false);
  const names = new Map(cat.categories.map((c) => [c.slug, c.name]));
  return (
    <li className="panel" style={{ padding: "10px 12px" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ width: 56, height: 56, overflow: "hidden", borderRadius: 6, background: "var(--line)", flex: "0 0 auto", display: "grid", placeItems: "center" }}>
          <span style={{ width: 56, height: 56, display: "block" }} className="product-thumb">
            <ProductImage p={p} />
          </span>
        </span>
        <span style={{ flex: "1 1 220px" }}>
          <strong>{p.name}</strong> <span style={{ whiteSpace: "nowrap" }}>{money(p.price)}</span>
          {p.regularPrice ? <span className="muted" style={{ whiteSpace: "nowrap" }}> (on sale, was {money(p.regularPrice)})</span> : null}
          <br />
          <span className="muted" style={{ fontSize: 13.5 }}>
            {p.cats.length ? p.cats.map((c) => names.get(c) ?? c).join(", ") : "on no shelf"}
            {p.offMenu ? " · off the menu" : ""}
            {!p.desc || p.desc.startsWith("PLACEHOLDER") ? " · needs a description" : ""}
          </span>
        </span>
        {!p.offMenu && (
          <a href={`/product/${p.slug}`} target="_blank" rel="noreferrer" style={{ fontSize: 13.5 }}>
            See it on the site
          </a>
        )}
        <button type="button" className="btn" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Edit"}
        </button>
      </div>
      {open && (
        <DesignForm
          cat={cat}
          existing={p}
          onDone={(what) => {
            setOpen(false);
            onChanged(what);
          }}
          onError={onError}
        />
      )}
    </li>
  );
}

function DesignForm({
  cat,
  existing,
  onSaved,
  onDone,
  onError,
}: {
  cat: Catalog;
  existing?: Product;
  /** The design is in the catalog, though the form may still be open (a
      photo that did not upload): refresh the list behind it. */
  onSaved?: () => void;
  onDone: (what: string) => void;
  onError: (e: string) => void;
}) {
  const [d, setD] = useState<Draft>(() => draftOf(existing));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  /** A NEW DESIGN IS MINTED ONCE. If its photo then fails to upload the
      form stays open; a second tap must save THAT design again, not mint
      "rose-bowl-2" beside it (there is no deleting a design, only taking
      it off the menu). */
  const [created, setCreated] = useState<Product | null>(null);
  const target = existing ?? created;
  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));
  const toggleCat = (slug: string) => set({ cats: d.cats.includes(slug) ? d.cats.filter((c) => c !== slug) : [...d.cats, slug] });

  /** THE PHOTO IS DOWNSCALED HERE, IN HER BROWSER, before it travels: a
      phone's original is 4 to 8MB and the platform turns away any request
      over 4.5MB before our route runs. Same step the photo drop page uses
      (PhotoDrop.tsx), which also bakes the camera's rotation in. */
  async function upload(slug: string): Promise<boolean> {
    if (!file) return true;
    setUploading(true);
    let blob: Blob = file;
    const jpeg = await toJpegDataUrl(file);
    if (!("failed" in jpeg)) {
      blob = await (await fetch(jpeg.dataUrl)).blob();
    } else if (file.size > 4 * 1024 * 1024) {
      setUploading(false);
      onError("That photo could not be resized on this device and is too big to send as it is. A normal camera photo (JPEG) works.");
      return false;
    }
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("file", blob, "photo.jpg");
    const r = await fetch("/api/workroom/catalog/photo", { method: "POST", body: fd }).catch(() => null);
    const data = r ? ((await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null) : null;
    setUploading(false);
    if (!r || !r.ok || !data?.ok) {
      onError(data?.error || "The photo did not upload. The design itself is saved; pick the photo again and press Save.");
      return false;
    }
    return true;
  }

  async function save() {
    if (!d.name.trim()) return onError("Give the design a name.");
    if (!d.price.trim()) return onError("Give it a price.");
    const price = asNumber(d.price);
    if (!Number.isFinite(price) || price <= 0) return onError("The price did not read as a number above zero.");
    const was = d.was.trim() ? asNumber(d.was) : null;
    if (was !== null && (!Number.isFinite(was) || was <= price)) return onError("The was-price has to be more than the price; that is what makes it a sale. Clear it for no sale.");
    setSaving(true);
    const body = { name: d.name.trim(), price, regularPrice: was, desc: d.desc.trim(), cats: d.cats, offMenu: d.offMenu, noSubs: d.noSubs };
    const r = target ? await call("PATCH", { slug: target.slug, ...body }) : await call("POST", body);
    setSaving(false);
    if (!r.ok) return onError(String(r.data?.error ?? "That did not save."));
    const product = r.data?.product as Product | undefined;
    if (!existing && product) {
      setCreated(product);
      onSaved?.();
    }
    const slug = product?.slug ?? target?.slug;
    if (slug && !(await upload(slug))) return;
    onError("");
    onDone(existing ? `${body.name} saved.` : `${body.name} is in the catalog${d.cats.length ? "" : " (on no shelf yet)"}.`);
  }

  return (
    <div style={{ marginTop: 12, display: "grid", gap: 12, maxWidth: 640 }}>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)" }}>
        <label>
          <span style={labelText}>Name</span>
          <input value={d.name} onChange={(e) => set({ name: e.target.value })} style={field} maxLength={80} />
        </label>
        <label>
          <span style={labelText}>Price</span>
          <input value={d.price} onChange={(e) => set({ price: e.target.value })} inputMode="decimal" placeholder="$" style={field} />
        </label>
        <label>
          <span style={labelText}>Was (on sale)</span>
          <input value={d.was} onChange={(e) => set({ was: e.target.value })} inputMode="decimal" placeholder="optional" style={field} />
        </label>
      </div>
      <p className="muted" style={{ margin: "-4px 0 0", fontSize: 13.5 }}>
        To put a design on sale, set Price to the sale price and Was to the usual one; the site strikes the usual price
        through. Clear Was when the sale ends.
      </p>
      <label>
        <span style={labelText}>Description</span>
        <textarea value={d.desc} onChange={(e) => set({ desc: e.target.value })} rows={4} maxLength={1200} style={{ ...field, resize: "vertical" }} placeholder="What is in it, and what it is for." />
      </label>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={labelText}>Shelves</legend>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {cat.categories.map((c) => (
            <label key={c.slug} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 14.5 }}>
              <input type="checkbox" checked={d.cats.includes(c.slug)} onChange={() => toggleCat(c.slug)} />
              {c.name}
              {c.hidden ? <span className="muted"> (hidden)</span> : null}
            </label>
          ))}
        </div>
      </fieldset>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 14.5 }}>
          <input type="checkbox" checked={!d.offMenu} onChange={(e) => set({ offMenu: !e.target.checked })} /> On the menu (for sale on the website)
        </label>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 14.5 }}>
          <input type="checkbox" checked={d.noSubs} onChange={(e) => set({ noSubs: e.target.checked })} /> No substitution note (gifts, plush, wedding pieces)
        </label>
      </div>
      <div>
        <span style={labelText}>Photo</span>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <input type="file" accept="image/*" aria-label="Photo file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 14 }} />
          <span className="muted" style={{ fontSize: 13.5 }}>
            {target?.photo ? "Replaces the photo on the site." : "A phone photo on a plain background is fine. It is resized here."}
          </span>
        </div>
      </div>
      <p style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: 0 }}>
        <button type="button" className="btn btn--solid" disabled={saving || uploading} onClick={save}>
          {uploading ? "Uploading the photo…" : saving ? "Saving…" : target ? "Save" : "Add it"}
        </button>
        {created && !existing && !saving && !uploading && (
          <span role="status" style={{ fontSize: 13.5, color: "var(--green)", fontWeight: 600 }}>
            {created.name} is in the catalog. Save again to finish the photo.
          </span>
        )}
        {existing && !existing.offMenu && (
          <span className="muted" style={{ fontSize: 13.5 }}>
            Its web address stays /product/{existing.slug} whatever the name becomes.
          </span>
        )}
      </p>
    </div>
  );
}
