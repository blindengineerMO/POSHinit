<script setup>
import { reactive, ref } from 'vue'
import FloatingWindow from '../components/common/FloatingWindow.vue'
import NeonPanel from '../components/common/NeonPanel.vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const identityWindow = ref(false)
const runtimeWindow = ref(false)
const vmwareWindow = ref(false)
const connectorWindow = ref(false)
const importSummary = ref('')
const branding = reactive({ productName: store.catalog.settings.branding?.productName || 'POSHinit Control Plane', supportEmail: store.catalog.settings.branding?.supportEmail || 'ops@example.com' })
const runtime = reactive({ defaultShell: store.catalog.settings.runtime?.defaultShell || 'pwsh', allowManualRuns: store.catalog.settings.runtime?.allowManualRuns ?? true })
const vmware = reactive({ connectors: [...(store.catalog.settings.vcenter?.connectors || [])] })
const connectorDraft = reactive({ id: '', kind: 'vcenter', name: '', baseUrl: '', username: '', passwordPlain: '', passwordEncrypted: '', verifyTls: false, autoImportGroupId: '' })

function resetConnector() {
  Object.assign(connectorDraft, { id: '', kind: 'vcenter', name: '', baseUrl: '', username: '', passwordPlain: '', passwordEncrypted: '', verifyTls: false, autoImportGroupId: '' })
}

function editConnector(connector = null) {
  Object.assign(connectorDraft, connector || {})
  connectorDraft.passwordPlain = ''
  connectorWindow.value = true
}

async function saveIdentity() { await store.saveSettings('branding', branding); identityWindow.value = false }
async function saveRuntime() { await store.saveSettings('runtime', runtime); runtimeWindow.value = false }
async function saveConnectors() {
  const saved = await store.saveSettings('vcenter', vmware)
  vmware.connectors = saved.connectors || []
}
async function saveConnector() {
  const index = vmware.connectors.findIndex((connector) => connector.id === connectorDraft.id)
  const draft = { ...connectorDraft, id: connectorDraft.id || `draft-${Date.now()}` }
  if (index >= 0) vmware.connectors.splice(index, 1, draft)
  else vmware.connectors.push(draft)
  await saveConnectors()
  connectorWindow.value = false
  resetConnector()
}
async function removeConnector(connector) {
  vmware.connectors = vmware.connectors.filter((item) => item.id !== connector.id)
  await saveConnectors()
}
async function importConnector(connector) {
  if (!connector.passwordConfigured) {
    editConnector(connector)
    importSummary.value = 'Enter the connector password, save it, then import this endpoint.'
    return
  }
  const imported = await store.importVmware(connector.id, '')
  importSummary.value = `${connector.name}: imported ${imported.length} virtual machine records.`
}
</script>

<template>
  <div class="settings-workspace">
    <div class="toolbar-row commandbar"><div><p class="section-eyebrow">Control Plane Configuration</p><h2 class="page-title">System Settings</h2></div><v-chip variant="outlined">configuration secured</v-chip></div>
    <div class="settings-grid">
      <NeonPanel subtitle="Portal" title="Identity"><template #actions><v-btn size="small" variant="text" @click="identityWindow = true">Configure</v-btn></template><div class="setting-card"><v-icon icon="mdi-badge-account-outline"/><strong>{{ branding.productName }}</strong><span>{{ branding.supportEmail }}</span></div></NeonPanel>
      <NeonPanel subtitle="Execution" title="Runtime"><template #actions><v-btn size="small" variant="text" @click="runtimeWindow = true">Configure</v-btn></template><div class="setting-card"><v-icon icon="mdi-console-line"/><strong>{{ runtime.defaultShell }}</strong><span>Manual runs {{ runtime.allowManualRuns ? 'enabled' : 'disabled' }}</span></div></NeonPanel>
      <NeonPanel subtitle="Infrastructure" title="VMware Inventory"><template #actions><v-btn size="small" variant="text" @click="vmwareWindow = true">Manage</v-btn></template><div class="setting-card"><v-icon icon="mdi-server-network-outline"/><strong>{{ vmware.connectors.length }} connectors</strong><span>vCenter REST + standalone ESXi SOAP</span></div></NeonPanel>
    </div>
    <NeonPanel subtitle="Security Posture" title="Runtime Protections"><div class="protection-list"><article><v-icon icon="mdi-shield-check-outline" color="success"/>Helmet headers and configurable CORS protect the Express host.</article><article><v-icon icon="mdi-database-lock-outline" color="info"/>SQLite queries use parameterized access paths.</article><article><v-icon icon="mdi-key-chain-variant" color="secondary"/>Vault payloads are sealed through AES-256-GCM.</article></div></NeonPanel>

    <FloatingWindow v-model="identityWindow" title="Portal Identity" :width="460" :start-x="190" :start-y="115"><form class="window-form" @submit.prevent="saveIdentity"><v-text-field v-model="branding.productName" label="Product name"/><v-text-field v-model="branding.supportEmail" label="Support email"/><div class="actions"><v-btn variant="text" @click="identityWindow = false">Cancel</v-btn><v-btn class="glass-button" type="submit">Save Identity</v-btn></div></form></FloatingWindow>
    <FloatingWindow v-model="runtimeWindow" title="Execution Runtime" :width="460" :start-x="430" :start-y="145"><form class="window-form" @submit.prevent="saveRuntime"><v-text-field v-model="runtime.defaultShell" label="PowerShell executable"/><v-switch v-model="runtime.allowManualRuns" color="secondary" label="Allow manual dispatch"/><div class="actions"><v-btn variant="text" @click="runtimeWindow = false">Cancel</v-btn><v-btn class="glass-button" type="submit">Save Runtime</v-btn></div></form></FloatingWindow>

    <FloatingWindow v-model="vmwareWindow" title="VMware Inventory Connectors" :width="700" :start-x="220" :start-y="90"><div class="connector-window"><div class="connector-header"><p>Register vCenter servers and standalone ESXi hosts side by side. vCenter uses its REST inventory API; host-only environments use the native VMware SOAP API at <code>/sdk</code>.</p><v-btn class="glass-button" prepend-icon="mdi-plus" @click="resetConnector(); connectorWindow = true">Add Connector</v-btn></div><article v-for="connector in vmware.connectors" :key="connector.id" class="connector-card"><span class="connector-icon"><v-icon :icon="connector.kind === 'esxi-host' ? 'mdi-server' : 'mdi-cloud-outline'"/></span><div><strong>{{ connector.name }}</strong><span>{{ connector.kind === 'esxi-host' ? 'Standalone ESXi host / SOAP' : 'vCenter / REST' }} · {{ connector.baseUrl }}</span><small>{{ connector.username || 'No account configured' }}</small></div><div class="connector-actions"><v-btn size="small" variant="text" @click="importConnector(connector)">Import VMs</v-btn><v-btn size="small" icon="mdi-pencil-outline" variant="text" @click="editConnector(connector)"/><v-btn size="small" icon="mdi-delete-outline" variant="text" @click="removeConnector(connector)"/></div></article><p v-if="!vmware.connectors.length" class="empty-state">No VMware connectors registered. Add a vCenter or standalone ESXi host to begin inventory import.</p><v-alert v-if="importSummary" type="info" variant="tonal">{{ importSummary }}</v-alert><div class="actions"><v-btn variant="text" @click="vmwareWindow = false">Close</v-btn></div></div></FloatingWindow>

    <FloatingWindow v-model="connectorWindow" :title="connectorDraft.id ? 'Edit VMware Connector' : 'Add VMware Connector'" :width="560" :start-x="420" :start-y="145"><form class="window-form two" @submit.prevent="saveConnector"><v-select v-model="connectorDraft.kind" :items="[{ title: 'vCenter Server (REST)', value: 'vcenter' }, { title: 'Standalone ESXi Host (SOAP)', value: 'esxi-host' }]" label="Endpoint type" class="full"/><v-text-field v-model="connectorDraft.name" label="Connector name"/><v-text-field v-model="connectorDraft.baseUrl" :label="connectorDraft.kind === 'esxi-host' ? 'ESXi host URL or hostname' : 'vCenter base URL'"/><v-text-field v-model="connectorDraft.username" label="Username"/><v-text-field v-model="connectorDraft.passwordPlain" type="password" label="Password" hint="Leave empty to retain the sealed password." persistent-hint/><v-select v-model="connectorDraft.autoImportGroupId" :items="store.catalog.groups" item-title="name" item-value="id" label="Auto-assign deployment group" class="full"/><v-alert type="info" variant="tonal" class="full">{{ connectorDraft.kind === 'esxi-host' ? 'Connects directly to the host /sdk SOAP service. No vCenter is required.' : 'Uses the vCenter REST inventory endpoint.' }}</v-alert><div class="actions full"><v-btn variant="text" @click="connectorWindow = false">Cancel</v-btn><v-btn class="glass-button" type="submit">Save Connector</v-btn></div></form></FloatingWindow>
  </div>
</template>

<style scoped>
.settings-workspace { display: grid; gap: 14px; }.commandbar { padding: 2px 0 4px; }.settings-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }.setting-card { display: grid; gap: 7px; padding: 15px; }.setting-card .v-icon { color: var(--amber); }.setting-card strong { overflow: hidden; font-family: 'Share Tech Mono', monospace; font-size: .8rem; text-overflow: ellipsis; white-space: nowrap; }.setting-card span, .connector-card span, .connector-card small { color: var(--muted); font-size: .72rem; }.protection-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; padding: 14px; }.protection-list article { display: flex; gap: 10px; padding: 12px; border: 1px solid var(--line); background: rgba(190, 77, 255, .05); font-size: .78rem; }.window-form, .connector-window { display: grid; gap: 12px; }.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }.full { grid-column: 1 / -1; }.actions, .connector-header, .connector-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }.connector-header { align-items: center; justify-content: space-between; padding-bottom: 10px; border-bottom: 1px solid var(--line); }.connector-header p { max-width: 475px; margin: 0; color: var(--muted); font-size: .78rem; line-height: 1.55; }.connector-card { display: grid; grid-template-columns: 36px 1fr auto; gap: 10px; align-items: center; padding: 12px; border: 1px solid var(--line); background: rgba(190, 77, 255, .05); }.connector-icon { display: grid; width: 32px; height: 32px; place-items: center; color: var(--cyan); border: 1px solid rgba(40, 211, 255, .34); }.connector-card div { display: grid; gap: 2px; min-width: 0; }.connector-card strong { font-size: .85rem; }.connector-card span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.connector-actions { display: flex !important; }.empty-state { margin: 8px 0; color: var(--muted); font-size: .8rem; } @media (max-width: 850px) { .settings-grid, .protection-list, .two { grid-template-columns: 1fr; }.full { grid-column: auto; }.connector-card { grid-template-columns: 36px 1fr; }.connector-actions { grid-column: 1 / -1; justify-content: flex-end; } }
</style>
