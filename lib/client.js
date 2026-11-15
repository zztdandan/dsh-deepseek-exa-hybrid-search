// dsh-deepseek-exa-hybrid-search — browser half.
//
// Registers a `settings.section` page (Settings → Hybrid Search) that edits the
// plugin's own config: DeepSeek / Exa keys (plain text, kept in the profile
// patch by design) and the two capability switches (enableSearch / enableFetch).
//
// The page mirrors dsh-opencode-go-quota-settings: it reads and writes the
// plugin's own settings namespace through the official `remote.settings`
// service, so every edit lands in the profile patch (明文) and hot-applies to
// the next search/fetch without a restart.
//
// Hand-authored client bundle in the DSH module-loader factory format:
// `window.__ModuleLoader__.load({ id, factory })`. Only externalized modules
// (react / react/jsx-runtime) may be required.

window.__ModuleLoader__.load({
	id: "dsh-deepseek-exa-hybrid-search",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const jsxRuntime = require("react/jsx-runtime");
		const jsx = jsxRuntime.jsx;
		const jsxs = jsxRuntime.jsxs;

		const NS = "dsh-deepseek-exa-hybrid-search";

		// ── styles (injected once) ───────────────────────────────────────────
		const CSS_ID = "dsh-deepseek-exa-hybrid-search/settings.css";
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-deepseek-exa-hybrid-search";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = [
				".hys{box-sizing:border-box;display:flex;flex-direction:column;gap:16px;max-width:820px;min-width:0}",
				".hys-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}",
				".hys-title{margin:0;font-size:16px;line-height:24px;font-weight:600;color:var(--dsw-alias-label-primary)}",
				".hys-sub{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);max-width:560px}",
				".hys-sec{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);min-width:0}",
				".hys-sec-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}",
				".hys-sec-title{margin:0;font-size:13px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary)}",
				".hys-sec-sub{margin:3px 0 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);max-width:620px}",
				".hys-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}",
				".hys-field{display:flex;flex-direction:column;gap:5px;min-width:0}",
				".hys-label{font-size:11px;line-height:16px;font-weight:600;color:var(--dsw-alias-label-secondary)}",
				".hys-help{margin:0;font-size:10px;line-height:15px;color:var(--dsw-alias-label-tertiary)}",
				".hys-input{box-sizing:border-box;width:100%;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:20px}",
				".hys-input:focus{outline:1px solid var(--dsw-alias-state-success-primary);outline-offset:1px}",
				".hys-input:disabled{opacity:.6}",
				".hys-check{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);cursor:pointer}",
				".hys-check input{margin:1px 0 0;accent-color:var(--dsw-alias-state-success-primary)}",
				".hys-check span{display:flex;flex-direction:column;gap:1px}",
				".hys-check small{font-size:10px;line-height:15px;color:var(--dsw-alias-label-tertiary)}",
				".hys-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
				".hys-btn{appearance:none;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;padding:4px 12px;border-radius:8px}",
				".hys-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
				".hys-btn:disabled{cursor:default;opacity:.55}",
				".hys-notice{margin:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
				".hys-notice-ok{color:var(--dsw-alias-state-success-primary)}",
				".hys-notice-error{color:var(--dsw-alias-state-error-primary)}",
				".hys-empty{margin:0;padding:10px 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}",
				".hys-badge{font-size:11px;line-height:16px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2)}",
				".hys-badge-ok{color:var(--dsw-alias-state-success-primary)}",
				".hys-badge-missing{color:var(--dsw-alias-state-warn-primary)}"
			].join("");
			document.head.appendChild(tag);
		}

		// ── locale ──────────────────────────────────────────────────────────
		const zh = {
			nav: "混合搜索",
			title: "DeepSeek + Exa 混合搜索 / 获取",
			subtitle: "搜索走 DeepSeek Search API 与 Exa 并发合并；网页获取走 DeepSeek Fetch API，失败时优雅退让到本地直连。密钥以明文保存在 profile 的 cordis.patch.yml 中。",
			loading: "正在读取插件设置…",
			"keys.title": "API 密钥",
			"keys.subtitle": "两把密钥都以明文写入 profile 的 cordis.patch.yml（插件配置），不要分享 patch 或 config dump。",
			"keys.deepseek": "DeepSeek API Key",
			"keys.deepseekHint": "搜索与网页获取共用（POST /v1/tools/search 与 /v1/tools/fetch）。",
			"keys.exa": "Exa API Key",
			"keys.exaHint": "仅用于搜索的第二条腿；留空则搜索退让为仅 DeepSeek。",
			"keys.placeholder": "粘贴密钥（明文）",
			"switches.title": "能力开关",
			"switches.subtitle": "两个功能相互独立，可分别开启或关闭；关闭后由内建 provider 接管。",
			"switches.search": "开启搜索接管",
			"switches.searchHint": "接管 web_search（DeepSeek + Exa 并发合并去重）。",
			"switches.fetch": "开启网页获取接管",
			"switches.fetchHint": "接管网页获取（DeepSeek Fetch API → 本地直连优雅退让）。",
			"save": "保存设置",
			"saving": "保存中…",
			"discard": "放弃修改",
			"saved": "设置已保存，下次请求即生效。",
			"noChange": "没有需要保存的修改。",
			"unavailable": "还没有读到插件设置，稍后再试。",
			"noRemote": "设置服务尚未就绪，请刷新页面后重试。",
			"failed": "保存失败：{error}",
			"noNs": "未找到插件设置命名空间。"
		};
		const en = {
			nav: "Hybrid Search",
			title: "DeepSeek + Exa hybrid search / fetch",
			subtitle: "Search merges DeepSeek Search API and Exa in parallel; fetch uses the DeepSeek Fetch API and degrades to a direct local fetch on failure. Keys live in plain text in the profile patch.",
			loading: "Reading plugin settings…",
			"keys.title": "API keys",
			"keys.subtitle": "Both keys are stored in plain text in the profile cordis.patch.yml (plugin config); do not share the patch or a config dump.",
			"keys.deepseek": "DeepSeek API key",
			"keys.deepseekHint": "Shared by search and fetch (POST /v1/tools/search and /v1/tools/fetch).",
			"keys.exa": "Exa API key",
			"keys.exaHint": "Only the second search leg; leave empty to degrade search to DeepSeek-only.",
			"keys.placeholder": "Paste a key (plain text)",
			"switches.title": "Capability switches",
			"switches.subtitle": "The two capabilities are independent; disable one and the built-in provider takes over.",
			"switches.search": "Enable search takeover",
			"switches.searchHint": "Takes over web_search (DeepSeek + Exa merged, de-duplicated).",
			"switches.fetch": "Enable fetch takeover",
			"switches.fetchHint": "Takes over fetch (DeepSeek Fetch API → local HTTP graceful fallback).",
			"save": "Save settings",
			"saving": "Saving…",
			"discard": "Discard changes",
			"saved": "Settings saved; the next request applies them.",
			"noChange": "Nothing to save.",
			"unavailable": "Plugin settings have not loaded yet; try again in a moment.",
			"noRemote": "The settings service is not ready; refresh the page and try again.",
			"failed": "Save failed: {error}",
			"noNs": "Plugin settings namespace not found."
		};

		// ── helpers ─────────────────────────────────────────────────────────
		let settingsApi = null;

		/** Read this plugin's own namespace value from the settings remote. */
		async function readOwnConfig() {
			if (!settingsApi) return null;
			const described = await settingsApi.describe();
			if (!described || !described.ok) return null;
			const namespaces = described.value && Array.isArray(described.value.namespaces) ? described.value.namespaces : [];
			const row = namespaces.find(item => item && item.ns === NS);
			if (!row) return null;
			return { value: row.value || {}, revision: row.revision, writable: described.value.writable !== false };
		}

		/** Write this plugin's own settings through the official remote. */
		async function mutateOwnConfig(ops, revision) {
			if (!settingsApi) throw new Error(t2("noRemote"));
			const written = await settingsApi.mutate(NS, ops, revision);
			if (!written || !written.ok) {
				throw new Error((written && written.error && written.error.message) || t2("failed", { error: "settings/mutate" }));
			}
			return written.value;
		}

		let t2 = (key) => key;

		// ── page component ──────────────────────────────────────────────────
		function SettingsPage(props) {
			const t = props.t || ((key) => key);
			t2 = t;
			const [state, setState] = react.useState("loading"); // loading | ready | error
			const [value, setValue] = react.useState(null);
			const [revision, setRevision] = react.useState(0);
			const [writable, setWritable] = react.useState(true);
			const [draft, setDraft] = react.useState(null);
			const [dirty, setDirty] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState(null);
			const [notice, setNotice] = react.useState(null);
			const dirtyRef = react.useRef(false);

			const load = react.useCallback(async () => {
				try {
					const own = await readOwnConfig();
					if (own === null) {
						setState("error");
						setError(t("unavailable"));
						return;
					}
					setValue(own.value);
					setRevision(own.revision);
					setWritable(own.writable);
					if (!dirtyRef.current) {
						setDraft({
							deepseekApiKey: typeof own.value.deepseekApiKey === "string" ? own.value.deepseekApiKey : "",
							exaApiKey: typeof own.value.exaApiKey === "string" ? own.value.exaApiKey : "",
							enableSearch: own.value.enableSearch !== false,
							enableFetch: own.value.enableFetch !== false
						});
					}
					setState("ready");
					setError(null);
				} catch (cause) {
					setState("error");
					setError(String((cause && cause.message) || cause));
				}
			}, []);

			react.useEffect(() => { void load(); }, [load]);

			const update = (patch) => {
				dirtyRef.current = true;
				setDirty(true);
				setDraft(current => current === null ? current : { ...current, ...patch });
				setNotice(null);
				setError(null);
			};

			const discard = () => {
				dirtyRef.current = false;
				setDirty(false);
				setNotice(null);
				setError(null);
				void load();
			};

			const save = async () => {
				if (!draft) return;
				const ops = [];
				if (draft.deepseekApiKey !== value.deepseekApiKey) ops.push({ op: "set", path: ["deepseekApiKey"], value: draft.deepseekApiKey });
				if (draft.exaApiKey !== value.exaApiKey) ops.push({ op: "set", path: ["exaApiKey"], value: draft.exaApiKey });
				if ((draft.enableSearch === true) !== (value.enableSearch !== false)) ops.push({ op: "set", path: ["enableSearch"], value: draft.enableSearch === true });
				if ((draft.enableFetch === true) !== (value.enableFetch !== false)) ops.push({ op: "set", path: ["enableFetch"], value: draft.enableFetch === true });
				if (ops.length === 0) {
					setNotice(t("noChange"));
					return;
				}
				setBusy(true);
				setError(null);
				setNotice(null);
				try {
					await mutateOwnConfig(ops, revision);
					dirtyRef.current = false;
					setDirty(false);
					setNotice(t("saved"));
					await load();
				} catch (cause) {
					setError(t("failed", { error: String((cause && cause.message) || cause) }));
				} finally {
					setBusy(false);
				}
			};

			const disabled = !writable || busy || state !== "ready";

			if (state === "loading") {
				return jsx("section", { className: "hys", children: jsx("p", { className: "hys-empty", children: t("loading") }) });
			}
			if (state === "error") {
				return jsxs("section", { className: "hys", children: [
					jsx("p", { className: "hys-notice hys-notice-error", children: error }),
					jsx("button", { type: "button", className: "hys-btn", onClick: () => { setState("loading"); void load(); }, children: t("discard") })
				] });
			}

			const keyConfigured = (draft && (draft.deepseekApiKey || draft.exaApiKey)) ? true : false;

			return jsxs("section", {
				className: "hys",
				children: [
					jsxs("div", {
						className: "hys-head",
						children: [
							jsxs("div", { children: [
								jsx("h2", { className: "hys-title", children: t("title") }),
								jsx("p", { className: "hys-sub", children: t("subtitle") })
							] }),
							jsx("span", { className: "hys-badge " + (keyConfigured ? "hys-badge-ok" : "hys-badge-missing"), children: t(keyConfigured ? "keys.title" : "keys.title") })
						]
					}),

					jsxs("section", {
						className: "hys-sec",
						children: [
							jsxs("div", {
								className: "hys-sec-head",
								children: [
									jsx("h3", { className: "hys-sec-title", children: t("keys.title") }),
									jsx("p", { className: "hys-sec-sub", children: t("keys.subtitle") })
								]
							}),
							jsxs("div", {
								className: "hys-grid",
								children: [
									jsxs("div", {
										className: "hys-field",
										children: [
											jsx("label", { className: "hys-label", children: t("keys.deepseek") }),
											jsx("input", {
												className: "hys-input",
												type: "password",
												value: draft.deepseekApiKey,
												disabled,
												autoComplete: "off",
												spellCheck: false,
												onChange: (event) => update({ deepseekApiKey: event.target.value })
											}),
											jsx("p", { className: "hys-help", children: t("keys.deepseekHint") })
										]
									}),
									jsxs("div", {
										className: "hys-field",
										children: [
											jsx("label", { className: "hys-label", children: t("keys.exa") }),
											jsx("input", {
												className: "hys-input",
												type: "password",
												value: draft.exaApiKey,
												disabled,
												autoComplete: "off",
												spellCheck: false,
												onChange: (event) => update({ exaApiKey: event.target.value })
											}),
											jsx("p", { className: "hys-help", children: t("keys.exaHint") })
										]
									})
								]
							})
						]
					}),

					jsxs("section", {
						className: "hys-sec",
						children: [
							jsxs("div", {
								className: "hys-sec-head",
								children: [
									jsx("h3", { className: "hys-sec-title", children: t("switches.title") }),
									jsx("p", { className: "hys-sec-sub", children: t("switches.subtitle") })
								]
							}),
							jsxs("div", {
								className: "hys-grid",
								children: [
									jsxs("label", {
										className: "hys-check",
										children: [
											jsx("input", {
												type: "checkbox",
												checked: draft.enableSearch === true,
												disabled,
												onChange: (event) => update({ enableSearch: event.target.checked })
											}),
											jsxs("span", { children: [
												jsx("span", { children: t("switches.search") }),
												jsx("small", { children: t("switches.searchHint") })
											] })
										]
									}),
									jsxs("label", {
										className: "hys-check",
										children: [
											jsx("input", {
												type: "checkbox",
												checked: draft.enableFetch === true,
												disabled,
												onChange: (event) => update({ enableFetch: event.target.checked })
											}),
											jsxs("span", { children: [
												jsx("span", { children: t("switches.fetch") }),
												jsx("small", { children: t("switches.fetchHint") })
											] })
										]
									})
								]
							})
						]
					}),

					jsxs("div", {
						className: "hys-actions",
						children: [
							jsx("button", { type: "button", className: "hys-btn", disabled: disabled || !dirty, onClick: () => { void save(); }, children: busy ? t("saving") : t("save") }),
							jsx("button", { type: "button", className: "hys-btn", disabled: disabled || !dirty, onClick: discard, children: t("discard") })
						]
					}),
					error === null ? null : jsx("p", { className: "hys-notice hys-notice-error", role: "alert", children: error }),
					notice === null ? null : jsx("p", { className: "hys-notice hys-notice-ok", role: "status", children: notice })
				]
			});
		}

		// ── cordis plugin entry ─────────────────────────────────────────────
		const inject = ["slots", "locale", "remote"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-deepseek-exa-hybrid-search: dictionaries");
			ctx.inject(["remote.settings"], (remoteCtx) => {
				settingsApi = remoteCtx.remote.settings;
				return () => { settingsApi = null; };
			});
			const register = () => ctx.slots.register({
				name: "settings.section",
				id: "hybrid-search",
				order: 15,
				label: () => ctx.locale.bind(NS)("nav"),
				locale: NS,
				inject: () => ({ t: ctx.locale.bind(NS) })
			}, SettingsPage);
			if (typeof ctx.slots.inject === "function") {
				ctx.slots.inject("settings.section", register);
			} else {
				ctx.effect(register, "dsh-deepseek-exa-hybrid-search: settings page registration");
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
