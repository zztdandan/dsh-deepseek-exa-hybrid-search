# dsh-deepseek-exa-hybrid-search

A DeepSeek Harness (`dsh`) web provider that queries **DeepSeek Search API** and **Exa** at the same time and gives the agent **one merged, de-duplicated result list**, and that fetches pages through the **DeepSeek Fetch API** with a **graceful local-HTTP fallback (优雅退让)**.

一个把 **DeepSeek** 与 **Exa** 的搜索结果并发查询、去重合并成单份结果的 DSH 插件，并让网页获取走 **DeepSeek Fetch API**、失败时优雅退让到本地直连。它替换内建 `web_search` / `web_fetch` 的后端，不新增工具。

- One `web_search` call → both engines in parallel.
- Cross-source hits first, then reciprocal-rank (RRF) ordering.
- One engine down/slow → the other leg still answers (no failed search).
- One `web_fetch` call → DeepSeek Fetch API, then direct HTTP on failure.
- Independent `enableSearch` / `enableFetch` switches.
- A settings page (Settings → Hybrid Search) edits keys and switches.
- No extra tools; the only footprint is the web provider and the settings page.

## Why a provider (and not MCP)

`ctx.web` accepts exactly one provider id per capability and has no multi-source
merge. A hosted MCP server can add another tool, but it cannot rewrite the
built-in `web_search` or return one combined list. So the merge lives in a
provider that calls both HTTP APIs directly.

## Install

```bash
dsh plugin --profile web add dsh-deepseek-exa-hybrid-search
```

Restart the engine after installing. The plugin registers `hybrid2` (search) and
`hybrid2-fetch` (fetch), and takes over the DeepSeek search slot (`hybrid2` /
`deepseek-official` / `deepseek-search-api` / unset) and the DeepSeek fetch slot
(`hybrid2-fetch` / `deepseek-fetch-api` / unset). Any other explicit provider
(for example `ddg` or `http`) is left alone.

## Configure

Two keys and two switches, set in **Settings → Hybrid Search** (the plugin's own
settings page), or directly in the profile patch:

```yaml
- id: dsh-deepseek-exa-hybrid-search
  config:
    deepseekApiKey: "sk-..."
    exaApiKey: "..."
    enableSearch: true
    enableFetch: true
```

Both keys are **plain text in the profile patch** by design. That means
`dsh --dump-config`, the settings form, and config backups show them — do not
share your patch or a config dump. Precedence:

1. `deepseekApiKey` / `exaApiKey` (config)
2. the credentials service (`DEEPSEEK_API_KEY` / `EXA_API_KEY`)
3. the process environment

`enableSearch` and `enableFetch` are independent; disable one and the built-in
provider for that capability takes over. Either search leg alone is enough; with
only one key the search degrades to that leg.

## Behavior

### Search

- DeepSeek: `POST https://api.deepseek.com/v1/tools/search` (structured results,
  no model turn).
- Exa: `POST https://api.exa.ai/search` with highlights.
- Retries: Exa 3 × 6 s, DeepSeek 2 × 8 s, 300 ms backoff, 25 s overall budget.
- Results are de-duplicated on a normalized URL (tracking params, hash and
  trailing slash removed). Hits found by both engines rank first, then by RRF
  score; the richer title/snippet is kept.
- Snippets are clipped to 800 characters to keep phone-sized contexts usable.

### Fetch

- DeepSeek Fetch API: `POST https://api.deepseek.com/v1/tools/fetch`, returns
  page Markdown in one call.
- On any DeepSeek Fetch API failure (network, HTTP error, empty body), the fetch
  **degrades to a direct public HTTP GET** (优雅退让). It throws only when both
  legs fail.
- Bodies are capped at 100 000 characters.

## Settings page

The plugin ships a settings page (Settings → Hybrid Search) that mirrors
`dsh-opencode-go-quota-settings`: it edits the two keys and the two switches
through the official `remote.settings` service, writing the profile patch
(明文) and hot-applying to the next request.

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
