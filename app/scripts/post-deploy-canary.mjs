const origin = String(process.argv[2] || "").replace(/\/$/, "");
if (!/^https:\/\//.test(origin)) {
  throw new Error("Usage: node scripts/post-deploy-canary.mjs https://reviewed-origin.example");
}

const token = Array.from(crypto.getRandomValues(new Uint8Array(48)), (byte) => byte.toString(16).padStart(2, "0")).join("");
const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
let bootstrapped = false;
let deleted = false;

async function request(path, options = {}, expected = [200]) {
  const response = await fetch(`${origin}/api/v1${path}`, options);
  const body = await response.json().catch(() => null);
  if (!expected.includes(response.status)) {
    throw new Error(`${path} returned ${response.status}: ${body?.error?.code || "unexpected_response"}`);
  }
  return body?.data ?? body;
}

try {
  const session = await request("/auth/demo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientAccessToken: token,
      displayName: "Release canary",
      timezone: "Asia/Kolkata",
      language: "en",
      ageConfirmed: true,
      consents: {
        chatStorage: true,
        aiProcessing: true,
        memory: false,
        proactiveFollowups: false,
        moodInference: false,
      },
    }),
  }, [201]);
  bootstrapped = true;
  if (!session?.authenticated || session?.user?.displayName !== "Release canary") throw new Error("bootstrap contract mismatch");

  const chat = await request("/chat", {
    method: "POST",
    headers: { ...headers, "idempotency-key": `canary-${crypto.randomUUID()}` },
    body: JSON.stringify({ content: "Release canary: help me make one small test plan.", clientMessageId: crypto.randomUUID() }),
  }, [201]);
  if (!chat?.assistantMessage?.id || !chat?.conversation?.id) throw new Error("chat persistence contract mismatch");

  const exported = await request("/data/export", { method: "POST", headers, body: "{}" });
  if (exported?.status !== "ready" || exported?.export?.user?.displayName !== "Release canary") {
    throw new Error("export contract mismatch");
  }

  const receipt = await request("/data/delete", {
    method: "POST",
    headers,
    body: JSON.stringify({ confirmation: "DELETE" }),
  });
  deleted = true;
  if (receipt?.status !== "deleted" || !receipt?.id) throw new Error("deletion receipt contract mismatch");

  await request("/session", { headers }, [401]);
  const replay = await request("/data/delete", {
    method: "POST",
    headers,
    body: JSON.stringify({ confirmation: "DELETE" }),
  });
  if (replay?.id !== receipt.id) throw new Error("deletion retry contract mismatch");
  process.stdout.write("Post-deploy canary passed: bootstrap, chat, export, deletion, and deletion retry.\n");
} finally {
  if (bootstrapped && !deleted) {
    await fetch(`${origin}/api/v1/data/delete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ confirmation: "DELETE" }),
    }).catch(() => undefined);
  }
}
