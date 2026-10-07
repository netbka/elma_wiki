# ELMA Wiki Storybook authority

Storybook is the current UI review surface for ELMA Wiki. It uses synthetic data only.

## Core rule

For a wired surface there is one renderer:

production ViewModel -> shared renderer <- synthetic Storybook fixture.

Do not copy production markup into stories.

When visible behavior/state changes, update the affected current story/workflow in the same task.

## Initial groups

- Production/Public
- Production/Projects
- Production/ProjectViewer
- Production/Connections
- Production/DeveloperWorkspace
- Production/Deployment
- Workflows/SourceImport
- Workflows/WorkspaceChange
- Workflows/TargetDeployment
- Workflows/Verification
- Design/* only for explicitly current unimplemented targets

## Workflow requirement

Source import and deployment are behavior-heavy. Their stories must expose normal, loading, partial/failure, retry and success/verified states defined by current contracts.

A successful deployment story must visually distinguish deployed-unverified from verified.

## Review manifest

Create storybook/review-manifest.json as the versioned map capability -> action/entry -> renderer -> story ids -> required visible states. Current stories are either represented or explicitly excluded with a reason.

## Safety

Never put real .e365 archives, credentials, customer object names, customer code or production screenshots in Storybook. Use synthetic fixtures.

Storybook evidence proves the Wiki UI under fixture conditions. It does not prove an ELMA Source export, Target deployment or live provider/runtime behavior.
