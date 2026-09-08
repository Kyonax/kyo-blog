#!/usr/bin/env node
/**
 * generate-manifest.mjs — turn a built corpus into what kyo-web-online needs.
 *
 * org2html deliberately stops at the document. It writes a page, its sidecars and a
 * flat routes.js, and it does NOT write:
 *
 *   - any index page (/blog, a paginated archive, a series landing)
 *   - the category crumb's URL — relations.json leaves it null, because
 *     "only the site knows the route"
 *   - anything about locale PAIRING; each document knows its own language and
 *     nothing about its translation
 *
 * kyo-web-online needs all three, and its src/seo/routes.js says a localised page
 * means "adding its map HERE and nowhere else" — which cannot be hand-maintained for
 * a blog. So this derives that table from the built output.
 *
 * WHY NOT THE GENERATED index.vue. Verified against a real build: the SFC emits its
 * own <main>/<article> (a duplicate landmark inside the host's DocumentPage), never
 * emits a `components:` key, and declares component props inside setup() without
 * returning them. It also omits the resolved cardImage. The rendered fragment plus
 * the sidecars is strictly better behaved, and `.org-root` occurs exactly once in
 * index.html, so slicing it is unambiguous.
 *
 * WHY TWO OUTPUTS. The post BODIES are split into one file per post rather than
 * inlined here. A view that imports a single manifest containing every body would
 * bundle every body into the client chunk, and the site's main-bundle budget is
 * 180 KB gzipped. Per-post files let import.meta.glob give each post its own chunk.
 *
 *   node ci/generate-manifest.mjs <site-dir> -o dist/blog-manifest.json
 *        [--posts-dir dist/posts] [--base /blog] [--origin https://kyonax.com]
 *        [--default-locale en] [--page-size 10] [--strict]
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"

const argv = process.argv.slice(2)
const flag = (n, d = null) => {
  const i = argv.indexOf(n)
  return i === -1 ? d : argv[i + 1]
}
const SITE = argv.find((a) => !a.startsWith("--") && !a.startsWith("-o")) ?? "dist/blog"
const OUT = flag("-o", "dist/blog-manifest.json")
const POSTS_DIR = flag("--posts-dir", "dist/posts")
const BASE = (flag("--base", "/blog") ?? "").replace(/\/$/, "")
const ORIGIN = (flag("--origin", "https://kyonax.com") ?? "").replace(/\/$/, "")
const DEFAULT_LOCALE = flag("--default-locale", "en")
const PAGE_SIZE = Number(flag("--page-size", "10"))
const STRICT = argv.includes("--strict")

// seo-audit.mjs in the host site HARD-FAILS a description under 60 characters and
// warns over 165. Catching it here names the post; catching it there names a path
// in dist/ after a full build.
const DESC_MIN = 60
const DESC_MAX = 165

const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"))
const readText = (p) => readFileSync(p, "utf8")
const problems = []

/** The site's locale prefix: default locale at the root, every other under /<locale>
 *  — the shape /resume and /es/hoja-de-vida already use, so adding /jp later is a
 *  content change rather than a code change. */
const localePrefix = (locale) => (locale === DEFAULT_LOCALE ? "" : `/${locale}`)
const siteUrl = (locale, engineRoute) => `${localePrefix(locale)}${BASE}${engineRoute}`

/** `.org-root` is the single content node of a built page (verified: exactly one
 *  occurrence). Everything outside it is the engine's document shell, which the host
 *  supplies itself. */
const extractFragment = (html, where) => {
  const open = html.indexOf('<div class="org-root"')
  if (open === -1) {
    problems.push(`${where}: no .org-root found — cannot extract the article fragment`)
    return ""
  }
  const close = html.lastIndexOf("</article>")
  const end = close > open ? close : html.length
  return html.slice(open, end).trim()
}

const sitemap = readJSON(join(SITE, "sitemap.json"))
const posts = []

for (const entry of sitemap) {
  const dir = join(SITE, entry.url.replace(/^\//, ""))
  const meta = readJSON(join(dir, "metadata.json"))
  const og = readJSON(join(dir, "og-metadata.json"))
  const rel = existsSync(join(dir, "relations.json")) ? readJSON(join(dir, "relations.json")) : null

  const locale = og.locale ?? DEFAULT_LOCALE
  // An unpaired post still needs a stable key or it would collide with every other
  // unpaired post. Its own route is unique, so use that.
  const key = meta.properties?.TRANSLATION_KEY ?? `_solo:${entry.url}`
  const url = siteUrl(locale, entry.url)

  const description = (og.description ?? meta.excerpt ?? "").trim()
  if (description.length < DESC_MIN) {
    problems.push(
      `${entry.url}: description is ${description.length} chars, under the ${DESC_MIN} the host's seo-audit requires`,
    )
  } else if (description.length > DESC_MAX) {
    console.warn(`  warn  ${entry.url}: description is ${description.length} chars (>${DESC_MAX} is a soft warning)`)
  }

  posts.push({
    key,
    locale,
    engineRoute: entry.url,
    url,
    absolute: `${ORIGIN}${url}`,
    title: meta.title ?? "",
    date: meta.dateIso ?? null,
    description,
    excerpt: meta.excerpt ?? "",
    categories: meta.categories ?? [],
    tags: meta.tags ?? [],
    series: meta.series ?? null,
    seriesIndex: meta.seriesIndex ?? null,
    readingTime: meta.readingTime ?? null,
    wordCount: meta.wordCount ?? null,
    // The engine RANKS the card image (#+COVER_IMAGE > :main mark > #+OG_IMAGE) and
    // the host reads. #+HERO_IMAGE is deliberately NOT in that chain, so a post with
    // only a hero has no card image — surfaced rather than silently blank.
    cardImage: meta.cardImage ?? null,
    cardImageAlt: meta.cardImageAlt ?? meta.mainImageAlt ?? "",
    heroImage: meta.heroImage ?? null,
    postId: meta.postId ?? null,
    postUrl: meta.postUrl ?? null,
    // Kept for the body file, stripped from the manifest below.
    _html: extractFragment(readText(join(dir, "index.html")), entry.url),
    _og: og,
    _relations: rel,
  })
}

// ---------------------------------------------------------------- families ----

// One entry per translation group: { key: { en: url, es: url } } — the exact shape
// src/seo/routes.js ROUTE_FAMILIES already consumes.
const families = {}
for (const p of posts) {
  families[p.key] ??= {}
  families[p.key][p.locale] = p.url
}

for (const p of posts) {
  const fam = families[p.key]
  p.alternates = Object.entries(fam).map(([hreflang, href]) => ({ hreflang, href: `${ORIGIN}${href}` }))
  const xd = fam[DEFAULT_LOCALE] ?? fam[p.locale]
  p.alternates.push({ hreflang: "x-default", href: `${ORIGIN}${xd}` })
  p.translations = Object.fromEntries(Object.entries(fam).filter(([l]) => l !== p.locale))
}

// ---------------------------------------------------------- per-post bodies ----

// Written as one file per post so the host can import.meta.glob them into separate
// chunks. Route-shaped path, so a collision is impossible.
for (const p of posts) {
  const file = join(POSTS_DIR, p.locale, `${p.engineRoute.replace(/^\//, "").replace(/\//g, "__")}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(
    file,
    JSON.stringify(
      {
        url: p.url,
        locale: p.locale,
        title: p.title,
        date: p.date,
        html: p._html,
        // og-metadata carries every field the host's useSeoHead needs, as clean JSON.
        // Preferred over regex-parsing `seoMeta` out of the generated SFC.
        seo: p._og,
        relations: p._relations,
        alternates: p.alternates,
        translations: p.translations,
        comments: p.postId ? { postId: p.postId, postUrl: p.postUrl } : null,
      },
      null,
      2,
    ),
  )
  p.body = file.replace(/^dist\//, "")
}

for (const p of posts) {
  delete p._html
  delete p._og
  delete p._relations
}

// -------------------------------------------------------- indexes and pages ----

const byLocale = (fn) => {
  const out = {}
  for (const p of posts) {
    for (const k of fn(p)) {
      out[p.locale] ??= {}
      out[p.locale][k] ??= []
      out[p.locale][k].push(p.url)
    }
  }
  return out
}
const categories = byLocale((p) => p.categories)
const tags = byLocale((p) => p.tags)

// Series order is the ENGINE's: SERIES_INDEX wins, else date ascending, because a
// series reads forward.
const series = {}
for (const p of posts) {
  if (!p.series) continue
  series[p.locale] ??= {}
  series[p.locale][p.series] ??= []
  series[p.locale][p.series].push({ url: p.url, title: p.title, date: p.date, position: p.seriesIndex ?? null })
}
for (const loc of Object.values(series)) {
  for (const items of Object.values(loc)) {
    items.sort(
      (a, b) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
        String(a.date).localeCompare(String(b.date)),
    )
  }
}

// Newest first — the order a reader walks a blog in.
const timeline = {}
for (const p of posts) {
  timeline[p.locale] ??= []
  timeline[p.locale].push(p.url)
}
for (const list of Object.values(timeline)) {
  const at = (u) => posts.find((p) => p.url === u)
  list.sort((a, b) => String(at(b).date ?? "").localeCompare(String(at(a).date ?? "")))
}

// Pagination is PRERENDERED: /blog, /blog/page/2, … Every page is a static route
// because vite-ssg only prerenders what router.getRoutes() enumerates and skips
// anything carrying a :param.
const pages = {}
for (const [locale, list] of Object.entries(timeline)) {
  const prefix = `${localePrefix(locale)}${BASE}`
  const buckets = []
  for (let i = 0; i < list.length; i += PAGE_SIZE) buckets.push(list.slice(i, i + PAGE_SIZE))
  if (buckets.length === 0) buckets.push([])
  pages[locale] = buckets.map((items, i) => ({
    number: i + 1,
    url: i === 0 ? prefix : `${prefix}/page/${i + 1}`,
    items,
    prev: i === 0 ? null : i === 1 ? prefix : `${prefix}/page/${i}`,
    next: i === buckets.length - 1 ? null : `${prefix}/page/${i + 2}`,
  }))
}

// The featured post is simply the newest one; the rest of the first page follows it.
const featured = Object.fromEntries(Object.entries(timeline).map(([l, list]) => [l, list[0] ?? null]))

// ------------------------------------------------------------ search index ----

// Titles, excerpts and tags only, one file per locale, loaded on demand so it never
// touches the host's 180 KB main-bundle budget.
for (const locale of Object.keys(timeline)) {
  const rows = posts
    .filter((p) => p.locale === locale)
    .map((p) => ({ url: p.url, title: p.title, excerpt: p.excerpt, tags: p.tags, date: p.date }))
  const file = join(dirname(OUT), `blog-search-${locale}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(rows))
}

// ------------------------------------------------------------------ write ----

/*
 * TWO files, not one.
 *
 * The host's routeKind()/localeSwapTarget() run on EVERY page of the site, so
 * whatever they import lands in its main bundle — a budget of 180 KB gzipped
 * that the blog must not eat. Those functions need only paths, locales and
 * translation groups, so that is all `manifest.json` carries.
 *
 * Everything an archive page renders — titles, descriptions, card images, the
 * per-page item lists — goes to `blog-index.json`, which only the archive view
 * imports and which therefore lands in that view's own chunk.
 */
const routing = {
  base: BASE,
  origin: ORIGIN,
  defaultLocale: DEFAULT_LOCALE,
  locales: [...new Set(posts.map((p) => p.locale))].sort(),
  counts: {
    posts: posts.length,
    families: Object.keys(families).length,
    pages: Object.values(pages).reduce((n, l) => n + l.length, 0),
  },
  families,
  /* Minimal per-post row: enough to route and to pair locales, nothing more. */
  routes: posts.map((p) => ({ url: p.url, locale: p.locale, key: p.key })),
  pages: Object.fromEntries(
    Object.entries(pages).map(([locale, list]) => [
      locale,
      list.map(({ number, url, prev, next }) => ({ number, url, prev, next })),
    ]),
  ),
}

writeFileSync(
  join(dirname(OUT), 'blog-index.json'),
  JSON.stringify({ posts, featured, timeline, pages, categories, tags, series }, null, 2),
)

const manifest = {
  generatedFrom: SITE,
  base: BASE,
  origin: ORIGIN,
  defaultLocale: DEFAULT_LOCALE,
  pageSize: PAGE_SIZE,
  locales: [...new Set(posts.map((p) => p.locale))].sort(),
  counts: {
    posts: posts.length,
    families: Object.keys(families).length,
    series: Object.values(series).reduce((n, l) => n + Object.keys(l).length, 0),
    pages: Object.values(pages).reduce((n, l) => n + l.length, 0),
  },
  posts,
  families,
  featured,
  timeline,
  pages,
  categories,
  tags,
  series,
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(routing, null, 2))
void manifest

console.log(
  `generate-manifest: ${posts.length} post(s), ${Object.keys(families).length} translation group(s), ` +
    `${manifest.counts.pages} archive page(s), locales [${manifest.locales.join(", ")}] -> ${OUT}`,
)

if (problems.length) {
  console.log(problems.map((p) => `  ${STRICT ? "FAIL" : "warn"}  ${p}`).join("\n"))
  if (STRICT) {
    console.log(`\n${problems.length} problem(s) — refusing to publish a corpus the host's gates would reject.`)
    process.exit(1)
  }
}
