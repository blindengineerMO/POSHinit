# PLAN

## Project Snapshot

- Project: POSHinit
- Date context: September 4, 2026
- Goal: deliver a web-based, API-first, multi-user PowerShell management and execution environment with a polished glassmorphic operator UI
- Runtime target: Linux-developed, cross-platform host, PowerShell 7 capable
- Frontend stack: Vue 3 + Vuetify + Monaco
- Backend stack: Express + Node.js + SQLite

## Vision

POSHinit should feel like a native operator console instead of a simple script runner. The product must centralize script authoring, safe delegation, credential-backed execution, scheduling, reporting, inventory management, and VM discovery while preserving strong auditability and a premium UX.

## Current Build State

### Implemented In This Pass

- Single-port app host on `4000`
- Vue/Vuetify SPA with shell navigation
- Monaco-based PowerShell authoring workspace
- Personal/shared library model with version history
- PowerShell parser syntax validation
- Machine inventory CRUD foundation
- Deployment-group CRUD foundation
- Credential vault CRUD foundation with encryption
- Teams and users CRUD foundation
- One-time and recurring schedule model
- Manual execution endpoint and scheduler loop
- Execution reporting and searchable logs
- vCenter settings UI and REST import scaffold
- Webhook-triggered execution
- README and automated smoke-level unit tests

### Remaining Hardening Work

- Full approval workflow enforcement
- SSO, MFA, and deeper authorization policies
- Notification delivery channels
- Script parameter schema validation and templated forms
- SSH execution fan-out in scheduled runs
- Library asset browsing and previews
- richer dashboard widgets and operator analytics

## Functional Scope

### Required User Workspaces

1. Dashboard
2. PowerShell editor and script library
3. Scheduler workspace
4. Reporting workspace
5. Machine inventory
6. Credential vault
7. Teams and users
8. Settings and vCenter integration

### Required API Domains

1. Auth
2. Scripts and library entries
3. Script validation
4. Machines
5. Credentials
6. Deployment groups
7. Schedules
8. Executions and reports
9. Logs
10. Teams and users
11. Settings
12. vCenter import
13. Webhooks

## Entity Model

### Core Tables

- `users`
- `teams`
- `team_members`
- `library_entries`
- `script_versions`
- `credentials`
- `machines`
- `deployment_groups`
- `deployment_group_machines`
- `schedules`
- `schedule_scripts`
- `schedule_targets`
- `executions`
- `logs`
- `settings`
- `approvals`

### Key Data Relationships

- users belong to many teams
- teams can see shared credentials
- scripts can be personal or shared
- groups contain many machines
- schedules reference scripts and targets
- executions resolve down to script + machine pairs

## UI Direction

### Visual Language

- Deep blue-black atmospheric background
- Blue and violet chromatic glass panels
- Floating windows for secondary workspaces
- Dense operator-first tables and controls
- OSX-inspired chrome in the main shell
- Sora for primary UI typography, Azeret Mono for operational metadata

### Interaction Patterns

- Draggable and resizable dashboard widgets
- Draggable floating windows
- Searchable, sortable, paginated data tables
- Compact toolbars with strong keyboard-oriented affordances

## Competitive Research

Research date: September 4, 2026.

### Products Reviewed

- Windows PowerShell ISE
- PowerShell Universal / Ironman Software
- NinjaOne Remote PowerShell and Script Library
- IDERA PowerShell Plus
- ScriptRunner
- SAPIEN PowerShell Studio

### Signals From The Reviewed Products

- Microsoft’s Windows PowerShell ISE emphasizes integrated authoring, debugging, multi-pane workflow, snippets, and context-sensitive help.
- PowerShell Universal emphasizes central script management, REST APIs, scheduled jobs, and a secure role-based admin console with an end-user portal.
- NinjaOne emphasizes interactive remote PowerShell on managed endpoints, shared script libraries, queued automation behavior, and script access control.
- IDERA PowerShell Plus emphasizes a debugger-oriented editor, embedded console, script library organization, signing, sharing, and download/import workflows.
- ScriptRunner emphasizes delegated automation, approval workflows, credential vaulting, RBAC, audit-ready logs, and structured workflows.
- SAPIEN PowerShell Studio emphasizes rich editing, GUI-tool creation, packaging into executables, and installer generation.

### Market-Comparable Features Added To The Roadmap

1. Approval workflows for sensitive or high-impact automations
2. Safe delegation and self-service execution portals
3. Typed input forms and parameter validation for scripts
4. Rich script revisioning and publish/release states
5. Interactive remote shell and live diagnostics replay
6. Governance-oriented RBAC, audit exports, and change tracking
7. Queued and retried automation behavior for temporarily unavailable nodes
8. Reusable script packs/templates and guided operational runbooks
9. Notification policies for failure, recovery, and escalation
10. Optional packaging/export patterns for scripts and deployment plans

## Delivery Plan

### Phase 1: Platform Foundation

- Finalize runtime config and environment model
- Finalize data schema and bootstrap seed
- Finalize auth and session strategy
- Finalize logging and report persistence

Status: complete in this pass

### Phase 2: Operator Shell

- Build single-port SPA shell
- Add shell navigation and fixed chrome
- Add floating windows and dense data panels
- Add responsive dashboard grid

Status: complete in this pass

### Phase 3: Authoring Surface

- Deliver Monaco editor
- Deliver library tree and script metadata
- Deliver syntax validation
- Deliver revision history

Status: complete in this pass

### Phase 4: Inventory And Vault

- Deliver machine CRUD
- Deliver credential CRUD
- Deliver group CRUD
- Deliver connection test flows

Status: complete in this pass

### Phase 5: Scheduling And Execution

- Deliver schedule CRUD
- Deliver manual run API
- Deliver scheduler loop
- Deliver webhook execution

Status: complete for local execution, partial for remote scheduling hardening

### Phase 6: Reporting And Governance

- Deliver run history and output review
- Deliver searchable logs
- Deliver approval system model
- Enforce approvals in run paths

Status: partial; reporting/logs shipped, approval enforcement pending

### Phase 7: VMware Integration

- Store vCenter settings
- Authenticate to vCenter REST APIs
- Import VM inventory
- Auto-assign imported nodes to groups

Status: partial; auth and inventory import scaffold shipped

## Implementation Notes For Future AI Passes

- The repo is greenfield and intentionally organized by client/server domains.
- The backend uses `node:sqlite` specifically to avoid native addon failures in restricted environments.
- The scheduler currently uses a simple polling loop rather than a queue worker.
- The frontend store expects `/api/bootstrap` plus `/api/library`.
- PowerShell syntax validation uses the native parser through `pwsh`.
- The most important next refactor is execution transport abstraction for local vs SSH vs future WinRM modes.

## Immediate Next Tasks

1. Add approval submission, reviewer actions, and run blocking
2. Add input-schema definitions to scripts and render parameter forms in the scheduler
3. Expand execution transport support for SSH-based scheduled jobs
4. Add notifications and retention settings
5. Add deeper vCenter inventory mapping such as guest IP, power state, and tags

## Source Links

- Microsoft Learn: Windows PowerShell ISE overview and debugging
- https://learn.microsoft.com/en-us/powershell/scripting/windows-powershell/ise/exploring-the-windows-powershell-ise?view=powershell-7.6
- https://learn.microsoft.com/en-us/powershell/scripting/windows-powershell/ise/how-to-debug-scripts-in-windows-powershell-ise?view=powershell-7.6
- https://learn.microsoft.com/en-us/powershell/module/ise/new-isesnippet?view=powershell-5.1
- Ironman Software / PowerShell Universal
- https://ironmansoftware.com/
- https://docs.ironmansoftware.com/dashboard/themes
- NinjaOne
- https://www.ninjaone.com/mdm/remote-powershell/
- https://www.ninjaone.com/docs/administration/script-library/
- https://www.ninjaone.com/docs/scripting-and-automation/automation-library-faq/
- IDERA PowerShell Plus
- https://www.idera.com/productssolutions/freetools/powershellplus/
- ScriptRunner
- https://www.scriptrunner.com/competitors/diy---do-it-yourself
- https://www.scriptrunner.com/blog-admin-architect/built-in-approval-workflows-how-scriptrunner-ensures-sensitive-automations-never-run-without-approval
- https://www.scriptrunner.com/blog-admin-architect/structuring-automation-with-scriptrunner
- https://support.scriptrunner.com/articles/concepts/workflows
- SAPIEN PowerShell Studio
- https://www.sapien.com/software/powershell_studio
- Broadcom Developer Portal for vCenter integration
- https://developer.broadcom.com/xapis/vsphere-automation-api/latest
- https://developer.broadcom.com/xapis/virtual-infrastructure-json-api/latest
