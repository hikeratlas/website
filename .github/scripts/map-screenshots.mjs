// Screenshots of the map at fixed places and zooms. The map page uses
// maplibre's hash: true, so a position is #zoom/lat/lng.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.env.BASE_URL || "https://www.hikeratlas.com/map";
const out = "screenshots";
mkdirSync(out, { recursive: true });

const places = [
  { name: "garibaldi", lat: 49.95, lng: -123.04 }, // Garibaldi Lake, Black Tusk, Panorama Ridge
  { name: "ohara", lat: 51.3555, lng: -116.3345 }, // Lake O'Hara
  { name: "killarney", lat: 46.03, lng: -81.385 }, // George Lake, The Crack
];
const zooms = [9, 12, 15];
const viewports = [
  { name: "desktop", width: 1280, height: 800, zooms },
  { name: "mobile", width: 390, height: 844, zooms: [13] },
];

const browser = await chromium.launch({
  // Software WebGL so maplibre renders on a GPU-less runner.
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
let failures = 0;
for (const vp of viewports) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  page.on("pageerror", (e) => console.error(`[${vp.name}] page error:`, e.message));
  for (const p of places) {
    for (const z of vp.zooms) {
      const file = `${out}/${p.name}-z${z}-${vp.name}.png`;
      try {
        // A fresh load per shot, so tiles and labels for the old view don't linger.
        await page.goto("about:blank");
        await page.goto(`${base}#${z}/${p.lat}/${p.lng}`, { waitUntil: "load" });
        await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 30000 });
        await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(2500); // let symbol placement and fades settle
        await page.screenshot({ path: file });
        console.log("wrote", file);
      } catch (e) {
        failures++;
        console.error("failed", file, e.message);
      }
    }
  }
  await page.close();
}
await browser.close();
if (failures) process.exitCode = 1;
