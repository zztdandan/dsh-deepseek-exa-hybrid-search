#!/usr/bin/env node
/**
 * Offline package guard for dsh-deepseek-exa-hybrid-search.
 *
 * Checks the things DSH itself reads before it will install and display the
 * bundle (dsh.bundle.patch, the locale dictionaries, the icon, engines.dsh),
 * plus the npm fields a storefront needs. No network, no dependencies.
 */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function readJson(relative) {
  const file = join(root, relative);
  if (!existsSync(file)) {
    fail(`${relative} is missing`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${relative} is not valid JSON: ${error.message}`);
    return undefined;
  }
}

const pkg = readJson("package.json") ?? {};

// ── identity and npm metadata ─────────────────────────────────────────────
if (typeof pkg.name !== "string" || pkg.name.trim() === "") fail("package.json: name is required");
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(pkg.version ?? ""))) fail("package.json: version must be semver");
for (const field of ["description", "license", "author"]) {
  if (typeof pkg[field] !== "string" || pkg[field].trim() === "") fail(`package.json: ${field} is required`);
}
if (pkg.repository?.url === undefined) fail("package.json: repository.url is required");
if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes("dsh-plugin")) notes.push("keywords: expected the dsh-plugin keyword");

// ── DSH bundle contract ───────────────────────────────────────────────────
const patchPath = pkg.dsh?.bundle?.patch;
if (typeof patchPath !== "string") {
  fail("package.json: dsh.bundle.patch is required (dsh installs the bundle through it)");
} else {
  const patchFile = join(root, patchPath);
  if (!existsSync(patchFile)) fail(`dsh.bundle.patch points at missing ${patchPath}`);
  else {
    const patch = readFileSync(patchFile, "utf8");
    if (!patch.includes(`- id: ${pkg.name}`)) fail(`${patchPath}: expected an insert entry with "id: ${pkg.name}"`);
    if (!patch.includes(`name: "${pkg.name}"`) && !patch.includes(`name: ${pkg.name}`)) {
      fail(`${patchPath}: expected "name: ${pkg.name}" so the loader imports this package`);
    }
  }
}

const enginesDsh = pkg.engines?.dsh;
if (typeof enginesDsh !== "string") {
  fail("package.json: engines.dsh is required for store compatibility checks");
} else if (!/^\s*[<>]=?/.test(enginesDsh)) {
  fail("package.json: engines.dsh must be a semver range");
}

// ── engine and runtime boundaries ─────────────────────────────────────────
if (typeof pkg.engines?.node !== "string") fail("package.json: engines.node is required");
const runtimeDependencies = Object.keys(pkg.dependencies ?? {});
if (runtimeDependencies.length > 0) fail(`package.json: ship zero runtime dependencies, found ${runtimeDependencies.join(", ")}`);
const peers = Object.keys(pkg.peerDependencies ?? {});
for (const peer of peers) {
  if (!peer.startsWith("@deepseek-ai/")) notes.push(`peerDependencies: ${peer} is not an official @deepseek-ai package`);
}

// ── exports resolve to real files ─────────────────────────────────────────
if (pkg.main !== undefined && !existsSync(join(root, pkg.main))) fail(`main points at missing ${pkg.main}`);
for (const [key, target] of Object.entries(pkg.exports ?? {})) {
  if (typeof target !== "string") {
    fail(`exports["${key}"] must be a string target`);
    continue;
  }
  if (target.includes("*")) {
    const directory = join(root, dirname(target));
    if (!existsSync(directory)) fail(`exports["${key}"] points at missing directory ${dirname(target)}`);
  } else if (!existsSync(join(root, target))) {
    fail(`exports["${key}"] points at missing ${target}`);
  }
}

// ── display metadata the plugin pages and market read ─────────────────────
const icon = pkg.icon;
if (typeof icon !== "string") {
  notes.push("icon: no package.json icon, plugin pages fall back to the module specifier");
} else {
  const iconFile = join(root, icon);
  if (!existsSync(iconFile)) fail(`icon points at missing ${icon}`);
  else {
    if (![".svg", ".png", ".jpg", ".jpeg", ".webp"].includes(extname(icon).toLowerCase())) fail("icon must be SVG, PNG, JPEG, or WebP");
    if (statSync(iconFile).size > 256 * 1024) fail("icon exceeds the 256 KiB limit");
  }
}

const localeDir = join(root, "locale");
if (!existsSync(localeDir)) fail("locale/ is missing (plugin pages read locale/en.json)");
else {
  const files = readdirSync(localeDir).filter((name) => name.endsWith(".json"));
  if (!files.includes("en.json")) fail("locale/en.json is required");
  for (const file of files) {
    const language = file.slice(0, -5);
    if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) fail(`locale/${file}: filename must be a language id`);
    const dictionary = readJson(`locale/${file}`) ?? {};
    for (const field of ["title", "description"]) {
      const value = dictionary.meta?.[field];
      if (typeof value !== "string" || value.trim() === "") fail(`locale/${file}: meta.${field} is required`);
    }
  }
}

// ── published file set ────────────────────────────────────────────────────
for (const entry of pkg.files ?? []) {
  if (!existsSync(join(root, entry))) fail(`files[] names missing ${entry}`);
}
const requiredInFiles = ["lib", "locale", "cordis.patch.yml", "README.md", "LICENSE"];
for (const entry of requiredInFiles) {
  if (!(pkg.files ?? []).includes(entry)) fail(`files[] must include ${entry}`);
}

// ── changelog carries this version ────────────────────────────────────────
const changelog = join(root, "CHANGELOG.md");
if (existsSync(changelog)) {
  const text = readFileSync(changelog, "utf8");
  if (!text.includes(`## ${pkg.version}`)) notes.push(`CHANGELOG.md: no "## ${pkg.version}" section yet`);
}

for (const note of notes) console.log(`note: ${note}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`error: ${failure}`);
  console.error(`\n${failures.length} package check(s) failed`);
  process.exit(1);
}
console.log(`package check: ok (${pkg.name}@${pkg.version})`);
