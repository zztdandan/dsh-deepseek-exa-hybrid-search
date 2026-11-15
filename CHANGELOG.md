# Changelog

## 1.1.1 — 2026-11-16

- Reorder fetch fallback to Exa-first: Exa Contents API (`POST /contents`) →
  DeepSeek Fetch API (`POST /v1/tools/fetch`) → direct public HTTP, each tried
  only when the previous leg fails (or has no key). The DeepSeek independent
  Search/Fetch endpoints are already the full-suite (全家桶) API, so no endpoint
  change was needed.
- Fix the capability switches: saving `enableSearch` / `enableFetch` now also
  syncs the `web` namespace (`searchProvider` / `fetchProvider`) so enabling
  pins the hybrid provider and disabling restores the built-in provider
  (`deepseek-search-api` / `http`) instead of leaving a dangling `hybrid2` id
  with no registered provider.

## 1.1.0 — 2026-11-16

- Add fetch capability: registers `hybrid2-fetch` and takes over the DeepSeek
  fetch slot (`deepseek-fetch-api` / `hybrid2-fetch` / unset).
- Fetch uses the DeepSeek Fetch API (`POST /v1/tools/fetch`); on any failure it
  gracefully degrades to a direct public HTTP fetch (优雅退让), throwing only when
  both legs fail.
- Add `enableSearch` / `enableFetch` config switches so the two capabilities can
  be enabled or disabled independently.
- Add a settings page (Settings → Hybrid Search) mirroring
  `dsh-opencode-go-quota-settings`: edits the keys (plain text in the profile
  patch) and both capability switches through the official `remote.settings`
  service; changes hot-apply to the next request.
- Keys remain plain text in the profile patch by design.

## 1.0.0 — 2026-11-09

First public release.

- `ctx.web` search provider `hybrid2`: queries the DeepSeek Search API
  (`POST /v1/tools/search`) and Exa (`POST /search`) in parallel.
- URL-normalized de-duplication; cross-source hits ranked first, then RRF score;
  richer title/snippet wins.
- Per-leg retry and bounded timeouts (Exa 3×6 s, DeepSeek 2×8 s, 25 s overall);
  one failed leg degrades to the other instead of failing the search.
- Snippets clipped to 800 characters for small context windows.
- Takes over the DeepSeek search slot (`hybrid2` / `deepseek-official` /
  `deepseek-search-api` / unset); other explicit providers are left alone.
- Config fields `deepseekApiKey` / `exaApiKey`, stored as plain text in the
  profile patch by design, with the credentials service and process environment
  as fallbacks.
- Native settings form (no extra client bundle), no extra tools.
- License: MIT.
