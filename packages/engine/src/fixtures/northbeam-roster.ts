// Northbeam's people and client roster as plain data (issue #18), shared by
// the engine's northbeamWithClients() and the database seed fixture. No
// imports, so the seed scripts can load it directly with Node's type
// stripping (package export "./northbeam-roster").

/** Northbeam's team (fictional), by key: name and role. */
export const NORTHBEAM_TEAM: [key: string, name: string, role: string][] = [
  ["priya", "Priya Shah", "sales"],
  ["tom", "Tom Reed", "sales"],
  ["maya", "Maya Collins", "strat"],
  ["leah", "Leah Brooks", "am"],
  ["dan", "Dan Okafor", "am"],
  ["sam", "Sam Patel", "seo"],
  ["chloe", "Chloe Evans", "seo"],
  ["arjun", "Arjun Mehta", "seo"],
  ["nina", "Nina Kowalski", "ppc"],
  ["ben", "Ben Carter", "ppc"],
  ["rosa", "Rosa Diaz", "fin"],
];

/** One client on Northbeam's roster, with the account manager and specialist(s) looking after it. */
export interface NorthbeamClient {
  name: string;
  services: ("seo" | "ppc")[];
  start: string;
  mrr: number;
  health: number;
  am: "leah" | "dan";
  seo?: "sam" | "chloe" | "arjun";
  ppc?: "nina" | "ben";
}

/**
 * Northbeam's 26 active clients (fictional): the prototype's `activeClients`,
 * named. Maya Collins (strategy) and Rosa Diaz (finance) look after everyone.
 * Nina Kowalski carries most of the PPC book, so a couple of PPC wins push
 * her client work past her week.
 */
export const NORTHBEAM_ROSTER: NorthbeamClient[] = [
  { name: "Harbour Lane Dental", services: ["seo"], start: "2023-02-01", mrr: 3500, health: 88, am: "leah", seo: "sam" },
  { name: "Fenwick & Co Solicitors", services: ["seo"], start: "2023-05-15", mrr: 4200, health: 82, am: "leah", seo: "sam" },
  { name: "Oakridge Garden Rooms", services: ["seo", "ppc"], start: "2023-06-01", mrr: 7700, health: 76, am: "leah", seo: "chloe", ppc: "nina" },
  { name: "Brightwater Physio", services: ["seo"], start: "2023-09-04", mrr: 2900, health: 91, am: "dan", seo: "arjun" },
  { name: "Greystone Kitchens", services: ["ppc"], start: "2023-10-02", mrr: 4600, health: 71, am: "dan", ppc: "nina" },
  { name: "Calder Valley Joinery", services: ["seo"], start: "2024-01-08", mrr: 3200, health: 84, am: "leah", seo: "chloe" },
  { name: "Lumen Eyewear", services: ["ppc"], start: "2024-02-05", mrr: 5200, health: 64, am: "dan", ppc: "nina" },
  { name: "Thistle Home Care", services: ["seo"], start: "2024-03-11", mrr: 3500, health: 79, am: "leah", seo: "sam" },
  { name: "Bramble & Oak Bakery", services: ["ppc"], start: "2024-04-02", mrr: 3400, health: 86, am: "leah", ppc: "ben" },
  { name: "Northgate Motors", services: ["seo", "ppc"], start: "2024-05-20", mrr: 8100, health: 58, am: "dan", seo: "sam", ppc: "nina" },
  { name: "Willow & Sage Interiors", services: ["seo"], start: "2024-06-03", mrr: 3100, health: 90, am: "leah", seo: "arjun" },
  { name: "Swift Courier Co", services: ["ppc"], start: "2024-07-01", mrr: 4200, health: 47, am: "dan", ppc: "nina" },
  { name: "Kestrel Accountancy", services: ["seo"], start: "2024-08-12", mrr: 3600, health: 83, am: "leah", seo: "chloe" },
  { name: "Elm Street Opticians", services: ["ppc"], start: "2024-09-02", mrr: 3900, health: 80, am: "dan", ppc: "ben" },
  { name: "Moorland Holiday Cottages", services: ["seo"], start: "2024-10-07", mrr: 3300, health: 77, am: "leah", seo: "sam" },
  { name: "Harper Solar", services: ["ppc"], start: "2024-11-04", mrr: 4800, health: 69, am: "dan", ppc: "nina" },
  { name: "Pennine Roofing", services: ["seo"], start: "2025-01-13", mrr: 3000, health: 85, am: "dan", seo: "arjun" },
  { name: "Nimbus Fitness", services: ["ppc"], start: "2025-02-03", mrr: 4100, health: 74, am: "leah", ppc: "ben" },
  { name: "Ashby Veterinary Group", services: ["seo", "ppc"], start: "2025-03-10", mrr: 7900, health: 81, am: "dan", seo: "chloe", ppc: "nina" },
  { name: "Riverside Pilates", services: ["seo"], start: "2025-04-07", mrr: 2800, health: 92, am: "leah", seo: "arjun" },
  { name: "Copperfield Furniture", services: ["ppc"], start: "2025-05-06", mrr: 4400, health: 66, am: "dan", ppc: "ben" },
  { name: "Hartley Estate Agents", services: ["seo"], start: "2025-06-02", mrr: 3700, health: 87, am: "leah", seo: "sam" },
  { name: "Birchwood Nurseries", services: ["seo"], start: "2025-08-04", mrr: 3400, health: 80, am: "dan", seo: "chloe" },
  { name: "Redwood Wedding Venue", services: ["ppc"], start: "2025-10-06", mrr: 4300, health: 78, am: "leah", ppc: "nina" },
  { name: "Coastline Kayak Hire", services: ["seo"], start: "2026-01-12", mrr: 3200, health: 89, am: "dan", seo: "sam" },
  { name: "Atlas Driving School", services: ["seo"], start: "2026-06-01", mrr: 3500, health: 93, am: "leah", seo: "arjun" },
];

/**
 * Fallback ongoing load per client a month, by role (docs/PRD.md §6.3.4),
 * sized so the roster's totals are close to the prototype's pooled load (26
 * clients × its hours per client a week in each role).
 */
export const NORTHBEAM_FALLBACK_LOAD: Record<"seo" | "ppc", Record<string, number>> = {
  seo: { strat: 1.5, am: 6, seo: 16, fin: 1.2 },
  ppc: { strat: 1.5, am: 6, ppc: 19, fin: 1.2 },
};

/**
 * Northbeam's clients counted per service instead of named (issue #120, decision D27): what an audit
 * would enter. The counts and fees are the roster above rolled up by service: a client on both
 * services counts in each, at half its fee. Normal churn and typical stay are the services' own (3%
 * and 18 months for SEO, 4% and 12 for PPC). Starting health tells the example's story: SEO clients
 * are happy (83), PPC clients are not (52, after a rough year of late reports), so one group is
 * clearly healthy and one is at risk. The named roster stays in the database, hidden, and is not
 * simulated while these exist.
 */
export const NORTHBEAM_CLIENT_GROUPS: { service: "seo" | "ppc"; count: number; fee: number; churnMonthly: number; stayMonths: number; health: number }[] = [
  { service: "seo", count: 17, fee: 3456, churnMonthly: 0.03, stayMonths: 18, health: 83 },
  { service: "ppc", count: 12, fee: 4229, churnMonthly: 0.04, stayMonths: 12, health: 52 },
];

/** Client ids of the roster, in roster order ("c01" …). */
export const northbeamClientKey = (i: number) => `c${String(i + 1).padStart(2, "0")}`;
