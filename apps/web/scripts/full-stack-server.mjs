import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { createServer as createHttpsServer } from "node:https";
import {
  assertIsolatedEnvironment,
  compiledModules,
  createArtifactHttpServer,
  validateCompiledConfig,
} from "./built-artifact-runtime.mjs";

// Compile production application code, then run its real routes/SQLite locally.
// Only external AI/push providers are substituted; every outbound network request
// is denied, all storage is temporary, and no owner credentials are inherited.
const cwd = resolve(import.meta.dirname, "..");
if (!process.argv.includes("--isolated-child")) {
  const prebuilt = process.argv.includes("--prebuilt");
  if (prebuilt && process.env.CI) throw Error("Prebuilt diagnostics are forbidden in CI");
  const directory = await mkdtemp(join(tmpdir(), "mira-full-stack-"));
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_CACHE_HOME: join(directory, "cache"),
    WRANGLER_REGISTRY_PATH: join(directory, "registry"),
    WRANGLER_SEND_METRICS: "false",
    CLOUDFLARE_API_TOKEN: "mira-synthetic-only-no-cloud-access",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    CI: "true",
  };
  const child = spawn(
    process.execPath,
    [import.meta.filename, "--isolated-child", ...(prebuilt ? ["--prebuilt"] : []), directory],
    { cwd, env, stdio: "inherit" },
  );
  process.once("SIGTERM", () => child.kill("SIGTERM"));
  process.once("SIGINT", () => child.kill("SIGTERM"));
  child.once("exit", (code) => {
    process.exitCode = code ?? 0;
  });
} else {
  assertIsolatedEnvironment(process.env);
  const directory = process.argv.at(-1),
    artifact = join(cwd, "dist/server/wrangler.json");
  if (process.argv.includes("--prebuilt")) {
    console.log("Using existing compiled bytes for local runtime diagnostics; not current-source release verification.");
  } else {
  const build = spawn(
    process.execPath,
    [join(cwd, "node_modules/vinext/dist/cli.js"), "build"],
    { cwd, env: process.env, stdio: "inherit" },
  );
  if (
    (await new Promise((done, reject) => {
      build.once("exit", done);
      build.once("error", reject);
    })) !== 0
  )
    throw Error("Full-stack build failed");
  }
  const require = createRequire(import.meta.url);
  const {
    unstable_readConfig,
    unstable_getMiniflareWorkerOptions,
  } = require("wrangler");
  const { Miniflare, convertV4MiniflareOptions, Response } = require(
    require.resolve("miniflare", {
      paths: [dirname(require.resolve("wrangler"))],
    }),
  );
  validateCompiledConfig(JSON.parse(await readFile(artifact, "utf8")));
  const config = unstable_readConfig({ config: artifact });
  config.userConfigPath = join(directory, "isolated.json");
  // Remove the SDK's special remote AI binding before adding the local RPC
  // service. Otherwise its generated wrapped binding shadows the mock service.
  config.ai = undefined;
  const emptyEnv = join(directory, "empty.env");
  await writeFile(emptyEnv, "# No credentials\n");
  const { workerOptions, main, externalWorkers } =
    unstable_getMiniflareWorkerOptions(config, undefined, {
      envFiles: [emptyEnv],
      overrides: { enableContainers: false },
    });
  if (externalWorkers.length) throw Error("Unexpected external workers");
  const { modulesRules, ...sourceFree } = workerOptions;
  void modulesRules;
  const providerName = "mira-full-stack-synthetic-providers";
  const denyEgress = () =>
    new Response("External network forbidden", { status: 503 });
  const worker = {
    ...sourceFree,
    name: config.name,
    modules: await compiledModules(dirname(artifact), main),
    modulesRoot: dirname(artifact),
    bindings: {
      ...workerOptions.bindings,
      SITE_ORIGIN: "https://127.0.0.1:4398",
      MIRA_LOCAL_TEST: "synthetic-only",
      MIRA_INFERENCE_DISABLED: "false",
      INWORLD_API_KEY: "synthetic-not-a-secret",
      BILLING_ENABLED: "false",
    },
    serviceBindings: {
      ...workerOptions.serviceBindings,
      AI: { name: providerName, entrypoint: "MockAI" },
      MIRA_TEST_PROVIDERS: { name: providerName, entrypoint: "MockProviders" },
    },
    unsafeRegisterWorker: false,
    outboundService: denyEgress,
  };
  const providerPath = join(cwd, "tests/worker/mock-providers.mjs");
  const provider = {
    name: providerName,
    modules: [{ type: "ESModule", path: providerPath }],
    modulesRoot: dirname(providerPath),
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    unsafeRegisterWorker: false,
    outboundService: denyEgress,
  };
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      host: "127.0.0.1",
      port: 0,
      cf: false,
      unsafeLocalExplorer: false,
      isolatedResourcePersistencePath: join(directory, "state"),
      resourceTmpPath: join(directory, "tmp"),
      unsafeDevRegistryPath: join(directory, "registry"),
      telemetry: { enabled: false },
      workers: [worker, provider],
    }),
  );
  await runtime.ready;
  // HTTPS exercises genuine Secure + __Host session cookies in every browser.
  // The certificate is generated locally and trusted only by the test context.
  const certificate = join(directory, "localhost.pem"),
    privateKey = join(directory, "localhost-key.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      privateKey,
      "-out",
      certificate,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  const tls = {
    key: await readFile(privateKey),
    cert: await readFile(certificate),
  };
  const server = createArtifactHttpServer(runtime.dispatchFetch, {
    serverFactory: (handler) => createHttpsServer(tls, handler),
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(4398, "127.0.0.1", done);
  });
  console.log("Full-stack synthetic runtime ready on https://127.0.0.1:4398");
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await runtime.dispose();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
