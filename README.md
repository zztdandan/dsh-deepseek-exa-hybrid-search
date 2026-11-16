# dsh-deepseek-exa-hybrid-search

[![npm](https://img.shields.io/npm/v/dsh-deepseek-exa-hybrid-search)](https://www.npmjs.com/package/dsh-deepseek-exa-hybrid-search)
[![CI](https://github.com/zztdandan/dsh-deepseek-exa-hybrid-search/actions/workflows/ci.yml/badge.svg)](https://github.com/zztdandan/dsh-deepseek-exa-hybrid-search/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/zztdandan/dsh-deepseek-exa-hybrid-search)](LICENSE)

A DeepSeek Harness (`dsh`) web provider that queries **DeepSeek Search API** and **Exa** at the same time and gives the agent **one merged, de-duplicated result list**, and that fetches pages through **Exa Contents → DeepSeek Fetch API → local HTTP** with graceful degradation (优雅退让).

一个把 **DeepSeek** 与 **Exa** 的搜索结果并发查询、去重合并成单份结果的 DSH 插件，并让网页获取依次走 **Exa Contents → DeepSeek Fetch API → 本地直连**、逐级优雅退让。它替换内建 `web_search` / `web_fetch` 的后端，不新增工具。

- One `web_search` call → both engines in parallel.
- Cross-source hits first, then reciprocal-rank (RRF) ordering.
- One engine down/slow → the other leg still answers (no failed search).
- One `web_fetch` call → Exa Contents, then DeepSeek Fetch API, then direct HTTP.
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

Pinning a version is `dsh-deepseek-exa-hybrid-search@1.1.3`. The package is
prebuilt — `lib/`, `locale/`, the bundle patch and the icon — so installing
needs no build step and no `allowBuilds` approval.

Without npm access, the same release is installable from git or from the tarball
attached to the GitHub Release:

```bash
dsh plugin --profile web add "github:zztdandan/dsh-deepseek-exa-hybrid-search#v1.1.3"
dsh plugin --profile web add https://github.com/zztdandan/dsh-deepseek-exa-hybrid-search/releases/latest/download/dsh-deepseek-exa-hybrid-search.tgz
```

`pnpm` records the dependency in the profile's `package.json`; the existing
bundle selection and this plugin's `config` stay as they are.

### Update

```bash
dsh plugin --profile web add dsh-deepseek-exa-hybrid-search@latest
```

`pnpm` replaces the package in place (same package name, same bundle patch, same
profile config); git and tarball installs update the same way by naming the newer
tag. Then restart the engine: profile configuration reloads over HMR, but plugin
*code* is only re-imported at startup, so a running engine keeps the old code
until it restarts.

`dsh plugin list dsh-deepseek-exa-hybrid-search` (or
`~/.dsh/profiles/web/node_modules/dsh-deepseek-exa-hybrid-search/package.json`)
shows the installed version.

The plugin registers `hybrid2` (search) and
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

Fetch degrades through three legs in order (优雅退让), each tried only when the
previous one fails or has no key:

1. Exa Contents API: `POST https://api.exa.ai/contents`, full page text as clean
   markdown.
2. DeepSeek Fetch API: `POST https://api.deepseek.com/v1/tools/fetch`, page
   Markdown in one call.
3. Direct public HTTP GET: the last resort.

It throws only when all available legs fail. Bodies are capped at 100 000
characters. The DeepSeek Search/Fetch independent endpoints are already the
full-suite (全家桶) API, so no endpoint change is needed.

## Settings page

The plugin ships a settings page (Settings → Hybrid Search) that mirrors
`dsh-opencode-go-quota-settings`: it edits the two keys and the two switches
through the official `remote.settings` service, writing the profile patch
(明文) and hot-applying to the next request.

The two capability switches do more than flip `enableSearch` / `enableFetch`:
saving also syncs the `web` namespace so the choice actually takes effect —

- **Enable search** → `web.searchProvider = hybrid2`; **disable** → restores
  `deepseek-search-api`.
- **Enable fetch** → `web.fetchProvider = hybrid2-fetch`; **disable** → restores
  `http`.

This is what makes the switches restore the built-in provider on uncheck (rather
than leaving a dangling `hybrid2` id with no registered provider).

## Compatibility

- DSH `>=0.2.1-rc.4 <0.3.0-0` (`engines.dsh`) and the matching
  `@deepseek-ai/schemastery` (peer).
- Node.js >= 20 (native `fetch`, `AbortSignal.any`).
- Zero runtime dependencies beyond the host's schemastery.

## Tests

```bash
npm ci
npm test                     # offline unit tests: merge, fetch fallback, slot takeover
npm run check                # package contract: dsh.bundle, locale, icon, engines.dsh
npm run test:live            # merge unit tests + live legs + missing-key behavior
node test/live-takeover.mjs  # mounts on a real Cordis ctx.web and checks slot takeover
```

The live tests read keys from `HYBRID_PATCH` (defaults to a local profile patch)
or `DEEPSEEK_API_KEY` / `EXA_API_KEY`, so CI runs only the offline suite.

## Release

`.github/workflows/ci.yml` runs the offline suite, the package contract and
`npm pack --dry-run` on every push and pull request (Node 20/22/24).
`.github/workflows/publish.yml` runs on a `v*` tag: it re-runs the same checks,
refuses a tag that does not match `package.json`, publishes to npm with
provenance (skipping a version that already exists), and creates the GitHub
Release with both the versioned `.tgz` and a stable `<name>.tgz` attached. The
`NPM_TOKEN` repository secret authenticates the npm step.

```bash
npm version patch --no-git-tag-version   # or edit package.json + CHANGELOG
git commit -am "chore: release v1.1.3" && git tag v1.1.3 && git push --follow-tags
```

## Related

- [`deepseek-exa-search-combine-mcp`](https://github.com/zztdandan/deepseek-exa-search-combine-mcp) — the same two engines combined as a standalone stdio MCP server, for hosts that cannot take a `ctx.web` provider.

## License

MIT
