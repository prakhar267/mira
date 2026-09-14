import { test, expect } from "@playwright/test";

test("landing artwork decodes without original PNG downloads or app prefetch", async ({ page, context }) => {
  const requests = [];
  await context.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  page.on("request", request => requests.push(new URL(request.url()).pathname));
  await page.goto("/");
  const hero = page.locator(".marketing-hero__scene");
  await expect(hero).toBeVisible();
  expect(await hero.evaluate(async image => { await image.decode(); return [image.naturalWidth, image.naturalHeight]; })).toEqual([1536, 1024]);
  expect(requests.some(path => /CompanionApp|\.(?:vrm|glb)$/.test(path))).toBe(false);
  const portrait = page.getByRole("img", { name: "Mira, an original AI companion avatar" });
  await portrait.scrollIntoViewIfNeeded();
  // Scrolling does not synchronously start a native lazy-image request.
  // Calling decode before the browser discovers it can reject with no request.
  await expect.poll(() => portrait.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await portrait.evaluate(async image => { await image.decode(); return [image.naturalWidth, image.naturalHeight]; })).toEqual([768, 768]);
  expect(requests.filter(path => /\/(?:loft-morning|portrait)\.png$/.test(path))).toEqual([]);
  await expect(page.getByRole("link", { name: "Start free beta", exact: true }).first()).toHaveAttribute("href", "/demo");
});
