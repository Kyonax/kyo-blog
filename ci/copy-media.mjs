#!/usr/bin/env node
/**
 * copy-media.mjs — put media/ into the build.
 *
 * org2html copies the assets IT writes (styles.css, o2h.js, favicon.svg,
 * manifest.json, fonts and Style Book assets). It does NOT copy images a
 * document references, and --asset-base does not rewrite their paths either:
 * both are scoped to the engine's own asset list. So content images are the
 * consumer's job, and this is that job.
 *
 * The convention: images live in media/ and documents reference them at their
 * DEPLOYED path (/blog/media/x.png). ci/assert-build.mjs then fails the build
 * if any referenced image is missing from the output, so a broken image is
 * loud at build time instead of a 404 in production.
 */
import { cp, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"

const from = process.argv[2] ?? "media"
const to = process.argv[3] ?? "dist/blog/media"

if (!existsSync(from)) {
  console.log(`copy-media: no ${from}/ directory, nothing to copy`)
  process.exit(0)
}
await mkdir(to, { recursive: true })
await cp(from, to, { recursive: true })
console.log(`copy-media: ${from} -> ${to}`)
