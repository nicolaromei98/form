// The route move (plan §1.1, step 3; §12 item 18): the app is served at /demo, and "/" answers a
// temporary 307 to it until Phase 2 replaces the redirect with the public intro.
// Builds from before the move (baseline A, served at "/") skip this file.
import { expect, test } from "@playwright/test";
import { APP_PATH } from "./env";

test.skip(APP_PATH !== "/demo", "This build predates the route move: the app is served at /");

test("GET / answers 307 → /demo", async ({ request }) => {
  const res = await request.get("/", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers()["location"]).toBe("/demo");
  // Temporary: nothing should let a browser or a CDN keep "/" pointing at /demo after Phase 2
  expect(res.headers()["cache-control"] ?? "").not.toMatch(/immutable|max-age=[1-9]/);
});

test("the redirect keeps the query string", async ({ request }) => {
  const res = await request.get("/?view=board", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers()["location"]).toBe("/demo?view=board");
});

test("GET /demo answers 200 with the app's document", async ({ request }) => {
  const res = await request.get("/demo", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/html");
  expect(await res.text()).toContain("<title>FORM — The Living Interface</title>");
});

test("a browser opening / lands on /demo with the app mounted", async ({ page, baseURL }) => {
  const res = await page.goto("/", { waitUntil: "load" });
  expect(new URL(page.url()).pathname).toBe("/demo");
  expect(res?.status()).toBe(200);
  const hop = res?.request().redirectedFrom();
  expect(hop?.url()).toBe(`${baseURL}/`);
  expect((await hop?.response())?.status()).toBe(307);
  // ClientRoot draws the app after mount; its sr-only h1 comes first
  await expect(page.locator("main h1")).toBeAttached();
});
