# Public field-lookup learning journey

Issue: #20. Follow-up to the audit in #13; scope is UX-02 and a bounded first
learning slice of UX-01/DOC-01, not the whole portal redesign.

## Outcome and entry

`/learn/find-field/` is a static, Russian-language tutorial. The public
"Найти поле" task and "Пройти учебный пример" secondary hero action lead
there. The article index remains the primary reading action. The existing
example gallery stays available and links into the task.

A developer identifies an application's field, its type and a source pointer,
then understands what still needs checking in Designer. No login, uploaded
archive, terminal, Git or AI is required. This is lookup, not adding a field.

## Shared authority and limits

`web/public-field-guide.mjs` holds a deliberately small synthetic teaching
fixture, its qualified lookup model and the HTML renderer. It is used directly
by `lib/public-site.mjs` and `storybook/stories/PublicFieldGuide.stories.js`.
Storybook does not copy the production markup.

The fixture is an illustrative document fragment, not an exported solution,
a server-verified recipe or evidence about the visitor's project. It includes
a second application with the same `title` field code to demonstrate why
matching a field name globally is insufficient.

The source pointer is calculated from the selected field's actual array
index in that fixture. Missing evidence and repeated owners/field codes must
not render the successful result. The model is not a replacement for the
project parser and is not connected to uploaded data.

The tutorial does not resolve form bindings, verify event handlers, compile,
edit, import or connect to ELMA. It explicitly distinguishes finding a
description from proving runtime behavior.

## Visible states and accessibility

The manifest capability `public-field-lookup` maps the shared renderer to:

- `public-field-guide--ready`: sequential instructions, expected result,
  optional JSON disclosure, self-check and Designer-first continuation.
- `public-field-guide--unavailable`: insufficient evidence and recovery;
  absence in an index is not proof that a field is absent in ELMA.
- `public-field-guide--ambiguous`: duplicate evidence, no first-match success.

Navigation uses native section links; JSON and answers use native `details`
and `summary`. There are no custom keyboard handlers, required client-side
scripts, new backend requests or new public assets. Existing public CSS is
also loaded in Storybook. The old whole-site coverage exclusion remains:
covering this tutorial does not claim coverage of every public page.

## Verification

`node --test test/public-field-guide.test.mjs` checks qualified lookup, the
source pointer, mutation-free input handling, missing/unknown/ambiguous
evidence, escaping, page routing and local tutorial links. It tests the actual
public generator with the actual landing template and bounded synthetic article metadata.

`npm run test:public` remains the full public build and local-link gate.
`npm run test:public:browser` additionally follows the actual homepage task
and first-example CTA, opens the tutorial disclosures by keyboard, checks
the successful result and mobile overflow, and retains backend-isolation
checks. `npm run check:storybook` validates the three registered story IDs;
`npm run build:storybook` builds their shared renderer. Linux CI runs
`test:public:browser` after the existing Chromium installation, alongside
the release browser check.

After `build:storybook`, run `node tools/public-field-guide-visual-check.mjs`.
It serves the built Storybook on an ephemeral loopback port, checks all three
actual stories at 1440 and 390 pixels, exercises native disclosures, rejects
external requests and saves screenshots. CI retains only `qa/public-*.png`
and the visual evidence JSON as `public-visual-evidence` for seven days.
These are synthetic public fixtures, never private release/project screenshots.
Inspect the images separately: passing overflow and state assertions is not
itself a visual approval. The evidence records the tested CI commit and browser.

Full build, browser and CI evidence must be reported separately from the
standalone model/generator tests. This task does not establish WCAG
conformance, deployment readiness or a live ELMA result.
