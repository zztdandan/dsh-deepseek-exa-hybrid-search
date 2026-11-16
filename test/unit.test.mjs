import assert from "node:assert/strict";
import test from "node:test";

import { apply, mergeSources, __test } from "../lib/index.js";

const { normalizeUrl, runFetch, configOf } = __test;

const realFetch = globalThis.fetch;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function textResponse(body, status = 200, contentType = "text/html; charset=utf-8") {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

function fetchOptions(overrides = {}) {
  return {
    baseURL: "https://api.deepseek.com/v1/tools",
    apiKey: "deepseek-key",
    exaBaseURL: "https://api.exa.ai",
    exaApiKey: "exa-key",
    attempts: 1,
    attemptTimeoutMs: 2000,
    delayMs: 0,
    maxBytes: 1_000_000,
    maxChars: 1000,
    log: () => {},
    ...overrides,
  };
}

test("normalizeUrl drops tracking parameters, hashes and trailing slashes", () => {
  assert.equal(normalizeUrl("https://Example.com/a/?utm_source=x&ref=y#frag"), "https://example.com/a");
  assert.equal(normalizeUrl("https://example.com/b?id=1"), "https://example.com/b?id=1");
  assert.equal(normalizeUrl("not a url"), "not a url");
});

test("mergeSources de-duplicates, prioritises cross-source hits and keeps the richer text", () => {
  const merged = mergeSources([
    {
      engine: "deepseek",
      sources: [
        { url: "https://example.com/a?utm_source=x", title: "A", snippet: "short" },
        { url: "https://example.com/b", title: "B", snippet: "b snippet" },
      ],
    },
    {
      engine: "exa",
      sources: [
        { url: "https://example.com/a", title: "A longer title", snippet: "a much longer snippet", publishedAt: "2026-01-02T00:00:00.000Z" },
        { url: "https://example.com/c", title: "C", snippet: "c snippet" },
      ],
    },
  ], 5);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].url, "https://example.com/a?utm_source=x");
  assert.equal(merged[0].title, "A longer title");
  assert.equal(merged[0].snippet, "a much longer snippet");
  assert.equal(merged[0].publishedAt, "2026-01-02T00:00:00.000Z");
});

test("mergeSources orders single-engine hits by reciprocal rank and clips long snippets", () => {
  const long = "word ".repeat(400);
  const merged = mergeSources([
    { engine: "exa", sources: [{ url: "https://example.com/first", snippet: long }, { url: "https://example.com/second" }] },
    { engine: "deepseek", sources: [{ url: "https://example.com/third" }] },
  ], 2);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].url, "https://example.com/first");
  assert.ok(merged[0].snippet.length <= 801, "snippet is clipped");
  assert.ok(merged[0].snippet.endsWith("…"));
});

test("configOf defaults both capabilities on and reads live volatile values", () => {
  const cfg = configOf({ deepseekApiKey: { get: () => "live-key" } });
  assert.equal(cfg.deepseekApiKey, "live-key");
  assert.equal(cfg.enableSearch, true);
  assert.equal(cfg.enableFetch, true);
  assert.equal(configOf({ enableSearch: false, enableFetch: false }).enableSearch, false);
});

test("runFetch tries Exa Contents first and stops when it answers", async (t) => {
  t.after(() => { globalThis.fetch = realFetch; });
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({ results: [{ url: "https://page.example/", text: "# Page\n\nbody" }] });
  };
  const result = await runFetch({ url: "https://page.example/" }, fetchOptions());
  assert.deepEqual(calls, ["https://api.exa.ai/contents"]);
  assert.equal(result.body.kind, "text");
  assert.match(result.body.content, /# Page/);
  assert.equal(result.statusCode, 200);
});

test("runFetch degrades Exa → DeepSeek → direct HTTP", async (t) => {
  t.after(() => { globalThis.fetch = realFetch; });
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("api.exa.ai")) return jsonResponse({ error: "exa down" }, 500);
    if (String(url).includes("api.deepseek.com")) return jsonResponse({ error: { message: "deepseek down" } }, 503);
    return textResponse("<html><body>direct</body></html>");
  };
  const result = await runFetch({ url: "https://page.example/" }, fetchOptions());
  assert.deepEqual(calls, [
    "https://api.exa.ai/contents",
    "https://api.deepseek.com/v1/tools/fetch",
    "https://page.example/",
  ]);
  assert.equal(result.body.kind, "html");
  assert.match(result.body.content, /direct/);
});

test("runFetch skips legs without a key and throws only when every leg fails", async (t) => {
  t.after(() => { globalThis.fetch = realFetch; });
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error("network down");
  };
  await assert.rejects(
    () => runFetch({ url: "https://page.example/" }, fetchOptions({ exaApiKey: "", apiKey: "" })),
    /all legs failed/,
  );
  assert.deepEqual(calls, ["https://page.example/"], "only the keyless fallback runs");
});

test("apply registers both providers and owns only the DeepSeek slots", async (t) => {
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async () => textResponse("stub");
  const registered = { search: [], fetch: [] };
  const effects = [];
  const web = {
    config: { searchProvider: { get: () => "" }, fetchProvider: { get: () => "" } },
    registerSearchProvider(provider) { registered.search.push(provider); },
    registerFetchProvider(provider) { registered.fetch.push(provider); },
    async search() { return { sources: [{ url: "https://builtin.example/" }] }; },
    async fetch() { return { url: "https://builtin.example/", statusCode: 200, body: { kind: "text", content: "builtin" } }; },
  };
  const ctx = {
    web,
    logger: { info: () => {}, warn: () => {} },
    effect: (fn) => effects.push(fn),
    get: () => undefined,
  };
  apply(ctx, { deepseekApiKey: "", exaApiKey: "" });
  const savedKeys = { deepseek: process.env.DEEPSEEK_API_KEY, exa: process.env.EXA_API_KEY };
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.EXA_API_KEY;

  assert.deepEqual(registered.search.map((provider) => provider.id), ["hybrid2"]);
  assert.deepEqual(registered.fetch.map((provider) => provider.id), ["hybrid2-fetch"]);
  assert.equal(effects.length, 2);

  const patchedSearch = web.search;
  const patchedFetch = web.fetch;

  // No keys: the takeover still owns the default slot and fails loudly.
  await assert.rejects(() => patchedSearch({ query: "x" }), /no API key/);
  // With no keys the fetch takeover falls back to the direct HTTP leg (stubbed here).
  assert.equal((await patchedFetch({ url: "https://builtin.example/" })).body.content, "stub");
  if (savedKeys.deepseek !== undefined) process.env.DEEPSEEK_API_KEY = savedKeys.deepseek;
  if (savedKeys.exa !== undefined) process.env.EXA_API_KEY = savedKeys.exa;

  // A deliberate non-DeepSeek provider choice is left alone.
  web.config.searchProvider.get = () => "ddg";
  assert.deepEqual(await patchedSearch({ query: "x" }), { sources: [{ url: "https://builtin.example/" }] });
  web.config.fetchProvider.get = () => "http";
  assert.equal((await patchedFetch({ url: "https://builtin.example/" })).body.content, "builtin");

  // Disposal restores the original methods.
  for (const register of effects) register(() => {})();
  assert.notEqual(web.search, patchedSearch);
  assert.notEqual(web.fetch, patchedFetch);
});

test("apply honours the per-capability switches", async () => {
  const registered = { search: [], fetch: [] };
  const web = {
    config: { searchProvider: { get: () => "" }, fetchProvider: { get: () => "" } },
    registerSearchProvider(provider) { registered.search.push(provider); },
    registerFetchProvider(provider) { registered.fetch.push(provider); },
    async search() { return { sources: [{ url: "https://builtin.example/" }] }; },
    async fetch() { return { url: "https://builtin.example/", statusCode: 200, body: { kind: "text", content: "builtin" } }; },
  };
  const ctx = { web, logger: { info: () => {}, warn: () => {} }, effect: () => {}, get: () => undefined };
  apply(ctx, { deepseekApiKey: "", exaApiKey: "", enableSearch: false, enableFetch: false });

  assert.equal(registered.search.length, 0);
  assert.equal(registered.fetch.length, 0);
  // Switched off: the built-in provider answers instead of the hybrid.
  assert.deepEqual(await web.search({ query: "x" }), { sources: [{ url: "https://builtin.example/" }] });
  assert.equal((await web.fetch({ url: "https://builtin.example/" })).body.content, "builtin");
});
