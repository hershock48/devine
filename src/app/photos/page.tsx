import type { Metadata } from "next";
import { getStore } from "@/lib/workroom/store";
import { neededPhotos } from "@/lib/photos";
import PhotoDrop from "@/components/PhotoDrop";
import "./photos.css";

/**
 * The owner's photo drop, linked from the proposal. Agreement-page shape:
 * top level, no site chrome, noindexed, shared by link.
 *
 * Her whole loop: open the link, tap Add photo on a design, pick the shot,
 * done. Each photo emails Kevin the moment it is chosen and the checkmark is
 * stored server-side, so progress follows her across phone and desktop and a
 * half-done afternoon loses nothing. When the last design lands, Kevin gets
 * a completion email (api/photos). The list itself is DERIVED from the
 * catalog minus the image manifest (lib/photos.ts), so every photo that goes
 * live shrinks this page on the next deploy without anyone editing it.
 */

export const metadata: Metadata = {
  title: "Photo drop · DeVine's Flowers & Botanicals",
  description: "Send the product photographs the new site is waiting for, one tap each.",
  robots: { index: false, follow: false },
};

// The submitted set lives in the database and changes as she uploads;
// a cached page would show her stale checkmarks.
export const dynamic = "force-dynamic";

export default async function PhotosPage() {
  const store = getStore();
  const submitted = await store.listPhotoSubmissions().catch(() => []);
  const tiers = neededPhotos().map((t) => ({ label: t.tier.label, items: t.items }));
  const mailReady = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

  return (
    <main className="ph">
      <p className="ph-kicker">DeVine&rsquo;s Flowers &amp; Botanicals</p>
      <h1>The photographs the new site is waiting for.</h1>
      <p className="lede">
        Twenty of your designs already have photographs on the site, and they do the selling
        everywhere they appear. These are the ones customers can currently only read about.
      </p>
      <p className="lede">
        One photo per design: tap <strong>Add photo</strong>, pick the shot, and it is sent.
        Your checkmarks save as you go, so you can do three today and the rest whenever. Shoot
        them the way you shot the others, in daylight with your phone, and matching them to the
        site is Kevin&rsquo;s job, not yours.
      </p>

      <PhotoDrop
        tiers={tiers}
        initialSubmitted={submitted.map((s) => s.slug)}
        initialThumbs={Object.fromEntries(submitted.filter((s) => s.thumb).map((s) => [s.slug, s.thumb!]))}
        backend={store.backend}
        mailReady={mailReady}
      />

      <div className="ph-aside">
        <p>
          <strong>The three Designer&rsquo;s Choice listings are not here on purpose.</strong>{" "}
          They are whatever you design that day. If you ever want them pictured, text Kevin any
          recent arrangement you are proud of at that price.
        </p>
        <p>
          <strong>A photo would not send?</strong> Texting it to Kevin works exactly as well.
          This page is a convenience, never a gate.
        </p>
      </div>

      <p className="ph-foot">
        Every photo received goes live on the site within a day, and its row leaves this list on
        its own.
      </p>
    </main>
  );
}
