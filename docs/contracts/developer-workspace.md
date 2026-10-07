# Developer Workspace contract

Own supported code editing/checking between an immutable snapshot and a deployment candidate.

Initial supported scope: existing widget/form scripts only where the verified round-trip contract applies.

Primary editable artifacts: client.ts/server.ts when present and supported. Generated runtime/history/types are tool-owned and read-only by default.

Required capabilities: open source, ELMA-aware diagnostics where typings exist, compile/check, conservative lint, exact diff, checkpoint/restore and candidate build only after required checks pass.

This is not a visual ELMA Designer. Unsupported entities remain inspect-only. Hosted Wiki never executes arbitrary uploaded customer code. AI and VS Code are optional clients.
