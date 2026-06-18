# Memory store format spec

## Topic file

One fact per file, kebab-case filename (convention: `<type>_<slug>.md`, e.g. `project_fill_capture.md`).

```markdown
---
name: project-fill-capture            # stable id; used as index link text
description: <one-line hook — THIS becomes the index line; keep ≈100 chars>
metadata:
  type: user | project | reference | feedback   # groups the index; unknown types → "Other"
  status: active | archived            # optional, default active
---

<full detail in the body — NOT loaded into the always-on index>
Link related memories with [[their-name]].
```

Rules:
- `name` and `description` are required for a clean index. Files without valid frontmatter are
  reported by `analyze` and still indexed using the filename + first body line (fix them).
- Keep `description` short. It is the hot-path cost. Everything else goes in the body.

## Index (`MEMORY.md`)

Generated, never hand-edited. Loaded into context every session. Layout:

```markdown
# Memory index

## User
- [name](file.md) — hook

## Project
- [name](file.md) — hook

## Reference
- [name](file.md) — hook

## Archived (cold — read on demand)
Completed/older memories (N) are indexed in [archive/MEMORY.archive.md](archive/MEMORY.archive.md).
Read it when the active memories above don't cover the question; topic files live in `archive/`.
```

- Entries are grouped by `metadata.type` in the order user → project → reference → feedback → others.
- Hooks are the `description` collapsed to one line and truncated to `--max-hook` chars (default 100).
- If the rendered index would exceed `--budget`, hooks auto-shrink in steps (down to 24 chars). If it
  still doesn't fit, the index reports STILL OVER BUDGET → archive done memories or split into
  sub-indexes (see workflow.md, hierarchical phase).

## Archive (cold storage)

```
memory/
├── MEMORY.md
├── <active topic files>.md
└── archive/
    ├── MEMORY.archive.md      # generated index of archived files (not loaded each session)
    └── <archived topic files>.md
```

- Archived files are excluded from `MEMORY.md` and listed in `archive/MEMORY.archive.md`.
- `compact` and `archive` both keep the two indexes in sync.

## Budget

- Default index budget: **24000 bytes** (`--budget`). Tune per environment.
- The budget exists because the index is loaded every session; an over-budget index loads truncated,
  silently degrading recall.
