import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";

const output = new URL("../.vercel/output/", import.meta.url);
const config = JSON.parse(await readFile(new URL("config.json", output), "utf8"));
assert.equal(config.version, 3, "Expected Vercel Build Output API version 3");

const html = await readFile(new URL("static/index.html", output), "utf8");
assert.match(html, /<title>Dayan Tabla Tuner<\/title>/, "The output must contain the tuner website");
assert.match(html, /<script[^>]+type="module"/, "The built app must load its JavaScript");

const localAssets = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)]
  .map((match) => match[1])
  .filter((asset) => !/^(?:[a-z]+:|\/\/|#)/i.test(asset));

for (const asset of localAssets) {
  const pathname = new URL(asset, "https://local.test/").pathname;
  await access(new URL(`static${pathname}`, output));
}

const functions = await readdir(new URL("functions/", output)).catch((error) => {
  if (error.code === "ENOENT") return [];
  throw error;
});
assert.equal(functions.length, 0, "The browser-only tuner must deploy as a static site, without API functions");

console.log(`Vercel output verified: tuner HTML, ${localAssets.length} assets, no server functions.`);
