/**
 * dsh-deepseek-exa-hybrid-search — a DSH `ctx.web` search provider that queries DeepSeek's
 * native Anthropic-format web_search and Exa's /search in parallel, then merges
 * both ranked lists into one de-duplicated, cross-source-first list.
 *
 * Keys are ordinary plugin config (`deepseekApiKey`/`exaApiKey`) stored as
 * plain text in the profile's cordis.patch.yml, with ctx.credentials and the
 * process environment as fallbacks. Precedence: config value > credentials > env.
 *
 * The plugin also takes over `ctx.web.search` for the DeepSeek provider ids,
 * so the web-search settings card can flip between "official" and "search API"
 * (or lose its `- id: web` entry entirely) without unplugging the hybrid.
 */

import z from "@deepseek-ai/schemastery";

export const name = "dsh-deepseek-exa-hybrid-search";
export const inject = ["web"];

const DEFAULTS = {
  deepseekBackend: "search-api",
  deepseekSearchApiBaseURL: "https://api.deepseek.com/v1/tools",
  deepseekAnthropicBaseURL: "https://api.deepseek.com/anthropic/v1",
  deepseekModel: "deepseek-v4-flash",
  deepseekApiVersion: "2023-06-01",
  deepseekMaxTokens: 4096,
  deepseekMaxUses: 5,
  deepseekApiKeyEnv: "DEEPSEEK_API_KEY",
  exaBaseURL: "https://api.exa.ai",
  exaSearchType: "auto",
  exaApiKeyEnv: "EXA_API_KEY",
  timeoutMs: 25000,
  rrfK: 60,
  maxSnippetChars: 800,
  exaAttempts: 3,
  exaAttemptTimeoutMs: 6000,
  deepseekAttempts: 2,
  deepseekAttemptTimeoutMs: 8000,
  retryDelayMs: 300,
};

const TRACKING_PARAMS = new Set([
  "ref", "ref_src", "source", "spm", "from", "share_source", "share_medium",
]);

/** Plugin settings. These two fields are stored in the profile patch as plain text by choice. */
export const Config = z.object({
  deepseekApiKey: z.string().default("").description("DeepSeek Search API key（明文存在 profile 的 cordis.patch.yml）").volatile(),
  exaApiKey: z.string().default("").description("Exa API key（明文存在 profile 的 cordis.patch.yml）").volatile(),
});

/**
 * Resolve one API key: explicit config value, then the harness credentials
 * service, then the process environment.
 * @returns {{value: string, source: "config"|"credentials"|"env"|"none"}}
 */
async function resolveSecret(ctx, refName, literal) {
  if (typeof literal === "string" && literal.trim().length > 0) return { value: literal.trim(), source: "config" };
  const credentials = ctx.get?.("credentials");
  if (credentials?.resolve !== undefined) {
    try {
      const resolved = await credentials.resolve(refName);
      const value = resolved?.value;
      if (typeof value === "string" && value.trim().length > 0) return { value: value.trim(), source: "credentials" };
    } catch {
      // an unregistered ref falls through to the process environment
    }
  }
  const ambient = process.env[refName];
  if (typeof ambient === "string" && ambient.trim().length > 0) return { value: ambient.trim(), source: "env" };
  return { value: "", source: "none" };
}

function normalizeUrl(raw) {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    let out = url.toString();
    if (out.endsWith("/") && url.pathname !== "/") out = out.slice(0, -1);
    return out;
  } catch {
    return raw;
  }
}

function pickLonger(current, next) {
  if (typeof next !== "string" || next.trim().length === 0) return current;
  if (typeof current !== "string" || current.trim().length === 0) return next;
  return next.length > current.length ? next : current;
}

/** Keep result snippets short enough for a phone-sized context window. */
function clipSnippet(text, maxChars) {
  if (typeof text !== "string" || maxChars <= 0 || text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > maxChars * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(error) {
  return error?.cause?.code ?? error?.code ?? "";
}

function isRetryable(error) {
  const code = errorCode(error);
  if (["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(code)) return true;
  if (error?.name === "TimeoutError") return true;
  return /fetch failed|timed out|socket|network/i.test(String(error?.message ?? ""));
}

/**
 * One HTTP request with bounded per-attempt timeouts and retries for network
 * failures / gateway errors. Retries only while the caller's signal is alive.
 */
async function fetchWithRetry(url, init, options = {}) {
  const attempts = Math.max(1, options.attempts ?? 2);
  const delayMs = Math.max(0, options.delayMs ?? 300);
  const attemptTimeoutMs = Math.max(1000, options.attemptTimeoutMs ?? 8000);
  const label = options.label ?? "request";
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) throw new Error(`${label}: aborted`);
    const timeoutSignal = AbortSignal.timeout(attemptTimeoutMs);
    const attemptSignal = options.signal === undefined ? timeoutSignal : AbortSignal.any([options.signal, timeoutSignal]);
    try {
      const response = await fetch(url, { ...init, signal: attemptSignal });
      if ([502, 503, 504].includes(response.status) && attempt < attempts) {
        lastError = new Error(`${label}: HTTP ${response.status}`);
        options.log?.(`${label}: HTTP ${response.status} on attempt ${attempt}/${attempts}, retrying`);
        await sleep(delayMs * attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) throw new Error(`${label}: aborted`);
      if (attempt < attempts && isRetryable(error)) {
        options.log?.(`${label}: ${errorCode(error) || error?.message || "network error"} on attempt ${attempt}/${attempts}, retrying`);
        await sleep(delayMs * attempt);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * Merge per-engine ranked source lists. Every entry contributes reciprocal-rank
 * points; entries that both engines returned therefore outrank single-engine
 * hits. URLs are normalized, snippets/titles keep the richer variant.
 *
 * @param {{engine: string, sources: Array<object>}[]} lists
 * @param {number} maxResults
 * @param {number} [rrfK]
 */
export function mergeSources(lists, maxResults, rrfK = DEFAULTS.rrfK, maxSnippetChars = DEFAULTS.maxSnippetChars) {
  const byUrl = new Map();
  const entries = [];
  for (const { engine, sources } of lists) {
    sources.forEach((source, rank) => {
      const key = normalizeUrl(source.url);
      let entry = byUrl.get(key);
      if (entry === undefined) {
        entry = {
          url: source.url,
          title: source.title,
          snippet: source.snippet,
          publishedAt: source.publishedAt,
          engines: new Set(),
          score: 0,
          first: entries.length,
        };
        byUrl.set(key, entry);
        entries.push(entry);
      }
      entry.engines.add(engine);
      entry.score += 1 / (rrfK + rank + 1);
      entry.title = pickLonger(entry.title, source.title);
      entry.snippet = pickLonger(entry.snippet, source.snippet);
      if (entry.publishedAt === undefined && source.publishedAt !== undefined) {
        entry.publishedAt = source.publishedAt;
      } else if (
        typeof source.publishedAt === "string" &&
        source.publishedAt.includes("T") &&
        !String(entry.publishedAt ?? "").includes("T")
      ) {
        entry.publishedAt = source.publishedAt;
      }
    });
  }
  return entries
    // cross-source hits first, then reciprocal-rank score, then original order
    .sort((a, b) => (b.engines.size - a.engines.size) || (b.score - a.score) || (a.first - b.first))
    .slice(0, Math.max(1, maxResults))
    .map((entry) => ({
      url: entry.url,
      ...(entry.title === undefined ? {} : { title: entry.title }),
      ...(entry.snippet === undefined ? {} : { snippet: clipSnippet(entry.snippet, maxSnippetChars) }),
      ...(entry.publishedAt === undefined ? {} : { publishedAt: entry.publishedAt }),
    }));
}

function citationSnippets(blocks) {
  const snippets = new Map();
  for (const block of blocks) {
    if (block?.type !== "text") continue;
    for (const citation of block.citations ?? []) {
      if (citation.url && citation.cited_text && !snippets.has(citation.url)) {
        snippets.set(citation.url, citation.cited_text);
      }
    }
  }
  return snippets;
}

function mapDeepSeekResponse(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const resultBlocks = blocks.filter((block) => block?.type === "web_search_tool_result");
  if (resultBlocks.length === 0) {
    throw new Error("DeepSeek returned no web_search_tool_result blocks");
  }
  const snippets = citationSnippets(blocks);
  const seen = new Set();
  const sources = [];
  for (const block of resultBlocks) {
    for (const item of block.content ?? []) {
      if (item?.type !== "web_search_result" || typeof item.url !== "string" || item.url.length === 0) continue;
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      sources.push({
        url: item.url,
        ...(item.title ? { title: item.title } : {}),
        ...(snippets.get(item.url) ? { snippet: snippets.get(item.url) } : {}),
        ...(item.page_age ? { publishedAt: item.page_age } : {}),
      });
    }
  }
  return sources;
}

function mapDeepSeekSearchApiResponse(payload) {
  if (!Array.isArray(payload?.results)) {
    throw new Error("DeepSeek Search API returned no results array");
  }
  return payload.results
    .map((item) => ({
      url: item?.url,
      ...(item?.title ? { title: item.title } : {}),
      ...(item?.snippet ? { snippet: item.snippet } : {}),
      ...(item?.date ? { publishedAt: item.date } : {}),
    }))
    .filter((source) => typeof source.url === "string" && source.url.length > 0);
}

/** Direct DeepSeek Search API (POST /v1/tools/search) — no model turn. */
async function deepSeekSearchApi(query, maxResults, options, signal) {
  const endpoint = `${options.baseURL.replace(/\/+$/u, "")}/search`;
  const response = await fetchWithRetry(endpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      "x-api-key": options.apiKey,
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "deepseek-harness/hybrid-search",
    },
    body: JSON.stringify({
      query,
      count: Math.min(50, Math.max(1, maxResults)),
      need_content: false,
    }),
  }, {
    attempts: options.attempts,
    delayMs: options.delayMs,
    attemptTimeoutMs: options.attemptTimeoutMs,
    signal,
    label: "DeepSeek Search API",
    log: options.log,
  });
  if (!response.ok) {
    let detail = "";
    try {
      const parsed = await response.json();
      detail = parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? "";
    } catch {
      // keep the status-only message
    }
    throw new Error(`DeepSeek Search API failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return mapDeepSeekSearchApiResponse(await response.json());
}

async function deepSeekSearch(query, maxResults, options, signal) {
  const endpoint = `${options.baseURL.replace(/\/+$/u, "")}/messages`;
  const body = {
    model: options.model,
    max_tokens: options.maxTokens,
    messages: [{
      role: "user",
      content: [{ type: "text", text: `Perform a web search for the query: ${query}` }],
    }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: options.maxUses }],
    thinking: { type: "disabled" },
  };
  const response = await fetchWithRetry(endpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      "x-api-key": options.apiKey,
      authorization: `Bearer ${options.apiKey}`,
      "anthropic-version": options.apiVersion,
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "deepseek-harness/hybrid-search",
    },
    body: JSON.stringify(body),
  }, {
    attempts: options.attempts,
    delayMs: options.delayMs,
    attemptTimeoutMs: options.attemptTimeoutMs,
    signal,
    label: "DeepSeek Anthropic web_search",
    log: options.log,
  });
  if (!response.ok) {
    let detail = "";
    try {
      const parsed = await response.json();
      detail = parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? "";
    } catch {
      // keep the status-only message
    }
    throw new Error(`DeepSeek search failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return mapDeepSeekResponse(await response.json());
}

async function exaSearch(query, maxResults, options, signal) {
  const response = await fetchWithRetry(`${options.baseURL.replace(/\/+$/u, "")}/search`, {
    method: "POST",
    redirect: "error",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "deepseek-harness/hybrid-search",
    },
    body: JSON.stringify({
      query,
      type: options.searchType,
      contents: { highlights: { highlightsPerUrl: 1 } },
      numResults: Math.max(1, maxResults),
    }),
  }, {
    attempts: options.attempts,
    delayMs: options.delayMs,
    attemptTimeoutMs: options.attemptTimeoutMs,
    signal,
    label: "Exa",
    log: options.log,
  });
  if (!response.ok) {
    let detail = "";
    try {
      const parsed = await response.json();
      detail = parsed?.error ?? parsed?.message ?? "";
    } catch {
      // keep the status-only message
    }
    throw new Error(`Exa search failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const payload = await response.json();
  return (payload?.results ?? [])
    .map((result) => {
      const snippet = result?.highlights?.find((highlight) => typeof highlight === "string" && highlight.trim().length > 0);
      return {
        url: result.url,
        ...(result.title ? { title: result.title } : {}),
        ...(snippet ? { snippet } : {}),
        ...(result.publishedDate ? { publishedAt: result.publishedDate } : {}),
      };
    })
    .filter((source) => typeof source.url === "string" && source.url.length > 0);
}

/** Volatile schema fields arrive as live refs; read their current value. */
function plainValue(value) {
  return value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
}

function configOf(config) {
  return {
    deepseekBackend: config?.deepseekBackend ?? DEFAULTS.deepseekBackend,
    deepseekBaseURL: config?.deepseekBaseURL ?? ((config?.deepseekBackend ?? DEFAULTS.deepseekBackend) === "anthropic" ? DEFAULTS.deepseekAnthropicBaseURL : DEFAULTS.deepseekSearchApiBaseURL),
    deepseekModel: config?.deepseekModel ?? DEFAULTS.deepseekModel,
    deepseekApiVersion: config?.deepseekApiVersion ?? DEFAULTS.deepseekApiVersion,
    deepseekMaxTokens: config?.deepseekMaxTokens ?? DEFAULTS.deepseekMaxTokens,
    deepseekMaxUses: config?.deepseekMaxUses ?? DEFAULTS.deepseekMaxUses,
    deepseekApiKey: plainValue(config?.deepseekApiKey),
    deepseekApiKeyEnv: config?.deepseekApiKeyEnv ?? DEFAULTS.deepseekApiKeyEnv,
    exaBaseURL: config?.exaBaseURL ?? DEFAULTS.exaBaseURL,
    exaSearchType: config?.exaSearchType ?? DEFAULTS.exaSearchType,
    exaApiKey: plainValue(config?.exaApiKey),
    exaApiKeyEnv: config?.exaApiKeyEnv ?? DEFAULTS.exaApiKeyEnv,
    timeoutMs: config?.timeoutMs ?? DEFAULTS.timeoutMs,
    rrfK: config?.rrfK ?? DEFAULTS.rrfK,
    maxSnippetChars: config?.maxSnippetChars ?? DEFAULTS.maxSnippetChars,
    exaAttempts: config?.exaAttempts ?? DEFAULTS.exaAttempts,
    exaAttemptTimeoutMs: config?.exaAttemptTimeoutMs ?? DEFAULTS.exaAttemptTimeoutMs,
    deepseekAttempts: config?.deepseekAttempts ?? DEFAULTS.deepseekAttempts,
    deepseekAttemptTimeoutMs: config?.deepseekAttemptTimeoutMs ?? DEFAULTS.deepseekAttemptTimeoutMs,
    retryDelayMs: config?.retryDelayMs ?? DEFAULTS.retryDelayMs,
  };
}

export function apply(ctx, config = {}) {
  /** One hybrid search call, shared by the registered provider and the takeover. */
  const runSearch = async (request, signal) => {
      const cfg = configOf(config);
      const query = typeof request?.query === "string" ? request.query.trim() : "";
      if (query.length === 0) throw new Error("hybrid-search: query is empty");
      const maxResults = Number.isInteger(request?.maxResults) && request.maxResults > 0 ? request.maxResults : 8;

      const [deepseekSecret, exaSecret] = await Promise.all([
        resolveSecret(ctx, cfg.deepseekApiKeyEnv, cfg.deepseekApiKey),
        resolveSecret(ctx, cfg.exaApiKeyEnv, cfg.exaApiKey),
      ]);
      const deepseekKey = deepseekSecret.value;
      const exaKey = exaSecret.value;

      const controllers = [];
      const timeoutController = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        timeoutController.abort(new Error("hybrid-search timed out"));
      }, cfg.timeoutMs);
      timer.unref?.();
      if (signal !== undefined) {
        const forward = () => timeoutController.abort(signal.reason);
        if (signal.aborted) forward();
        else signal.addEventListener("abort", forward, { once: true });
        controllers.push(() => signal.removeEventListener("abort", forward));
      }
      const callSignal = timeoutController.signal;

      const tasks = [];
      if (deepseekKey.length > 0) {
        tasks.push({
          engine: "deepseek",
          run: () => cfg.deepseekBackend === "anthropic"
            ? deepSeekSearch(query, maxResults, {
              baseURL: cfg.deepseekBaseURL,
              model: cfg.deepseekModel,
              apiVersion: cfg.deepseekApiVersion,
              maxTokens: cfg.deepseekMaxTokens,
              maxUses: cfg.deepseekMaxUses,
              apiKey: deepseekKey,
              attempts: cfg.deepseekAttempts,
              attemptTimeoutMs: cfg.deepseekAttemptTimeoutMs,
              delayMs: cfg.retryDelayMs,
              log: (message) => ctx.logger?.warn?.(`hybrid-search: ${message}`),
            }, callSignal)
            : deepSeekSearchApi(query, maxResults, {
              baseURL: cfg.deepseekBaseURL,
              apiKey: deepseekKey,
              attempts: cfg.deepseekAttempts,
              attemptTimeoutMs: cfg.deepseekAttemptTimeoutMs,
              delayMs: cfg.retryDelayMs,
              log: (message) => ctx.logger?.warn?.(`hybrid-search: ${message}`),
            }, callSignal),
        });
      }
      if (exaKey.length > 0) {
        tasks.push({
          engine: "exa",
          run: () => exaSearch(query, maxResults, {
            baseURL: cfg.exaBaseURL,
            searchType: cfg.exaSearchType,
            apiKey: exaKey,
            attempts: cfg.exaAttempts,
            attemptTimeoutMs: cfg.exaAttemptTimeoutMs,
            delayMs: cfg.retryDelayMs,
            log: (message) => ctx.logger?.warn?.(`hybrid-search: ${message}`),
          }, callSignal),
        });
      }
      if (tasks.length === 0) {
        clearTimeout(timer);
        throw new Error(`hybrid-search: no API key — set DeepSeek / Exa keys in 设置 → 插件 → dsh-deepseek-exa-hybrid-search, or put ${cfg.deepseekApiKeyEnv}/${cfg.exaApiKeyEnv} in the environment`);
      }

      try {
        const settled = await Promise.allSettled(tasks.map((task) => task.run()));
        if (signal?.aborted === true) {
          throw new Error("hybrid-search: aborted");
        }
        const lists = [];
        const failures = [];
        settled.forEach((outcome, index) => {
          const engine = tasks[index].engine;
          if (outcome.status === "fulfilled") {
            lists.push({ engine, sources: outcome.value });
          } else {
            failures.push(`${engine}: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`);
            ctx.logger?.warn?.(`hybrid-search: ${engine} leg failed: ${failures.at(-1)}`);
          }
        });
        if (lists.length === 0) {
          throw new Error(`hybrid-search: both legs failed${timedOut ? " (timed out)" : ""} (${failures.join("; ")})`);
        }
        if (timedOut) {
          ctx.logger?.warn?.("hybrid-search: timed out; returning the legs that already answered");
        }
        return { sources: mergeSources(lists, maxResults, cfg.rrfK, cfg.maxSnippetChars), truncated: false };
      } finally {
        clearTimeout(timer);
        for (const dispose of controllers) dispose();
      }
  };

  // Register under our own id too, so `searchProvider: hybrid2` works. A
  // duplicate entry (settings rewrites, double apply) must not kill the plugin:
  // the takeover below is what actually serves searches.
  try {
    ctx.web.registerSearchProvider({
      id: "hybrid2",
      available: () => true,
      search: runSearch,
    });
  } catch (error) {
    ctx.logger?.warn?.(`hybrid-search: provider "hybrid2" already registered (${error?.message ?? error}); keeping the search-slot takeover`);
  }

  // Own the DeepSeek search slot regardless of what the profile patch or the
  // web-search settings card writes. Any other explicit provider id is left
  // alone, so a deliberate non-DeepSeek choice still wins.
  const web = ctx.web;
  const originalSearch = web?.search;
  const DEEPSEEK_SLOT = new Set(["", "hybrid2", "deepseek-official", "deepseek-search-api"]);
  if (typeof originalSearch === "function") {
    const patchedSearch = async (request, signal) => {
      let configured;
      try {
        configured = web?.config?.searchProvider?.get?.();
      } catch {
        configured = undefined;
      }
      if (typeof configured === "string" && !DEEPSEEK_SLOT.has(configured)) {
        return originalSearch.call(web, request, signal);
      }
      return runSearch(request, signal);
    };
    try {
      web.search = patchedSearch;
      ctx.effect(() => () => {
        if (web.search === patchedSearch) web.search = originalSearch;
      }, "hybrid-search: own the DeepSeek search slot");
      ctx.logger?.info?.("hybrid-search: serving ctx.web.search (deepseek + exa)");
    } catch (error) {
      ctx.logger?.warn?.(`hybrid-search: cannot patch ctx.web.search (${error?.message ?? error}); set web.searchProvider=hybrid2 instead`);
    }
  }

}

/** Internal seams used by the offline test harness only. */
export const __test = { deepSeekSearch, deepSeekSearchApi, exaSearch, normalizeUrl, configOf };
