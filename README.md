# POSHinit

POSHinit is a web-based, API-first PowerShell control plane for multi-user script authoring, scheduling, machine inventory, credential vaulting, execution reporting, and vCenter-assisted inventory import. The current implementation runs as a single-port Express host on `4000` by default and serves a Vue 3 + Vuetify SPA.

## Status

This repository now contains a runnable greenfield foundation with:

- Vue 3 + Vuetify operator UI
- Monaco-based script editor
- PowerShell parser-backed syntax validation
- Personal and shared script library model with revision history
- Script library import, preview, and export for PowerShell and supporting files
- Machine inventory, deployment groups, and local, SSH, and PowerShell Remoting connection testing
- Credential vault with encrypted secret storage
- Schedule builder for one-time and recurring runs
- Manual and scheduled execution services
- Reporting and searchable logs
- Local authentication plus Microsoft Entra ID enterprise sign-in with tenant-managed MFA
- VMware connector registry for vCenter REST and standalone ESXi SOAP inventory import
- Webhook-triggered execution with a shared secret
- Per-schedule webhook endpoints with independent path keys and header tokens

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
| `PUBLIC_APP_URL` | `http://localhost:$PORT` | Public base URL used after enterprise sign-in |
| `ENTRA_TENANT_ID` | none | Microsoft Entra tenant ID or tenant domain |
| `ENTRA_CLIENT_ID` | none | Application (client) ID from the Entra app registration |
| `ENTRA_CLIENT_SECRET` | none | Server-side client secret for the Entra app registration |
| `ENTRA_REDIRECT_URI` | `$PUBLIC_APP_URL/auth/entra/callback` | Exact web redirect URI registered in Entra |

## Microsoft Entra ID

Enterprise sign-in uses the Microsoft Authentication Library (MSAL) for Node with the authorization-code flow and PKCE. Configure a **Web** redirect URI in the Microsoft Entra app registration that exactly matches `ENTRA_REDIRECT_URI`; for a local deployment the default is `http://localhost:4000/auth/entra/callback`. Set the tenant ID, client ID, and client secret as server environment variables, then restart POSHinit.

An Entra-authenticated identity does not create an operator automatically. In **Access Control**, create or edit the operator, enable **Allow enterprise sign-in**, and enter the Entra UPN/email returned at sign-in. Entra tenant policy controls MFA and Conditional Access. The system audit log records local and enterprise sign-in successes, failed attempts, enterprise callback failures, and sign-outs.

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
- Import PowerShell scripts, images, and supporting files; preview safe text/images and export any library entry

### Inventory And Credentials

- Manual machine registration
- Deployment groups
- Stored credentials with AES-256-GCM encryption
- Per-machine credential assignment
- Test connection action with a PowerShell hello-world validation
- PowerShell Remoting execution through WinRM, using `Invoke-Command` and sealed credentials

### Scheduling And Execution

- One-time and recurring schedules
- Direct machine or deployment-group targeting
- Manual ad hoc execution
- Scheduled execution polling loop
- Webhook-triggered execution
- Optional per-schedule webhook triggers with status polling

### Reporting And Logs

- Execution history
- Friendly execution summary payloads
- Captured stdout and stderr
- Searchable application and execution logs

## API Overview

### Auth

- `POST /auth/login`
- `GET /auth/entra/start`
- `GET /auth/entra/callback`

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

### Schedule Webhooks

Enable **Schedule Webhook** in the schedule composer and save the schedule. The administrator-only editor view reveals a generated webhook address and header token. The address itself includes a random path key; callers must also include the header token.

```bash
# Read schedule and latest execution status
curl "$WEBHOOK_URL" \
  -H "x-poshinit-webhook-token: $WEBHOOK_TOKEN"

# Run the schedule's configured scripts and targets now
curl -X POST "$WEBHOOK_URL" \
  -H "x-poshinit-webhook-token: $WEBHOOK_TOKEN"
```

`POST` accepts an empty request body and does not alter the schedule's normal next-run time. `GET` returns schedule state, whether an execution is running, and the latest execution status. Treat both the random URL and token as secrets; never put them in public monitoring dashboards or source control.

### VMware Import

- `POST /api/vmware/import`

Example:

```bash
curl -X POST http://localhost:4000/api/vmware/import \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"connectorId":"VMWARE_CONNECTOR_ID"}'
```

## Current Constraints

- Local and PowerShell Remoting targets can run through manual, scheduled, and webhook execution. SSH remains available for connection testing only.
- PowerShell Remoting targets need WinRM and PS Remoting enabled (for example, `Enable-PSRemoting`) and a matching `psremoting` credential. Port `5985` uses HTTP; port `5986` opts into WinRM HTTPS.
- VMware inventory import supports vCenter REST endpoints and standalone ESXi hosts through the native `/sdk` SOAP API; deeper VM action workflows are not yet implemented.
- Entra ID uses an in-memory, short-lived PKCE and callback ticket store. Run a shared session store before deploying more than one application instance.

## Security Notes

- Helmet and CORS are enabled in the Express host.
- Secrets are encrypted with AES-256-GCM and should be protected with a strong `VAULT_SECRET`.
- SQL statements are parameterized through prepared statements in the SQLite wrapper.
- Webhook execution requires the shared secret from `WEBHOOK_SECRET`.
- Entra client secrets stay server-side in environment configuration; never place them in the browser or a checked-in `.env` file.

## Recommended Next Work

- Add approval workflows with approver UI and route enforcement
- Add richer parameter schemas per script and per schedule
- Add SSH-based scheduled remote execution fan-out
- Add a shared Entra PKCE/session store for multi-instance deployments and deeper RBAC controls
- Add notification channels and retention controls
- Add file upload browsing and image asset preview in the library
