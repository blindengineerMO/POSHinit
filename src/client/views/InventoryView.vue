<script setup>
import { computed, reactive, ref, watch } from 'vue'
import DataTable from '../components/common/DataTable.vue'
import FloatingWindow from '../components/common/FloatingWindow.vue'
import NeonPanel from '../components/common/NeonPanel.vue'
import VmwareImportWizard from '../components/inventory/VmwareImportWizard.vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const machineDialog = ref(false)
const nodeDialog = ref(false)
const groupDialog = ref(false)
const importDialog = ref(false)
const nodeTab = ref('record')
const nodeConnectionResult = ref(null)
const selectedRun = ref(null)

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
})

const groupDraft = reactive({
  name: '',
  description: '',
  machineIds: [],
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

watch(() => machineDraft.transport, (transport) => {
  machineDraft.port = transport === 'psremoting' ? 5985 : transport === 'ssh' ? 22 : 0
  machineDraft.credentialId = ''
})

async function saveMachine() {
  await store.saveMachine(machineDraft)
  machineDialog.value = false
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
  })
  nodeConnectionResult.value = null
  selectedRun.value = null
  nodeTab.value = 'record'
  nodeDialog.value = true
}

async function saveNode() {
  await store.saveMachine(nodeDraft)
}

async function saveGroup() {
  await store.saveGroup(groupDraft)
  groupDialog.value = false
}

async function testNodeConnection() {
  nodeConnectionResult.value = null
  try {
    nodeConnectionResult.value = await store.testMachine(nodeDraft.id)
  } catch (error) {
    nodeConnectionResult.value = { ok: false, stdout: '', stderr: error.message }
  }
}
</script>

<template>
  <div class="page-grid">
    <div class="toolbar-row">
      <div>
        <p class="section-eyebrow">Machine Inventory</p>
        <h2 class="page-title">Inventory, grouping, credentials, and connection testing</h2>
      </div>
      <div class="chip-line">
        <v-btn prepend-icon="mdi-vmware" variant="text" @click="importDialog = true">Import Virtual Machines</v-btn>
        <v-btn class="glass-button" prepend-icon="mdi-plus" @click="machineDialog = true">Add Machine</v-btn>
        <v-btn prepend-icon="mdi-folder-network-outline" variant="text" @click="groupDialog = true">Create Group</v-btn>
      </div>
    </div>

    <div class="content-grid">
      <NeonPanel class="span-8" subtitle="Inventory Table" title="Registered Machines">
        <div class="table-pad">
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
            ]"
          >
            <template #name="{ row }">
              <div class="name-cell">
                <strong>{{ row.name }}</strong>
                <span class="open-node">Open node</span>
              </div>
            </template>
          </DataTable>
        </div>
      </NeonPanel>

      <NeonPanel class="span-4" subtitle="Deployment Groups" title="Target Collections">
        <div class="group-list">
          <article v-for="group in store.catalog.groups" :key="group.id" class="group-card">
            <strong>{{ group.name }}</strong>
            <span class="muted">{{ group.description }}</span>
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

    <FloatingWindow v-model="groupDialog" title="Create Group" :width="420" :start-x="560" :start-y="180">
      <div class="form-grid">
        <v-text-field v-model="groupDraft.name" label="Group name" />
        <v-textarea v-model="groupDraft.description" label="Description" rows="3" />
        <v-select
          v-model="groupDraft.machineIds"
          :items="store.catalog.machines"
          item-title="name"
          item-value="id"
          label="Machines"
          multiple
          chips
        />
        <v-btn class="glass-button" prepend-icon="mdi-content-save-outline" @click="saveGroup">Save Group</v-btn>
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
          <v-tab value="connection" prepend-icon="mdi-lan-connect">Connection</v-tab>
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
    <VmwareImportWizard v-model="importDialog" />
  </div>
</template>

<style scoped>
.page-title {
  margin: 4px 0 0;
}

.table-pad,
.group-list {
  padding: 20px;
}

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
}

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

@media (max-width: 720px) { .node-form-grid { grid-template-columns: 1fr; }.connection-summary { align-items: flex-start; flex-direction: column; }.node-tab-content { min-height: 0; } }
</style>
