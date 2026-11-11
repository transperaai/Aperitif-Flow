/**
 * The product name and logo files people see. One place, so a client rebrand is this file plus the files in public/brand
 * (docs/brand.md). Internal names (package names, env vars, file formats such as `transpera-process/2`) don't come from here.
 */
export const BRAND = {
  /** The product's name, in titles, the sign-in screen, the sidebar, exports and emails. */
  name: "Aperitif Flow",
  /** The wide logo (the client's wordmark): sidebar, headers, sign-in. */
  logo: { src: "/brand/logo.svg", width: 1076, height: 254, alt: "Aperitif" },
  /** The square mark cut from the logo: collapsed sidebar; the app icons in src/app are generated from it. */
  mark: { src: "/brand/mark.svg", width: 256, height: 256 },
  /** The word shown after the logo, since the wordmark itself says only "Aperitif". Empty when the logo carries the full name. */
  logoSuffix: "Flow",
} as const;

/** A page title: "Not found · Aperitif Flow". */
export const pageTitle = (page: string) => `${page} · ${BRAND.name}`;
