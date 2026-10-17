# Internal field and function lookup

Authenticated users open an existing project or the synthetic teaching example at `/p/showcase/`, select field/function lookup, search, and open a captured source reference. The viewer retains the query and focuses the selected source; imported code remains inert. Missing/ambiguous matches remain explicit and never prove that the original ELMA configuration lacks a field.

`dist/object-search.js` is the shared renderer used by the internal viewer and `storybook/stories/ObjectSearch.stories.js`. `test/object-search.test.mjs` and `tools/first-use-browser-check.mjs` cover it. The separate public tutorial and static site were removed by the owner's 2026-10-17 direction. Storybook uses synthetic data only and is local engineering infrastructure.
