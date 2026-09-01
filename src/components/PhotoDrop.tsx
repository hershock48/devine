"use client";

import { useRef, useState } from "react";

/**
 * The owner's upload rows for /photos.
 *
 * THE PHOTO IS DOWNSCALED IN HER BROWSER before it travels: a modern phone
 * shoots 8MB+ HEICs, Vercel caps a request at 4.5MB, and the site only needs
 * ~1800px. Canvas re-encode to JPEG solves all three and also converts
 * whatever format the phone hands us. When the browser cannot decode the
 * file at all (some HEICs on desktop), the row says so honestly and offers
 * the fallback that always works: text it to Kevin.
 *
 * EACH PHOTO SENDS THE MOMENT SHE PICKS IT. An earlier sketch batched them
 * behind a submit button; a batch that dies at photo 30 of 34 loses 30
 * photos, and "save" she asked for really means "do not lose my progress".
 * Sent-immediately means nothing is ever lost, and the server ledger is the
 * saved progress, visible from any device.
 */

type Item = { slug: string; name: string; price: number };
type Tier = { label: string; items: Item[] };

const MAX_EDGE = 1800;

function drawScaled(source: ImageBitmap | HTMLImageElement, w0: number, h0: number): string | null {
  const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return dataUrl.startsWith("data:image/jpeg") ? dataUrl : null;
}

/**
 * ORIENTATION IS THE TRAP HERE. A camera photo is stored sideways with a
 * rotation flag in its EXIF, and the canvas re-encode strips EXIF, so if the
 * decode step ignores the flag she uploads sideways flowers. Primary path
 * asks createImageBitmap for baked-in orientation explicitly; browsers too
 * old for the option (it throws there) fall through to an <img> decode,
 * which every engine orientation-corrects before drawImage. The <img> path
 * is also the net under HEIC-on-desktop and any other decode failure: when
 * even that cannot read the file, the row says so and offers texting it.
 */
async function toJpegDataUrl(file: File): Promise<{ dataUrl: string } | { failed: true }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const out = drawScaled(bmp, bmp.width, bmp.height);
    bmp.close();
    if (out) return { dataUrl: out };
  } catch {
    /* fall through to the <img> path */
  }
  try {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("decode"));
        img.src = url;
      });
      const out = drawScaled(img, img.naturalWidth, img.naturalHeight);
      if (out) return { dataUrl: out };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    /* fall through to the honest error */
  }
  return { failed: true };
}

export default function PhotoDrop({
  tiers,
  initialSubmitted,
  backend,
  mailReady,
}: {
  tiers: Tier[];
  initialSubmitted: string[];
  backend: string;
  mailReady: boolean;
}) {
  const [submitted, setSubmitted] = useState<Set<string>>(() => new Set(initialSubmitted));
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const total = tiers.reduce((n, t) => n + t.items.length, 0);
  const doneCount = tiers.reduce((n, t) => n + t.items.filter((i) => submitted.has(i.slug)).length, 0);

  async function send(item: Item, file: File) {
    setErrors((e) => ({ ...e, [item.slug]: "" }));
    setBusy((b) => new Set(b).add(item.slug));
    try {
      const shrunk = await toJpegDataUrl(file);
      if ("failed" in shrunk) {
        setErrors((e) => ({
          ...e,
          [item.slug]: "That file would not open here. A screenshot of the photo works, or text it to Kevin.",
        }));
        return;
      }
      const res = await fetch("/api/photos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: item.slug, filename: file.name, dataUrl: shrunk.dataUrl }),
      });
      const data: { ok?: boolean; submitted?: string[]; error?: string } = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setSubmitted((s) => new Set([...s, ...(data.submitted ?? [item.slug])]));
      } else {
        setErrors((e) => ({
          ...e,
          [item.slug]: data.error || "That one did not go through. Try again, or text it to Kevin.",
        }));
      }
    } catch {
      setErrors((e) => ({
        ...e,
        [item.slug]: "That one did not go through. Try again, or text it to Kevin.",
      }));
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(item.slug);
        return next;
      });
    }
  }

  return (
    <>
      <div className="ph-progress" aria-live="polite">
        <b>{doneCount}</b>
        <span>of {total} photographed</span>
      </div>

      {!mailReady && (
        <p className="ph-warn">
          The photo drop is not connected to a mailbox yet, so uploads here cannot reach anyone.
          Text photos to Kevin for now.
        </p>
      )}
      {mailReady && backend === "memory" && (
        <p className="ph-warn">
          Heads up: checkmarks may not stick on this preview setup. Every photo you send still
          arrives by email either way.
        </p>
      )}

      {tiers.map((t) => (
        <section key={t.label} className="ph-tier">
          <h2>{t.label}</h2>
          <ul>
            {t.items.map((item) => {
              const isDone = submitted.has(item.slug);
              const isBusy = busy.has(item.slug);
              const err = errors[item.slug];
              return (
                <li key={item.slug} className={isDone ? "done" : undefined}>
                  <div className="ph-row">
                    <span className="ph-name">{item.name}</span>
                    <span className="ph-price">
                      {item.price % 1 === 0 ? `$${item.price}` : `$${item.price.toFixed(2)}`}
                    </span>
                    {isDone ? (
                      <span className="ph-state ph-in">In ✓</span>
                    ) : (
                      <label className={`ph-add${isBusy ? " ph-busy" : ""}`}>
                        {isBusy ? "Sending…" : "Add photo"}
                        <input
                          ref={(el) => {
                            inputs.current[item.slug] = el;
                          }}
                          type="file"
                          accept="image/*"
                          disabled={isBusy}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (f) void send(item, f);
                          }}
                        />
                      </label>
                    )}
                  </div>
                  {isDone && (
                    <p className="ph-note">
                      Got it.{" "}
                      <button
                        type="button"
                        className="ph-retake"
                        onClick={() => inputs.current[item.slug]?.click()}
                      >
                        Send a better one
                      </button>
                      <input
                        ref={(el) => {
                          inputs.current[item.slug] = el;
                        }}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) void send(item, f);
                        }}
                      />
                    </p>
                  )}
                  {err ? <p className="ph-err">{err}</p> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
