/**
 * Live seam test (not part of `run.mjs`): imports the real plugin, fakes the
 * Cordis context around a WebRuntime-shaped service, and proves that
 * `ctx.web.search` is taken over for the DeepSeek slot and that the keys file
 * — not credentials or env — feeds the legs.
 *
 * Run: node test/live-takeover.mjs [query]
 */
import { apply } from "../lib/index.js";
import { readFileSync } from "node:fs";

const query = process.argv[2] ?? "DeepSeek V4 release";
const PATCH = process.env.HYBRID_PATCH ?? "/root/.dsh/profiles/web/cordis.patch.yml";
const patchKeys = () => {
  try {
    const text = readFileSync(PATCH, "utf8");
    const grab = (name) => {
      const m = text.match(new RegExp(`^\\s*${name}:\\s*"([^"]*)"`, "m"));
      return m ? m[1] : "";
    };
    return { deepseekApiKey: grab("deepseekApiKey"), exaApiKey: grab("exaApiKey") };
  } catch {
    return {};
  }
};

function makeCtx(configuredId) {
  const disposers = [];
  const providers = [];
  const originalCalls = [];
  const service = {
    config: { searchProvider: { get: () => configuredId } },
    async search() {
      originalCalls.push(true);
      throw new Error("original provider should not run");
    },
    registerSearchProvider(provider) {
      providers.push(provider);
    },
  };
  const ctx = {
    web: service,
    effect(fn) {
      disposers.push(fn());
    },
    get() {
      return undefined;
    },
    logger: { warn: (...args) => console.error("[warn]", ...args), info: () => {} },
  };
  return { ctx, service, providers, originalCalls, dispose: () => disposers.forEach((fn) => fn()) };
}

for (const id of ["deepseek-official", "deepseek-search-api", "hybrid2", undefined, "ddg"]) {
  const { ctx, service, providers, originalCalls, dispose } = makeCtx(id);
  apply(ctx, patchKeys());
  const patched = service.search !== undefined && service.search.name !== "search";
  if (id === "ddg") {
    try {
      await service.search({ query }, undefined);
      console.log(`[${id}] UNEXPECTED: hybrid answered`);
    } catch (error) {
      console.log(`[${id}] delegated to the original provider (${error.message}) · patched=${patched}`);
    }
  } else {
    const result = await service.search({ query, maxResults: 3 }, undefined);
    console.log(`[${id}] ${result.sources.length} source(s) · first=${result.sources[0]?.url ?? "(none)"} · providers=${providers.map((p) => p.id).join(",")} · originalCalls=${originalCalls.length}`);
  }
  dispose();
}
