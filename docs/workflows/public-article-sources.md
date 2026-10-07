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
a badge.

## Shared authority and limits

`web/public-article-sources.mjs` holds the classification model and the HTML
renderer. `lib/public-site.mjs` uses it for the static build and
`storybook/stories/PublicArticleSources.stories.js` renders the same function
inside the same article shell. Storybook does not copy the production markup.

Only two kinds of reference become links:

- a relative path into the intentionally public part of the repository
  (`README.md`, `docs/`, `lib/`, `web/`, `tools/`, `test/`, `examples/`,
  `extensions/`, `storybook/`, `testing/`, `deploy/`, `dist/`, a few root
  files), linked to the project's GitHub `blob/main` view;
- an `https://` address on `elma365.com` or on this project's GitHub repository.

Anything else is rendered as escaped text with the reason and "ссылка не
публикуется": non-strings, empty or oversized values, whitespace or quote
characters, absolute or drive paths, hidden segments (`.env`, `.local`, `..`),
paths outside the public roots (`qa/`, `node_modules/`, uploads), non-https
schemes (`javascript:`, `data:`, `http:`), credentials in the URL, and hosts
outside the allow list. The generator does not read the filesystem at render
time; existence of declared repository files is a test, not a runtime check.

## Visible states

The manifest capability `public-article-sources` maps the renderer to:

- `public-article-sources--listed`: all declared sources are valid links with
  their kind (repository file / external documentation) and the status note.
- `public-article-sources--empty`: no declared sources; fallback text, no links.
- `public-article-sources--invalid`: a mix of valid and rejected references;
  rejected ones are plain text with the reason and an explicit note that this
  does not change the article status.

## Verification

`node --test test/public-article-sources.test.mjs` covers classification of
populated, empty, malformed and unsafe input, escaping, the three states, the
real public generator with the real article data (every published article
must currently be in the `listed` state and every declared repository path
must exist), and the Storybook registration. `npm run test:public` remains the
full build and local-link gate (the contents link `#article-sources` resolves
on every article page). `npm run test:public:browser` opens a real article,
checks the section, its links' schemes/hosts and mobile overflow, and keeps
the no-backend-request assertion. `npm run check:storybook` validates the
three story IDs; `npm run build:storybook` builds the shared renderer.
