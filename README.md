# POSHinit

POSHinit is a web-based, API-first PowerShell control plane for multi-user script authoring, scheduling, machine inventory, credential vaulting, execution reporting, and vCenter-assisted inventory import. The current implementation runs as a single-port Express host on `4000` by default and serves a Vue 3 + Vuetify SPA.

## Status

This repository now contains a runnable greenfield foundation with:

- Vue 3 + Vuetify operator UI
- Monaco-based script editor
- PowerShell parser-backed syntax validation
- Personal and shared script library model with revision history
- Machine inventory, deployment groups, and connection testing
- Credential vault with encrypted secret storage
- Schedule builder for one-time and recurring runs
- Manual and scheduled execution services
- Reporting and searchable logs
- Local auth bootstrap with teams and users
- vCenter settings and import service scaffolding
- Webhook-triggered execution with a shared secret

## Stack

- `Node.js` 24.x
- `Express` 5
- `node:sqlite` for local data storage
- `Vue` 3
- `Vuetify` 3.13.x
- `Pinia`
- `Vue Router`
- `Monaco Editor`

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Start the application:

```bash
npm start
```

3. Open:

```text
http://localhost:4000
```

4. Sign in with the seeded account:

```text
Email: admin@poshinit.local
Password: ChangeMe123!
```

## Commands

```bash
npm start
npm run build
npm test
```

## Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | Single application port for API and UI |
| `HOST` | `0.0.0.0` | Bind host |
| `DATA_DIR` | `./data` | Data root for SQLite, uploads, and logs |
| `DB_PATH` | `./data/poshinit.sqlite` | SQLite file path |
| `VAULT_SECRET` | dev fallback | Encryption key for stored secrets |
| `WEBHOOK_SECRET` | `poshinit-webhook-secret` | Shared secret for external webhook execution |
| `CORS_ORIGIN` | `*` | CORS origin policy |
| `LOG_LEVEL` | `info` | Pino log level |
| `SCHEDULER_POLL_MS` | `15000` | Schedule polling interval |
| `DEMO_PASSWORD` | `ChangeMe123!` | Seeded admin password |

## High-Level Architecture

### Backend

- `src/server/index.js`: bootstraps the database, server, and scheduler loop
- `src/server/app.js`: Express host, Helmet, CORS, body parsing, Vite middleware
- `src/server/routes/index.js`: API and webhook routes
- `src/server/services/`: domain logic for auth, scripts, machines, schedules, executions, logs, settings, and vCenter
- `src/server/db/`: SQLite wrapper and bootstrap schema/seed logic

### Frontend

- `src/client/App.vue`: auth gate and shell entry
- `src/client/components/app/AppShell.vue`: side nav, top toolbar, bottom status chrome
- `src/client/views/`: dashboard, editor, scheduler, reports, inventory, vault, teams, settings
- `src/client/components/script/ScriptEditor.vue`: Monaco-backed PowerShell editor
- `src/client/components/common/FloatingWindow.vue`: draggable floating dialogs/workspaces

## Core Features

### Script Authoring

- Monaco-based editing surface
- Personal vs shared script metadata
- Revision history storage
- PowerShell syntax validation using the PowerShell parser
- Floating library explorer with contextual creation and delete actions

### Inventory And Credentials

- Manual machine registration
- Deployment groups
- Stored credentials with AES-256-GCM encryption
- Per-machine credential assignment
- Test connection action with a PowerShell hello-world validation

### Scheduling And Execution

- One-time and recurring schedules
- Direct machine or deployment-group targeting
- Manual ad hoc execution
- Scheduled execution polling loop
- Webhook-triggered execution

### Reporting And Logs

- Execution history
- Friendly execution summary payloads
- Captured stdout and stderr
- Searchable application and execution logs

## API Overview

### Auth

- `POST /auth/login`

Example:

```bash
curl -X POST http://localhost:4000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@poshinit.local","password":"ChangeMe123!"}'
```

### Bootstrap

- `GET /api/bootstrap`

Example:

```bash
curl http://localhost:4000/api/bootstrap \
  -H "Authorization: Bearer $TOKEN"
```

### Script Validation

- `POST /api/scripts/validate`

Example:

```bash
curl -X POST http://localhost:4000/api/scripts/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"content":"Write-Output \"Hello\""}'
```

### Manual Execution

- `POST /api/executions/run`

Example:

```bash
curl -X POST http://localhost:4000/api/executions/run \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"scriptIds":["SCRIPT_ID"],"machineIds":["MACHINE_ID"],"triggerType":"manual"}'
```

### Webhook Execution

- `POST /webhooks/execute`

Example:

```bash
curl -X POST http://localhost:4000/webhooks/execute \
  -H 'Content-Type: application/json' \
  -H 'x-poshinit-webhook-secret: poshinit-webhook-secret' \
  -d '{"scriptIds":["SCRIPT_ID"],"machineIds":["MACHINE_ID"]}'
```

### vCenter Import

- `POST /api/vcenter/import`

Example:

```bash
curl -X POST http://localhost:4000/api/vcenter/import \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"baseUrl":"https://vcenter.example.com","username":"administrator@vsphere.local","passwordPlain":"secret","verifyTls":false}'
```

## Current Constraints

- Scheduled executions currently run local-transport targets only.
- SSH is supported for connection testing, but scheduler fan-out is intentionally conservative in this first pass.
- vCenter import currently focuses on inventory import rather than deeper VM action workflows.
- Authentication is local and seeded; SSO and MFA are planned follow-on items.

## Security Notes

- Helmet and CORS are enabled in the Express host.
- Secrets are encrypted with AES-256-GCM and should be protected with a strong `VAULT_SECRET`.
- SQL statements are parameterized through prepared statements in the SQLite wrapper.
- Webhook execution requires the shared secret from `WEBHOOK_SECRET`.

## Recommended Next Work

- Add approval workflows with approver UI and route enforcement
- Add richer parameter schemas per script and per schedule
- Add SSH-based scheduled remote execution fan-out
- Add SSO, MFA, and deeper RBAC controls
- Add notification channels and retention controls
- Add file upload browsing and image asset preview in the library

## References

- See [PLAN.md](./PLAN.md) for the implementation roadmap and competitive-research notes.
