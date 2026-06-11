---
name: user-prefers-no-magic-mcp
description: User hit Magic MCP (21st.dev) limit — implement UI in code, not via Magic
metadata:
  type: feedback
---

On the my-site project the user asked to stop calling Magic MCP (21st.dev) because of a usage limit, and to implement everything in code instead (motion + the ui-ux-pro-max skill).

**Why:** Limited Magic MCP quota; also the Magic builder returned unusable output here (the project has no Tailwind/shadcn, so its shadcn-oriented snippets needed full rewriting anyway).

**How to apply:** For UI work on this project, build components by hand in the project's idiom (React + motion + inline styles + CSS variables in index.css). Use ui-ux-pro-max for design guidance. Don't invoke `mcp__magic__*` tools. Related: [[design-direction-adras-atlas]].
