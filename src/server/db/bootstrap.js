import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'
import { config } from '../config.js'
import { encryptSecret } from '../utils/crypto.js'
import { logger } from '../utils/logger.js'
import { all, db, nowIso, run } from './client.js'

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      entra_enabled INTEGER NOT NULL DEFAULT 0,
      entra_email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (team_id, user_id),
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS library_entries (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      scope TEXT NOT NULL,
      owner_user_id TEXT,
      content TEXT,
      asset_path TEXT,
      language TEXT DEFAULT 'powershell',
      parameter_schema_json TEXT NOT NULL DEFAULT '[]',
      is_published INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (parent_id) REFERENCES library_entries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS script_versions (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      version_label TEXT NOT NULL,
      content TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (entry_id) REFERENCES library_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      scope TEXT NOT NULL,
      owner_user_id TEXT,
      team_ids_json TEXT NOT NULL DEFAULT '[]',
      username TEXT NOT NULL,
      domain_name TEXT,
      protocol TEXT NOT NULL DEFAULT 'ssh',
      secret_type TEXT NOT NULL DEFAULT 'username_password',
      secret_encrypted TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      fqdn TEXT,
      ip_address TEXT,
      notes TEXT,
      os_family TEXT NOT NULL DEFAULT 'linux',
      transport TEXT NOT NULL DEFAULT 'local',
      port INTEGER NOT NULL DEFAULT 22,
      credential_id TEXT,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_ref TEXT,
      last_tested_at TEXT,
      last_test_status TEXT,
      last_test_output TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS deployment_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      group_type TEXT NOT NULL DEFAULT 'manual',
      match_pattern TEXT,
      source_filters_json TEXT NOT NULL DEFAULT '[]',
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deployment_group_machines (
      group_id TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      PRIMARY KEY (group_id, machine_id),
      FOREIGN KEY (group_id) REFERENCES deployment_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cron_expression TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      mode TEXT NOT NULL DEFAULT 'recurring',
      run_at TEXT,
      status TEXT NOT NULL DEFAULT 'enabled',
      require_approval INTEGER NOT NULL DEFAULT 0,
      webhook_enabled INTEGER NOT NULL DEFAULT 0,
      webhook_key TEXT,
      webhook_token TEXT,
      next_run_at TEXT,
      last_run_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS schedule_scripts (
      schedule_id TEXT NOT NULL,
      script_id TEXT NOT NULL,
      parameters_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (schedule_id, script_id),
      FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
      FOREIGN KEY (script_id) REFERENCES library_entries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS schedule_targets (
      schedule_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      PRIMARY KEY (schedule_id, target_type, target_id),
      FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by TEXT,
      approved_by TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      trigger_type TEXT NOT NULL,
      schedule_id TEXT,
      script_id TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_by TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      exit_code INTEGER,
      stdout TEXT,
      stderr TEXT,
      report_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL,
      FOREIGN KEY (script_id) REFERENCES library_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS job_dispatches (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      trigger_type TEXT NOT NULL,
      schedule_id TEXT,
      requested_by TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      retry_limit INTEGER NOT NULL DEFAULT 0,
      timeout_seconds INTEGER NOT NULL DEFAULT 3600,
      payload_json TEXT NOT NULL DEFAULT '{}',
      queued_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL,
      FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS job_targets (
      id TEXT PRIMARY KEY,
      dispatch_id TEXT NOT NULL,
      script_id TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      timeout_seconds INTEGER NOT NULL DEFAULT 3600,
      available_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      execution_id TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (dispatch_id) REFERENCES job_dispatches(id) ON DELETE CASCADE,
      FOREIGN KEY (script_id) REFERENCES library_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE,
      FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS job_targets_claim_idx ON job_targets(status, available_at, created_at);
    CREATE INDEX IF NOT EXISTS job_targets_dispatch_idx ON job_targets(dispatch_id, status);

    CREATE TABLE IF NOT EXISTS job_rate_limits (
      scope TEXT PRIMARY KEY,
      window_started_at TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS machine_circuits (
      machine_id TEXT PRIMARY KEY,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'closed',
      opened_at TEXT,
      open_until TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS job_dead_letters (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL UNIQUE,
      dispatch_id TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      script_id TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (target_id) REFERENCES job_targets(id) ON DELETE CASCADE,
      FOREIGN KEY (dispatch_id) REFERENCES job_dispatches(id) ON DELETE CASCADE,
      FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE,
      FOREIGN KEY (script_id) REFERENCES library_entries(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS job_dead_letters_open_idx ON job_dead_letters(resolved_at, created_at DESC);

    CREATE TABLE IF NOT EXISTS job_events (
      id TEXT PRIMARY KEY,
      dispatch_id TEXT NOT NULL,
      target_id TEXT,
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(dispatch_id, sequence),
      FOREIGN KEY (dispatch_id) REFERENCES job_dispatches(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES job_targets(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS job_events_dispatch_idx ON job_events(dispatch_id, sequence);

    CREATE TABLE IF NOT EXISTS job_output_chunks (
      id TEXT PRIMARY KEY,
      dispatch_id TEXT NOT NULL,
      target_id TEXT,
      sequence INTEGER NOT NULL,
      stream TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(dispatch_id, sequence),
      FOREIGN KEY (dispatch_id) REFERENCES job_dispatches(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES job_targets(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS job_output_chunks_tail_idx ON job_output_chunks(dispatch_id, sequence DESC);

    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      channel TEXT NOT NULL,
      message TEXT NOT NULL,
      context_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      window_json TEXT NOT NULL DEFAULT '{}',
      event_types_json TEXT NOT NULL DEFAULT '[]',
      recipient_user_ids_json TEXT NOT NULL DEFAULT '[]',
      team_ids_json TEXT NOT NULL DEFAULT '[]',
      webhook_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(organization_id, name),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS environments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, name),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS access_grants (
      id TEXT PRIMARY KEY,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL DEFAULT '*',
      resource_id TEXT NOT NULL DEFAULT '*',
      organization_id TEXT,
      project_id TEXT,
      environment_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS access_grants_subject_idx ON access_grants(subject_type, subject_id);
    CREATE INDEX IF NOT EXISTS access_grants_scope_idx ON access_grants(resource_type, resource_id, action);

    CREATE TABLE IF NOT EXISTS external_secret_accesses (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      provider_kind TEXT NOT NULL,
      secret_reference TEXT NOT NULL,
      property_name TEXT,
      execution_id TEXT,
      script_id TEXT,
      machine_id TEXT,
      status TEXT NOT NULL,
      error_code TEXT,
      accessed_at TEXT NOT NULL,
      FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE SET NULL,
      FOREIGN KEY (script_id) REFERENCES library_entries(id) ON DELETE SET NULL,
      FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS external_secret_accesses_audit_idx ON external_secret_accesses(provider_id, accessed_at DESC);

    CREATE TABLE IF NOT EXISTS parameter_sets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      script_id TEXT NOT NULL,
      values_json TEXT NOT NULL DEFAULT '{}',
      owner_user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(script_id, name),
      FOREIGN KEY (script_id) REFERENCES library_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS parameter_sets_script_idx ON parameter_sets(script_id, name);

    CREATE TABLE IF NOT EXISTS inventory_sources (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      connector_id TEXT NOT NULL,
      name TEXT NOT NULL,
      owner_user_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      sync_enabled INTEGER NOT NULL DEFAULT 1,
      sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
      next_sync_at TEXT,
      last_sync_at TEXT,
      health_state TEXT NOT NULL DEFAULT 'unknown',
      last_error TEXT,
      field_mapping_json TEXT NOT NULL DEFAULT '{}',
      stale_policy TEXT NOT NULL DEFAULT 'mark_stale',
      stale_after_syncs INTEGER NOT NULL DEFAULT 1,
      cursor_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(provider, connector_id),
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_reconciliations (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      discovered_count INTEGER NOT NULL DEFAULT 0,
      created_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      unchanged_count INTEGER NOT NULL DEFAULT 0,
      stale_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (source_id) REFERENCES inventory_sources(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS inventory_reconciliations_source_idx ON inventory_reconciliations(source_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS inventory_source_errors (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      reconciliation_id TEXT,
      message TEXT NOT NULL,
      context_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES inventory_sources(id) ON DELETE CASCADE,
      FOREIGN KEY (reconciliation_id) REFERENCES inventory_reconciliations(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS inventory_source_errors_source_idx ON inventory_source_errors(source_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS group_membership_events (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      reason_json TEXT NOT NULL DEFAULT '[]',
      occurred_at TEXT NOT NULL,
      FOREIGN KEY (group_id) REFERENCES deployment_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS group_membership_events_group_idx ON group_membership_events(group_id, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS cmdb_enrichment_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      match_field TEXT NOT NULL DEFAULT 'fqdn',
      config_json TEXT NOT NULL DEFAULT '{}',
      mapping_json TEXT NOT NULL DEFAULT '{}',
      last_sync_at TEXT,
      health_state TEXT NOT NULL DEFAULT 'unknown',
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cmdb_enrichment_runs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      records_read INTEGER NOT NULL DEFAULT 0,
      nodes_enriched INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      FOREIGN KEY (source_id) REFERENCES cmdb_enrichment_sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      sequence INTEGER NOT NULL UNIQUE,
      occurred_at TEXT NOT NULL,
      actor_id TEXT,
      actor_type TEXT NOT NULL DEFAULT 'user',
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      outcome TEXT NOT NULL,
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      context_json TEXT NOT NULL DEFAULT '{}',
      previous_hash TEXT,
      event_hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_events_occurred_idx ON audit_events(occurred_at DESC);
    CREATE TRIGGER IF NOT EXISTS audit_events_immutable_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'Audit events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS audit_events_immutable_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'Audit events are immutable'); END;
  `)
}

function ensureUserIdentitySchema() {
  const columns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name)
  if (!columns.includes('entra_enabled')) {
    db.exec('ALTER TABLE users ADD COLUMN entra_enabled INTEGER NOT NULL DEFAULT 0')
  }
  if (!columns.includes('entra_email')) {
    db.exec('ALTER TABLE users ADD COLUMN entra_email TEXT')
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_entra_email_unique ON users(entra_email COLLATE NOCASE) WHERE entra_email IS NOT NULL')
}

function ensureScriptParameterSchema() { const columns = db.prepare('PRAGMA table_info(library_entries)').all().map((column) => column.name); if (!columns.includes('parameter_schema_json')) db.exec("ALTER TABLE library_entries ADD COLUMN parameter_schema_json TEXT NOT NULL DEFAULT '[]'") }

function ensureDynamicGroupSchema() {
  const columns = db.prepare('PRAGMA table_info(deployment_groups)').all().map((column) => column.name)
  if (!columns.includes('group_type')) db.exec("ALTER TABLE deployment_groups ADD COLUMN group_type TEXT NOT NULL DEFAULT 'manual'")
  if (!columns.includes('match_pattern')) db.exec('ALTER TABLE deployment_groups ADD COLUMN match_pattern TEXT')
  if (!columns.includes('source_filters_json')) db.exec("ALTER TABLE deployment_groups ADD COLUMN source_filters_json TEXT NOT NULL DEFAULT '[]'")
  if (!columns.includes('last_synced_at')) db.exec('ALTER TABLE deployment_groups ADD COLUMN last_synced_at TEXT')
  if (!columns.includes('rule_json')) db.exec("ALTER TABLE deployment_groups ADD COLUMN rule_json TEXT NOT NULL DEFAULT '{}' ")
  const machineColumns = db.prepare('PRAGMA table_info(machines)').all().map((column) => column.name)
  if (!machineColumns.includes('custom_facts_json')) db.exec("ALTER TABLE machines ADD COLUMN custom_facts_json TEXT NOT NULL DEFAULT '{}'")
  if (!machineColumns.includes('host_facts_json')) db.exec("ALTER TABLE machines ADD COLUMN host_facts_json TEXT NOT NULL DEFAULT '{}'")
  if (!machineColumns.includes('owner_user_id')) db.exec('ALTER TABLE machines ADD COLUMN owner_user_id TEXT')
  if (!machineColumns.includes('owner_team_id')) db.exec('ALTER TABLE machines ADD COLUMN owner_team_id TEXT')
  if (!machineColumns.includes('criticality')) db.exec("ALTER TABLE machines ADD COLUMN criticality TEXT NOT NULL DEFAULT 'standard'")
  if (!machineColumns.includes('maintenance_window_json')) db.exec("ALTER TABLE machines ADD COLUMN maintenance_window_json TEXT NOT NULL DEFAULT '{}'")
  if (!machineColumns.includes('business_service')) db.exec('ALTER TABLE machines ADD COLUMN business_service TEXT')
}

function ensureScheduleWebhookSchema() {
  const columns = db.prepare('PRAGMA table_info(schedules)').all().map((column) => column.name)
  if (!columns.includes('webhook_enabled')) db.exec('ALTER TABLE schedules ADD COLUMN webhook_enabled INTEGER NOT NULL DEFAULT 0')
  if (!columns.includes('webhook_key')) db.exec('ALTER TABLE schedules ADD COLUMN webhook_key TEXT')
  if (!columns.includes('webhook_token')) db.exec('ALTER TABLE schedules ADD COLUMN webhook_token TEXT')
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS schedules_webhook_key_unique ON schedules(webhook_key) WHERE webhook_key IS NOT NULL')
}

function ensureCredentialSecretSchema() {
  const columns = db.prepare('PRAGMA table_info(credentials)').all().map((column) => column.name)
  if (!columns.includes('secret_type')) db.exec("ALTER TABLE credentials ADD COLUMN secret_type TEXT NOT NULL DEFAULT 'username_password'")
}

function ensureJobReliabilitySchema() {
  const dispatchColumns = db.prepare('PRAGMA table_info(job_dispatches)').all().map((column) => column.name)
  if (!dispatchColumns.includes('job_timeout_seconds')) db.exec('ALTER TABLE job_dispatches ADD COLUMN job_timeout_seconds INTEGER NOT NULL DEFAULT 0')
  if (!dispatchColumns.includes('deadline_at')) db.exec('ALTER TABLE job_dispatches ADD COLUMN deadline_at TEXT')
}

function ensureScopedRbacSchema() {
  const resourceTables = ['library_entries', 'machines', 'credentials', 'deployment_groups', 'schedules']
  resourceTables.forEach((table) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)
    if (!columns.includes('project_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN project_id TEXT NOT NULL DEFAULT 'project-default'`)
    if (!columns.includes('environment_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN environment_id TEXT NOT NULL DEFAULT 'env-default'`)
  })
  const timestamp = nowIso()
  run("INSERT OR IGNORE INTO organizations (id, name, created_at, updated_at) VALUES ('org-default', 'Default Organization', ?, ?)", [timestamp, timestamp])
  run("INSERT OR IGNORE INTO projects (id, organization_id, name, created_at, updated_at) VALUES ('project-default', 'org-default', 'Default Project', ?, ?)", [timestamp, timestamp])
  run("INSERT OR IGNORE INTO environments (id, project_id, name, created_at, updated_at) VALUES ('env-default', 'project-default', 'Production', ?, ?)", [timestamp, timestamp])
}

function ensureProjectEnvironmentSchema() {
  const projectColumns = db.prepare('PRAGMA table_info(projects)').all().map((column) => column.name)
  if (!projectColumns.includes('description')) db.exec('ALTER TABLE projects ADD COLUMN description TEXT')
  const environmentColumns = db.prepare('PRAGMA table_info(environments)').all().map((column) => column.name)
  if (!environmentColumns.includes('environment_type')) db.exec("ALTER TABLE environments ADD COLUMN environment_type TEXT NOT NULL DEFAULT 'custom'")
  if (!environmentColumns.includes('is_protected')) db.exec('ALTER TABLE environments ADD COLUMN is_protected INTEGER NOT NULL DEFAULT 0')
  if (!environmentColumns.includes('require_approval')) db.exec('ALTER TABLE environments ADD COLUMN require_approval INTEGER NOT NULL DEFAULT 0')
  ;['notification_policies', 'cmdb_enrichment_sources', 'inventory_sources'].forEach((table) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)
    if (!columns.includes('project_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN project_id TEXT NOT NULL DEFAULT 'project-default'`)
    if (!columns.includes('environment_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN environment_id TEXT NOT NULL DEFAULT 'env-default'`)
  })
}

function ensureInventorySourceSchema() {
  const columns = db.prepare('PRAGMA table_info(machines)').all().map((column) => column.name)
  if (!columns.includes('inventory_source_id')) db.exec('ALTER TABLE machines ADD COLUMN inventory_source_id TEXT')
  if (!columns.includes('inventory_state')) db.exec("ALTER TABLE machines ADD COLUMN inventory_state TEXT NOT NULL DEFAULT 'active'")
  if (!columns.includes('inventory_last_seen_at')) db.exec('ALTER TABLE machines ADD COLUMN inventory_last_seen_at TEXT')
  if (!columns.includes('inventory_metadata_json')) db.exec("ALTER TABLE machines ADD COLUMN inventory_metadata_json TEXT NOT NULL DEFAULT '{}'")
  if (!columns.includes('inventory_missing_syncs')) db.exec('ALTER TABLE machines ADD COLUMN inventory_missing_syncs INTEGER NOT NULL DEFAULT 0')
  db.exec('CREATE INDEX IF NOT EXISTS machines_inventory_source_idx ON machines(inventory_source_id, inventory_state)')
}

function seedSettings() {
  if (all('SELECT key FROM settings').length) {
    return
  }

  const createdAt = nowIso()
  const baseSettings = {
    branding: {
      productName: 'POSHinit Control Plane',
      supportEmail: 'ops@example.com',
    },
    vcenter: {
      connectors: [],
    },
    azureArc: {
      connectors: [],
    },
    proxmox: { connectors: [] },
    secretProviders: { providers: [] },
    notifications: {
      defaultChannel: 'log',
      notifyOnFailure: true,
      notifyOnSuccess: false,
    },
    runtime: {
      defaultShell: 'pwsh',
      allowManualRuns: true,
      workerMode: 'active',
      maxConcurrentTargets: 4,
      maxConcurrentPerDispatch: 2,
      maxConcurrentPerMachine: 1,
      maxDispatchesPerMinute: 60,
      defaultTargetTimeoutSeconds: 3600,
      defaultJobTimeoutSeconds: 0,
      retryBaseSeconds: 5,
      retryMaxSeconds: 300,
      circuitFailureThreshold: 3,
      circuitOpenSeconds: 300,
    },
  }

  Object.entries(baseSettings).forEach(([key, value]) => {
    run(
      'INSERT INTO settings (key, value_json, updated_at) VALUES (@key, @valueJson, @updatedAt)',
      {
        key,
        valueJson: JSON.stringify(value),
        updatedAt: createdAt,
      },
    )
  })
}

function seedDemoData() {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count
  if (userCount) {
    return
  }

  const createdAt = nowIso()
  const adminId = nanoid()
  const teamId = nanoid()
  const credId = nanoid()
  const localMachineId = nanoid()
  const groupId = nanoid()
  const scriptFolderId = nanoid()
  const sharedScriptId = nanoid()
  const personalScriptId = nanoid()
  const scheduleId = nanoid()

  run(
    `INSERT INTO users (id, name, email, role, password_hash, status, created_at, updated_at)
     VALUES (@id, @name, @email, @role, @passwordHash, 'active', @createdAt, @updatedAt)`,
    {
      id: adminId,
      name: 'Matt Powers',
      email: 'admin@poshinit.local',
      role: 'admin',
      passwordHash: bcrypt.hashSync(config.demoPassword, 10),
      createdAt,
      updatedAt: createdAt,
    },
  )

  run(
    'INSERT INTO teams (id, name, description, created_at, updated_at) VALUES (@id, @name, @description, @createdAt, @updatedAt)',
    {
      id: teamId,
      name: 'Platform Ops',
      description: 'Shared automation and credential access for platform operators.',
      createdAt,
      updatedAt: createdAt,
    },
  )

  run('INSERT INTO team_members (team_id, user_id) VALUES (@teamId, @userId)', {
    teamId,
    userId: adminId,
  })

  run(
    `INSERT INTO credentials (
       id, name, scope, owner_user_id, team_ids_json, username, domain_name, protocol,
       secret_encrypted, notes, created_at, updated_at
     ) VALUES (
       @id, @name, @scope, @ownerUserId, @teamIdsJson, @username, @domainName, @protocol,
       @secretEncrypted, @notes, @createdAt, @updatedAt
     )`,
    {
      id: credId,
      name: 'Local Operator',
      scope: 'shared',
      ownerUserId: adminId,
      teamIdsJson: JSON.stringify([teamId]),
      username: 'local',
      domainName: '',
      protocol: 'local',
      secretEncrypted: encryptSecret('unused'),
      notes: 'Used for local demo runs.',
      createdAt,
      updatedAt: createdAt,
    },
  )

  run(
    `INSERT INTO machines (
       id, name, fqdn, ip_address, notes, os_family, transport, port, credential_id,
       source_type, source_ref, last_tested_at, last_test_status, last_test_output, created_at, updated_at
     ) VALUES (
       @id, @name, @fqdn, @ipAddress, @notes, @osFamily, @transport, @port, @credentialId,
       @sourceType, @sourceRef, @lastTestedAt, @lastTestStatus, @lastTestOutput, @createdAt, @updatedAt
     )`,
    {
      id: localMachineId,
      name: 'Local Lab Node',
      fqdn: 'localhost',
      ipAddress: '127.0.0.1',
      notes: 'Executes PowerShell directly on the host running POSHinit.',
      osFamily: 'linux',
      transport: 'local',
      port: 22,
      credentialId: credId,
      sourceType: 'manual',
      sourceRef: '',
      lastTestedAt: createdAt,
      lastTestStatus: 'success',
      lastTestOutput: 'Hello from Local Lab Node',
      createdAt,
      updatedAt: createdAt,
    },
  )

  run(
    'INSERT INTO deployment_groups (id, name, description, created_at, updated_at) VALUES (@id, @name, @description, @createdAt, @updatedAt)',
    {
      id: groupId,
      name: 'Core Infrastructure',
      description: 'Primary demo deployment group.',
      createdAt,
      updatedAt: createdAt,
    },
  )

  run(
    'INSERT INTO deployment_group_machines (group_id, machine_id) VALUES (@groupId, @machineId)',
    {
      groupId,
      machineId: localMachineId,
    },
  )

  run(
    `INSERT INTO library_entries (
       id, parent_id, type, name, scope, owner_user_id, content, asset_path, language,
       is_published, notes, created_at, updated_at
     ) VALUES (
       @id, @parentId, @type, @name, @scope, @ownerUserId, @content, @assetPath, @language,
       @isPublished, @notes, @createdAt, @updatedAt
     )`,
    {
      id: scriptFolderId,
      parentId: null,
      type: 'folder',
      name: 'Runbooks',
      scope: 'shared',
      ownerUserId: adminId,
      content: '',
      assetPath: '',
      language: 'folder',
      isPublished: 1,
      notes: 'Shared runbooks and operations scripts.',
      createdAt,
      updatedAt: createdAt,
    },
  )

  const sharedContent = [
    "$summary = [ordered]@{",
    "  HostName = $env:COMPUTERNAME",
    "  User = [Environment]::UserName",
    "  UtcNow = (Get-Date).ToUniversalTime().ToString('o')",
    "  Services = (Get-Service | Where-Object Status -eq 'Running' | Select-Object -First 5 -ExpandProperty Name)",
    "}",
    '$summary | ConvertTo-Json -Depth 4',
  ].join('\n')

  const personalContent = [
    "Write-Output 'Running personal diagnostics'",
    "Get-ChildItem Env: | Sort-Object Name | Select-Object -First 12",
  ].join('\n')

  run(
    `INSERT INTO library_entries (
       id, parent_id, type, name, scope, owner_user_id, content, asset_path, language,
       is_published, notes, created_at, updated_at
     ) VALUES (
       @id, @parentId, @type, @name, @scope, @ownerUserId, @content, @assetPath, @language,
       @isPublished, @notes, @createdAt, @updatedAt
     )`,
    {
      id: sharedScriptId,
      parentId: scriptFolderId,
      type: 'script',
      name: 'System Snapshot.ps1',
      scope: 'shared',
      ownerUserId: adminId,
      content: sharedContent,
      assetPath: '',
      language: 'powershell',
      isPublished: 1,
      notes: 'Shared system snapshot collector.',
      createdAt,
      updatedAt: createdAt,
    },
  )

  run(
    `INSERT INTO library_entries (
       id, parent_id, type, name, scope, owner_user_id, content, asset_path, language,
       is_published, notes, created_at, updated_at
     ) VALUES (
       @id, @parentId, @type, @name, @scope, @ownerUserId, @content, @assetPath, @language,
       @isPublished, @notes, @createdAt, @updatedAt
     )`,
    {
      id: personalScriptId,
      parentId: null,
      type: 'script',
      name: 'Personal Diagnostics.ps1',
      scope: 'personal',
      ownerUserId: adminId,
      content: personalContent,
      assetPath: '',
      language: 'powershell',
      isPublished: 0,
      notes: 'Personal scratchpad diagnostics.',
      createdAt,
      updatedAt: createdAt,
    },
  )

  run(
    'INSERT INTO script_versions (id, entry_id, version_label, content, created_by, created_at) VALUES (@id, @entryId, @versionLabel, @content, @createdBy, @createdAt)',
    {
      id: nanoid(),
      entryId: sharedScriptId,
      versionLabel: 'v1',
      content: sharedContent,
      createdBy: adminId,
      createdAt,
    },
  )

  run(
    'INSERT INTO script_versions (id, entry_id, version_label, content, created_by, created_at) VALUES (@id, @entryId, @versionLabel, @content, @createdBy, @createdAt)',
    {
      id: nanoid(),
      entryId: personalScriptId,
      versionLabel: 'v1',
      content: personalContent,
      createdBy: adminId,
      createdAt,
    },
  )

  run(
    `INSERT INTO schedules (
       id, name, cron_expression, timezone, mode, run_at, status, require_approval,
       next_run_at, last_run_at, created_by, created_at, updated_at
     ) VALUES (
       @id, @name, @cronExpression, @timezone, @mode, @runAt, @status, @requireApproval,
       @nextRunAt, @lastRunAt, @createdBy, @createdAt, @updatedAt
     )`,
    {
      id: scheduleId,
      name: 'Hourly Local Snapshot',
      cronExpression: '0 * * * *',
      timezone: 'UTC',
      mode: 'recurring',
      runAt: null,
      status: 'enabled',
      requireApproval: 0,
      nextRunAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      lastRunAt: null,
      createdBy: adminId,
      createdAt,
      updatedAt: createdAt,
    },
  )

  run(
    'INSERT INTO schedule_scripts (schedule_id, script_id, parameters_json) VALUES (@scheduleId, @scriptId, @parametersJson)',
    {
      scheduleId,
      scriptId: sharedScriptId,
      parametersJson: JSON.stringify({}),
    },
  )

  run(
    'INSERT INTO schedule_targets (schedule_id, target_type, target_id) VALUES (@scheduleId, @targetType, @targetId)',
    {
      scheduleId,
      targetType: 'group',
      targetId: groupId,
    },
  )
}

export function initializeDatabase() {
  createTables()
  ensureUserIdentitySchema()
  ensureScheduleWebhookSchema()
  ensureCredentialSecretSchema()
  ensureJobReliabilitySchema()
  ensureScopedRbacSchema()
  ensureProjectEnvironmentSchema()
  ensureInventorySourceSchema()
  ensureScriptParameterSchema()
  ensureDynamicGroupSchema()
  seedSettings()
  seedDemoData()
  logger.info({ dbPath: config.dbPath }, 'database initialized')
}
