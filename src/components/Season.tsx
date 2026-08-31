import { currentSeasonal, PREVIEW_CHOICES, type ActiveHoliday } from "@/lib/seasons";
import { href } from "@/lib/nav";

/**
 * The two visible faces of the seasonal engine (lib/seasons.ts). Both server
 * components: the season is decided per request on the server, so nothing here
 * needs a byte of client JavaScript.
 */

/**
 * The holiday band. One line under the header while a flower holiday is
 * inside its window: the day, its computed date, one editorial note, one link
 * into her own catalog. It deliberately does NOT say order-by dates or
 * availability, because she has published neither and the site invents no
 * business facts.
 */
export function SeasonBand({ holiday }: { holiday: ActiveHoliday | null }) {
  if (!holiday) return null;
  return (
    <aside className="season-band" aria-label="Coming up at the shop">
      <div className="wrap">
        <p>
          <strong>{holiday.line}</strong> {holiday.note}
        </p>
        <a href={href(holiday.cta.path)}>{holiday.cta.label}</a>
      </div>
    </aside>
  );
}

/**
 * The preview row in the footer. On the live site this is the owner's party
 * trick as much as ours: the site turns with the calendar on its own, and this
 * row lets anyone see the year without waiting for it. While a preview is on,
 * the row says so and offers the way back, so a preview can never be mistaken
 * for the real state of the day.
 */
export async function SeasonPreview() {
  const { preview } = await currentSeasonal();
  return (
    <p className="season-preview">
      <span>The site turns with the seasons on its own. See it in:</span>
      {PREVIEW_CHOICES.map((c) => (
        <a
          key={c.slug}
          href={`/api/season?set=${c.slug}`}
          aria-current={preview === c.slug ? "true" : undefined}
        >
          {c.label}
        </a>
      ))}
      {preview && <a href="/api/season?set=today">Back to today</a>}
    </p>
  );
}
