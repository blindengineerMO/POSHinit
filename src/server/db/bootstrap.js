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
    notifications: {
      defaultChannel: 'log',
      notifyOnFailure: true,
      notifyOnSuccess: false,
    },
    runtime: {
      defaultShell: 'pwsh',
      allowManualRuns: true,
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
  seedSettings()
  seedDemoData()
  logger.info({ dbPath: config.dbPath }, 'database initialized')
}
