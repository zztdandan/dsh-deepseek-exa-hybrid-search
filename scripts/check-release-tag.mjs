#!/usr/bin/env node
/**
 * Refuse to publish a tag that does not name the package version.
 *
 * Runs in the Release workflow before `npm publish`, so a mistyped tag cannot
 * publish an unexpected version or overwrite an older one.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { name, version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const ref = process.env.GITHUB_REF_NAME ?? "";

if (ref === "") {
  console.error("GITHUB_REF_NAME is not set; run this inside the release workflow");
  process.exit(1);
}
if (ref !== `v${version}`) {
  console.error(`tag ${ref} does not match ${name}@${version} (expected tag v${version})`);
  process.exit(1);
}
console.log(`tag ${ref} matches ${name}@${version}`);
