// Regenerates the app icons from the brand's square mark (docs/brand.md): src/app/icon.svg (a copy), src/app/apple-icon.png
// (180x180) and src/app/favicon.ico (16, 32 and 48 px PNGs). Run from apps/web: `node scripts/brand-icons.mjs`.
// Draws with the Chromium playwright-core already uses for the browser tests (set CHROMIUM_PATH if it isn't found).
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const MARK = "public/brand/mark.svg";
const svg = readFileSync(MARK, "utf8");
copyFileSync(MARK, "src/app/icon.svg");

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
const render = async (size) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style>` +
      `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}">`,
  );
  await page.locator("img").evaluate((img) => img.decode());
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
};

writeFileSync("src/app/apple-icon.png", await render(180));

// An .ico whose entries are PNGs (every current browser reads these).
const sizes = [16, 32, 48];
const pngs = [];
for (const s of sizes) pngs.push(await render(s));
await browser.close();
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s, e);
  header.writeUInt8(s, e + 1);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(pngs[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
writeFileSync("src/app/favicon.ico", Buffer.concat([header, ...pngs]));
console.log("Wrote src/app/icon.svg, src/app/apple-icon.png and src/app/favicon.ico from", MARK);
