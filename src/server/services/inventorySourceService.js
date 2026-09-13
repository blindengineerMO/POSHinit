import { nanoid } from 'nanoid'
import { all, get, nowIso, run } from '../db/client.js'
import { getSettings } from './settingsService.js'
import { discoverVmwareMachines, normalizeVmwareConnectors } from './vcenterService.js'
import { discoverAzureArcMachines, normalizeAzureArcConnectors } from './azureArcService.js'
import { discoverProxmoxMachines, normalizeProxmoxConnectors } from './proxmoxService.js'
import { discoverXenServerMachines, normalizeXenServerConnectors } from './xenServerService.js'
import { saveMachine } from './machineService.js'

const providers = {
  vmware: { settingKey: 'vcenter', sourceTypes: (connector) => connector.kind === 'esxi-host' ? 'esxi' : 'vcenter', connectors: normalizeVmwareConnectors, discover: discoverVmwareMachines },
  azure_arc: { settingKey: 'azureArc', sourceTypes: () => 'azure_arc', connectors: normalizeAzureArcConnectors, discover: discoverAzureArcMachines },
  proxmox: { settingKey: 'proxmox', sourceTypes: () => 'proxmox', connectors: normalizeProxmoxConnectors, discover: discoverProxmoxMachines },
  xenserver: { settingKey: 'xenserver', sourceTypes: () => 'xenserver', connectors: normalizeXenServerConnectors, discover: discoverXenServerMachines },
}

const defaultMapping = { name: 'name', fqdn: 'fqdn', ipAddress: 'ipAddress', osFamily: 'osFamily', notes: 'notes' }

function parseJson(value, fallback) { try { return JSON.parse(value || '') } catch { return fallback } }
function isoAfterMinutes(minutes) { return new Date(Date.now() + Math.max(1, Number(minutes) || 60) * 60_000).toISOString() }
function sourceRow(row) { return { ...row, enabled: Boolean(row.enabled), syncEnabled: Boolean(row.sync_enabled), syncIntervalMinutes: row.sync_interval_minutes, fieldMapping: parseJson(row.field_mapping_json, {}), cursor: parseJson(row.cursor_json, {}) } }
function nestedValue(object, path) { return String(path || '').split('.').filter(Boolean).reduce((value, key) => value?.[key], object) }
function mappedValue(item, mapping, field) { const value = nestedValue(item, mapping[field] || defaultMapping[field]); return value == null ? '' : String(value) }

export function listInventorySources() {
  ensureManagedInventorySources()
  return all(`SELECT s.*, u.name AS owner_name, u.email AS owner_email,
    (SELECT COUNT(*) FROM inventory_reconciliations r WHERE r.source_id = s.id) AS reconciliation_count
    FROM inventory_sources s LEFT JOIN users u ON u.id = s.owner_user_id ORDER BY s.provider, s.name`).map(sourceRow)
}

export function listInventorySourceHistory(sourceId) {
  return all('SELECT * FROM inventory_reconciliations WHERE source_id = ? ORDER BY started_at DESC LIMIT 50', [sourceId]).map((row) => ({ ...row, details: parseJson(row.details_json, {}) }))
}

export function listInventorySourceErrors(sourceId) {
  return all('SELECT * FROM inventory_source_errors WHERE source_id = ? ORDER BY created_at DESC LIMIT 50', [sourceId]).map((row) => ({ ...row, context: parseJson(row.context_json, {}) }))
}

export function ensureManagedInventorySources() {
  const settings = getSettings()
  Object.entries(providers).forEach(([provider, definition]) => {
    const connectors = definition.connectors(settings[definition.settingKey] || {})
    connectors.forEach((connector) => {
      const prior = get('SELECT id FROM inventory_sources WHERE provider = ? AND connector_id = ?', [provider, connector.id])
      const timestamp = nowIso()
      if (!prior) run(`INSERT INTO inventory_sources (id, provider, connector_id, name, owner_user_id, next_sync_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [nanoid(), provider, connector.id, connector.name || connector.id, connector.ownerUserId || null, isoAfterMinutes(connector.syncIntervalMinutes || 60), timestamp, timestamp])
      else run('UPDATE inventory_sources SET name = ?, owner_user_id = COALESCE(?, owner_user_id), updated_at = ? WHERE id = ?', [connector.name || connector.id, connector.ownerUserId || null, timestamp, prior.id])
    })
  })
}

export function updateInventorySource(sourceId, payload = {}) {
  const source = get('SELECT * FROM inventory_sources WHERE id = ?', [sourceId])
  if (!source) throw new Error('Inventory source was not found')
  const interval = Math.max(1, Math.min(10080, Number(payload.syncIntervalMinutes ?? source.sync_interval_minutes) || 60))
  const stalePolicy = ['retain', 'mark_stale', 'archive'].includes(payload.stalePolicy) ? payload.stalePolicy : source.stale_policy
  const mapping = payload.fieldMapping && typeof payload.fieldMapping === 'object' ? payload.fieldMapping : parseJson(source.field_mapping_json, {})
  const enabled = payload.enabled == null ? source.enabled : Number(Boolean(payload.enabled))
  const syncEnabled = payload.syncEnabled == null ? source.sync_enabled : Number(Boolean(payload.syncEnabled))
  run(`UPDATE inventory_sources SET owner_user_id = ?, enabled = ?, sync_enabled = ?, sync_interval_minutes = ?, next_sync_at = ?,
    field_mapping_json = ?, stale_policy = ?, stale_after_syncs = ?, updated_at = ? WHERE id = ?`, [
    payload.ownerUserId ?? source.owner_user_id ?? null, enabled, syncEnabled, interval,
    syncEnabled && !source.next_sync_at ? isoAfterMinutes(interval) : source.next_sync_at,
    JSON.stringify(mapping), stalePolicy, Math.max(1, Number(payload.staleAfterSyncs ?? source.stale_after_syncs) || 1), nowIso(), sourceId,
  ])
  return sourceRow(get('SELECT * FROM inventory_sources WHERE id = ?', [sourceId]))
}

function normalizeForMachine(source, connector, item) {
  const mapping = { ...defaultMapping, ...parseJson(source.field_mapping_json, {}) }
  const sourceType = providers[source.provider].sourceTypes(connector)
  const name = mappedValue(item, mapping, 'name') || item.name || item.id
  const os = mappedValue(item, mapping, 'osFamily') || (/windows/i.test(item.guestOs || item.osName || '') ? 'windows' : 'linux')
  const notes = mappedValue(item, mapping, 'notes') || `Managed by ${source.name} (${source.provider})`
  return { name, fqdn: mappedValue(item, mapping, 'fqdn') || name, ipAddress: mappedValue(item, mapping, 'ipAddress'), notes, osFamily: os, sourceType, sourceRef: `${connector.id}:${item.id}` }
}

function reconciliation(sourceId) {
  const id = nanoid(); const startedAt = nowIso()
  run('INSERT INTO inventory_reconciliations (id, source_id, started_at, status) VALUES (?, ?, ?, ?)', [id, sourceId, startedAt, 'running'])
  return { id, startedAt }
}

export async function syncInventorySource(sourceId) {
  ensureManagedInventorySources()
  const source = get('SELECT * FROM inventory_sources WHERE id = ?', [sourceId])
  if (!source) throw new Error('Inventory source was not found')
  const definition = providers[source.provider]
  if (!definition) throw new Error(`Unsupported inventory source provider: ${source.provider}`)
  const connector = definition.connectors(getSettings()[definition.settingKey] || {}).find((item) => item.id === source.connector_id)
  if (!connector) throw new Error('The connector for this inventory source no longer exists')
  const record = reconciliation(source.id)
  try {
    const values = await definition.discover(getSettings()[definition.settingKey] || {}, connector.id)
    const seen = new Set(); let created = 0; let updated = 0; let unchanged = 0
    for (const item of values) {
      const machine = normalizeForMachine(source, connector, item)
      seen.add(machine.sourceRef)
      const current = get('SELECT * FROM machines WHERE source_type = ? AND source_ref = ?', [machine.sourceType, machine.sourceRef])
      const changed = !current || ['name', 'fqdn', 'ip_address', 'notes', 'os_family'].some((key) => String(current?.[key] || '') !== String({ name: machine.name, fqdn: machine.fqdn, ip_address: machine.ipAddress, notes: machine.notes, os_family: machine.osFamily }[key] || ''))
      const saved = saveMachine({ id: current?.id, ...machine, transport: current?.transport || 'psremoting', port: current?.port || 5985, credentialId: current?.credential_id || null, customFacts: parseJson(current?.custom_facts_json, {}), hostFacts: parseJson(current?.host_facts_json, {}), ownerUserId: current?.owner_user_id, ownerTeamId: current?.owner_team_id, criticality: current?.criticality, maintenanceWindow: parseJson(current?.maintenance_window_json, {}), businessService: current?.business_service })
      run("UPDATE machines SET inventory_source_id = ?, inventory_state = 'active', inventory_last_seen_at = ?, inventory_metadata_json = ?, inventory_missing_syncs = 0 WHERE id = ?", [source.id, nowIso(), JSON.stringify(item), saved.id])
      if (!current) created += 1; else if (changed) updated += 1; else unchanged += 1
    }
    const existing = all('SELECT id, source_ref, inventory_missing_syncs FROM machines WHERE inventory_source_id = ? AND inventory_state = ?', [source.id, 'active'])
    const missing = existing.filter((machine) => !seen.has(machine.source_ref)).map((machine) => ({ ...machine, missingSyncs: Number(machine.inventory_missing_syncs || 0) + 1 }))
    missing.forEach((machine) => run('UPDATE machines SET inventory_missing_syncs = ?, updated_at = ? WHERE id = ?', [machine.missingSyncs, nowIso(), machine.id]))
    const stale = missing.filter((machine) => machine.missingSyncs >= source.stale_after_syncs)
    if (source.stale_policy !== 'retain') stale.forEach((machine) => run("UPDATE machines SET inventory_state = ?, updated_at = ? WHERE id = ?", [source.stale_policy === 'archive' ? 'archived' : 'stale', nowIso(), machine.id]))
    const cursor = JSON.stringify({ lastCompletedAt: nowIso(), discovered: values.length })
    run(`UPDATE inventory_sources SET health_state = 'healthy', last_error = NULL, last_sync_at = ?, next_sync_at = ?, cursor_json = ?, updated_at = ? WHERE id = ?`, [nowIso(), isoAfterMinutes(source.sync_interval_minutes), cursor, nowIso(), source.id])
    run(`UPDATE inventory_reconciliations SET finished_at = ?, status = 'completed', discovered_count = ?, created_count = ?, updated_count = ?, unchanged_count = ?, stale_count = ?, details_json = ? WHERE id = ?`, [nowIso(), values.length, created, updated, unchanged, stale.length, JSON.stringify({ provider: source.provider, incremental: true, stalePolicy: source.stale_policy }), record.id])
    return { id: record.id, status: 'completed', discovered: values.length, created, updated, unchanged, stale: stale.length }
  } catch (error) {
    const message = error.message || 'Inventory source synchronization failed'
    run("UPDATE inventory_sources SET health_state = 'error', last_error = ?, next_sync_at = ?, updated_at = ? WHERE id = ?", [message, isoAfterMinutes(source.sync_interval_minutes), nowIso(), source.id])
    run("UPDATE inventory_reconciliations SET finished_at = ?, status = 'failed', error_message = ? WHERE id = ?", [nowIso(), message, record.id])
    run('INSERT INTO inventory_source_errors (id, source_id, reconciliation_id, message, context_json, created_at) VALUES (?, ?, ?, ?, ?, ?)', [nanoid(), source.id, record.id, message, JSON.stringify({ provider: source.provider, connectorId: source.connector_id }), nowIso()])
    throw error
  }
}

export async function processDueInventorySources() {
  ensureManagedInventorySources()
  const due = all("SELECT id FROM inventory_sources WHERE enabled = 1 AND sync_enabled = 1 AND (next_sync_at IS NULL OR next_sync_at <= ?)", [nowIso()])
  for (const source of due) await syncInventorySource(source.id)
  return due.length
}
