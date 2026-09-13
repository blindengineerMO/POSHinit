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
- Machine inventory, manual and dynamic deployment groups, and local, SSH, and PowerShell Remoting connection testing
- Credential vault with encrypted secret storage
- Schedule builder for one-time and recurring runs
- Manual and scheduled execution services
- Durable dispatch queue with quota enforcement, timeout, retry/backoff, circuit breakers, dead letters, cancellation, and redacted resumable output
- Reporting and searchable logs
- Local authentication plus Microsoft Entra ID enterprise sign-in with tenant-managed MFA
- VMware connector registry for vCenter REST and standalone ESXi SOAP inventory import
- Azure Arc connector registry for subscription-scoped Arc-enabled server inventory import
- Proxmox VE connector registry for cluster-wide and node-scoped QEMU/LXC inventory import
- Managed inventory sources for VMware, Azure Arc, and Proxmox with scheduled incremental reconciliation, health state, ownership, mapping, lifecycle policy, and diagnostics
- Composable dynamic host-group rules with explainable previews and durable membership-change history
- Node context, normalized facts, custom metadata, ownership, criticality, maintenance windows, business-service mapping, and CMDB enrichment sources
- Project and environment boundaries with `dev`, `test`, protected `prod`, active-scope assignment, and production approval controls
- Immutable hash-chained audit evidence with permission, approval, secret-access, worker/target, and output-export events plus Syslog/HTTP SIEM delivery
- OpenTelemetry traces, Prometheus metrics, structured logs, and Collector/Grafana reference deployment assets
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
- `ws` WebSocket gateway for live dispatch output

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
| `WORKER_POLL_MS` | `1000` | Durable job-worker polling interval |
| `WORKER_ENROLLMENT_TOKEN` | `WEBHOOK_SECRET` fallback | Bootstrap secret used only to enroll an outbound execution worker; set a distinct high-entropy value in production |
| `DEMO_PASSWORD` | `ChangeMe123!` | Seeded admin password |
| `PUBLIC_APP_URL` | `http://localhost:$PORT` | Public base URL used after enterprise sign-in |
| `ENTRA_TENANT_ID` | none | Microsoft Entra tenant ID or tenant domain |
| `ENTRA_CLIENT_ID` | none | Application (client) ID from the Entra app registration |
| `ENTRA_CLIENT_SECRET` | none | Server-side client secret for the Entra app registration |
| `ENTRA_REDIRECT_URI` | `$PUBLIC_APP_URL/auth/entra/callback` | Exact web redirect URI registered in Entra |

## Microsoft Entra ID

Enterprise sign-in uses the Microsoft Authentication Library (MSAL) for Node with the authorization-code flow and PKCE. Administrators can configure the tenant ID, client ID, client secret, and redirect URI in **System Settings > Microsoft Entra ID**. The client secret is sealed at rest and is never returned to the browser. The `ENTRA_*` environment variables remain available as deployment-time fallback configuration.

PKCE state and the short-lived post-login browser handoff ticket are persisted as one-time records in SQLite rather than process memory. For a multi-instance deployment, every instance must use the same `DB_PATH` on storage that supports SQLite locking; this lets the Entra callback and the SPA ticket exchange land on different application instances safely. Do not use per-instance local `./data` directories behind a load balancer.

### Roles And Permissions

POSHinit includes four explicit roles. `viewer` is read-only, `operator` can manage scripts, inventory, schedules, vault entries, and execute runs, `approver` can review and decide approval requests without changing automation, and `admin` has full control including identity, settings, and integrations. The API enforces permissions server-side, and disabled users are rejected even if they still hold a valid browser token.

Configure a **Web** redirect URI in the Microsoft Entra app registration that exactly matches the configured redirect URI; for a local deployment the default is `http://localhost:4000/auth/entra/callback`.

An Entra-authenticated identity does not create an operator automatically. In **Access Control**, create or edit the operator, enable **Allow enterprise sign-in**, and enter the Entra UPN/email returned at sign-in. Entra tenant policy controls MFA and Conditional Access. The system audit log records local and enterprise sign-in successes, failed attempts, enterprise callback failures, and sign-outs.

### Resource-Scoped RBAC

Roles remain a coarse platform baseline for navigation and non-resource actions, but sensitive automation operations now require a durable, explicit resource-scoped grant. Administrators retain break-glass access; users and teams receive only the grants assigned in **Access Control > Scoped Grants**.

- Grant actions are `use`, `approve`, `edit`, `admin`, and `audit`. An `admin` grant covers the other actions within its scope.
- Grants can target an organization, project, environment, folder, runbook, inventory node, credential, integration, or execution resource. A resource ID of `*` grants that action for all resources of the selected type.
- Organization, project, and environment constraints can further narrow any grant. Existing installations migrate into `Default Organization > Default Project > Production` without changing resource IDs.
- Folder grants inherit to child runbooks. Dispatch authorization checks require `use` for every selected runbook, node, attached credential, and execution scope. Script edits, inventory/credential changes, approval decisions, terminal connections, and integration configuration are similarly checked server-side.
- Grants may be assigned to a user or team; team membership is evaluated at request time. The API exposes admin-only `GET/POST /api/access-grants` and `DELETE /api/access-grants/{id}` endpoints.

### SMTP And Webhook Job Alerts

Administrators configure delivery in **System Settings > Alert Delivery**. Enable SMTP, provide the host, port, optional credentials, sender, and comma-separated recipients, then select whether successful runs, failed runs, or both produce alerts. An optional global HTTP(S) webhook receives the same structured job-result event.

SMTP passwords are sealed at rest. Job alerts contain execution metadata and a short failure summary only; script content, resolved vault secrets, and full command output are intentionally excluded.

### Durable Run Output

Every queued dispatch writes ordered stdout and stderr chunks to SQLite before publishing them to the live console. Each chunk has a dispatch-local sequence number, so an operator can reconnect without duplicated or out-of-order output after a browser refresh, WebSocket interruption, or application-instance change. The WebSocket gateway replays durable events before listening for live ones; when WebSockets are unavailable, the browser falls back to durable REST replay.

- `GET /api/executions/dispatch/{dispatchId}/events?after={sequence}` replays all dispatch events after a known sequence.
- `GET /api/executions/dispatch/{dispatchId}/output/tail?after={sequence}&limit=200` returns persisted stdout/stderr chunks for tailing tools.
- `GET /api/executions/dispatch/{dispatchId}/output/download` returns the complete plain-text transcript. The **Live Dispatch Console** also provides a **Download log** action.
- `ws(s)://{host}/api/executions/dispatch/{dispatchId}/socket?after={sequence}` provides replay plus live delivery for authenticated operators. Browser clients negotiate the existing bearer token as a WebSocket subprotocol, so it is not put in the URL.

Before output is persisted or published, POSHinit redacts values from the credential vault and common secret-bearing patterns including bearer tokens, passwords, API keys, and client secrets. Redaction is deliberately one-way: use the original secure system only if a protected secret must be recovered.

### Execution Reliability Controls

Administrators configure **System Settings > Execution Runtime** in a floating operational-controls workspace. Settings are persisted and enforced by the worker, including after restart:

- Independent per-target timeouts and an optional overall dispatch deadline. The Run Planner can override both for an individual dispatch.
- Global, per-dispatch, and per-machine target concurrency quotas, plus a durable global dispatches-per-minute rate limit.
- Exponential retry backoff, bounded by configurable base and maximum delays.
- Per-machine circuit breakers. Repeated failed or timed-out executions open the circuit and defer new work for that target until its cool-down expires; a successful execution resets the circuit.
- Dead-letter handling. A target that exhausts retries is retained with its reason and attempt count, then an administrator can requeue it from the Runtime dialog.
- Worker modes: **Active** claims work, **Draining** finishes in-flight work without claiming more, and **Maintenance** pauses claims and rejects new dispatches with `503`.

Administrators can inspect the runtime health summary at `GET /api/reliability/status`, list outstanding dead letters at `GET /api/reliability/dead-letters`, and requeue one using `POST /api/reliability/dead-letters/{id}/requeue`.

### Worker Control Plane

POSHinit separates the browser/API control plane from private-network execution through a versioned, outbound-only worker protocol. The built-in executor continues to process unplaced work; dispatches with a `workerPoolId` are reserved for enrolled workers and cannot be claimed by the API process. This allows a worker inside a protected network to connect to WinRM, PowerShell Remoting, or SSH targets without exposing those target endpoints to the POSHinit web server.

- Create and drain worker pools in **Worker Fleet**. Pools have metadata labels and required worker labels. A worker must match every required label to claim that pool's jobs; draining either a pool or a worker completes in-flight work but prevents new claims.
- Enroll with `POST /workers/enroll` and an `X-POSHinit-Worker-Enrollment` header containing `WORKER_ENROLLMENT_TOKEN`. Enrollment reports the worker name, pool ID, protocol/client version, capabilities, and labels, then returns a rotating per-worker bearer token exactly once.
- Workers send `POST /workers/{id}/heartbeat`, poll `POST /workers/{id}/poll`, and report `POST /workers/{id}/targets/{targetId}/complete` with `X-POSHinit-Worker-Token` (or a bearer token). All v1 responses identify `protocolVersion: "v1"`; heartbeats update capability, version, label, and drain telemetry.
- Poll responses include the script and target connection identity but never vault secret values. Credential resolution remains on the trusted execution host, and returned stdout/stderr is redacted before durable output and audit evidence are stored.

Use a separate enrollment token from webhook automation in production, restrict it to deployment tooling, and rotate it when worker bootstrap access changes. The protocol is intentionally outbound-polling rather than inbound agent control; mTLS, automatic upgrades, and a packaged universal agent remain future work.

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
- Schema-driven parameter definitions with typed runtime forms and reusable parameter sets

### Schema-Driven Parameters

Scripts may define a `parameterSchema` array in Script Studio. The Run Planner renders matching typed fields for each selected script and validates them again on the server before saving a schedule and immediately before every target execution.

- Supported types are `string`, `number`, `boolean`, `date`, `enum`, `array`, `machine`, `group`, and `credential`.
- Fields support labels, descriptions, defaults, `required`, `options` for enums, `sensitive`, conditional visibility/requirement rules, and safe validation expressions: `value.length >= 3`, numeric comparisons such as `value <= 10`, or `regex:^[A-Z]+$`.
- Conditions can use `{ "field": "Mode", "equals": "force" }`, `notEquals`, or `in`. Machine, group, and credential pickers validate that the selected inventory record still exists.
- Sensitive values are AES-GCM sealed before schedule or reusable-set persistence, unsealed only while an execution prepares its PowerShell parameter preamble, and added to output redaction for that execution.
- Save or load reusable sets from the Schedule Composer. Sets belong to a script and reuse its schema; API clients can use `GET /api/parameter-sets?scriptId={id}` and `POST /api/parameter-sets`.

Example:

```json
[
  { "name": "Mode", "type": "enum", "options": ["safe", "force"], "default": "safe" },
  { "name": "Reason", "type": "string", "required": true, "condition": { "field": "Mode", "equals": "force" }, "validation": "value.length >= 3" },
  { "name": "TargetCredential", "type": "credential", "sensitive": true }
]
```

### Inventory And Credentials

- Manual machine registration
- Manual and dynamic deployment groups
- Stored credentials with AES-256-GCM encryption
- Username/password, domain credentials, and token secret types
- Per-machine credential assignment
- Test connection action with a PowerShell hello-world validation
- PowerShell Remoting execution through WinRM, using `Invoke-Command` and sealed credentials
- Node actions for a browser-hosted CLI and RDP file download

### Dynamic Host Groups

**Node Inventory > Create Group** opens a floating target-collection editor. Collections can be manual, with an explicit node list, or dynamic, with a name/FQDN wildcard rule and one or more imported integration sources.

- Use `*` to match any number of characters and `?` to match one character. For example, `TST*` selects imported nodes whose name or FQDN begins with `TST`; `*-WEB` selects names ending in `-WEB`.
- Dynamic rules search only the selected VMware, Azure Arc, or Proxmox connector sources. The editor shows a live preview before the collection is saved.
- Membership is materialized for schedule targeting and refreshed when inventory/group data is loaded and immediately before a schedule expands group targets. This allows newly imported matching nodes to join a dynamic collection without manually editing its membership.
- Dynamic collections only include imported nodes. Manually registered nodes remain available to manual collections.

### Node CLI And RDP

The **Node Inventory** action menu can generate a standard `.rdp` file for a selected Windows node; open the file with an RDP client and authenticate using an appropriate remote account. The same menu opens an xterm.js floating CLI workspace.

For remote nodes, CLI connection attempts PowerShell Remoting first. If that attempt fails for a Linux node, POSHinit tries SSH as a fallback. Local nodes use the server's installed PowerShell and Bash hosts. Commands remain available until the operator selects **Disconnect** or closes the terminal window, and connection attempts, command failures, and disconnects are recorded in the application log.

### Subnet Discovery

Select **Node Inventory > Scan Subnet** to open the floating subnet-discovery wizard. First enter an IPv4 CIDR and choose an existing Secret Vault username/password credential configured for PowerShell Remoting or SSH. POSHinit runs the scan from its server, not the browser, in this order:

- Run a dependency-free Node.js TCP reachability probe on port `5985` for PS Remoting credentials or port `22` for SSH credentials, with scans bounded to 1,024 hosts.
- Attempt reverse DNS/PTR resolution for responsive addresses.
- Test PS Remoting or SSH with the selected credential.

The live scan stage shows ping progress, discovered addresses, DNS names, and connection-test outcomes. The final table includes only machines that passed the connection test, allows selecting Windows or Linux per node, and registers those selected rows only after **Complete Import**. The scan does not retain unresponsive or failed targets.

### Dynamic Host Group Rules

Dynamic collections are configured from **Node Inventory > Target Collections** in a floating rule editor. Rules compose `all`, `any`, and `not` logic with nested branches and support source, connector, name, FQDN, operating system, transport, source tags/status, IP address or CIDR subnet, notes, and custom facts.

- The live preview is evaluated by the server with the same rule engine used by schedules and executions. Hover a matched node to see the successful condition explanations.
- The **Changes** action on a dynamic collection opens durable membership history, including additions, removals, timestamps, and the matched conditions that admitted a node.
- Existing wildcard/source-filter groups continue to work and are automatically treated as an equivalent rule tree when read or synchronized.

### Tags, Facts, And CMDB Enrichment

Each node has an operational **Context** tab for business owner, owning team, criticality, business service, maintenance-window metadata, normalized host facts, and custom key/value facts. These facts are available to dynamic host-group rules and remain separate from importer-provided source metadata.

Use **Node Inventory > CMDB Enrichment** to configure ServiceNow CMDB, generic REST JSON, or CSV sources. Every source defines how an upstream record identifies an existing node and maps source fields into normalized facts, custom facts, criticality, maintenance windows, and business service. Credentials are sealed at rest, and each synchronization records its input count, enriched-node count, status, timestamp, and provider error when applicable.

### Projects And Environments

Administrators use **Projects** to partition automation work. Creating a project automatically provisions **Development**, **Test**, and a protected **Production** environment. Select an environment to make it the active scope; newly created scripts, nodes, credentials, groups, and schedules inherit that project and environment.

Production environments require approval when schedules are saved, and the existing resource-scoped RBAC grants can target organizations, projects, or individual environments. The project workspace also supports custom environment lanes and per-environment protection/approval controls.

### Runbook Release Lifecycle

Script Studio keeps working copies as drafts and promotes immutable artifacts through `draft`, `review`, `approved`, `released`, `deprecated`, and `retired` states. Open **Release Control** from the Script Studio command bar to submit the current script content as a semantic version, associate a change ticket, choose the target environment, and add reviewers. The server records a SHA-256 content hash and an HMAC-SHA256 signature for every artifact; the release window verifies both before showing it as promotable.

Administrators configure each environment's **Release Policy** from **Projects** using the shield action beside an environment. Policies can require semantic versions, a change ticket, and a specific set of reviewers. Every required reviewer must approve before the author or release manager can release the artifact. Releasing a newer artifact automatically deprecates the prior release for that runbook/environment; released artifacts can subsequently be deprecated or retired without changing their preserved content.

Protected-environment dispatches are rejected unless every selected script has a currently `released` signed artifact for that environment. Saving a material script edit moves its mutable working copy back to `draft`, so it cannot silently replace the approved content. Lifecycle submissions, reviews, promotions, and state changes are recorded in the immutable audit trail. Use `GET /api/library/releases/:id/artifact` to retrieve an artifact's hash, signature, content, and verification result for external evidence workflows.

### Approval Workflows

The **Approval Queue** is policy-driven rather than a single-operator gate. Administrators open **Approval Policy** to configure one workflow per environment: approver teams and direct approvers, required quorum, expiration/default-deny period, escalation threshold and recipients, separation of duties, mandatory ServiceNow/Jira change tickets, and whether an emergency justification is permitted.

Each scheduled request captures its policy, ticket or emergency reason, expiry/escalation timestamps, and individual reviewer decisions. Only eligible users can vote; with separation of duties enabled, the requester cannot approve their own work. A rejected vote denies the request, while approvals stay pending until quorum is met. Expired requests are automatically marked `expired` and denied, and escalations are recorded as audit and operational log events. The final execution report includes approval evidence with the policy, quorum, votes, ticket, emergency justification, and escalation/expiry metadata.

### Visual Workflows

Use **Visual Workflows** to compose reusable DAG templates in a floating designer. The palette supports runbook dispatches, managed inventory synchronization, conditions, parallel joins, waits, approval gates, notifications, retry controls, and rollback/compensation markers. Each node can define configuration and input mappings using `{{inputs.key}}` or prior workflow context; runbook nodes select scripts, targets, and queue retry policy directly.

The server rejects broken or cyclic graphs before save/run. At runtime it executes all dependency-ready nodes concurrently, waits for durable dispatch completion, records every node's input, output, attempt, status, and error, and preserves the aggregate output in the workflow run ledger. Approval nodes create normal Approval Queue records and respect the existing quorum, escalation, and default-deny controls. Open a template's **Run** window to provide JSON inputs and inspect recent workflow-run node evidence.

### Operational Recommendations

The Command Deck includes a deterministic **Operational Recommendations** panel. It evaluates persisted operational evidence only and surfaces stable, severity-ranked findings for failing credentials, stale dynamic groups, repeated target failures, unused secrets, consistently slow runbooks, workflow runbook nodes without explicit timeouts, and broad schedule target groups. Each finding includes its rule source, redacted evidence, and a direct operator destination; it never changes configuration or runs a command automatically.

The floating **Recommendation Review** window records a human confirmation in the immutable audit trail. Its **AI assist preview** intentionally makes no provider request: it returns `opt-in-required`, redacts output/evidence text, stamps deterministic provenance and generation time, and states that human confirmation is mandatory. This establishes the privacy and control boundary for a future opt-in AI provider integration without silently transmitting secrets, output, or inventory details.

### Safe Remote Sessions

**Remote Session Control** gives administrators a policy for interactive CLI sessions. The policy controls redacted transcript retention (30 days by default), recording hooks, clipboard allowance, upload/download guards, and optional brokered SSH/RDP URL templates. Every terminal connection, command, streamed stdout/stderr event, cancellation, disconnect, clipboard event, and transfer guard decision is retained as ordered session evidence when recording is enabled. Transcript content runs through the same output-redaction controls used for execution logs.

Clipboard paste is detected in the terminal client and is either blocked or audit-recorded with metadata only; clipboard contents are not retained. Upload and download are deny-by-default and enforced at the server guard endpoint. Enabling either guard does not itself move a file: a brokered transfer provider must perform the transfer. Optional RDP/SSH broker URLs support `{{target}}` and `{{machineId}}` placeholders and deliberately never contain a credential value. Expired transcripts are pruned according to the configured retention policy.

### Immutable Audit Trail

POSHinit records append-only audit events in a hash chain. Database triggers reject updates and deletes, while the audit API verifies the chain head and reports an invalid sequence if integrity cannot be established. Entries capture before/after metadata for supported changes, permission allow/deny decisions, approvals, external secret access metadata, worker and target identities for execution, and output-export events. Secret values and output contents are never recorded in audit context.

Configure delivery with `POST /api/settings/audit` as an administrator. The audit delivery profile supports UDP Syslog and signed HTTP event streams; the HTTP signing token is encrypted at rest and sent as `X-POSHinit-Audit-Signature` using HMAC-SHA256. Retrieve evidence and chain integrity through `GET /api/audit-events` as an administrator.

### OpenTelemetry And Metrics

POSHinit initializes OpenTelemetry at process startup. Automatic instrumentation covers HTTP/Express and outbound HTTP calls; explicit spans and metrics cover queue and worker polls, PowerShell remoting, inventory/CMDB integration work, and notification dispatch. Existing Pino JSON logs remain structured and are correlated by the OpenTelemetry runtime where supported.

- Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to send traces to an OTLP/HTTP collector.
- Prometheus metrics are exposed at `http://<host>:9464/metrics` by default. Configure `OTEL_PROMETHEUS_PORT`, `OTEL_SERVICE_NAME`, or disable startup with `OTEL_ENABLED=false`.
- Reference OpenTelemetry Collector, Prometheus, and Grafana dashboard files are in [deploy/observability](/home/matthewp/Code/POSHinit/deploy/observability/README.md). Restrict the Prometheus endpoint and collector with your normal network controls.

### Managed Inventory Sources

Every configured VMware, Azure Arc, and Proxmox connector is automatically represented as a managed inventory source. Open **System Settings > Inventory Sources > Manage Sources** to configure the source owner, enable or pause its schedule, choose the interval, map provider fields to POSHinit node fields, and decide how upstream records that disappear should be handled.

- Synchronizations run incrementally: discovered nodes are compared with their existing source record, and unchanged fields are not rewritten.
- Each reconciliation records discovered, created, changed, unchanged, and stale counts. Source health becomes `healthy` on success or `error` with a source-specific diagnostic when a provider request fails.
- Stale-node policy is intentionally non-destructive: retain the record as active, mark it `stale`, or mark it `archived`. POSHinit never deletes an inventory node merely because it was absent from one source response.
- Source schedules are checked by the API process every minute by default. Set `INVENTORY_SYNC_POLL_MS` to tune the worker poll cadence; each source controls its own sync interval in minutes.

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

### External Secret Providers

Administrators configure external providers in **System Settings > External Secret Providers**. Provider credentials are sealed at rest; resolved secret values are never stored in POSHinit. Azure Key Vault and HashiCorp Vault are implemented now, while the provider interface also reserves CyberArk, AWS Secrets Manager, and Google Secret Manager connectors for future deployment-specific adapters.

- **Azure Key Vault** uses a Microsoft Entra application tenant ID, client ID, and client secret to acquire a data-plane token. Grant that application the least-privilege Key Vault secret-read data role.
- **HashiCorp Vault** uses a Vault URL, KV mount path, optional namespace, and a scoped Vault token. Use a token policy that can read only the referenced paths.
- Use `{{external:provider-id:secret-name}}` for an Azure Key Vault secret. Use `{{external:provider-id:path/to/secret#field}}` to read a field from a HashiCorp Vault KV record; omit `#field` only when the provider returns a direct string or `value` field.
- External values are resolved immediately before each target execution, remain only in process memory, and are included in that execution’s redaction set before output, events, reports, or downloadable logs are persisted.
- Each retrieval writes only provider ID/type, reference, requested field, execution/script/machine IDs, timestamp, and success/failure metadata to `external_secret_accesses`. Secret values are never written to the audit table or application log.
- Secret names are matched case-insensitively. Resolved values are escaped as PowerShell single-quoted literals.
- Do not write a resolved value to stdout, stderr, a transcript, or an external command line: run output is retained for reporting and can expose it.

### Scheduling And Execution

- One-time and recurring schedules
- Direct machine or deployment-group targeting
- Durable manual, scheduled, approval, and webhook dispatches
- Target-level queue state, retry policy, timeout, cancellation request, and idempotency key
- Persisted ordered job output events, available to reconnecting live consoles and the API
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

- Local, PowerShell Remoting, and SSH targets can run through manual, scheduled, and webhook execution. Scheduled SSH targets fan out concurrently per runbook and execute PowerShell through the remote `pwsh` host.
- PowerShell Remoting targets need WinRM and PS Remoting enabled (for example, `Enable-PSRemoting`) and a matching `psremoting` credential. Port `5985` uses HTTP; port `5986` opts into WinRM HTTPS.
- VMware inventory import supports vCenter REST endpoints and standalone ESXi hosts through the native `/sdk` SOAP API; deeper VM action workflows are not yet implemented.
- Azure Arc discovery imports only Arc-enabled server resource metadata. Imported targets still need a directly reachable WinRM endpoint and matching PowerShell Remoting credential for POSHinit execution.
- Proxmox VE discovery imports guest inventory metadata. Imported guests still need a directly reachable WinRM endpoint and matching PowerShell Remoting credential for POSHinit execution.
- Subnet discovery is IPv4 only and is limited to 1,024 usable addresses per scan. TCP reachability, reverse DNS, WinRM, and SSH results depend on the POSHinit server's own network path and firewall policy.
- Entra ID PKCE state and callback tickets use one-time, short-lived SQLite records. Multi-instance deployments must point every instance at the same `DB_PATH` on storage that supports SQLite locking.

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
