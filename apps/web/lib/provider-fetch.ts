/** Mock routing requires the isolated local binding, never browser input. */
export async function providerFetch(url: string, init: RequestInit) {
  const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
  const test = env as typeof env & { MIRA_TEST_PROVIDERS?: { fetch(input: string, init: RequestInit): Promise<Response> }; MIRA_LOCAL_TEST?: string; SITE_ORIGIN?: string };
  if (test.MIRA_TEST_PROVIDERS) {
    const host = new URL(test.SITE_ORIGIN ?? "https://invalid").hostname;
    if (test.MIRA_LOCAL_TEST !== "synthetic-only" || !["localhost", "127.0.0.1"].includes(host)) throw new Error("Test provider binding is not allowed outside the isolated local environment");
    return test.MIRA_TEST_PROVIDERS.fetch(url, init);
  }
  if (test.MIRA_LOCAL_TEST) throw new Error("Isolated testing requires the mock provider binding");
  return fetch(url, init);
}
