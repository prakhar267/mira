import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { coldMobilePage, enterDemo, observeAvatar, observeInteractions, recordInteraction, sampleAvatarCadence, syntheticCallMedia } from '../tests/performance/lab-fixtures.mjs';

if (process.env.CI || process.platform !== 'darwin') throw Error('This is a local macOS Metal diagnostic, not a CI or physical-phone acceptance test.');
const cwd = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(cwd, 'package.json'));
const { chromium, expect } = require('@playwright/test');
const output = await mkdtemp(join(tmpdir(), 'mira-avatar-metal-'));
const slowNetwork = process.argv.includes('--slow-network');
const prefix = slowNetwork ? 'metal-slow-network' : 'metal';
const directory = await mkdtemp(join(tmpdir(), 'mira-metal-runtime-'));
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
  XDG_CONFIG_HOME: join(directory, 'config'), XDG_CACHE_HOME: join(directory, 'cache'),
  CLOUDFLARE_API_TOKEN: 'mira-synthetic-only-no-cloud-access', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
  WRANGLER_SEND_METRICS: 'false', CI: 'true' };
const runtime = spawn(process.execPath, [join(cwd, 'scripts/built-artifact-runtime.mjs'),
  join(cwd, 'dist/server/wrangler.json'), directory, '4397'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
let runtimeOutput = '';
runtime.stdout.on('data', chunk => { runtimeOutput = (runtimeOutput + chunk).slice(-12000); });
runtime.stderr.on('data', chunk => { runtimeOutput = (runtimeOutput + chunk).slice(-12000); });
let browser, context;
const evidence = { at: new Date().toISOString(), sourceArtifact: 'Local compiled app; this is not proof of a sealed release or a deployment',
  conditions: 'Headless Chromium with ANGLE Metal on this Apple M4 Mac; 393x851 mobile emulation, DPR1, no CPU throttle, loopback network. Actual GPU, synthetic audio and microphone. Not an iPhone or an acoustic test.',
  network: slowNetwork ? 'After demo entry, CDP shaped loopback: 1.6 Mbps down, 0.8 Mbps up, 150ms latency; cold cache. Not a physical cellular connection.' : 'Unshaped loopback',
  providerRequests: 0, realMicrophoneRequests: 0, samples: [], passed: false };
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (runtime.exitCode !== null) throw Error('Isolated runtime exited before readiness');
    try { const r = await fetch('http://127.0.0.1:4397/api/health', { signal: AbortSignal.timeout(1000) }); if (r.ok) { await r.arrayBuffer(); ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Isolated runtime not ready');
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
  const lab = await coldMobilePage(browser, 1); context = lab.context;
  const { page, requests } = lab; page.setDefaultTimeout(20000);
  await syntheticCallMedia(page); await observeAvatar(page); await observeInteractions(page);
  await enterDemo(page);
  await page.getByRole('button', { name: 'Chat', exact: true }).tap();
  if (slowNetwork) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150,
      downloadThroughput: 200000, uploadThroughput: 100000, connectionType: 'cellular3g' });
  }
  const start = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: 'Start video call with Mira', exact: true }).tap();
  await expect(page.locator('.live-avatar-3d--ready')).toBeVisible({ timeout: 90000 });
  const load = await page.evaluate(() => ({ ...window.__miraAvatarLab }));
  assert.match(load.renderer, /Apple M4/);
  evidence.load = { ...load, callToReadyMs: load.readyAt - start };
  await expect(page.locator('.video-call__status')).toContainText('Mira is speaking');
  evidence.samples.push(await sampleAvatarCadence(page, 'metal-synthetic-speaking'));
  await page.screenshot({ path: join(output, `${prefix}-speaking-mobile.png`) });
  await page.evaluate(() => window.__miraLabMedia.activeAudio.finish());
  await expect(page.getByRole('button', { name: 'Listening automatically', exact: true })).toBeVisible();
  evidence.samples.push(await sampleAvatarCadence(page, 'metal-synthetic-listening'));
  await expect(page.locator('.live-avatar-3d--ready')).toBeVisible();
  assert.ok(evidence.samples.every(sample => sample.drawCalls > 0));
  await page.screenshot({ path: join(output, `${prefix}-listening-mobile.png`) });
  await recordInteraction(page, 'metal-end-video-call', () => page.getByRole('button', { name: 'End video call', exact: true }).tap(),
    () => expect(page.getByRole('dialog', { name: 'Video call with Mira', exact: true })).toHaveCount(0));
  const draws = await page.evaluate(() => window.__miraAvatarLab.drawCalls);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__miraAvatarLab.drawCalls), draws);
  evidence.final = await page.evaluate(() => ({ avatar: window.__miraAvatarLab, interactions: window.__miraInteractionLab.actions,
    media: { requested: window.__miraLabMedia.requested, stopped: window.__miraLabMedia.stopped, activeTracks: window.__miraLabMedia.activeTracks, cameraRequested: window.__miraLabMedia.cameraRequested } }));
  assert.equal(evidence.final.media.activeTracks, 0);
  assert.equal(evidence.final.media.requested, evidence.final.media.stopped);
  assert.equal(evidence.final.media.cameraRequested, 0);
  assert.deepEqual(requests, { session: 1, chat: 0, speech: 1, unexpected: [] });
  evidence.assets = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter(entry => /\.(?:vrm|glb|mesh)(?:\.(?:gz|br))?$/.test(new URL(entry.name).pathname)).map(entry => ({ path: new URL(entry.name).pathname,
      durationMs: entry.duration, bytes: entry.decodedBodySize, encodedBytes: entry.encodedBodySize, transferBytes: entry.transferSize })));
  evidence.syntheticRequests = requests; evidence.passed = true;
} catch (error) { evidence.error = error.message; process.exitCode = 1; }
finally {
  await context?.close(); await browser?.close();
  runtime.kill('SIGTERM');
  await Promise.race([new Promise(resolve => runtime.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
  if (runtime.exitCode === null && runtime.signalCode === null) runtime.kill('SIGKILL');
  await writeFile(join(output, `${prefix}-gpu-evidence.json`), JSON.stringify(evidence, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ passed: evidence.passed, error: evidence.error, renderer: evidence.load?.renderer,
    readyMs: evidence.load?.callToReadyMs, samples: evidence.samples.map(({ label, drawCalls, medianRAFIntervalMs, maxRAFIntervalMs }) => ({ label, drawCalls, medianRAFIntervalMs, maxRAFIntervalMs })),
    cleanup: evidence.final?.media, assets: evidence.assets, network: evidence.network,
    evidence: join(output, `${prefix}-gpu-evidence.json`) }, null, 2));
}
