![Header](public/poshinit.png)
# POSHinit

POSHinit is a web-based, API-first PowerShell control plane for multi-user script authoring, scheduling, machine inventory, credential vaulting, execution reporting, and virtualization-assisted inventory import. The current implementation runs as a single-port Express host on `4000` by default and serves a Vue 3 + Vuetify SPA.

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
- Azure Arc connector registry for subscription-scoped Arc-enabled server inventory import
- Proxmox VE connector registry for cluster-wide and node-scoped QEMU/LXC inventory import
- SMTP and HTTP(S) webhook delivery for completed job alerts
- Notification policies for routed system, script, and job events
- xterm.js-powered node CLI and generated RDP connection files
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
- `Nodemailer`
- `xterm.js` with the Fit addon

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

Enterprise sign-in uses the Microsoft Authentication Library (MSAL) for Node with the authorization-code flow and PKCE. Administrators can configure the tenant ID, client ID, client secret, and redirect URI in **System Settings > Microsoft Entra ID**. The client secret is sealed at rest and is never returned to the browser. The `ENTRA_*` environment variables remain available as deployment-time fallback configuration.

Configure a **Web** redirect URI in the Microsoft Entra app registration that exactly matches the configured redirect URI; for a local deployment the default is `http://localhost:4000/auth/entra/callback`.

An Entra-authenticated identity does not create an operator automatically. In **Access Control**, create or edit the operator, enable **Allow enterprise sign-in**, and enter the Entra UPN/email returned at sign-in. Entra tenant policy controls MFA and Conditional Access. The system audit log records local and enterprise sign-in successes, failed attempts, enterprise callback failures, and sign-outs.

### SMTP And Webhook Job Alerts

Administrators configure delivery in **System Settings > Alert Delivery**. Enable SMTP, provide the host, port, optional credentials, sender, and comma-separated recipients, then select whether successful runs, failed runs, or both produce alerts. An optional global HTTP(S) webhook receives the same structured job-result event.

SMTP passwords are sealed at rest. Job alerts contain execution metadata and a short failure summary only; script content, resolved vault secrets, and full command output are intentionally excluded.

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
- Username/password, domain credentials, and token secret types
- Per-machine credential assignment
- Test connection action with a PowerShell hello-world validation
- PowerShell Remoting execution through WinRM, using `Invoke-Command` and sealed credentials
- Node actions for a browser-hosted CLI and RDP file download

### Node CLI And RDP

The **Node Inventory** action menu can generate a standard `.rdp` file for a selected Windows node; open the file with an RDP client and authenticate using an appropriate remote account. The same menu opens an xterm.js floating CLI workspace.

For remote nodes, CLI connection attempts PowerShell Remoting first. If that attempt fails for a Linux node, POSHinit tries SSH as a fallback. Local nodes use the server's installed PowerShell and Bash hosts. Commands remain available until the operator selects **Disconnect** or closes the terminal window, and connection attempts, command failures, and disconnects are recorded in the application log.

### Subnet Discovery

Select **Node Inventory > Scan Subnet** to open the floating subnet-discovery wizard. First enter an IPv4 CIDR and choose an existing Secret Vault username/password credential configured for PowerShell Remoting or SSH. POSHinit runs the scan from its server, not the browser, in this order:

- Run a dependency-free Node.js TCP reachability probe on port `5985` for PS Remoting credentials or port `22` for SSH credentials, with scans bounded to 1,024 hosts.
- Attempt reverse DNS/PTR resolution for responsive addresses.
- Test PS Remoting or SSH with the selected credential.

The live scan stage shows ping progress, discovered addresses, DNS names, and connection-test outcomes. The final table includes only machines that passed the connection test, allows selecting Windows or Linux per node, and registers those selected rows only after **Complete Import**. The scan does not retain unresponsive or failed targets.

### Azure Arc Inventory

Administrators configure one or more Azure Arc connectors in **System Settings > Azure Arc Inventory**. Each connector uses a Microsoft Entra application client ID, client secret, tenant ID, and Azure subscription ID. The secret is sealed at rest and is never returned to the browser.

In **Node Inventory**, select **Import Azure Arc** to open the floating three-step wizard:

- Discover Arc-enabled servers from `Microsoft.HybridCompute/machines` across the selected subscription, including paginated results.
- Choose nodes and assign a PowerShell Remoting credential for each target.
- Import the selected records and run connectivity tests before completing the wizard.

The integration is inventory-only: it does not deploy Arc extensions, execute Azure Run Command, or modify Azure resources. Assign the app registration the Azure `Reader` role at the subscription scope or a narrower scope that includes the Arc machine resources. Azure Arc requires the `Microsoft.HybridCompute` resource provider to be registered in the subscription.

### Proxmox VE Inventory

Administrators configure Proxmox connectors in **System Settings > Proxmox VE Inventory**, then choose **Proxmox VE** from the universal **Add Or Import Machines** wizard. A connector can either read the full cluster or one individual node.

- Cluster connectors query `/api2/json/cluster/resources` and can return all guests, QEMU/KVM virtual machines only, or LXC containers only.
- Node connectors query `/api2/json/nodes/{node}/qemu` or `/api2/json/nodes/{node}/lxc`.
- Use a least-privilege Proxmox API token in the form `user@realm!tokenid=secret`; a full `PVEAPIToken=...` value is also accepted. Tokens are sealed at rest and never returned to the browser.
- The connector-level TLS switch is available for trusted self-signed Proxmox endpoints only.

The wizard discovers the inventory, lets the operator select guests, assigns a PowerShell Remoting credential, then imports and tests each selected target. Inventory discovery is read-only. Like the VMware import, a discovered guest must still have a reachable management endpoint before POSHinit can execute against it.

### Secret Templates

Scripts can reference a vault entry by name with an explicit template. POSHinit resolves the template in memory immediately before execution and stores only the original, unexpanded script content.

```powershell
$username = {{secret:Operations Admin.username}}
$password = {{secret:Operations Admin.password}}
$domain = {{secret:Operations Admin.domain}}
$apiToken = {{secret:GitHub Automation.token}}
```

- Username/password secrets support `.username` and `.password`.
- Domain credentials support `.username`, `.password`, and `.domain`.
- Token secrets support `.token`.
- Secret names are matched case-insensitively. Resolved values are escaped as PowerShell single-quoted literals.
- Do not write a resolved value to stdout, stderr, a transcript, or an external command line: run output is retained for reporting and can expose it.

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

### Notification Policies

**System Settings > Notification Policies** opens a floating policy editor and inventory. A policy can be enabled, disabled, tested, edited, or deleted, and controls when event notifications are allowed and where they are sent.

- Restrict delivery by date range, days of the week, and time window.
- Select job success or failure, authentication success or failure, and script edit or delete events.
- Deliver to individual operator email addresses, all active members of selected teams, and/or a policy-specific HTTP(S) webhook.
- Email and webhook payloads include a direct link to the relevant event details when `PUBLIC_APP_URL` is configured.

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

### Node Terminal

- `POST /api/machines/:id/terminal/connect`
- `POST /api/terminal/:sessionId/command`
- `POST /api/terminal/:sessionId/disconnect`

These authenticated endpoints back the Node Inventory CLI. Connecting returns a temporary terminal session identifier and selected transport. Send a command body to the command endpoint, then explicitly disconnect when the interactive workspace is no longer needed.

### Subnet Discovery

- `POST /api/subnet-scans`
- `GET /api/subnet-scans/:id`
- `POST /api/subnet-scans/:id/import`

Start a scan with `cidr` and `credentialId`, poll the returned scan ID for stage and progress details, then submit the selected passing machine addresses with an `osFamily` of `windows` or `linux` to import them.

### Notification Policies

- `GET /api/notification-policies`
- `POST /api/notification-policies`
- `POST /api/notification-policies/:id/enabled`
- `POST /api/notification-policies/:id/test`
- `DELETE /api/notification-policies/:id`

All notification policy endpoints require an administrator bearer token.

### Azure Arc Import

- `POST /api/azure-arc/discover`
- `POST /api/azure-arc/import-selection`

Both endpoints require an administrator bearer token and an Azure Arc connector ID. Discovery obtains an Azure Resource Manager client-credentials token and reads the selected subscription's Arc machine inventory.

### Proxmox VE Import

- `POST /api/proxmox/discover`
- `POST /api/proxmox/import-selection`

Both endpoints require an administrator bearer token and a configured Proxmox connector ID. Discovery queries the connector's cluster resource or node QEMU/LXC endpoint with its sealed API token. Import accepts selected machine IDs and optional credential bindings.

### VMware Import

- `POST /api/vmware/import`

Example:

```bash
curl -X POST http://localhost:4000/api/vmware/import \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"connectorId":"VMWARE_CONNECTOR_ID"}'
```

VMware connectors are configured in **System Settings > VMware Inventory**. Add vCenter servers for REST discovery and/or standalone ESXi hosts for native `/sdk` SOAP discovery. The connector editor includes an **Ignore self-signed certificate / TLS errors** switch for trusted lab or internal endpoints; it applies only to that connector and should not be enabled for untrusted infrastructure.

## Current Constraints

- Local and PowerShell Remoting targets can run through manual, scheduled, and webhook execution. SSH is available for connection testing and as a Linux-only fallback transport in the interactive Node Inventory CLI; it is not a scheduled execution transport.
- PowerShell Remoting targets need WinRM and PS Remoting enabled (for example, `Enable-PSRemoting`) and a matching `psremoting` credential. Port `5985` uses HTTP; port `5986` opts into WinRM HTTPS.
- VMware inventory import supports vCenter REST endpoints and standalone ESXi hosts through the native `/sdk` SOAP API; deeper VM action workflows are not yet implemented.
- Azure Arc discovery imports only Arc-enabled server resource metadata. Imported targets still need a directly reachable WinRM endpoint and matching PowerShell Remoting credential for POSHinit execution.
- Proxmox VE discovery imports guest inventory metadata. Imported guests still need a directly reachable WinRM endpoint and matching PowerShell Remoting credential for POSHinit execution.
- Subnet discovery is IPv4 only and is limited to 1,024 usable addresses per scan. TCP reachability, reverse DNS, WinRM, and SSH results depend on the POSHinit server's own network path and firewall policy.
- Entra ID uses an in-memory, short-lived PKCE and callback ticket store. Run a shared session store before deploying more than one application instance.

## Security Notes

- Helmet and CORS are enabled in the Express host.
- Secrets are encrypted with AES-256-GCM and should be protected with a strong `VAULT_SECRET`.
- Script templates are expanded only in the running process. The original script is retained, but intentionally printing an injected value can still disclose it through execution output.
- SQL statements are parameterized through prepared statements in the SQLite wrapper.
- Webhook execution requires the shared secret from `WEBHOOK_SECRET`.
- Entra client secrets can be sealed in system settings or supplied by server environment configuration; never place them in the browser or a checked-in `.env` file.
- SMTP passwords are sealed in settings; alert payloads intentionally omit script content, resolved secrets, and full run output.
- The VMware TLS bypass applies only to a connector that explicitly enables it. Use it only for trusted endpoints with self-signed certificates.
- Azure Arc client credentials are used only from the server to acquire Azure Resource Manager tokens. Grant the connector application least-privilege Azure RBAC, normally `Reader` for inventory discovery.
- Proxmox API tokens are used only by the server for configured inventory requests. Grant only the minimum audit or inventory privileges, and enable the connector TLS bypass only for a trusted self-signed endpoint.

## Recommended Next Work

- Add approval workflows with approver UI and route enforcement
- Add richer parameter schemas per script and per schedule
- Add SSH-based scheduled remote execution fan-out
- Add a shared Entra PKCE/session store for multi-instance deployments and deeper RBAC controls
- Add notification retention controls and delivery retry visibility
- Add streamed terminal output and long-running process support
