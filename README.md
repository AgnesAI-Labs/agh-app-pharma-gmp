# Sableleaf GMP Quality Hub

[简体中文](README.zh-CN.md) · [Demo](DEMO.md) · [Domain notes](DOMAIN-NOTES.md)

An installable pharmaceutical quality application for Agnes Harness (AGH), package `@agnes-showcase/pharma-gmp` 1.2.5. Sableleaf OSD, people, products, signatures and evidence are fictional and synthetic. This unvalidated teaching system models nonsterile tablets/capsules and must not be used for real batch release or regulatory submissions.

## What it does

The fixed scenario date is **2024-10-20**: 36 batches, 240 EM samples, nine equipment records and 12 deviations. The workbench combines overview, tasks/signatures, live object dossiers and the batch/record, deviation/CAPA, EM, QA release and audit modules. The Quality Assistant is the single entry. It delegates fresh investigation, review, EM and pre-release checks to four declared role subagents; delegation cards and completion notices retain their localized role attribution after reload. The hub summarizes their findings and performs requested signed records, advancement and release in the main conversation.

The Quality Assistant is the single entry. It delegates fresh investigation, review, EM and pre-release checks to four declared role subagents, summarizes their findings, and performs requested signed records, advancement and release in the main conversation. Quality records and release need a human business signature bound to the exact revision.

## Install

Requires AGH with plugin API `^5.0.0` and Node >= 24.10. From Git (the repository commits the built `dist/`):

```sh
agh plugins add git:https://github.com/AgnesAI-Labs/agh-app-pharma-gmp#v1.2.5
```

Or build a shareable archive and install that:

```sh
git clone --branch v1.2.5 https://github.com/AgnesAI-Labs/agh-app-pharma-gmp.git
agh plugins pack ./agh-app-pharma-gmp ./pharma-gmp-1.2.5.tgz
agh plugins add ./pharma-gmp-1.2.5.tgz
```

Review exact capabilities/integrity, trust and enable in Plugins; preview and adopt Sableleaf in **Settings → Application**. Installation never adopts implicitly. Demo accepts exact tool prompts such as `call pharma_inspect {"batch":"B-2410-017"}`; use a real model for the reasoning stages in DEMO. Recovery remains available through `/?admin` and `agh app clear`. Use an isolated home.

## Capabilities requested

Declared in `package.json` (`agnes.plugins`); AGH shows them for review before you trust the plugin.

| Plugin entry | Capability |
|---|---|
| `main` | `ui`; `store` (owner/profile storage); `filesystem` read and write limited to `pharma-output/**`; tools `pharma_inspect`, `pharma_dossier`, `pharma_record`, `pharma_release`, `pharma_report` (prefix `pharma_`); `tools.invoke`. Injects tools, services, skills and providers. |
| `cards` | `ui` only (evidence cards). |

Runtime libraries (`@agnes/extension-api`, `@agnes/plugin-runtime`, `@sinclair/typebox`, `react`, web UI packages) are provided by the host and are not bundled.

## Behavior notes

Profile pages use only declared `pharma.snapshot`, `pharma.change` and `pharma.release` services. Host-bound owner/profile storage persists across restart; no browser database or private filesystem access. Transactions bind monotonic revisions to audit entries. Originals are retained. The page saves operation IDs and inspects pending/unknown receipts before resuming. Release requires the entire checklist, exact revision, exact meaning and backend-injected human approval. Signer identity comes from that proof.

`pharma_report` creates Markdown and print HTML and calls `present`. The main Quality Assistant can create an ordinary nightly EM schedule. Growth uses the platform candidate helper: create, test, submit for review, then human-publish the exact hash. Host code pins retain running session versions across upgrades.

Role presets select an application-owned policy through the public tool-policy SPI, preserving default tool-permission behavior. Quality writes and release separately request a business signature bound to the exact arguments/revision. Full access auto-confirms eligible signatures through Host for the session’s human principal; other permissions ask the human. A direct domain write without the Host decision proof refuses.

Only the exact nightly EM export (`kind=em` plus a supported locale) may run unattended: it reads quality state and writes new report files inside `pharma-output/`. Other report shapes retain the default decision; quality records and release require the bound business decision, automatically confirmed only for eligible full-access main-session requests.

Release dossier tools return the original findings together with current blockers and the deviation, retest, EM and equipment evidence. A certificate binds the reviewed pre-signature dossier revision; signing advances the state revision by one.

## Business signatures

Quality records and batch release are business acts. Tools request `business.confirm`, binding exact arguments, business object, revision, evidence and signature meaning. Under full access, Host automatically submits the declared approving response for the session's human principal, without a pending card. Receipts, audit records and release/closure records say **auto-confirmed under full access**; this is never a manual click or a model signature. Other permission levels retain manual sign/reject/cancel/expiry behavior. Host consumes each decision once; the private admission checks the same live epoch, cancellation and deadline inside the store transaction, so narrowing away from full access before commit blocks the write. Ambiguous or incomplete approving contracts still ask a person. Page effects retain Host human confirmation and revision checks.

The signature card shows the object, reviewed revision, exact meaning and evidence in the current UI language. The human answer must return that view’s bound meaning unchanged; receipts and audit records preserve it. A legacy null answer cannot complete these new signatures.

Version 1.2.2 declares report generation as history evidence: Core waits for full session-history verification before dispatch.

Version 1.2.1 adds role subagents and the single Quality Assistant entry; existing installations can review the bundled update on the Plugins page. Installation and application adoption remain separate.

The workbench offers Current object, Pending signatures and Evidence & reports. Start deviation, CAPA, EM, batch review or QA release work from object buttons or composer actions; the hub delegates to four specialist roles and records their attribution. Overview and Tasks & signatures form the primary navigation; all other modules remain under More and overview links.

Role children capture a spawn-time intersection of role and parent tools, file/network scope, sandbox and read-only limits. Tool calls needing approval wait on the parent human card and Web Approvals tab; only an authenticated human can allow once or reject, and no human surface means refusal. Parent/ancestor stop or close withdraws pending requests. Role children cannot obtain business signatures, even from a Full access parent; signed actions return to the main Quality Assistant. Their persistent persona comes from the role recipe, independently of the editable launch draft.

The Quality Assistant waits for specialist findings and finishes the request in one user turn, including an explicitly requested signed record in the main session. It summarizes any generated reports with their paths. Delegation cards show the role, task and durable status, with a link to the child; internal handles remain in Technical details. Long tasks can still use background completion notices.


## Development

```sh
npm run build        # bundle src/index.ts into dist/index.js (esbuild 0.28.2); commit the result
npm run check:dist   # rebuild to a temp file and fail if dist/index.js is stale
npm test             # vitest, using a local checkout of the open-source repo
```

`npm test` runs `$AGNES_HARNESS/node_modules/.bin/vitest` (default `~/agnes-harness`, install its dependencies first) with this folder as the root; `vitest.config.mjs` resolves the `@agnes/*` workspace packages and their dependencies from that checkout, so nothing is published or installed here. The `scripts/` folder holds acceptance and browser-evidence runners that also expect that checkout (run them from its root with an isolated AGH home and an explicit model budget). No account or key ships in the package. EU GMP Annex 1/11, 21 CFR Part 11, ICH Q9/Q10 and ALCOA+ are reference frameworks, not compliance certification.
