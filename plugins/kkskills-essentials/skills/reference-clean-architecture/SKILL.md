---
name: reference-clean-architecture
description: "Use this skill when designing or reviewing the architecture of a backend service — deciding where business logic lives, what depends on what, how to enforce boundaries, and how to migrate a legacy 'everything in one file' codebase toward layered design.
  Triggers include: 'Clean Architecture', 'hexagonal', 'ports and adapters', 'onion architecture', 'where does this logic go', 'entity vs DTO', 'repository pattern', 'use case', 'service vs use case', 'UnitOfWork' / 'UoW', 'import-linter', 'boundary enforcement', 'strangler fig', 'domain layer pure', 'controller too fat'.
  Also use when scaffolding a new service from scratch — to get the directory layout and naming right on day one.
  Do NOT use for tiny scripts, CLI utilities, throwaway prototypes, or pure UI work where the overhead isn't worth it. Layering small things is just overhead."
version: "0.1.0"
updated: "2026-06-19"
---

# Reference — Clean Architecture (project-agnostic)

## Overview

A stack-independent layering model that keeps business logic free of frameworks, databases, and HTTP. Same four layers work in Python/FastAPI, NestJS, Spring Boot, Go/Gin, or anything else — the only thing that changes per stack is the boundary-enforcement tool.

Four layers, strict dependency direction (outer depends on inner, never the reverse):

```
┌─────────────────────────────────────────────────────────────┐
│ Adapters / Routers / Controllers      (HTTP, CLI, schedulers)│
│   ↓ depend on                                                │
│ Use cases                            (orchestrate business)  │
│   ↓ depend on                                                │
│ Repositories                         (interfaces + ORM impl) │
│   ↓ depend on                                                │
│ Entities                             (domain types, pure)    │
└─────────────────────────────────────────────────────────────┘
```

Plus one orthogonal concept: **Unit of Work** sits at the use-case boundary and owns the transaction.

## When to Use

- ✅ A backend service with non-trivial business logic and more than one delivery mechanism (HTTP + cron + queue worker).
- ✅ Refactoring a "fat service / fat router" codebase via strangler-fig migration.
- ✅ Designing a new monorepo or service that other teams will extend.
- ❌ One-off scripts, throwaway PoCs, single-file utilities.
- ❌ Pure UI / static sites where there's no domain logic to protect.

## Process / Steps

### Step 1 — Place every file in one layer

Before writing the file, decide which layer it belongs to. If you can't, the layer is probably wrong.

| Layer        | Allowed imports                              | Forbidden imports                                |
|--------------|----------------------------------------------|--------------------------------------------------|
| Entity       | stdlib only, validation libs (Pydantic, zod) | ORM, HTTP, framework, DB driver, other entities' repos |
| Repository   | Entity types, ORM, DB driver                 | HTTP, framework, use cases, routers              |
| Use case     | Entity, Repository **interfaces** only       | ORM concrete, HTTP, framework primitives         |
| Adapter / Router | Use case, DTOs, framework, validation       | ORM directly, business logic inline              |

**Example (Python/FastAPI):**

```
backend/app/
├── entities/signal.py            # @dataclass(frozen=True) class Signal
├── repositories/signal_repo.py   # class SignalRepository(Protocol) + SqlSignalRepository
├── use_cases/mark_signal_dismissed.py  # def execute(uow, signal_id) -> Signal
├── unit_of_work.py               # class UnitOfWork: __enter__/__exit__ owns txn
└── routers/signal.py             # @router.post("/dismiss") thin handler
```

**Example (NestJS / TypeScript):**

```
apps/api/src/
├── signal/
│   ├── signal.entity.ts          # plain class, no decorators from typeorm
│   ├── signal.repository.ts      # interface + TypeOrmSignalRepository
│   ├── mark-signal-dismissed.usecase.ts
│   ├── unit-of-work.ts           # wraps DataSource.transaction
│   └── signal.controller.ts      # @Controller, thin
```

**Example (Spring Boot / Java):**

```
src/main/java/com/example/signal/
├── domain/Signal.java
├── domain/SignalRepository.java         # interface
├── infrastructure/JpaSignalRepository.java
├── application/MarkSignalDismissedUseCase.java
├── application/UnitOfWork.java          # @Transactional wrapper
└── interfaces/web/SignalController.java
```

### Step 2 — Pick the boundary-enforcement tool for your stack

The layering rule is worthless without automated enforcement. Pick one per stack and wire it into CI from day 1:

| Stack            | Tool                              | What it does                                       |
|------------------|-----------------------------------|----------------------------------------------------|
| Python           | `import-linter`                   | Contract-based forbidden-imports rules in `.importlinter` |
| TypeScript / JS  | `eslint-plugin-boundaries`        | ESLint rules grouped by directory roles            |
| TypeScript / JS  | `dependency-cruiser`              | Standalone graph linter; richer than ESLint plugin |
| Java             | `ArchUnit`                        | JUnit-style architecture assertions                |
| Go               | `go-arch-lint` / `archlint`       | YAML-defined layer rules                           |
| Any              | `git grep` in pre-commit          | Crude but works — fail on forbidden import strings |

**Example — `import-linter` contracts (Python):**

```ini
[importlinter]
root_packages = backend.app

[importlinter:contract:entities-pure]
name = Entities never import infrastructure
type = forbidden
source_modules = backend.app.entities
forbidden_modules = sqlalchemy, fastapi, backend.app.repositories, backend.app.routers

[importlinter:contract:use-cases-pure]
name = Use cases use repos via interfaces only
type = forbidden
source_modules = backend.app.use_cases
forbidden_modules = sqlalchemy, fastapi

[importlinter:contract:routers-via-use-cases]
name = Routers reach repos only through use cases
type = forbidden
source_modules = backend.app.routers
forbidden_modules = backend.app.repositories, sqlalchemy
```

- ☐ Contracts cover all four layers.
- ☐ Full-tree from day 1 — legacy code can't add new violations.
- ☐ Runs in CI on every PR, not optional.

### Step 3 — Decide on Unit of Work shape

The use-case layer owns the transaction. Pick one of two shapes:

**Shape A — UoW as context manager (preferred for greenfield):**

```python
def execute(uow: UnitOfWork, signal_id: SignalId) -> Signal:
    with uow:
        signal = uow.signals.get(signal_id)
        signal = signal.mark_dismissed()
        uow.signals.save(signal)
        return signal
    # commit happens on __exit__
```

**Shape B — `run_in_uow` helper (preferred when you need to compose multiple use cases per request):**

```python
result = run_in_uow(uow, lambda repos: (
    mark_signal_dismissed(repos, signal_id_1),
    mark_signal_dismissed(repos, signal_id_2),
))
```

- ☐ One transaction per use-case invocation (not per repo call).
- ☐ Caller (router) decides composition; use case never opens its own transaction.
- ☐ Read-only operations can skip UoW; writes always go through it.

### Step 4 — Name things consistently

| Concept                 | Convention                           | Example                              |
|-------------------------|--------------------------------------|--------------------------------------|
| Entity                  | Singular noun                        | `Signal`, `Position`, `User`         |
| Entity ID type          | `<Entity>Id`                         | `SignalId`, `UserId`                 |
| Repository interface    | `<Entity>Repository`                 | `SignalRepository`                   |
| Repository impl         | `<Tech><Entity>Repository`           | `SqlSignalRepository`, `RedisCartRepository` |
| Use case                | `<Verb><Object>UseCase` or `<verb>_<object>` | `MarkSignalDismissedUseCase` / `mark_signal_dismissed` |
| DTO / API schema        | `<Entity>Response`, `<Entity>Request`| `SignalResponse` (not `Signal`!)     |
| Aggregate root          | Same as entity                       | `Order` (with line items inside)     |

Critically: **DTO ≠ Entity.** `SignalResponse` is what the HTTP API exposes; `Signal` is the domain object. They diverge over time — that's fine.

### Step 5 — Apply incrementally on legacy code (strangler-fig)

You don't refactor a 2000-line `analysis_engine.py` in one PR. You wedge in next to it:

- ☐ Sprint N: pick a small aggregate (one entity, one write use case, one read use case). Build the new layered version alongside the legacy code, at new endpoints. Existing endpoints unchanged.
- ☐ Sprint N+1: pick a second aggregate. Reuse the UoW + repository base from Sprint N.
- ☐ Sprint N+2: tackle a larger aggregate using the now-proven pattern.
- ☐ Ongoing (boy-scout rule): when feature work touches a legacy file, migrate that piece. No dedicated cleanup sprint.

See [[feedback-additive-changes]] for the additive rule. See [[feedback-migrations-additive-first]] for the DB side.

## Checklist Before Calling It "Clean"

- ☐ Entities have zero imports from ORM / HTTP / framework.
- ☐ Repository interfaces live in the domain layer; implementations in infrastructure.
- ☐ Use cases depend on repository **interfaces**, not concrete implementations.
- ☐ Routers / controllers contain no business logic — they validate input, call a use case, serialize the result.
- ☐ Transaction boundary is at the use-case level, not the repo level.
- ☐ A boundary-enforcement tool is wired into CI and failing builds when violated.
- ☐ DTO types are separate from entity types (even if structurally identical today).

## Rules & Constraints

- ALWAYS: enforce boundaries with tooling, not reviewer discipline.
- ALWAYS: entities import nothing framework-specific.
- ALWAYS: one transaction per use-case invocation (UoW at use-case boundary).
- ALWAYS: routers depend on use cases, never on repositories directly.
- NEVER: import ORM classes into entities.
- NEVER: open a transaction inside a repository.
- NEVER: put business logic in a router / controller.
- NEVER: reuse a DTO type as the entity — they will diverge.
- NEVER: rewrite a 2000-line legacy file in one PR — wedge in alongside (strangler-fig).

## Examples

**Wrong (router doing business logic):**

```python
@router.post("/signal/{id}/dismiss")
def dismiss(id: int, db: Session = Depends(get_db)):
    signal = db.query(SignalModel).get(id)         # repo concern
    signal.dismissed_at = datetime.utcnow()        # use case concern
    if signal.status != "active":                  # business rule
        raise HTTPException(400, "already dismissed")
    db.commit()                                    # txn concern
    return SignalSerializer().serialize(signal)    # adapter concern
```

**Right (router thin, layers separated):**

```python
@router.post("/signal/{id}/dismiss", response_model=SignalResponse)
def dismiss(id: int, uow: UnitOfWork = Depends(get_uow)):
    signal = mark_signal_dismissed(uow, SignalId(id))
    return SignalResponse.from_entity(signal)
```

**Wrong (entity importing ORM):**

```python
# entities/signal.py
from sqlalchemy import Column, Integer  # ← contamination
class Signal(Base):
    id = Column(Integer, primary_key=True)
```

**Right (entity pure):**

```python
# entities/signal.py
from dataclasses import dataclass
from datetime import datetime

@dataclass(frozen=True)
class Signal:
    id: SignalId
    status: SignalStatus
    dismissed_at: datetime | None

    def mark_dismissed(self, now: datetime) -> "Signal":
        if self.status != SignalStatus.active:
            raise SignalAlreadyDismissed(self.id)
        return replace(self, status=SignalStatus.dismissed, dismissed_at=now)
```

**Wrong (repository opening its own transaction):**

```python
class SqlSignalRepository:
    def save(self, signal):
        with self.session.begin():  # ← txn at repo level — composes badly
            self.session.merge(signal)
```

**Right (repo participates, use case decides):**

```python
class SqlSignalRepository:
    def save(self, signal):
        self.session.merge(signal)   # no commit here

# use case:
def mark_signal_dismissed(uow, signal_id):
    with uow:
        signal = uow.signals.get(signal_id)
        signal = signal.mark_dismissed(now())
        uow.signals.save(signal)
        return signal                 # commit on __exit__
```

## Changelog

- 0.1.0 (2026-06-19) — initial version, vendored into kktest-dev/kkskills-essentials.
