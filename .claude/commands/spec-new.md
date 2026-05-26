---
description: "Open a new spec under specs/<NNN-slug>/ for a feature that needs detailed specification before any task breakdown. Spec-kit-inspired: spec.md (functional reqs), plan.md (technical), tasks.md (breakdown), research.md (background)."
argument-hint: "<short feature name>"
---

# /spec-new — Feature Spec

For features substantial enough to warrant their own specification document before any tasks are filed. Mirrors the github/spec-kit flow at a smaller scale.

**Argument:** `$ARGUMENTS`

## Procedure

1. Slug from name: kebab-case, ≤ 5 words.
2. Find next spec number: `ls specs/ | sort -n | tail -1` + 1 (or `001` if empty).
3. Create directory: `specs/NNN-<slug>/`.
4. Create these files:

### `specs/NNN-<slug>/spec.md`

```markdown
---
spec_id: NNN
title: "<title>"
branch: ""
status: draft
created: YYYY-MM-DD
---

# <Title> — Specification

## Motivation

<Why this feature exists. Operator/business driver.>

## User scenarios

### Scenario A (Priority P1)

**Given** <context>
**When** <action>
**Then** <observable outcome>

### Scenario B (P2)
...

## Functional requirements

- **FR-001** <Requirement, measurable.>
- **FR-002** ...

## Key entities

<Domain objects involved. Names, relationships, lifecycle.>

## Success criteria

- <Measurable outcome 1>
- <Measurable outcome 2>

## Assumptions

- <Assumption 1 — flag with [NEEDS CLARIFICATION] if uncertain>

## Out of scope

- <Explicit exclusion 1>
```

### `specs/NNN-<slug>/plan.md`

```markdown
---
spec_id: NNN
created: YYYY-MM-DD
---

# Technical Plan

## Approach

<Chosen approach. Reference alternatives in research.md.>

## Architecture

<Diagram or description.>

## Migrations

<DB schema changes, if any.>

## Backtest validation

<Required if live-sensitive. Which CLI, which gate.>

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
```

### `specs/NNN-<slug>/research.md`

```markdown
---
spec_id: NNN
created: YYYY-MM-DD
---

# Research Notes

## Background

<Prior art, related work, source materials.>

## Alternatives considered

### Alt A: <name>
<Trade-offs.>

### Alt B: <name>
<Trade-offs.>

## Decision

<Which was chosen and why.>
```

### `specs/NNN-<slug>/tasks.md`

```markdown
---
spec_id: NNN
created: YYYY-MM-DD
---

# Task Breakdown

Populated by the planner via `/orchestrate` once the spec is approved.

| Task ID | Title | Depends on | Sprint |
|---|---|---|---|
```

5. Reply:

```
Spec opened: specs/NNN-<slug>/
  spec.md   — fill scenarios, FRs, success criteria
  plan.md   — fill once approach is chosen
  research.md
  tasks.md  — auto-filled by planner

Next: edit spec.md, then run /orchestrate to drive implementation.
```

## When to use a spec vs just /orchestrate

- **Use /orchestrate directly** for tasks where the architect's `TASK-NNN.analysis.md` is enough.
- **Use /spec-new** when:
  - Feature spans ≥ 2 sprints.
  - Requires user research / external research.
  - Has multiple stakeholders (even informally).
  - Involves a contract change that other systems consume.
  - Needs detailed functional requirements (numbered FR-001 etc.) that won't fit in a task file.

For this trading bot project, most work fits `/orchestrate`. Spec is for the rare strategic feature.
