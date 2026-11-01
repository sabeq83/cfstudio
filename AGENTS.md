# CF Studio V3

Follow docs/PRD.md and docs/implementation_plan.md. Update the Execution Task List after each verified phase. Before editing a new file, record before/after in the implementation plan. Read installed Next.js documentation before framework changes.

Source MAKNA Flow staging is read-only. Target database must differ from source. No secret, real credential, session, or provider token in code/log/export. No fallback default tenant. UI uses semantic tokens and must be shown in standalone mockup before React edits.

One shared render pipeline; source compilers do not render. Provider dispatch defaults OFF. No production deployment without explicit human instruction. Git release only to a verified CF Studio remote, never MAKNA Flow remote.
