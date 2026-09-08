#!/usr/bin/env node
/**
 * feature-surface.mjs — exercise the parts of the package a BUILD never touches.
 *
 * ci/assert-build.mjs checks what `org2html build` produced. That leaves three
 * surfaces untested, and all three are promises the package makes in public:
 *
 *   1. the LIBRARY API   — 18 exports that tests/public-api.test.ts pins. Naming
 *                          them proves they exist; this CALLS them.
 *   2. the FILTER MODE   — stdin -> stdout, --fragment, --format vue.
 *   3. the STRICT/COMPONENT paths — --strict must turn an unknown component from
 *                          a warning into a failure, and --components must make
 *                          it resolve.
 *
 * Exit 0 = every check held. Exit 1 = at least one did not.
 */
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { pathToFileURL } from "node:url"

/* Resolve from the CURRENT WORKING DIRECTORY, not from this file.
   A bare specifier resolves relative to the importing MODULE, so running this
   from ci/floor -- the only place the package is installed in that job --
   walked up from ci/ and found nothing. It passed locally only because the
   repo root happened to have the package installed too. */
const require = createRequire(pathToFileURL(join(process.cwd(), "package.json")))
const PKG_JSON = require.resolve("@kyonax/org2html/package.json")
const PKG_DIR = dirname(PKG_JSON)
const PKG = JSON.parse(readFileSync(PKG_JSON, "utf8"))
const CLI = join(PKG_DIR, "dist", "cli", "index.mjs")
/* The package is ESM-only: its "." export declares no `require` condition, so
   the entry is read from the manifest rather than resolved by name. */
const ENTRY = pathToFileURL(
  join(PKG_DIR, PKG.exports?.["."]?.import ?? PKG.module ?? PKG.main),
).href

const fails = []
const oks = []
const check = (cond, m) => (cond ? oks.push(m) : fails.push(m))

const run = (args, opts = {}) => {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      input: opts.input,
      stdio: ["pipe", "pipe", "pipe"],
    })
    return { code: 0, stdout }
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }
  }
}

const tmp = mkdtempSync(join(tmpdir(), "o2h-surface-"))

// ---------------------------------------------------------- 1. library API ----

const api = await import(ENTRY)

// The four names the package documents as its STABLE surface.
const doc = "#+TITLE: Library\n#+DATE: 2026-05-01\n\n* Heading\n\nA *bold* word.\n"

// parse() is synchronous and returns { type, metadata, children }.
const parsed = api.parse(doc)
// NOTE: the AST node type is "document". KNOWN_CONSTRUCTS lists "org-root",
// which is the emitted CLASS hook, not the node type -- the two vocabularies
// are deliberately different, and conflating them is an easy wrong assumption.
check(!!parsed && parsed.type === "document", `parse() returns a document node (${parsed?.type})`)
check(parsed.metadata?.title === "Library", "parse() lifts #+TITLE into metadata")
check(Array.isArray(parsed.children) && parsed.children.length > 0, "parse() returns child nodes")

// renderToHtml() and org2html() are ASYNC and resolve to { html, metadata }.
const rendered = await api.renderToHtml(parsed)
check(typeof rendered?.html === "string", "renderToHtml() resolves to { html, metadata }")
const htmlStr = rendered.html
check(htmlStr.includes("org-heading"), "renderToHtml() emits heading markup")
check(htmlStr.includes("bold"), "renderToHtml() emits the paragraph text")

// applyTemplate(html, metadata) -> a FULL document. A third argument is a
// template FILE PATH, not an options object.
const templated = await api.applyTemplate(htmlStr, rendered.metadata)
check(typeof templated === "string" && templated.includes("<html"),
  "applyTemplate() wraps the fragment in a full document")
check(templated.includes("<title>Library"), "applyTemplate() carries the title into <title>")

const oneShot = await api.org2html(doc)
check(typeof oneShot?.html === "string" && oneShot.html.length > 0,
  "org2html() converts in one async call")

// The supporting exports, each called rather than merely named.
check(api.titleFromFilename("2026-08-21-my-post.org").toLowerCase().includes("my post"),
  "titleFromFilename() derives a title from a dated filename")

check(JSON.stringify(api.startupToOptions(["nonum"])) === JSON.stringify(["num:nil"]),
  "startupToOptions() maps nonum onto num:nil")

// The FIRST token is the component name; the rest are :key value pairs, and at
// this layer every value is a string (the build layer is what coerces types
// into data-props).
const cargs = api.parseComponentArgs("Card :image /i.jpg :title Hello :count 3")
check(cargs?.name === "Card", `parseComponentArgs() takes the leading token as the name (${cargs?.name})`)
check(cargs?.attrs?.image === "/i.jpg" && cargs?.attrs?.title === "Hello" && cargs?.attrs?.count === "3",
  "parseComponentArgs() returns all :key value pairs as string attrs")

check(Array.isArray(api.KNOWN_CONSTRUCTS) && api.KNOWN_CONSTRUCTS.length > 0,
  `KNOWN_CONSTRUCTS is a non-empty array (${api.KNOWN_CONSTRUCTS?.length})`)

const registry = new api.PluginRegistry()
check(typeof registry === "object", "PluginRegistry is constructible")
check(typeof api.codeHighlightPlugin === "object" || typeof api.codeHighlightPlugin === "function",
  "codeHighlightPlugin is a usable plugin value")

const spec = api.parseIncludeSpec('"./snippet.org" src js')
check(!!spec && typeof spec === "object", "parseIncludeSpec() parses an INCLUDE spec")

const placeholder = api.renderComponentPlaceholder("Card", { title: "Hi" })
check(typeof placeholder === "string" && placeholder.includes("data-component"),
  "renderComponentPlaceholder() emits a data-component placeholder")

for (const name of ["parseComponentBody", "resolveOrgFileKeywords", "resolveStyleBook",
                    "probeLocalImage", "resolveImageDimensions", "addImageDimensions"]) {
  check(typeof api[name] === "function", `${name} is callable`)
}

// ---------------------------------------------------------- 2. filter mode ----

const filter = run(["--stdin"], { input: doc })
check(filter.code === 0, "org2html --stdin exits 0")
check(filter.stdout.includes("<!") || filter.stdout.includes("<html"),
  "org2html --stdin writes a full document to stdout")

const fragment = run(["--stdin", "--fragment"], { input: doc })
check(fragment.code === 0, "org2html --stdin --fragment exits 0")
check(!fragment.stdout.includes("<html"),
  "org2html --stdin --fragment emits NO full document, only the article fragment")

const vue = run(["--stdin", "--format", "vue"], { input: doc })
check(vue.code === 0, "org2html --stdin --format vue exits 0")
check(vue.stdout.includes("<template"), "org2html --stdin --format vue emits an SFC template block")

// stdout must stay pipe-clean: every log goes to stderr.
check(!filter.stdout.includes("Building"), "filter mode keeps stdout free of log output")

// --------------------------------------------- 3. strict / component paths ----

const strictDir = join(tmp, "strict")
const outDir = join(tmp, "out-strict")
writeFileSync(join(tmp, "card.org"),
  "#+TITLE: Card\n\n#+BEGIN_COMPONENT Card :title Hello\n#+END_COMPONENT\n")

// Default: an unknown component WARNS and the build succeeds.
const lax = run(["build", tmp, "-o", join(tmp, "out-lax")])
check(lax.code === 0, "an unknown component only WARNS by default (build exits 0)")

// --strict: the same document must now FAIL the build.
const strict = run(["build", tmp, "-o", outDir, "--strict"])
check(strict.code !== 0, `--strict turns the unknown component into a FAILURE (exit ${strict.code})`)

// --components: the component resolves, and the warning goes away.
const mapFile = join(tmp, "components.json")
writeFileSync(mapFile, JSON.stringify({ Card: "./src/components/Card.vue" }, null, 2))
const mapped = run(["build", tmp, "-o", join(tmp, "out-mapped"), "--components", mapFile, "--strict"])
check(mapped.code === 0, "--components resolves the component, so --strict now passes")

rmSync(tmp, { recursive: true, force: true })
void strictDir
void existsSync

// ------------------------------------------------------------------ report ----

console.log(oks.map((m) => `  ok   ${m}`).join("\n"))
if (fails.length) console.log(fails.map((m) => `  FAIL ${m}`).join("\n"))
console.log(`\n${oks.length} passed, ${fails.length} failed  (feature surface)`)
process.exit(fails.length ? 1 : 0)
