<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import DataTable from '../components/common/DataTable.vue'
import FloatingWindow from '../components/common/FloatingWindow.vue'
import NeonPanel from '../components/common/NeonPanel.vue'
import VmwareImportWizard from '../components/inventory/VmwareImportWizard.vue'
import AzureArcImportWizard from '../components/inventory/AzureArcImportWizard.vue'
import SubnetScanWizard from '../components/inventory/SubnetScanWizard.vue'
import MachineImportWizard from '../components/inventory/MachineImportWizard.vue'
import ProxmoxImportWizard from '../components/inventory/ProxmoxImportWizard.vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const machineDialog = ref(false)
const nodeDialog = ref(false)
const groupDialog = ref(false)
const groupHistoryDialog = ref(false)
const groupHistory = ref([])
const importDialog = ref(false)
const azureArcImportDialog = ref(false)
const subnetScanDialog = ref(false)
const importLauncherDialog = ref(false)
const cmdbDialog = ref(false)
const cmdbSources = ref([])
const cmdbEditor = ref(false)
const vmwareKind = ref('')
const proxmoxImportDialog = ref(false)
const nodeTab = ref('record')
const nodeConnectionResult = ref(null)
const selectedRun = ref(null)
const terminalDialog = ref(false)
const terminalSession = ref(null)
const terminalConnecting = ref(false)
const terminalRunning = ref(false)
const terminalHost = ref(null)
let terminal
let fitAddon
let resizeObserver
let commandBuffer = ''

const machineDraft = reactive({
  name: '',
  fqdn: '',
  ipAddress: '',
  notes: '',
  osFamily: 'linux',
  transport: 'psremoting',
  port: 5985,
  credentialId: '',
})

const nodeDraft = reactive({
  id: '',
  name: '',
  fqdn: '',
  ipAddress: '',
  notes: '',
  osFamily: 'linux',
  transport: 'psremoting',
  port: 5985,
  credentialId: '',
  sourceType: 'manual',
  sourceRef: '',
  customFactsText: '{}',
  hostFactsText: '{}',
  ownerUserId: '',
  ownerTeamId: '',
  criticality: 'standard',
  businessService: '',
  maintenanceWindowText: '{}',
})
const cmdbDraft = reactive({ id: '', name: '', kind: 'servicenow', enabled: true, matchField: 'fqdn', config: { url: '', table: 'cmdb_ci_server', recordsPath: 'result', authType: 'bearer', username: '', password: '', authToken: '', csvText: '' }, mapping: { identity: 'name', hostFacts: { serial: 'serial_number', osVersion: 'os_version' }, customFacts: {}, criticality: 'operational_status', businessService: 'business_service' } })

const groupDraft = reactive({
  id: '',
  name: '',
  description: '',
  groupType: 'manual',
  machineIds: [],
  matchPattern: '*',
  sourceIds: [],
  rule: { op: 'all', conditions: [{ field: 'name', operator: 'matches', value: '*' }], groups: [] },
})

const transportOptions = [
  { title: 'PowerShell Remoting (recommended)', value: 'psremoting' },
  { title: 'SSH', value: 'ssh' },
  { title: 'Local host', value: 'local' },
]
const credentialOptions = computed(() => (store.catalog.credentials || []).filter((credential) =>
  machineDraft.transport === 'local' || credential.protocol === machineDraft.transport,
))
const nodeCredentialOptions = computed(() => (store.catalog.credentials || []).filter((credential) =>
  nodeDraft.transport === 'local' || credential.protocol === nodeDraft.transport,
))
const nodeRunHistory = computed(() => (store.catalog.executions || []).filter((execution) => execution.machine_id === nodeDraft.id))
const integratedSources = computed(() => {
  const sources = new Map()
  ;(store.catalog.machines || []).filter((machine) => machine.source_type && machine.source_type !== 'manual').forEach((machine) => {
    const connectorId = String(machine.source_ref || '').split(':')[0]
    if (!connectorId) return
    const id = `${machine.source_type}:${connectorId}`
    if (!sources.has(id)) sources.set(id, { id, sourceType: machine.source_type, connectorId, title: `${machine.source_type.replaceAll('_', ' ')} · ${connectorId}` })
  })
  return [...sources.values()].sort((left, right) => left.title.localeCompare(right.title))
})
const dynamicMatches = ref([])
const ruleFields = [{ title: 'Inventory source', value: 'source' }, { title: 'Connector', value: 'connector' }, { title: 'Name', value: 'name' }, { title: 'FQDN', value: 'fqdn' }, { title: 'OS', value: 'os' }, { title: 'Transport', value: 'transport' }, { title: 'Tags', value: 'tags' }, { title: 'Status', value: 'status' }, { title: 'IP address', value: 'ip' }, { title: 'IP subnet', value: 'subnet' }, { title: 'Notes', value: 'notes' }, { title: 'Custom facts', value: 'facts' }]
const ruleOperators = [{ title: 'equals', value: 'equals' }, { title: 'does not equal', value: 'not_equals' }, { title: 'contains', value: 'contains' }, { title: 'wildcard matches', value: 'matches' }, { title: 'is in subnet', value: 'in_subnet' }, { title: 'exists', value: 'exists' }]
async function refreshRulePreview() { if (groupDraft.groupType !== 'dynamic') return; dynamicMatches.value = await store.previewGroupRule(groupDraft.rule) }
function addRuleCondition(node = groupDraft.rule) { node.conditions.push({ field: 'name', operator: 'matches', value: '*' }); refreshRulePreview() }
function addRuleGroup() { groupDraft.rule.groups.push({ op: 'any', conditions: [{ field: 'tags', operator: 'contains', value: '' }], groups: [] }); refreshRulePreview() }
function removeRuleCondition(index) { groupDraft.rule.conditions.splice(index, 1); refreshRulePreview() }

watch(() => machineDraft.transport, (transport) => {
  machineDraft.port = transport === 'psremoting' ? 5985 : transport === 'ssh' ? 22 : 0
  machineDraft.credentialId = ''
})
watch(terminalDialog, (open) => { if (!open) closeTerminal() })

async function saveMachine() {
  await store.saveMachine(machineDraft)
  machineDialog.value = false
}

function selectMachineImport(method) {
  if (method === 'standalone') machineDialog.value = true
  if (method === 'network') subnetScanDialog.value = true
  if (method === 'azure-arc') azureArcImportDialog.value = true
  if (method === 'proxmox') proxmoxImportDialog.value = true
  if (method === 'vcenter' || method === 'esxi') { vmwareKind.value = method === 'esxi' ? 'esxi-host' : 'vcenter'; importDialog.value = true }
}

function inventoryRows() {
  return (store.catalog.machines || []).map((machine) => ({
    Name: machine.name || '', FQDN: machine.fqdn || '', Address: machine.ip_address || '', OS: machine.os_family || '', Transport: machine.transport || '', Port: machine.port || '', Source: machine.source_type || '', Status: machine.last_test_status || 'not tested',
  }))
}
function downloadExport(name, type, content) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([content], { type }))
  link.download = name
  link.click()
  URL.revokeObjectURL(link.href)
}
function escapeCsv(value) { return `"${String(value ?? '').replaceAll('"', '""')}"` }
function exportCsv() {
  const rows = inventoryRows(); const columns = Object.keys(rows[0] || { Name: '' })
  downloadExport('poshinit-node-inventory.csv', 'text/csv;charset=utf-8', [columns.join(','), ...rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(','))].join('\n'))
}
function escapeXml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;') }
function exportXls() {
  const rows = inventoryRows(); const columns = Object.keys(rows[0] || { Name: '' })
  const table = `<table><tr>${columns.map((column) => `<th>${escapeXml(column)}</th>`).join('')}</tr>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeXml(row[column])}</td>`).join('')}</tr>`).join('')}</table>`
  downloadExport('poshinit-node-inventory.xls', 'application/vnd.ms-excel', `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${table}</body></html>`)
}
function escapePdf(value) { return String(value ?? '').replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '?') }
function exportPdf() {
  const rows = inventoryRows(); const lines = ['POSHinit Node Inventory', `Generated ${new Date().toLocaleString()}`, '', ...rows.flatMap((row) => [`${row.Name} | ${row.OS} | ${row.Transport} | ${row.Status}`, `${row.FQDN || row.Address} | ${row.Source}`])]
  const content = ['BT', '/F1 10 Tf', '50 760 Td', ...lines.slice(0, 55).flatMap((line, index) => [index ? '0 -13 Td' : '', `(${escapePdf(line)}) Tj`]).filter(Boolean), 'ET'].join('\n')
  const objects = [`<< /Type /Catalog /Pages 2 0 R >>`, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`]
  let pdf = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const start = pdf.length; pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`
  downloadExport('poshinit-node-inventory.pdf', 'application/pdf', pdf)
}

function openNode(machine) {
  Object.assign(nodeDraft, {
    id: machine.id,
    name: machine.name,
    fqdn: machine.fqdn || '',
    ipAddress: machine.ip_address || '',
    notes: machine.notes || '',
    osFamily: machine.os_family || 'windows',
    transport: machine.transport || 'psremoting',
    port: machine.port ?? (machine.transport === 'ssh' ? 22 : machine.transport === 'local' ? 0 : 5985),
    credentialId: machine.credential_id || '',
    sourceType: machine.source_type || 'manual',
    sourceRef: machine.source_ref || '',
    customFactsText: machine.custom_facts_json || '{}', hostFactsText: machine.host_facts_json || '{}', ownerUserId: machine.owner_user_id || '', ownerTeamId: machine.owner_team_id || '', criticality: machine.criticality || 'standard', businessService: machine.business_service || '', maintenanceWindowText: machine.maintenance_window_json || '{}',
  })
  nodeConnectionResult.value = null
  selectedRun.value = null
  nodeTab.value = 'record'
  nodeDialog.value = true
}

async function saveNode() {
  try { await store.saveMachine({ ...nodeDraft, customFacts: JSON.parse(nodeDraft.customFactsText || '{}'), hostFacts: JSON.parse(nodeDraft.hostFactsText || '{}'), maintenanceWindow: JSON.parse(nodeDraft.maintenanceWindowText || '{}') }) } catch (error) { window.alert(`Metadata must be valid JSON: ${error.message}`) }
}
async function refreshCmdbSources() { cmdbSources.value = await store.listCmdbSources() }
function openCmdbSource(source = null) { Object.assign(cmdbDraft, source ? structuredClone(source) : { id: '', name: '', kind: 'servicenow', enabled: true, matchField: 'fqdn', config: { url: '', table: 'cmdb_ci_server', recordsPath: 'result', authType: 'bearer', username: '', password: '', authToken: '', csvText: '' }, mapping: { identity: 'name', hostFacts: { serial: 'serial_number' }, customFacts: {}, criticality: '', businessService: '' } }); cmdbEditor.value = true }
async function saveCmdbSource() { await store.saveCmdbSource(cmdbDraft); cmdbEditor.value = false; await refreshCmdbSources() }
async function syncCmdbSource(source) { await store.syncCmdbSource(source.id); await refreshCmdbSources(); await store.bootstrap() }
async function removeCmdbSource(source) { await store.deleteCmdbSource(source.id); await refreshCmdbSources() }

function resetGroup() {
  Object.assign(groupDraft, { id: '', name: '', description: '', groupType: 'manual', machineIds: [], matchPattern: '*', sourceIds: [], rule: { op: 'all', conditions: [{ field: 'name', operator: 'matches', value: '*' }], groups: [] } })
}

function openGroup(group = null) {
  if (!group) resetGroup()
  else Object.assign(groupDraft, {
    id: group.id,
    name: group.name,
    description: group.description || '',
    groupType: group.groupType || 'manual',
    machineIds: [...(group.machineIds || [])],
    matchPattern: group.matchPattern || '*',
    sourceIds: (group.sourceFilters || []).map((source) => `${source.sourceType}:${source.connectorId}`),
    rule: structuredClone(group.rule?.conditions?.length || group.rule?.groups?.length ? group.rule : { op: 'all', conditions: [{ field: 'name', operator: 'matches', value: group.matchPattern || '*' }], groups: [] }),
  })
  groupDialog.value = true
  if (groupDraft.groupType === 'dynamic') refreshRulePreview()
}

async function saveGroup() {
  const sources = integratedSources.value.filter((source) => groupDraft.sourceIds.includes(source.id))
  await store.saveGroup({ ...groupDraft, sourceFilters: sources.map(({ sourceType, connectorId }) => ({ sourceType, connectorId })), rule: groupDraft.rule })
  groupDialog.value = false
}
async function openGroupHistory(group) { groupHistory.value = await store.groupMembershipHistory(group.id); groupHistoryDialog.value = true }

async function testNodeConnection() {
  nodeConnectionResult.value = null
  try {
    nodeConnectionResult.value = await store.testMachine(nodeDraft.id)
  } catch (error) {
    nodeConnectionResult.value = { ok: false, stdout: '', stderr: error.message }
  }
}

function downloadRdp(machine) {
  const address = machine.fqdn || machine.ip_address
  if (!address) return
  const content = `full address:s:${address}\nprompt for credentials:i:1\nauthentication level:i:2\nredirectclipboard:i:1\n`
  const blob = new Blob([content], { type: 'application/x-rdp' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${machine.name.replace(/[^a-z0-9_-]/gi, '_') || 'node'}.rdp`
  link.click()
  URL.revokeObjectURL(link.href)
}

async function openTerminal(machine) {
  terminalDialog.value = true
  terminalSession.value = null
  await nextTick()
  createTerminal()
  writeTerminal(`\x1b[36mConnecting to ${machine.name}: PowerShell Remoting first${machine.os_family === 'linux' ? ', SSH fallback enabled' : ''}.\x1b[0m\r\n`)
  terminalConnecting.value = true
  try {
    const connected = await store.connectTerminal(machine.id)
    terminalSession.value = connected
    writeTerminal(`\x1b[32mConnected via ${connected.transport}.\x1b[0m\r\n${connected.output || ''}`)
    promptTerminal()
  } catch (error) {
    writeTerminal(`\x1b[31m${error.message}\x1b[0m\r\n`)
  } finally { terminalConnecting.value = false }
}

function writeTerminal(value) { terminal?.write(String(value || '').replace(/\n/g, '\r\n')) }
function promptTerminal() { writeTerminal('\x1b[35mposhinit> \x1b[0m') }

async function submitTerminalCommand() {
  const command = commandBuffer.trim()
  if (!command || !terminalSession.value || terminalConnecting.value) return
  writeTerminal('\r\n')
  commandBuffer = ''
  terminalConnecting.value = true
  try {
    terminalRunning.value = true
    let receivedOutput = false
    await store.streamTerminalCommand(terminalSession.value.id, command, (event) => {
      if (event.type === 'stdout' && event.data) { receivedOutput = true; writeTerminal(event.data) }
      if (event.type === 'stderr' && event.data) { receivedOutput = true; writeTerminal(`\x1b[31m${event.data}\x1b[0m`) }
      if (event.type === 'complete' && !receivedOutput) writeTerminal('\x1b[90m[command completed with no output]\x1b[0m\r\n')
    })
  } catch (error) { writeTerminal(`\x1b[31m${error.message}\x1b[0m\r\n`) }
  finally { terminalRunning.value = false; terminalConnecting.value = false; promptTerminal() }
}

async function cancelTerminalCommand() { if (terminalSession.value && terminalRunning.value) await store.cancelTerminalCommand(terminalSession.value.id) }

function createTerminal() {
  terminal?.dispose()
  resizeObserver?.disconnect()
  commandBuffer = ''
  terminal = new Terminal({ cursorBlink: true, convertEol: true, fontFamily: 'Azeret Mono, monospace', fontSize: 13, theme: { background: '#03070b', foreground: '#d5f3ff', cursor: '#46d6ff', black: '#03070b', brightBlack: '#62808c', green: '#7ee7b3', brightGreen: '#7ee7b3', red: '#ff9dbd', brightRed: '#ff9dbd', magenta: '#ee9cff', brightMagenta: '#ee9cff', cyan: '#46d6ff', brightCyan: '#46d6ff' } })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(terminalHost.value)
  fitAddon.fit()
  resizeObserver = new ResizeObserver(() => fitAddon?.fit())
  resizeObserver.observe(terminalHost.value)
  terminal.onData((data) => {
    if (!terminalSession.value || terminalConnecting.value) return
    if (data === '\r') { submitTerminalCommand(); return }
    if (data === '\u007f') { if (commandBuffer) { commandBuffer = commandBuffer.slice(0, -1); terminal.write('\b \b') } return }
    if (data >= ' ' && data !== '\u007f') { commandBuffer += data; terminal.write(data) }
  })
  terminal.focus()
}

function closeTerminal() {
  const sessionId = terminalSession.value?.id
  terminal?.dispose()
  resizeObserver?.disconnect()
  terminal = null
  resizeObserver = null
  terminalSession.value = null
  if (sessionId) void store.disconnectTerminal(sessionId).catch(() => {})
}
onBeforeUnmount(closeTerminal)
</script>

<template>
  <div class="page-grid">
    <FloatingWindow v-model="cmdbDialog" title="CMDB Enrichment Sources" :width="820" :start-x="205" :start-y="75"><div class="cmdb-window"><div class="dynamic-rule-head"><div><p class="section-eyebrow">Managed Enrichment</p><strong>ServiceNow, generic REST, and CSV records merge into existing nodes</strong></div><v-btn class="glass-button" size="small" prepend-icon="mdi-plus" @click="openCmdbSource()">Add Source</v-btn></div><article v-for="source in cmdbSources" :key="source.id" class="cmdb-source"><v-icon :color="source.health_state === 'healthy' ? 'success' : source.health_state === 'error' ? 'error' : undefined" icon="mdi-database-sync-outline"/><div><strong>{{ source.name }}</strong><span>{{ source.kind }} · match node {{ source.match_field }} · {{ source.enabled ? 'enabled' : 'paused' }}</span><small>{{ source.last_sync_at ? `last sync ${new Date(source.last_sync_at).toLocaleString()}` : 'not synchronized' }}{{ source.last_error ? ` · ${source.last_error}` : '' }}</small></div><div class="row-actions"><v-btn size="x-small" variant="text" @click="syncCmdbSource(source)">Sync</v-btn><v-btn size="x-small" icon="mdi-pencil-outline" variant="text" @click="openCmdbSource(source)"/><v-btn size="x-small" icon="mdi-delete-outline" variant="text" @click="removeCmdbSource(source)"/></div></article><p v-if="!cmdbSources.length" class="muted">No CMDB enrichment sources configured. Add ServiceNow, REST, or CSV data to attach business context to inventory nodes.</p><div class="window-actions"><v-btn variant="text" @click="cmdbDialog = false">Close</v-btn></div></div></FloatingWindow>
    <FloatingWindow v-model="cmdbEditor" :title="cmdbDraft.id ? 'Edit CMDB Source' : 'Add CMDB Source'" :width="720" :start-x="300" :start-y="85"><form class="cmdb-form" @submit.prevent="saveCmdbSource"><v-select v-model="cmdbDraft.kind" :items="[{ title: 'ServiceNow CMDB', value: 'servicenow' }, { title: 'Generic REST JSON', value: 'rest' }, { title: 'CSV paste/import', value: 'csv' }]" label="Source type"/><v-text-field v-model="cmdbDraft.name" label="Source name"/><v-switch v-model="cmdbDraft.enabled" density="compact" color="success" hide-details label="Enabled"/><v-select v-model="cmdbDraft.matchField" :items="['fqdn', 'name', 'ip']" label="Match existing node by"/><template v-if="cmdbDraft.kind !== 'csv'"><v-text-field v-model="cmdbDraft.config.url" label="Base URL or REST endpoint"/><v-text-field v-if="cmdbDraft.kind === 'servicenow'" v-model="cmdbDraft.config.table" label="ServiceNow table"/><v-text-field v-model="cmdbDraft.config.recordsPath" label="JSON records path" hint="Use result for ServiceNow." persistent-hint/><v-select v-model="cmdbDraft.config.authType" :items="[{ title: 'Bearer token', value: 'bearer' }, { title: 'Basic authentication', value: 'basic' }]" label="Authentication"/><v-text-field v-if="cmdbDraft.config.authType === 'basic'" v-model="cmdbDraft.config.username" label="Username"/><v-text-field v-if="cmdbDraft.config.authType === 'basic'" v-model="cmdbDraft.config.password" type="password" label="Password (leave blank to retain)"/><v-text-field v-else v-model="cmdbDraft.config.authToken" type="password" label="Bearer token (leave blank to retain)"/></template><v-textarea v-else v-model="cmdbDraft.config.csvText" label="CSV content" rows="6" hint="First row is headers. Comma-delimited values only." persistent-hint/><v-text-field v-model="cmdbDraft.mapping.identity" label="Source identity field" hint="Field compared with the selected node match field." persistent-hint/><v-textarea :model-value="JSON.stringify(cmdbDraft.mapping.hostFacts, null, 2)" label="Normalized fact mapping (JSON)" rows="4" hint='Example: {"serial":"serial_number","osVersion":"os_version"}' persistent-hint @update:model-value="cmdbDraft.mapping.hostFacts = JSON.parse($event || '{}')"/><v-textarea :model-value="JSON.stringify(cmdbDraft.mapping.customFacts, null, 2)" label="Custom fact mapping (JSON)" rows="3" @update:model-value="cmdbDraft.mapping.customFacts = JSON.parse($event || '{}')"/><v-text-field v-model="cmdbDraft.mapping.criticality" label="Criticality source field (optional)"/><v-text-field v-model="cmdbDraft.mapping.businessService" label="Business service source field (optional)"/><div class="window-actions"><v-btn variant="text" @click="cmdbEditor = false">Cancel</v-btn><v-btn class="glass-button" type="submit">Save Source</v-btn></div></form></FloatingWindow>
    <FloatingWindow v-model="groupHistoryDialog" title="Dynamic Group Membership Changes" :width="680" :start-x="310" :start-y="115"><div class="group-history"><article v-for="event in groupHistory" :key="event.id"><v-icon :color="event.change_type === 'added' ? 'success' : 'warning'" :icon="event.change_type === 'added' ? 'mdi-account-plus-outline' : 'mdi-account-remove-outline'"/><div><strong>{{ event.machine_name || event.machine_id }} · {{ event.change_type }}</strong><span>{{ new Date(event.occurred_at).toLocaleString() }}</span><small v-if="event.reason.length">Matched: {{ event.reason.map((rule) => `${rule.field} ${rule.operator}`).join(' · ') }}</small></div></article><p v-if="!groupHistory.length" class="muted">No membership changes have been recorded yet.</p><div class="window-actions"><v-btn variant="text" @click="groupHistoryDialog = false">Close</v-btn></div></div></FloatingWindow>
    <div class="toolbar-row">
      <div>
        <p class="section-eyebrow">Machine Inventory</p>
        <h2 class="page-title">Inventory, grouping, credentials, and connection testing</h2>
      </div>
      <div class="chip-line">
        <v-btn class="glass-button" prepend-icon="mdi-server-plus-outline" @click="importLauncherDialog = true">Add Or Import Machines</v-btn>
        <v-btn prepend-icon="mdi-database-cog-outline" variant="text" @click="cmdbDialog = true; refreshCmdbSources()">CMDB Enrichment</v-btn><v-btn prepend-icon="mdi-folder-network-outline" variant="text" @click="openGroup()">Create Group</v-btn>
      </div>
    </div>

    <div class="content-grid">
      <NeonPanel class="span-8" subtitle="Inventory Table" title="Registered Machines">
        <div class="table-pad">
          <div class="inventory-exports"><span>Export inventory</span><v-btn size="x-small" variant="text" @click="exportCsv">CSV</v-btn><v-btn size="x-small" variant="text" @click="exportXls">XLS</v-btn><v-btn size="x-small" variant="text" @click="exportPdf">PDF</v-btn></div>
          <DataTable
            :items="store.catalog.machines || []"
            clickable
            @row-click="openNode"
            :columns="[
              { key: 'name', label: 'Name' },
              { key: 'fqdn', label: 'FQDN' },
              { key: 'transport', label: 'Transport' },
              { key: 'os_family', label: 'OS' },
              { key: 'last_test_status', label: 'Last Test' },
              { key: 'actions', label: 'Actions' },
            ]"
          >
            <template #name="{ row }">
              <div class="name-cell">
                <strong>{{ row.name }}</strong>
                <span class="open-node">Open node</span>
              </div>
            </template>
            <template #actions="{ row }"><div class="row-actions"><v-btn size="x-small" variant="text" prepend-icon="mdi-console-line" @click.stop="openTerminal(row)">CLI</v-btn><v-btn size="x-small" variant="text" prepend-icon="mdi-monitor-arrow-down-variant" :disabled="!row.fqdn && !row.ip_address" @click.stop="downloadRdp(row)">RDP</v-btn></div></template>
          </DataTable>
        </div>
      </NeonPanel>

      <NeonPanel class="span-4" subtitle="Deployment Groups" title="Target Collections">
        <div class="group-list">
          <article v-for="group in store.catalog.groups" :key="group.id" class="group-card" @click="openGroup(group)">
            <div class="group-card-heading"><strong>{{ group.name }}</strong><div><v-btn v-if="group.groupType === 'dynamic'" size="x-small" variant="text" @click.stop="openGroupHistory(group)">Changes</v-btn><v-chip size="x-small" :color="group.groupType === 'dynamic' ? 'secondary' : undefined" variant="tonal">{{ group.groupType === 'dynamic' ? 'dynamic' : 'manual' }}</v-chip></div></div>
            <span class="muted">{{ group.groupType === 'dynamic' ? `${group.matchPattern} · ${group.sourceFilters?.length || 0} source${group.sourceFilters?.length === 1 ? '' : 's'}` : group.description }}</span>
            <div class="chip-line">
              <v-chip v-for="machineId in group.machineIds" :key="machineId" size="small" variant="tonal">
                {{ store.catalog.machines.find((machine) => machine.id === machineId)?.name || machineId }}
              </v-chip>
            </div>
          </article>
        </div>
      </NeonPanel>
    </div>

    <FloatingWindow v-model="machineDialog" title="Add Machine" :width="420" :start-x="120" :start-y="150">
      <div class="form-grid">
        <v-text-field v-model="machineDraft.name" label="Display name" />
        <v-text-field v-model="machineDraft.fqdn" label="Hostname / FQDN" />
        <v-text-field v-model="machineDraft.ipAddress" label="IP address" />
        <v-select v-model="machineDraft.osFamily" :items="['linux', 'windows']" label="Operating system" />
        <v-select v-model="machineDraft.transport" :items="transportOptions" label="Transport" />
        <v-text-field v-model="machineDraft.port" type="number" label="Port" />
        <v-select
          v-model="machineDraft.credentialId"
          :items="credentialOptions"
          item-title="name"
          item-value="id"
          label="Credential"
        />
        <v-alert v-if="machineDraft.transport === 'psremoting'" type="info" variant="tonal" density="compact">
          Preferred for Windows targets. Enable PS Remoting/WinRM on the target first. Use 5985 for HTTP or 5986 for HTTPS.
        </v-alert>
        <v-textarea v-model="machineDraft.notes" label="Notes" rows="3" />
        <v-btn class="glass-button" prepend-icon="mdi-content-save-outline" @click="saveMachine">Save Machine</v-btn>
      </div>
    </FloatingWindow>

    <FloatingWindow v-model="groupDialog" :title="groupDraft.id ? 'Edit Target Collection' : 'Create Target Collection'" :width="610" :start-x="460" :start-y="120">
      <div class="group-editor">
        <div class="group-editor-intro"><div><p class="section-eyebrow">Targeting Strategy</p><strong>{{ groupDraft.groupType === 'dynamic' ? 'Dynamic Inventory Rule' : 'Manual Membership' }}</strong></div><v-btn-toggle v-model="groupDraft.groupType" mandatory density="compact" color="secondary"><v-btn value="manual" prepend-icon="mdi-account-multiple-outline">Manual</v-btn><v-btn value="dynamic" prepend-icon="mdi-auto-fix">Dynamic</v-btn></v-btn-toggle></div>
        <div class="group-editor-fields"><v-text-field v-model="groupDraft.name" label="Collection name" density="compact"/><v-textarea v-model="groupDraft.description" label="Operator description" rows="2" density="compact"/></div>
        <template v-if="groupDraft.groupType === 'manual'"><v-select v-model="groupDraft.machineIds" :items="store.catalog.machines" item-title="name" item-value="id" label="Explicit nodes" density="compact" multiple chips/><p class="group-helper">Manual collections retain exactly the nodes selected here.</p></template>
        <template v-else><section class="dynamic-rule"><div class="dynamic-rule-head"><div><p class="section-eyebrow">Composable Rule Engine</p><strong>All, any, and not conditions with explainable matches</strong></div><v-chip size="small" color="secondary" variant="tonal">{{ dynamicMatches.length }} live matches</v-chip></div><v-select v-model="groupDraft.rule.op" :items="[{ title: 'All conditions must match', value: 'all' }, { title: 'Any condition may match', value: 'any' }, { title: 'Invert this rule (not)', value: 'not' }]" label="Root logic" density="compact" @update:model-value="refreshRulePreview"/><article v-for="(condition, index) in groupDraft.rule.conditions" :key="index" class="rule-condition"><v-select v-model="condition.field" :items="ruleFields" label="Field" density="compact" @update:model-value="refreshRulePreview"/><v-select v-model="condition.operator" :items="ruleOperators" label="Comparison" density="compact" @update:model-value="refreshRulePreview"/><v-text-field v-model="condition.value" label="Value" density="compact" :hint="condition.operator === 'in_subnet' ? 'Example: 10.20.0.0/16' : condition.operator === 'matches' ? 'Wildcards: TST*, *-WEB' : ''" persistent-hint @update:model-value="refreshRulePreview"/><v-btn icon="mdi-close" size="small" variant="text" @click="removeRuleCondition(index)"/></article><div class="rule-actions"><v-btn size="small" variant="text" prepend-icon="mdi-plus" @click="addRuleCondition()">Condition</v-btn><v-btn size="small" variant="text" prepend-icon="mdi-source-branch-plus" @click="addRuleGroup">Any Branch</v-btn><v-btn size="small" variant="text" prepend-icon="mdi-refresh" @click="refreshRulePreview">Refresh Preview</v-btn></div><article v-for="(branch, branchIndex) in groupDraft.rule.groups" :key="branchIndex" class="rule-branch"><v-select v-model="branch.op" :items="[{ title: 'All branch conditions', value: 'all' }, { title: 'Any branch condition', value: 'any' }, { title: 'Not branch conditions', value: 'not' }]" label="Branch logic" density="compact" @update:model-value="refreshRulePreview"/><div v-for="(condition, index) in branch.conditions" :key="index" class="rule-condition"><v-select v-model="condition.field" :items="ruleFields" label="Field" density="compact" @update:model-value="refreshRulePreview"/><v-select v-model="condition.operator" :items="ruleOperators" label="Comparison" density="compact" @update:model-value="refreshRulePreview"/><v-text-field v-model="condition.value" label="Value" density="compact" @update:model-value="refreshRulePreview"/><v-btn icon="mdi-close" size="small" variant="text" @click="branch.conditions.splice(index, 1); refreshRulePreview()"/></div><div class="rule-actions"><v-btn size="x-small" variant="text" @click="addRuleCondition(branch)">Add condition</v-btn><v-btn size="x-small" variant="text" color="error" @click="groupDraft.rule.groups.splice(branchIndex, 1); refreshRulePreview()">Remove branch</v-btn></div></article><div class="match-preview"><span class="section-eyebrow">Live Inventory Preview</span><div v-if="dynamicMatches.length" class="chip-line"><v-chip v-for="machine in dynamicMatches" :key="machine.id" size="small" variant="outlined" :title="machine.explanation.checks.filter((item) => item.passed).map((item) => `${item.field} ${item.operator}`).join(', ')">{{ machine.name }}</v-chip></div><p v-else class="muted">No nodes match this rule. Use preview to evaluate mapped source data and custom facts without saving.</p></div></section></template>
        <div class="window-actions"><v-btn variant="text" @click="groupDialog = false">Cancel</v-btn><v-btn class="glass-button" prepend-icon="mdi-content-save-outline" @click="saveGroup">{{ groupDraft.id ? 'Update Collection' : 'Create Collection' }}</v-btn></div>
      </div>
    </FloatingWindow>

    <FloatingWindow v-model="nodeDialog" :title="`Node Workspace: ${nodeDraft.name || 'Machine'}`" :width="790" :start-x="190" :start-y="104">
      <div class="node-workspace">
        <div class="node-banner">
          <div><p class="section-eyebrow">Managed Node</p><strong>{{ nodeDraft.fqdn || nodeDraft.ipAddress || 'No address configured' }}</strong></div>
          <v-chip size="small" :color="nodeDraft.transport === 'psremoting' ? 'secondary' : 'info'" variant="tonal">{{ nodeDraft.transport }}</v-chip>
        </div>
        <v-tabs v-model="nodeTab" density="compact" class="node-tabs">
          <v-tab value="record" prepend-icon="mdi-server-cog-outline">Record</v-tab>
          <v-tab value="context" prepend-icon="mdi-tag-multiple-outline">Context</v-tab><v-tab value="connection" prepend-icon="mdi-lan-connect">Connection</v-tab>
          <v-tab value="history" prepend-icon="mdi-history">Run History <span class="tab-count">{{ nodeRunHistory.length }}</span></v-tab>
        </v-tabs>
        <v-window v-model="nodeTab" class="node-tab-content">
          <v-window-item value="record">
            <div class="node-form-grid">
              <v-text-field v-model="nodeDraft.name" label="Display name" density="compact" />
              <v-select v-model="nodeDraft.osFamily" :items="['linux', 'windows']" label="Operating system" density="compact" />
              <v-text-field v-model="nodeDraft.fqdn" label="Hostname / FQDN" density="compact" />
              <v-text-field v-model="nodeDraft.ipAddress" label="IP address" density="compact" />
              <v-select v-model="nodeDraft.transport" :items="transportOptions" label="Transport" density="compact" />
              <v-text-field v-model="nodeDraft.port" type="number" label="Port" density="compact" />
              <v-select v-model="nodeDraft.credentialId" :items="nodeCredentialOptions" item-title="name" item-value="id" label="Credential" density="compact" />
              <div class="node-origin"><span>Source</span><strong>{{ nodeDraft.sourceType }}</strong><small>{{ nodeDraft.sourceRef || 'Operator-managed record' }}</small></div>
              <v-alert v-if="nodeDraft.transport === 'psremoting'" type="info" variant="tonal" density="compact" class="full">PowerShell Remoting is preferred for Windows targets. Use a matching PS Remoting credential and WinRM endpoint.</v-alert>
              <v-textarea v-model="nodeDraft.notes" label="Operator notes" rows="3" density="compact" class="full" />
              <div class="node-actions full"><v-btn variant="text" @click="nodeDialog = false">Close</v-btn><v-btn class="glass-button" prepend-icon="mdi-content-save-outline" @click="saveNode">Save Node Record</v-btn></div>
            </div>
          </v-window-item>
          <v-window-item value="context"><div class="node-form-grid"><v-select v-model="nodeDraft.ownerUserId" :items="store.catalog.users" item-title="email" item-value="id" clearable label="Business owner" density="compact"/><v-select v-model="nodeDraft.ownerTeamId" :items="store.catalog.teams" item-title="name" item-value="id" clearable label="Owning team" density="compact"/><v-select v-model="nodeDraft.criticality" :items="['low', 'standard', 'high', 'critical']" label="Criticality" density="compact"/><v-text-field v-model="nodeDraft.businessService" label="Business service" density="compact"/><v-textarea v-model="nodeDraft.customFactsText" label="Custom facts (JSON)" rows="5" density="compact" class="full"/><v-textarea v-model="nodeDraft.hostFactsText" label="Normalized host facts (JSON)" rows="5" density="compact" class="full"/><v-textarea v-model="nodeDraft.maintenanceWindowText" label="Maintenance window (JSON)" hint='Example: {"timezone":"America/Chicago","start":"22:00","end":"02:00"}' persistent-hint rows="3" density="compact" class="full"/><div class="node-actions full"><v-btn class="glass-button" prepend-icon="mdi-content-save-outline" @click="saveNode">Save Context</v-btn></div></div></v-window-item>
          <v-window-item value="connection">
            <div class="connection-pane">
              <div class="connection-summary"><v-icon icon="mdi-lan-connect" /><div><strong>Validate the configured transport</strong><span>Tests {{ nodeDraft.transport }} against {{ nodeDraft.fqdn || nodeDraft.ipAddress || 'the configured endpoint' }} and stores the outcome on this node.</span></div><v-btn class="glass-button" :disabled="!nodeDraft.id" prepend-icon="mdi-play" @click="testNodeConnection">Run Connection Test</v-btn></div>
              <div v-if="nodeConnectionResult" class="detail-grid">
                <v-alert :type="nodeConnectionResult.ok ? 'success' : 'warning'" variant="tonal">{{ nodeConnectionResult.ok ? 'Connection succeeded' : 'Connection failed' }}</v-alert>
                <pre class="output-block">{{ nodeConnectionResult.stdout || 'No stdout output.' }}</pre>
                <pre class="output-block error-block">{{ nodeConnectionResult.stderr || 'No stderr output.' }}</pre>
              </div>
              <div v-else class="empty-pane"><v-icon icon="mdi-connection" /><span>No connection test has been run during this session.</span></div>
            </div>
          </v-window-item>
          <v-window-item value="history">
            <div class="history-pane">
              <DataTable :items="nodeRunHistory" :columns="[{ key: 'script_name', label: 'Runbook' }, { key: 'status', label: 'Status' }, { key: 'started_at', label: 'Started' }, { key: 'exit_code', label: 'Exit' }, { key: 'actions', label: '' }]">
                <template #status="{ row }"><v-chip size="x-small" :color="row.status === 'success' ? 'success' : 'error'" variant="tonal">{{ row.status }}</v-chip></template>
                <template #actions="{ row }"><v-btn size="x-small" variant="text" @click="selectedRun = row">Output</v-btn></template>
              </DataTable>
              <section v-if="selectedRun" class="run-output"><div class="run-output-head"><strong>{{ selectedRun.script_name }}</strong><v-btn icon="mdi-close" size="x-small" variant="text" @click="selectedRun = null" /></div><pre class="output-block">{{ selectedRun.stdout || 'No stdout output.' }}</pre><pre class="output-block error-block">{{ selectedRun.stderr || 'No stderr output.' }}</pre></section>
            </div>
          </v-window-item>
        </v-window>
      </div>
    </FloatingWindow>
    <FloatingWindow v-model="terminalDialog" :title="`Remote CLI${terminalSession ? ` · ${terminalSession.transport}` : ''}`" :width="760" :start-x="270" :start-y="80"><div class="terminal-window"><div class="terminal-status"><v-icon :icon="terminalSession ? 'mdi-lan-connect' : 'mdi-lan-pending'"/><span>{{ terminalRunning ? 'Command running · output is streaming' : terminalSession ? `Connected through ${terminalSession.transport} · press Enter to run commands` : terminalConnecting ? 'Establishing remote session...' : 'Connection unavailable' }}</span><v-btn v-if="terminalRunning" size="x-small" color="warning" variant="text" @click="cancelTerminalCommand">Cancel Command</v-btn><v-btn size="x-small" variant="text" @click="terminalDialog = false">Disconnect</v-btn></div><div ref="terminalHost" class="xterm-host"/></div></FloatingWindow>
    <VmwareImportWizard v-model="importDialog" :kind-filter="vmwareKind" />
    <AzureArcImportWizard v-model="azureArcImportDialog" />
    <SubnetScanWizard v-model="subnetScanDialog" />
    <MachineImportWizard v-model="importLauncherDialog" @select="selectMachineImport" />
    <ProxmoxImportWizard v-model="proxmoxImportDialog" />
  </div>
</template>

<style scoped>
.cmdb-window,.cmdb-form { display:grid; gap:12px; }.cmdb-source { display:grid; grid-template-columns:30px 1fr auto; gap:9px; align-items:center; padding:10px; border:1px solid var(--line); background:rgba(40,211,255,.035); }.cmdb-source div { display:grid; gap:2px; }.cmdb-source span,.cmdb-source small { color:var(--muted); font-size:.74rem; }.cmdb-form { grid-template-columns:repeat(2,minmax(0,1fr)); }.cmdb-form > :nth-last-child(1),.cmdb-form > :nth-last-child(2),.cmdb-form > :nth-last-child(3),.cmdb-form > :nth-last-child(4),.cmdb-form > :nth-last-child(5),.cmdb-form > :nth-last-child(6) { grid-column:1 / -1; }
.rule-condition { display:grid; grid-template-columns:1fr 1fr 1.25fr auto; gap:8px; align-items:start; padding:8px; border:1px solid rgba(40,211,255,.16); background:rgba(3,7,11,.28); }.rule-branch { display:grid; gap:8px; padding:10px; border:1px dashed rgba(190,77,255,.42); background:rgba(190,77,255,.035); }.rule-actions { display:flex; gap:6px; flex-wrap:wrap; }.group-history { display:grid; gap:8px; }.group-history article { display:grid; grid-template-columns:28px 1fr; gap:9px; padding:10px; border:1px solid var(--line); background:rgba(40,211,255,.035); }.group-history article div { display:grid; gap:2px; }.group-history span,.group-history small { color:var(--muted); font-size:.74rem; }
.page-title {
  margin: 4px 0 0;
}

.table-pad,
.group-list {
  padding: 20px;
}

.inventory-exports { display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin-bottom: 8px; color: var(--muted); font: .65rem 'Share Tech Mono', monospace; text-transform: uppercase; }

.group-list {
  display: grid;
  gap: 12px;
}

.group-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(75, 116, 205, 0.08);
  border: 1px solid transparent;
  cursor: pointer;
  transition: border-color .18s ease, background .18s ease;
}
.group-card:hover { border-color: rgba(40, 211, 255, .42); background: rgba(40, 211, 255, .08); }
.group-card-heading, .group-editor-intro, .dynamic-rule-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.group-card-heading strong { color: var(--text); }
.group-editor { display: grid; gap: 15px; }.group-editor-intro { padding: 11px 12px; border: 1px solid var(--line); background: linear-gradient(100deg, rgba(40, 211, 255, .08), rgba(159, 95, 255, .07)); }.group-editor-intro p, .group-editor-intro strong, .dynamic-rule-head p, .dynamic-rule-head strong { margin: 0; }.group-editor-intro strong, .dynamic-rule-head strong { display: block; margin-top: 3px; color: var(--cyan); font: .82rem 'Share Tech Mono', monospace; }.group-editor-fields { display: grid; grid-template-columns: 1fr 1.2fr; gap: 10px; }.dynamic-rule { display: grid; gap: 12px; padding: 14px; border: 1px solid rgba(40, 211, 255, .3); background: rgba(40, 211, 255, .035); }.group-helper, .match-preview p { margin: 0; color: var(--muted); font-size: .74rem; }.match-preview { display: grid; gap: 8px; padding: 10px; border: 1px dashed rgba(40, 211, 255, .34); background: rgba(3, 7, 11, .4); }.source-empty { padding: 9px 12px; color: var(--muted); font-size: .75rem; }

.form-grid,
.detail-grid {
  display: grid;
  gap: 14px;
}

.name-cell {
  display: flex;
  gap: 12px;
  align-items: center;
}

.open-node { color: var(--cyan); font: .62rem 'Share Tech Mono', monospace; text-transform: uppercase; }
.row-actions { display: flex; gap: 2px; white-space: nowrap; }

.node-workspace, .connection-pane, .history-pane { display: grid; gap: 14px; }
.node-banner, .connection-summary { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px; border: 1px solid var(--line); background: rgba(40, 211, 255, .04); }
.node-banner p, .node-banner strong { margin: 0; }.node-banner strong { color: var(--cyan); font: .78rem 'Share Tech Mono', monospace; }
.node-tabs { border-bottom: 1px solid var(--line); }.tab-count { margin-left: 5px; color: var(--cyan); font: .66rem 'Share Tech Mono', monospace; }
.node-tab-content { min-height: 360px; }.node-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px; padding-top: 14px; }.full { grid-column: 1 / -1; }
.node-origin { display: grid; align-content: center; gap: 2px; min-height: 56px; padding: 8px 10px; border: 1px solid var(--line); background: rgba(40, 211, 255, .035); }.node-origin span { color: var(--muted); font: .62rem 'Share Tech Mono', monospace; text-transform: uppercase; }.node-origin small { color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-actions { display: flex; justify-content: flex-end; gap: 8px; }.connection-summary > div { display: grid; flex: 1; gap: 3px; }.connection-summary span { color: var(--muted); font-size: .74rem; }.empty-pane { display: grid; min-height: 220px; place-items: center; align-content: center; gap: 10px; color: var(--muted); border: 1px dashed var(--line); }.run-output { display: grid; gap: 8px; margin-top: 14px; }.run-output-head { display: flex; justify-content: space-between; align-items: center; }.history-pane :deep(.table-search) { max-width: 180px; }

.output-block {
  margin: 0;
  padding: 12px;
  border-radius: 14px;
  background: rgba(2, 6, 14, 0.86);
  color: #9fd7ff;
  overflow: auto;
  font-family: 'Azeret Mono', monospace;
  font-size: 0.8rem;
}

.error-block {
  color: #ffb2ca;
}

.terminal-window { display: grid; gap: 10px; }.terminal-status { display: flex; gap: 8px; align-items: center; padding: 9px 11px; border: 1px solid var(--line); color: var(--cyan); font: .75rem 'Share Tech Mono', monospace; }.terminal-status .v-btn { margin-left: auto; }.xterm-host { min-height: 390px; padding: 10px; overflow: hidden; border: 1px solid rgba(40, 211, 255, .34); background: #03070b; box-shadow: inset 0 0 38px rgba(40, 211, 255, .035); }.xterm-host :deep(.xterm) { height: 390px; }.xterm-host :deep(.xterm-viewport) { scrollbar-color: rgba(70, 214, 255, .42) #03070b; }

@media (max-width: 720px) { .node-form-grid, .group-editor-fields { grid-template-columns: 1fr; }.connection-summary, .group-editor-intro { align-items: flex-start; flex-direction: column; }.node-tab-content { min-height: 0; } }
</style>
