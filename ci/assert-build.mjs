#!/usr/bin/env node
/**
 * assert-build.mjs — the consumer-side gate on an org2html build.
 *
 * This repository does not test the org2html source tree; it tests the PUBLISHED
 * package as a stranger would, and every assertion here is written against the
 * BUILD OUTPUT alone. A loud failure is a feature; a silent wrong answer is the
 * bug this file exists to catch.
 *
 *   node ci/assert-build.mjs <site-dir> [--origin https://kyonax.com] [--base-path /blog]
 *
 * With --origin/--base-path the sub-path deploy contract is checked too: the
 * rendered HTML must be self-consistent for a site that does NOT live at a
 * domain root, because every asset org2html emits is root-absolute by default.
 *
 * Exit 0 = every assertion held. Exit 1 = at least one did not.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const argv = process.argv.slice(2)
const SITE = argv.find((a) => !a.startsWith("--")) ?? "dist/blog"
const flag = (name) => {
  const i = argv.indexOf(name)
  return i === -1 ? null : argv[i + 1]
}
const ORIGIN = flag("--origin")
// The FIXTURE corpus must exercise every construct and must carry the sanitizer
// fixture. Real blog posts must not: a post that happens to use no verse block
// is not a defect. Those two gates are therefore opt-in, and ci/corpus is what
// opts in.
const CORPUS = argv.includes("--corpus")
const BASE_PATH = (flag("--base-path") ?? "").replace(/\/$/, "")

const fails = []
const oks = []
const ok = (m) => oks.push(m)
const fail = (m) => fails.push(m)
const check = (cond, m) => (cond ? ok(m) : fail(m))

const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"))
const readText = (p) => readFileSync(p, "utf8")
const walk = (d) =>
  readdirSync(d).flatMap((e) => {
    const p = join(d, e)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

if (!existsSync(SITE)) {
  console.error(`assert-build: no such build directory: ${SITE}`)
  process.exit(1)
}

const sitemap = readJSON(join(SITE, "sitemap.json"))
const urls = new Set(sitemap.map((e) => e.url))

// Pages are what the SITEMAP claims, never what happens to be on disk: a real
// deploy plants CNAME, .well-known/ and friends, and those are not pages.
const pageDirs = sitemap.map((e) => e.url.replace(/^\//, ""))
const plantedDirs = readdirSync(SITE)
  .filter((e) => statSync(join(SITE, e)).isDirectory())
  .filter((e) => !pageDirs.includes(e))

// ---------------------------------------------------------------- routes ----

// A title that slugifies to nothing must fall back to the filename, never to "".
check(!existsSync(join(SITE, "index.html")), "no page landed at the output root")

for (const e of sitemap) {
  check(
    e.url.startsWith("/") && existsSync(join(SITE, e.url.slice(1), "index.html")),
    `sitemap url ${e.url} has an index.html on disk`,
  )
}
for (const d of plantedDirs) {
  check(!existsSync(join(SITE, d, "index.html")), `planted dir /${d} is not an unlisted page`)
}

// ------------------------------------------------------------- relations ----

// relations.json ships as DATA: prev/next/related are root-relative slugs the
// consumer composes. Every one of them must still name a page that exists.
for (const dir of pageDirs) {
  const rp = join(SITE, dir, "relations.json")
  if (!existsSync(rp)) {
    fail(`${dir}/relations.json is missing`)
    continue
  }
  const r = readJSON(rp)
  const refs = [r.prev, r.next, ...(r.related ?? []), ...(r.series?.items ?? [])].filter(Boolean)
  for (const ref of refs) {
    check(urls.has(ref.url), `relations ${dir} -> ${ref.url} resolves to a real page`)
  }
}

// --------------------------------------------------------------- anchors ----

// Heading ids collide with the page shell's own ids; the engine disambiguates
// with a -section suffix. If it ever stops, the table of contents 404s in place.
for (const dir of pageDirs) {
  const html = readText(join(SITE, dir, "index.html"))
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
  const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
  const dangling = anchors.filter((a) => !ids.has(a) && !ids.has(decodeURIComponent(a)))
  check(dangling.length === 0, `${dir}: ${anchors.length} in-page anchors, dangling=[${dangling.join(", ")}]`)
}

// ----------------------------------------------------------------- dates ----

// STRUCTURED DATA NEVER PUBLISHES A HALF-ANSWER: a date is ISO, or the field is
// absent. metadata.json is the ONE exception and deliberately so -- it is the
// verbatim document record, keeping `date` exactly as the author typed it
// (e.g. "<2026-03-01 Sun>") beside a normalised `dateIso`. It is not a
// publishing surface. An assertion that demands ISO *everywhere* is wrong.
const DATE_KEYS =
  /^(lastmod|date|dateIso|publishedTime|modifiedTime|datePublished|dateModified|updated|pubDate)$/
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/

const scan = (node, where, verbatim) => {
  if (Array.isArray(node)) return node.forEach((n) => scan(n, where, verbatim))
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (DATE_KEYS.test(k) && typeof v === "string") {
        if (verbatim && k === "date") ok(`${where}: verbatim date="${v}" (exempt by contract)`)
        else check(ISO.test(v), `${where}: ${k}="${v}" is ISO`)
      }
      scan(v, where, verbatim)
    }
  }
}
for (const f of walk(SITE).filter((p) => p.endsWith(".json"))) {
  scan(readJSON(f), f, f.endsWith("metadata.json") && !f.endsWith("og-metadata.json"))
}

// An undated document must not acquire a date from the wall clock: that is both
// a lie and the end of a reproducible build.
const undatedDir = pageDirs.find((d) => d === "undated")
if (undatedDir) {
  for (const f of walk(join(SITE, undatedDir)).filter((p) => p.endsWith(".json"))) {
    check(!/\d{4}-\d{2}-\d{2}/.test(readText(f)), `${f} carries no date at all`)
  }
  check(!sitemap.find((e) => e.url === "/undated")?.lastmod, "/undated has no lastmod in the sitemap")
}

// The raw/ISO split must actually be honoured on a page whose author wrote an
// Org active timestamp rather than an ISO string.
const stampedDir = pageDirs.find((d) => d.endsWith("stamped"))
if (stampedDir) {
  const meta = readJSON(join(SITE, stampedDir, "metadata.json"))
  check(meta.date === "<2026-03-01 Sun>", `metadata.date keeps the verbatim timestamp (${meta.date})`)
  check(meta.dateIso === "2026-03-01", `metadata.dateIso normalises it (${meta.dateIso})`)
  check(
    readJSON(join(SITE, stampedDir, "og-metadata.json")).publishedTime === "2026-03-01",
    "og-metadata publishedTime is ISO",
  )
  check(
    readJSON(join(SITE, stampedDir, "structured-data.json")).datePublished === "2026-03-01",
    "structured-data datePublished is ISO",
  )
  check(sitemap.find((e) => e.url === `/${stampedDir}`)?.lastmod === "2026-03-01", "sitemap lastmod is ISO")
  const t = readText(join(SITE, stampedDir, "index.html")).match(/<time[^>]*datetime="([^"]*)"/)
  check(!t || ISO.test(t[1]), `<time datetime="${t?.[1]}"> is ISO`)
}

// ------------------------------------------------- site-wide written files ----

// THE ENGINE REFERENCES NO ASSET IT DID NOT WRITE.
const robots = readText(join(SITE, "robots.txt"))
check(!robots.includes("{{"), "robots.txt has no unrendered template braces")
check(!robots.includes("sitemap.xml"), "robots.txt does not point at a sitemap.xml the engine never wrote")

const manifest = readJSON(join(SITE, "manifest.json"))
for (const dir of pageDirs) {
  const html = readText(join(SITE, dir, "index.html"))
  const m =
    html.match(/<meta[^>]*name="theme-color"[^>]*content="([^"]*)"/) ??
    html.match(/<meta[^>]*content="([^"]*)"[^>]*name="theme-color"/)
  check(
    !!m && m[1] === manifest.theme_color,
    `${dir}: <meta theme-color>=${m?.[1]} matches manifest ${manifest.theme_color}`,
  )
}

// A language with no Shiki grammar must ship unhighlighted AND say so in the
// markup, rather than silently rendering as if it had been highlighted.
const elispDir = pageDirs.find((d) => d === "elisp")
if (elispDir) {
  check(readText(join(SITE, elispDir, "index.html")).includes("org-src--plain"), "elisp block carries org-src--plain")
}

// ---------------------------------------------------------------- images ----

// org2html copies the assets IT writes. It does NOT copy images a document
// references, and --asset-base does not rewrite their URLs either -- both are
// scoped to the engine's own asset list. So a referenced image that nobody
// copied is a 404 in production that the build reports as success. Not here.
const localSrc = (u) => !/^(https?:)?\/\//.test(u) && !u.startsWith("data:") && !u.startsWith("#")
for (const dir of pageDirs) {
  const html = readText(join(SITE, dir, "index.html"))
  const srcs = [...html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]).filter(localSrc)
  for (const src of srcs) {
    const onDisk = src.startsWith("/")
      // a root-absolute ref is served from the site root; strip the base path
      // the deploy adds back, so /blog/media/x.png is dist/blog/media/x.png
      ? join(SITE, (BASE_PATH && src.startsWith(BASE_PATH + "/") ? src.slice(BASE_PATH.length) : src).slice(1))
      : join(SITE, dir, src.replace(/^\.\//, ""))
    check(existsSync(onDisk), `${dir}: image ${src} exists in the build (${onDisk})`)
  }
}

// ------------------------------------------------------------- constructs ----

// KNOWN_CONSTRUCTS is the engine's OWN list of what it can parse. Asserting the
// corpus exercises all of it is what stops this suite quietly narrowing to the
// handful of shapes somebody happened to write first.
if (CORPUS) {
  const api = await import("@kyonax/org2html")
  const known = api.KNOWN_CONSTRUCTS
  let markup = ""
  for (const dir of pageDirs) {
    markup += readText(join(SITE, dir, "index.html"))
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
  }
  const classes = new Set()
  for (const m of markup.matchAll(/class="([^"]+)"/g)) {
    m[1].split(/\s+/).forEach((c) => classes.add(c))
  }
  const seen = (k) => [...classes].some((c) => c === k || c.startsWith(k + "--") || c.startsWith(k + "__"))
  const missing = known.filter((k) => !seen(k))
  check(missing.length === 0, `corpus exercises all ${known.length} KNOWN_CONSTRUCTS (missing=[${missing.join(", ")}])`)
}

// -------------------------------------------------------------- sanitizer ----

// SANITIZE BY DEFAULT. The fixture hands the renderer raw HTML containing the
// usual injection vectors; the hostile ones must be gone from the rendered
// article and the benign ones must survive. Scanned over the ARTICLE only, so
// the engine's own JSON-LD and deferred script tag are not mistaken for the
// payload.
const sanitizerDir = pageDirs.find((d) =>
  readText(join(SITE, d, "index.html")).includes('id="benign"'))
if (CORPUS) {
  check(!!sanitizerDir, "the sanitizer fixture is present in the corpus (a page carrying id=\"benign\")")
}
if (sanitizerDir) {
  const raw = readText(join(SITE, sanitizerDir, "index.html")).replace(/<style[\s\S]*?<\/style>/gi, "")
  const a = raw.indexOf("<article")
  const b = raw.lastIndexOf("</article>")
  const body = a > -1 && b > a ? raw.slice(a, b) : raw
  const lower = body.toLowerCase()

  const HOSTILE = ["<script", "onerror", "onclick", "onmouseover", "javascript:",
                   "<iframe", "<form", "<object", "<embed", "__pwned", "<style",
                   'name="stolen"']
  for (const needle of HOSTILE) {
    check(!lower.includes(needle), `sanitizer removed ${needle}`)
  }
  const BENIGN = ["<strong>", "<em>", "example.com/ok", "inline-ok"]
  for (const needle of BENIGN) {
    check(lower.includes(needle.toLowerCase()), `sanitizer kept benign ${needle}`)
  }

  // `input` is NARROWED, not forbidden. Forbidding it outright once stripped the
  // checkbox of every Org task item, so the rule is: the engine's own checkboxes
  // survive, and nothing else does. A blunt "no <input>" assertion would pass
  // for the wrong reason -- by breaking every task list in the corpus.
  const inputs = [...body.matchAll(/<input[^>]*>/g)].map((m) => m[0])
  check(inputs.length > 0, `the engine's own task checkboxes survive sanitization (${inputs.length})`)
  check(
    inputs.every((i) => /type="(checkbox|radio)"/.test(i)),
    `every surviving <input> is a checkbox or radio (${inputs.map((i) => (i.match(/type="([^"]+)"/) ?? [])[1]).join(", ")})`,
  )
}

// ------------------------------------------------------ sub-path contract ----

// Every asset org2html emits is ROOT-ABSOLUTE. A deploy that is not at a domain
// root therefore 404s on all of them unless --asset-base prefixes them, and the
// canonical/JSON-LD URLs are wrong unless --base-url carries the sub-path. This
// block fails the build rather than letting a broken /blog deploy look healthy.
if (BASE_PATH) {
  const ASSET = /(?:href|src)="(\/[^"]*)"/g
  for (const dir of pageDirs) {
    const html = readText(join(SITE, dir, "index.html"))
    const rootAbs = [...html.matchAll(ASSET)].map((m) => m[1])
    const unbased = rootAbs.filter((u) => !u.startsWith(`${BASE_PATH}/`))
    check(unbased.length === 0, `${dir}: every root-absolute ref sits under ${BASE_PATH} (stray=[${unbased.join(", ")}])`)
  }
}

if (ORIGIN) {
  const PREFIX = `${ORIGIN}${BASE_PATH}`
  for (const dir of pageDirs) {
    const html = readText(join(SITE, dir, "index.html"))
    const canonical = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]*)"/)?.[1]
    check(canonical === `${PREFIX}/${dir}`, `${dir}: canonical is ${PREFIX}/${dir} (got ${canonical})`)

    const ogUrl = html.match(/<meta[^>]*property="og:url"[^>]*content="([^"]*)"/)?.[1]
    check(ogUrl === `${PREFIX}/${dir}`, `${dir}: og:url is ${PREFIX}/${dir} (got ${ogUrl})`)

    // Absolute links the engine rendered must each name a page that exists.
    const absLinks = [...html.matchAll(new RegExp(`href="${PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([^"]*)"`, "g"))]
      .map((m) => m[1].replace(/\/$/, ""))
      .filter((s) => s !== "")
    for (const slug of absLinks) {
      check(urls.has(`/${slug}`), `${dir}: absolute link ${PREFIX}/${slug} resolves to a real page`)
    }
  }
}

// --------------------------------------------------------------- report ----

console.log(oks.map((m) => `  ok   ${m}`).join("\n"))
if (fails.length) console.log(fails.map((m) => `  FAIL ${m}`).join("\n"))
console.log(`\n${oks.length} passed, ${fails.length} failed  (site=${SITE}${BASE_PATH ? `, base=${BASE_PATH}` : ""})`)
process.exit(fails.length ? 1 : 0)
