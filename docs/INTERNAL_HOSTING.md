# Internal hosting only

Authority: owner's 2026-10-17 instruction, recorded in the [product contract](SOLUTION_FIRST_PRODUCT_PLAN.md#current-operating-priority-owner-2026-10-17).

Wiki serves our team. Public use, a public Learn/marketing site and publication to Vercel or another public platform are excluded. They are not deferred roadmap work. Use the existing internal Docker service and its [operations runbook](../deploy/README.md); local development and synthetic Storybook remain supported.

Only the sign-in/entry shell, its required assets and authentication/health endpoints are anonymous. Product content, guides, the synthetic showcase and engineering flows require a server-validated session, including direct HTML and asset URLs. Shared configuration access remains equal for authenticated team actors. The existing corporate identity contract and internal network controls remain authoritative. `X-Robots-Tag` discourages indexing; it does not enforce access.

The public renderer, templates, build/preview commands, public-only stories/tests and public CI jobs are removed. Internal articles and the shared object-search renderer remain available after sign-in. `package.json` stays private.

`vercel.json` is deliberately a **deny-only** configuration: `git.deploymentEnabled: false` disables Git-triggered deployment, and the build command fails. `.vercelignore` excludes every file from CLI upload. These are guards, not a supported deployment mode. The Git switch follows [Vercel's documented configuration](https://vercel.com/docs/project-configuration/git-configuration). No other public publishing workflow may be added under the current product authority.

Repository changes do not revoke an existing deployment or disconnect a provider account. Closing existing Vercel deployments/domains and disconnecting its repository integration require an observed provider-side action. In the 2026-10-17 task the owner explicitly took that action over after the login required 2FA. Do not claim it completed from this code change. Future internal release follows the existing merge/deploy gates; this instruction does not authorize an ELMA import.
