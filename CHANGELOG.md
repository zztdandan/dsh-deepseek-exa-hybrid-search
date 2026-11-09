# Changelog

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
