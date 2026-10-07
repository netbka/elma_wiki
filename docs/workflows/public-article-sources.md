# Public article sources

Issue #27, TRUST-01 from the developer portal audit #13.

## Reader outcome

Each public article has an `article-sources` heading and a contents link to it.
Readers can open the article's declared public references without mistaking the
presence of a source for evidence of successful compilation, import or live ELMA
behavior. Existing article status, version restrictions and content are unchanged.
No verification dates, compatibility claims or extra status badges are generated.

## Shared rendering

`web/public-article-sources.mjs` classifies references, builds the bounded view
model and renders HTML. `lib/public-site.mjs` and the ArticleSources stories call
the same renderer. It takes declared sources, not arbitrary prebuilt link models.
No new browser bundle, network request, dependency or private API is introduced.
Sources are regular links with `noreferrer noopener`, not embedded remote content.

The three states are `listed`, `empty` and `invalid`. An absent list is empty;
a malformed container or entry is invalid. Mixed lists retain approved references
and show generic placeholders for invalid entries. Raw rejected values are never
printed: even a path, object or URL supplied by mistake can contain private data.
These states describe metadata quality, not a verification result.

## Link policy and maintenance

Repository references must name an explicitly reviewed file in `PUBLIC_FILES`,
either relative to this repository or through its canonical GitHub blob/main URL.
A directory allowlist would admit arbitrary private filenames inside docs/tools.
The current allowlist covers the actual source arrays in both article modules.
Add a new public file to the list in the same change as its article; check its
tracked contents first. Tests also check that current linked files exist and are
regular files. Links refer to current main, not immutable test evidence.

External references are restricted to canonical HTTPS ELMA help-page URLs on
elma365.com or www.elma365.com, under /ru/help/ or /en/help/. Plain anchors are
allowed. Credentials, queries, nonstandard ports, encodings, control characters,
traversal, protocol-relative URLs, other hosts and other schemes are rejected.
Invalid addresses are not decoded or repaired into allowed destinations. This is
a deliberately narrow documentation policy, not a general-purpose URL validator.
Adding a new documentation provider requires an explicit policy/test change.
The renderer does not fetch links or certify their availability or accuracy.

## Verification

- `node --test test/public-article-sources.test.mjs`: metadata/type failures,
  malformed encodings, private/unsafe URLs, no value echoes, no mutation and no
  extra verification badge.
- `node --test test/public-article-sources-integration.test.mjs`: every actual
  article, existing statuses, source anchors, allowed file existence, fallback
  rendering through the real generator and registered shared stories.
- `npm run test:public` and `npm run test:public:browser`: complete static build,
  existing public isolation, sources on every article, keyboard links and
  desktop/mobile panel screenshots.
- `npm run check:storybook`, `npm run build:storybook`, then
  `node tools/public-field-guide-visual-check.mjs`: the existing public visual
  check also exercises listed/empty/invalid article-source stories at 1440/390.

The existing CI artifact includes only synthetic public PNGs and its evidence
JSON. Browser evidence is not a WCAG-conformance or live ELMA verification claim.
Private projects, release/delivery logic, authentication and bot work are outside
this change. The whole-public-site Storybook exclusion remains in force: these
three stories cover the sources panel, not the rest of each article's renderer.
