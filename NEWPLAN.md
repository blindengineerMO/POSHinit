# POSHinit Industry-Leader Plan

## Product Thesis

POSHinit should become the PowerShell-first automation control plane for hybrid infrastructure: safer and easier to operate than raw remoting, more native to Microsoft and VMware/Proxmox environments than general-purpose orchestrators, and credible for enterprise production use.

The competitive baseline is clear:

| Product | Established expectation | POSHinit response |
| --- | --- | --- |
| [PowerShell Universal](https://docs.powershelluniversal.com/v1) | Parameter-driven forms, interactive script feedback, APIs, dashboards, Git-backed configuration | Make every approved runbook consumable as a safe self-service product, while preserving PowerShell-native authoring. |
| [Ansible Automation Controller](https://docs.ansible.com/automation-controller/4.4/html/userguide/workflow_templates.html) | Visual workflows, surveys, approval nodes, inventory sync, RBAC | Add controlled workflow graphs, validated input schemas, resource-level authorization, and promotion gates. |
| [Rundeck](https://docs.rundeck.com/docs/files/pa-deployment-guide.pdf) | Projects, node sources, plugins, clustered execution history, external key storage | Build project boundaries, pluggable inventory/secret providers, and durable clustered execution. |
| [Azure Automation Hybrid Runbook Workers](https://learn.microsoft.com/en-us/azure/automation/automation-hybrid-runbook-worker) | Worker groups, health, high availability, managed identity, local-network execution | Introduce a POSHinit worker/agent plane that executes close to private targets without exposing WinRM or SSH broadly. |

## Principles

- PowerShell remains the first-class runtime; other automation types are additive, not a replacement.
- Every high-impact action must be attributable, reviewable, approval-aware, and recoverable.
- Control plane, execution plane, inventory plane, and secret plane must scale independently.
- A useful UI never substitutes for server-side authorization, audit, validation, or durable state.

## Phase 0: Production Foundation

- [ ] **Replace SQLite as the primary production store with PostgreSQL.** Keep SQLite only for an explicitly documented single-node/dev mode. Add migrations, connection pooling, backups, point-in-time recovery guidance, and HA deployment manifests.
  - Done when multiple API/worker instances can run concurrently without shared-file locking assumptions.
- [x] **Create a durable job queue and worker service.** Persist job state, queue position, retry policy, timeout, cancellation request, target-level state, and idempotency key outside the HTTP request lifecycle.
  - Done when an API restart does not lose or duplicate a queued/running dispatch.
- [ ] **Split control plane from execution plane.** Define an authenticated worker protocol with heartbeats, capability reporting, versioning, worker pools, labels, draining, and placement rules.
  - Done when a private-network worker can execute a job without exposing a target’s remoting endpoint to the web server.
- [x] **Make streamed output durable and resumable.** Store append-only output chunks with sequence numbers; publish live events through a broker/WebSocket gateway; support reconnect, tail, download, and redaction.
  - Done when a user can reconnect to a 12-hour job and see complete ordered output.
- [x] **Establish operational reliability controls.** Add per-job and per-target timeouts, concurrency quotas, rate limits, circuit breakers, retry/backoff rules, dead-letter handling, and a worker drain/maintenance mode.

## Phase 1: Enterprise Security And Governance

- [ ] **Move from coarse roles to resource-scoped RBAC.** Support organization, project, environment, folder/runbook, inventory, credential, integration, and execution permissions; include explicit `use`, `approve`, `edit`, `admin`, and `audit` grants.
  - Done when an operator can run only approved production runbooks against an authorized target collection, without reading unrelated vault/integration metadata.
- [ ] **Add projects and environments.** Partition scripts, inventories, credentials, schedules, reports, policies, and worker pools into projects with `dev`, `test`, and `prod` environment controls.
- [ ] **Integrate enterprise identity lifecycle.** Add Entra group-to-role mapping, SCIM provisioning/deprovisioning, group claims, session revocation, break-glass accounts, and configurable sign-in/session policy.
- [ ] **Add external secret-provider support.** Start with Azure Key Vault and HashiCorp Vault; define a provider interface for CyberArk and cloud secret managers. Resolve secrets only at execution time and record access metadata without values.
- [ ] **Harden secrets and execution.** Add envelope encryption/KMS support, rotation reminders, secret access approval, credential checkout/lease, masked output, command-line redaction, and signed runbook policy for protected environments.
- [ ] **Create an immutable audit trail.** Record before/after changes, permission decisions, approvals, secret use metadata, worker identity, target identity, and output-export events. Ship to SIEM via Syslog and HTTP event streams.

## Phase 2: Runbook Productization And Change Control

- [ ] **Finish schema-driven parameters.** Support typed fields, defaults, required/conditional fields, arrays, enums, host/group pickers, credential pickers, validation expressions, sensitive inputs, and reusable parameter sets.
  - Done when a non-author can launch an approved runbook from a generated form without editing code.
- [ ] **Add Git as the source of truth.** Support GitHub, GitLab, and Azure DevOps repositories; branch mapping by environment; pull/sync status; commit provenance; diff review; and rollback to a released revision.
  - Aligns with [Azure Automation source-control integration](https://learn.microsoft.com/en-us/azure/automation/source-control-integration), but avoid its one-way-sync limitations by supporting controlled bidirectional promotion.
- [ ] **Implement runbook release lifecycle.** Draft, review, approved, released, deprecated, and retired states; signed release artifacts; semantic versioning; change tickets; and required reviewers by environment.
- [ ] **Build visual workflows.** Add DAG-based workflow templates with runbook nodes, inventory sync nodes, conditionals, parallel branches, wait/approval nodes, notifications, retries, rollback/compensation nodes, and input/output mappings.
  - Done when a patch workflow can validate, canary, request approval, fan out, verify, and roll back from one audited graph.
- [ ] **Expand approval workflows.** Add approver groups, quorum rules, escalation, expiry/default-deny, separation of duties, emergency justification, ServiceNow/Jira change linkage, and approval evidence in reports.

## Phase 3: Inventory And Hybrid Reach

- [ ] **Turn integrations into managed inventory sources.** Add source schedules, health state, incremental sync, source ownership, field mapping, reconciliation history, stale-node policy, and source-specific error reporting.
- [ ] **Advance dynamic host groups into a rule engine.** Add composable `all`/`any`/`not` conditions over source, connector, name, FQDN, OS, transport, tags, status, IP/subnet, notes, and custom facts; preserve a preview, explain why a node matched, and track membership changes.
- [ ] **Add tags, facts, and CMDB enrichment.** Capture normalized host facts, custom key/value metadata, ownership, criticality, maintenance windows, and business service. Integrate ServiceNow CMDB and generic REST/CSV sources.
- [ ] **Create a lightweight POSHinit agent.** Support Windows and Linux enrollment, mutual TLS, auto-upgrade channels, local PowerShell/Bash execution, file transfer, worker health, and outbound-only connectivity.
- [ ] **Provide safe remote session controls.** Add terminal transcript retention, session policy, upload/download guardrails, copy/paste audit, session recording hooks, and optional brokered RDP/SSH integrations.

## Phase 4: Operational Intelligence

- [ ] **Deliver a real operations dashboard.** Show queue depth, worker health, success rate, duration percentiles, target failures, inventory drift, approval backlog, notification health, and tenant/project/environment filtering.
- [ ] **Adopt OpenTelemetry.** Emit traces, metrics, and structured logs for HTTP, queue, worker, remoting, integration, and notification paths; publish reference Grafana/Prometheus/OTel Collector dashboards.
- [ ] **Improve reporting.** Add scheduled executive reports, runbook/target trend analysis, SLA/SLO views, CSV/XLS/PDF templates, evidence bundles, retention policies, and legal hold.
- [ ] **Add event-driven automation.** Support inbound CloudEvents, message queues, ServiceNow/Jira events, Git webhooks, and normalized outbound events with delivery retries and signatures.
- [ ] **Introduce recommendations carefully.** Surface deterministic recommendations first: failing credential, stale dynamic group, repeated target failure, unused secret, slow runbook, missing timeout, and risky broad target. Add AI assistance only with opt-in, redaction, provenance, and human confirmation.

## Phase 5: Ecosystem And Extensibility

- [ ] **Publish a versioned OpenAPI contract and SDKs.** Generate PowerShell, TypeScript, Python, and Terraform-provider clients; include API versioning, deprecation policy, pagination, filtering, and idempotency.
- [ ] **Build a plugin SDK.** Define signed plugins for inventory sources, execution transports, notification channels, secret providers, report exporters, and workflow nodes. Include permission manifests and isolated plugin execution.
- [ ] **Prioritize integrations by operator value.** ServiceNow, Jira, Teams/Slack, PagerDuty, Splunk, Microsoft Sentinel, GitHub/GitLab/Azure DevOps, Azure Key Vault, HashiCorp Vault, and common CMDB/ITAM APIs.
- [ ] **Support infrastructure-as-code.** Export/import projects as declarative files, provide Terraform resources, and add policy checks to CI before production promotion.

## Engineering Quality Gates

- [ ] Add API contract, migration, authorization, queue/worker, secret-redaction, and workflow-engine tests to CI.
- [ ] Add Playwright coverage for login, RBAC boundaries, inventory import, dynamic-group preview, approval, long-running stream reconnect, cancellation, and report export.
- [ ] Add load, chaos, and recovery tests: worker loss during execution, queue failover, database failover, reconnecting output consumers, and large-inventory sync.
- [ ] Publish threat model, security architecture, upgrade guide, backup/restore runbook, support matrix, and reference deployments for single-node, HA, and private-network worker topologies.

## Suggested Delivery Order

1. Durable queue/workers, PostgreSQL, resumable output, and reliability controls.
2. Project/environment isolation, resource RBAC, audit, and external secrets.
3. Git promotion, typed self-service parameters, and workflow/approval engine.
4. Managed inventory/facts, advanced dynamic groups, and outbound worker agent.
5. Observability, ITSM/SIEM integrations, SDK/plugin ecosystem, and recommendations.

## Success Measures

- 99.9% control-plane availability for an HA deployment and zero lost jobs during an API restart.
- A 10,000-node inventory sync completes predictably with explainable dynamic-group membership.
- A production run is executable only through a released runbook, authorized target set, policy-compliant parameters, and recorded approval.
- Operators can resume live output within 30 seconds after a browser reconnect and retrieve a complete redacted evidence bundle afterward.
- New inventory, notification, or secret integrations can ship as a plugin without modifying the core execution engine.
