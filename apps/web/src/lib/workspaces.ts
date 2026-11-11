// Input checks for creating a workspace (issue #88). Pure, so they can be unit
// tested. They only reject malformed input early: `create_workspace` checks
// the same bounds again, as the signed-in user, in the database.

/** Longest name, and the slug's length limit (the database's check on `workspaces.slug`). */
export const MAX_NAME = 200;
export const MAX_SLUG = 60;
/** Lower-case words joined by single dashes: the database's slug check. */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A name as a slug: "Café Río & Co." is "cafe-rio-co". May be empty if the name has no letters or digits. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/, "");
}

export const isSlug = (v: string): boolean => v.length <= MAX_SLUG && SLUG.test(v);

export interface NewWorkspace {
  name: string;
  slug: string;
  settings: { hours_per_week: number; currency: string; horizon_weeks: number };
}

/** The new-workspace form's fields, or the sentence to show. Blank settings take the defaults (40 hours, AUD, 13 weeks). */
export function parseNewWorkspace(form: { get(name: string): FormDataEntryValue | null }): NewWorkspace | { error: string } {
  const name = String(form.get("name") ?? "").trim();
  if (name.length < 1 || name.length > MAX_NAME) return { error: "Enter a name (up to 200 characters)." };
  const slug = String(form.get("slug") ?? "").trim().toLowerCase() || slugify(name);
  if (!isSlug(slug)) return { error: "The address can use lower-case letters, digits and single dashes, up to 60 characters." };
  const hoursText = String(form.get("hours_per_week") ?? "").trim();
  const hours = hoursText === "" ? 40 : Number(hoursText);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) return { error: "Hours a week must be more than 0 and at most 168." };
  const currency = String(form.get("currency") ?? "").trim().toUpperCase() || "AUD";
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "Enter a three-letter currency code, such as AUD." };
  const horizonText = String(form.get("horizon_weeks") ?? "").trim();
  const horizon = horizonText === "" ? 13 : Number(horizonText);
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 104) return { error: "The horizon must be a whole number of weeks from 1 to 104." };
  return { name, slug, settings: { hours_per_week: hours, currency, horizon_weeks: horizon } };
}
