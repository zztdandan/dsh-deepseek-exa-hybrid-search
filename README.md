# dsh-deepseek-exa-hybrid-search

A DeepSeek Harness (`dsh`) search provider that queries **DeepSeek Search API** and **Exa** at the same time and gives the agent **one merged, de-duplicated result list** instead of two overlapping ones.

一个把 **DeepSeek** 与 **Exa** 的搜索结果并发查询、去重合并成单份结果的 DSH 插件。它替换内建 `web_search` 的后端，不新增工具。

- One `web_search` call → both engines in parallel.
- Cross-source hits first, then reciprocal-rank (RRF) ordering.
- One engine down/slow → the other leg still answers (no failed search).
- No extra tools, no client bundle: the only footprint is the search provider.

## Why a provider (and not MCP)

`ctx.web` accepts exactly one provider id per capability and has no multi-source
merge. A hosted MCP server can add another tool, but it cannot rewrite the
built-in `web_search` or return one combined list. So the merge lives in a
provider that calls both HTTP APIs directly.

## Install

```bash
dsh plugin --profile web add dsh-deepseek-exa-hybrid-search
```

Restart the engine after installing. The plugin registers `hybrid2` and takes
over the DeepSeek search slot (`hybrid2` / `deepseek-official` /
`deepseek-search-api` / unset). Any other explicit provider (for example `ddg`)
is left alone.

## Configure

Two keys, set in **Settings → Plugins → dsh-deepseek-exa-hybrid-search → Settings**
(native form), or directly in the profile patch:

```yaml
- id: web-search-hybrid
  config:
    deepseekApiKey: "sk-..."
    exaApiKey: "..."
```

Both are **plain text in the profile patch** by design. That means
`dsh --dump-config`, the settings form, and config backups show them — do not
share your patch or a config dump. Precedence:

1. `deepseekApiKey` / `exaApiKey` (config)
2. the credentials service (`DEEPSEEK_API_KEY` / `EXA_API_KEY`)
3. the process environment

Either leg alone is enough; with only one key the search degrades to that leg.

## Behavior

- DeepSeek: `POST https://api.deepseek.com/v1/tools/search` (structured results,
  no model turn).
- Exa: `POST https://api.exa.ai/search` with highlights.
- Retries: Exa 3 × 6 s, DeepSeek 2 × 8 s, 300 ms backoff, 25 s overall budget.
- Results are de-duplicated on a normalized URL (tracking params, hash and
  trailing slash removed). Hits found by both engines rank first, then by RRF
  score; the richer title/snippet is kept.
- Snippets are clipped to 800 characters to keep phone-sized contexts usable.

## Compatibility

- DSH `0.2.1-rc.4` and the matching `@deepseek-ai/schemastery` (peer).
- Node.js >= 20 (native `fetch`, `AbortSignal.any`).
- Zero runtime dependencies beyond the host's schemastery.

## Tests

```bash
node test/run.mjs            # merge unit tests + live legs + missing-key behavior
node test/live-takeover.mjs  # mounts on a real Cordis ctx.web and checks slot takeover
```

The live tests read keys from `HYBRID_PATCH` (defaults to a local profile patch)
or `DEEPSEEK_API_KEY` / `EXA_API_KEY`.

## Related

- [`deepseek-exa-search-combine-mcp`](https://github.com/zztdandan/deepseek-exa-search-combine-mcp) — the same two engines combined as a standalone stdio MCP server, for hosts that cannot take a `ctx.web` provider.

## License

MIT
