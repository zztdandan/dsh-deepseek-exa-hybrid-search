import { apply, mergeSources, __test } from "../lib/index.js";
import { readFileSync } from "node:fs";

const PATCH = process.env.HYBRID_PATCH ?? "/root/.dsh/profiles/web/cordis.patch.yml";
function patchKey(name) {
  try {
    const text = readFileSync(PATCH, "utf8");
    const m = text.match(new RegExp(`^\\s*${name}:\\s*"([^"]*)"`, "m"));
    return m ? m[1] : "";
  } catch {
    return "";
  }
}
const secrets = {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? patchKey("deepseekApiKey"),
  EXA_API_KEY: process.env.EXA_API_KEY ?? patchKey("exaApiKey"),
};

function makeCtx() {
  const providers = [];
  const ctx = {
    web: { registerSearchProvider(provider) { providers.push(provider); } },
    get(service) {
      if (service !== "credentials") return undefined;
      return {
        async resolve(ref) {
          const value = secrets[ref];
          return value ? { value } : undefined;
        },
      };
    },
    logger: { warn: (...args) => console.error("[warn]", ...args) },
  };
  return { ctx, providers };
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

function report(label, result) {
  console.log(`${label}: ${result.length} sources`);
  for (const source of result.slice(0, 5)) {
    console.log(`  - ${String(source.title ?? "(no title)").slice(0, 58)} | ${source.url.slice(0, 78)}`);
  }
}

async function main() {
  // 1. merge semantics: URL normalization, dedupe, cross-source priority, snippet choice.
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
  assert(merged.length === 3, "expected 3 unique URLs");
  assert(merged[0].url.startsWith("https://example.com/a"), "cross-source URL must rank first");
  assert(merged[0].snippet === "a much longer snippet", "longer snippet must win");
  assert(merged[0].title === "A longer title", "longer title must win");
  assert(merged[0].publishedAt === "2026-01-02T00:00:00.000Z", "publishedAt must survive");
  console.log("merge unit: ok");

  // 2. individual legs
  if (secrets.EXA_API_KEY) {
    const exa = await __test.exaSearch("DeepSeek V4 release", 3, {
      baseURL: "https://api.exa.ai",
      searchType: "auto",
      apiKey: secrets.EXA_API_KEY,
    }, AbortSignal.timeout(20000));
    report("exa leg", exa);
    assert(exa.length > 0, "exa leg returned nothing");
  } else {
    console.log("exa leg: skipped (no key)");
  }

  if (secrets.DEEPSEEK_API_KEY) {
    const started = Date.now();
    const deepseek = await __test.deepSeekSearchApi("DeepSeek V4 release", 3, {
      baseURL: "https://api.deepseek.com/v1/tools",
      apiKey: secrets.DEEPSEEK_API_KEY,
    }, AbortSignal.timeout(30000));
    report(`deepseek search-api leg (${Date.now() - started}ms)`, deepseek);
    assert(deepseek.length > 0, "deepseek leg returned nothing");
  } else {
    console.log("deepseek leg: skipped (no key)");
  }

  // 3. full provider search
  const { ctx, providers } = makeCtx();
  apply(ctx, { deepseekApiKey: secrets.DEEPSEEK_API_KEY, exaApiKey: secrets.EXA_API_KEY });
  const provider = providers.find((candidate) => candidate.id === "hybrid2");
  assert(provider !== undefined, "hybrid provider was not registered");
  const started = Date.now();
  const result = await provider.search({ query: "DeepSeek V4 release", maxResults: 5 }, AbortSignal.timeout(40000));
  report(`hybrid (${Date.now() - started}ms)`, result.sources);
  assert(result.sources.length > 0 && result.sources.length <= 5, "hybrid result count out of range");

  // 4. no credentials -> explicit failure
  const { ctx: emptyCtx, providers: emptyProviders } = makeCtx();
  const saved = { ...secrets };
  const savedEnv = { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, EXA_API_KEY: process.env.EXA_API_KEY };
  secrets.DEEPSEEK_API_KEY = "";
  secrets.EXA_API_KEY = "";
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.EXA_API_KEY;
  apply(emptyCtx, { deepseekApiKey: "", exaApiKey: "" });
  const emptyProvider = emptyProviders.find((candidate) => candidate.id === "hybrid2");
  let failed = false;
  try {
    await emptyProvider.search({ query: "nothing", maxResults: 3 });
  } catch {
    failed = true;
  }
  Object.assign(secrets, saved);
  if (savedEnv.DEEPSEEK_API_KEY !== undefined) process.env.DEEPSEEK_API_KEY = savedEnv.DEEPSEEK_API_KEY;
  if (savedEnv.EXA_API_KEY !== undefined) process.env.EXA_API_KEY = savedEnv.EXA_API_KEY;
  assert(failed, "search must fail when both keys are missing");
  console.log("missing-key behavior: ok");
}

main().catch((error) => {
  console.error("FAILED:", error?.message ?? error);
  process.exitCode = 1;
});
