# CRM System — documentation

This directory is the full reference for the crm-system monorepo.
Start at the top (`README.md` at the repo root) and drill down.

---

## Quick links

| Doc | What it covers |
| --- | --- |
| [`README.md`](../README.md) | Repo root: quick start, Docker stack, env vars, dev workflow |
| [`PROGRESS.md`](./PROGRESS.md) | Day-by-day development log (Day 1 → Day 9+) |
| [`architecture.md`](./architecture.md) | Topology, modules, request lifecycle, auth, audit, wire-format conventions |
| [`database.md`](./database.md) | Every Prisma model, field, index, enum, and ERD |
| [`api.md`](./api.md) | Full HTTP endpoint reference with request/response shapes |
| [`ai-agent.md`](./ai-agent.md) | AI tool catalogue, conversation model, prompt patterns |
| [`frontend.md`](./frontend.md) | Pages, components, routing, the typed `lib/api.ts` client, known gotchas |
| [`rbac.md`](./rbac.md) | Permission catalogue, system roles, enforcement, how to add a permission |
| [`operations.md`](./operations.md) | Env vars, dev workflow, migrations, backup/restore, troubleshooting |
| [`contributing.md`](./contributing.md) | How to add a new resource / tool / permission, conventions, pitfalls |

---

## When to read which doc

| If you want to…                                  | Read                                                  |
| ------------------------------------------------ | ----------------------------------------------------- |
| Get the project running                           | `../README.md`                                        |
| Understand a high-level diagram                   | `architecture.md`                                     |
| Look up a Prisma field                            | `database.md`                                         |
| Look up an HTTP endpoint                          | `api.md`                                              |
| Look up an AI tool                                | `ai-agent.md`                                         |
| Add a new page / component                        | `frontend.md` + `contributing.md`                     |
| Add a new resource (full-stack)                   | `contributing.md` § "Adding a new resource"          |
| Add a new permission                              | `rbac.md` § "Adding a new permission"                 |
| Add a new AI tool                                 | `ai-agent.md` + `contributing.md`                     |
| Run a migration                                   | `operations.md`                                       |
| Debug a runtime issue                             | `operations.md` § "Troubleshooting" + `frontend.md` § "Known frontend gotchas" |
| Catch up on what shipped when                     | `PROGRESS.md`                                         |

---

## Documentation conventions

- **User-facing labels** in screenshots, code samples, and prose
  are in **繁體中文香港口語** (the product is for HK sales teams).
- **Technical identifiers** (route paths, field names, code
  symbols) stay in English.
- **Code samples** are TypeScript unless otherwise noted.
- **Money values** in samples are illustrative, not real.

---

## Last-known-good day

This documentation snapshot reflects the state of the codebase at
**Day 9** (the most recent day with merged work). The day-by-day
changelog is the source of truth for what shipped when —
`PROGRESS.md` is appended to, not rewritten.

If you spot a doc that disagrees with the code, the code wins and
the doc is wrong. Either fix the doc in the same PR as the code
change, or open a follow-up issue.
