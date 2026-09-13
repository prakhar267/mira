import {test,expect} from "@playwright/test";
test.beforeEach(async({context})=>{
  // Fresh isolated browser context, no real user state or provider requests.
  await context.route("**/*",route=>{const url=new URL(route.request().url());return ["127.0.0.1","localhost"].includes(url.hostname)||["data:","blob:"].includes(url.protocol)?route.continue():route.abort();});
});
for(const width of [360,390,1280])test(`landing fits ${width}px with reachable navigation`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.goto("/");
  await expect(page.getByRole("link",{name:"Start free beta",exact:true}).first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.keyboard.press("Tab");expect(await page.evaluate(()=>document.activeElement!==document.body)).toBe(true);
});
test("demo requires explicit current disclosures",async({page})=>{
  await page.goto("/demo");
  await expect(page.getByRole("checkbox").first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("recovery has labels and missing mail configuration is honest",async({page})=>{
  await page.goto("/forgot-password");await page.getByLabel("Email",{exact:true}).fill("synthetic-adult@example.test");
  await page.getByRole("button",{name:"Request reset link",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText(/not configured|unavailable/i);
});
