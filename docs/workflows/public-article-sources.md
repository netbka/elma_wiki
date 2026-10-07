# Public article sources

Issue: #27. Follow-up to the audit in #13 (TRUST-01): article definitions in
`dist/articles.js` and `dist/developer-articles.js` already declare `sources`,
but the public article page did not render them.

## Outcome and entry

Every public article page (`/articles/<id>/`) ends with a "Источники" section
and lists it in the article contents. A reader sees which repository files and
which external documentation pages the article relies on, and reads next to
them that a reference is not a verification: the article status badge is
repeated verbatim in that section, and nothing in the section upgrades it.

No test dates, compatibility statements or live ELMA claims are invented. An
article without sources gets an honest fallback ("источники не указаны"), not
a new verification badge.

## Shared authority and limits

`web/public-article-sources.mjs` holds the classification model and the HTML
renderer. `lib/public-site.mjs` uses it for the static build and
`storybook/stories/PublicArticleSources.stories.js` renders the same function
inside the same article shell. Storybook does not copy the production markup.

Only two kinds of reference become links:

- a file named in the module's exact `PUBLIC_FILES` allowlist, linked to this
  project's GitHub `blob/main` view; the equivalent canonical GitHub URL is
  also accepted. Add new public files explicitly alongside their article and
  test. A directory name alone does not authorize private filenames inside it;
- a canonical `https://` ELMA help-page URL on `elma365.com` or
  `www.elma365.com`, under `/ru/help/` or `/en/help/`, ending in `.html`, with
  an optional plain alphanumeric/underscore/hyphen fragment.

Rejected references produce only a generic category reason and "ссылка не
публикуется". Their original value is never retained in the view model or
printed, even escaped: malformed metadata can contain credentials or private
paths. Circular objects, BigInt values and other non-strings are not serialized.
Queries, alternate ports, encoded/normalized paths, arbitrary same-host endpoints,
unsafe schemes, unknown hosts, absolute paths and unreviewed files are rejected.
The generator does not fetch references or read the filesystem at render time;
existence of declared repository files is a test, not a runtime check. Links
point to current main and are not immutable verification evidence.

## Visible states

The manifest capability `public-article-sources` maps the renderer to:

- `public-article-sources--listed`: all declared sources are valid links with
  their kind (repository file / external documentation) and the status note.
- `public-article-sources--empty`: no declared sources; fallback text, no links.
- `public-article-sources--invalid`: malformed list or rejected references;
  valid entries remain linked, rejected values stay hidden behind category
  reasons and an explicit note that this does not change the article status.

## Verification

`node --test test/public-article-sources.test.mjs` covers classification of
populated, empty, malformed and unsafe input, escaping, the three states, the
real public generator with the real article data (every published article
must currently be in the `listed` state and every declared repository path
must exist), and the Storybook registration. The additional
`test/public-article-sources-hardening.test.mjs` checks private-value suppression,
unserializable/sparse metadata, strict destinations, input preservation and
malformed references through the actual generator.

`npm run test:public` remains the full build and local-link gate (the contents
link `#article-sources` resolves on every article page).
`npm run test:public:browser` opens a real article, checks the section, links and
mobile overflow, and keeps the no-backend-request assertion.
`npm run check:storybook` validates the three story IDs; `npm run build:storybook`
builds the shared renderer. The existing `tools/public-field-guide-visual-check.mjs`
checks those built stories at 1440/390, including suppression of synthetic private
sentinels and keyboard focus on valid links. Screenshots show synthetic UI only,
not live ELMA behavior or accessibility conformance.
