<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import FloatingWindow from '../components/common/FloatingWindow.vue'
import NeonPanel from '../components/common/NeonPanel.vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const identityWindow = ref(false)
const runtimeWindow = ref(false)
const vmwareWindow = ref(false)
const connectorWindow = ref(false)
const entraWindow = ref(false)
const notificationsWindow = ref(false)
const policyWindow = ref(false)
const policies = ref([])
const importSummary = ref('')
const branding = reactive({ productName: store.catalog.settings.branding?.productName || 'POSHinit Control Plane', supportEmail: store.catalog.settings.branding?.supportEmail || 'ops@example.com' })
const runtime = reactive({ defaultShell: store.catalog.settings.runtime?.defaultShell || 'pwsh', allowManualRuns: store.catalog.settings.runtime?.allowManualRuns ?? true })
const vmware = reactive({ connectors: [...(store.catalog.settings.vcenter?.connectors || [])] })
const entra = reactive({
  tenantId: store.catalog.settings.entra?.tenantId || '',
  clientId: store.catalog.settings.entra?.clientId || '',
  redirectUri: store.catalog.settings.entra?.redirectUri || `${globalThis.location.origin}/auth/entra/callback`,
  clientSecret: '',
  clientSecretConfigured: Boolean(store.catalog.settings.entra?.clientSecretConfigured),
})
const notifications = reactive({
  smtpEnabled: Boolean(store.catalog.settings.notifications?.smtpEnabled),
  smtpHost: store.catalog.settings.notifications?.smtpHost || '',
  smtpPort: Number(store.catalog.settings.notifications?.smtpPort || 587),
  smtpSecure: Boolean(store.catalog.settings.notifications?.smtpSecure),
  smtpUsername: store.catalog.settings.notifications?.smtpUsername || '',
  smtpPassword: '',
  smtpPasswordConfigured: Boolean(store.catalog.settings.notifications?.smtpPasswordConfigured),
  smtpFrom: store.catalog.settings.notifications?.smtpFrom || '',
  smtpTo: store.catalog.settings.notifications?.smtpTo || '',
  webhookEnabled: Boolean(store.catalog.settings.notifications?.webhookEnabled),
  webhookUrl: store.catalog.settings.notifications?.webhookUrl || '',
  notifyOnSuccess: Boolean(store.catalog.settings.notifications?.notifyOnSuccess),
  notifyOnFailure: store.catalog.settings.notifications?.notifyOnFailure !== false,
})
const connectorDraft = reactive({ id: '', kind: 'vcenter', name: '', baseUrl: '', username: '', passwordPlain: '', passwordEncrypted: '', verifyTls: false, autoImportGroupId: '' })
const isAdmin = computed(() => store.currentUser?.role === 'admin')
const policyDraft = reactive({ id: '', name: '', enabled: true, window: { days: [], startTime: '', endTime: '', startDate: '', endDate: '' }, eventTypes: ['job.failed'], recipientUserIds: [], teamIds: [], webhookUrl: '' })
const eventOptions = [
  { title: 'Job succeeded', value: 'job.success' }, { title: 'Job failed', value: 'job.failed' },
  { title: 'Sign-in succeeded', value: 'auth.success' }, { title: 'Sign-in failed', value: 'auth.failed' },
  { title: 'Script created or edited', value: 'script.edited' }, { title: 'Script deleted', value: 'script.deleted' },
]
const weekdayOptions = [{ title: 'Sun', value: 0 }, { title: 'Mon', value: 1 }, { title: 'Tue', value: 2 }, { title: 'Wed', value: 3 }, { title: 'Thu', value: 4 }, { title: 'Fri', value: 5 }, { title: 'Sat', value: 6 }]

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
async function saveEntra() {
  const saved = await store.saveSettings('entra', entra)
  Object.assign(entra, saved, { clientSecret: '' })
  entraWindow.value = false
}
async function saveNotifications() {
  const saved = await store.saveSettings('notifications', notifications)
  Object.assign(notifications, saved, { smtpPassword: '' })
  notificationsWindow.value = false
}
async function refreshPolicies() { policies.value = await store.listNotificationPolicies() }
function openPolicy(policy = null) {
  Object.assign(policyDraft, policy ? { ...policy, window: { ...(policy.window || {}) }, eventTypes: [...policy.eventTypes], recipientUserIds: [...policy.recipientUserIds], teamIds: [...policy.teamIds] } : { id: '', name: '', enabled: true, window: { days: [], startTime: '', endTime: '', startDate: '', endDate: '' }, eventTypes: ['job.failed'], recipientUserIds: [], teamIds: [], webhookUrl: '' })
  policyWindow.value = true
}
async function savePolicy() { await store.saveNotificationPolicy(policyDraft); policyWindow.value = false; await refreshPolicies() }
async function togglePolicy(policy) { await store.setNotificationPolicyEnabled(policy.id, !policy.enabled); await refreshPolicies() }
async function testPolicy(policy) { await store.testNotificationPolicy(policy.id) }
async function removePolicy(policy) { await store.deleteNotificationPolicy(policy.id); await refreshPolicies() }
onMounted(refreshPolicies)
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
      <NeonPanel subtitle="Enterprise Identity" title="Microsoft Entra ID"><template #actions><v-btn size="small" variant="text" :disabled="!isAdmin" @click="entraWindow = true">Configure</v-btn></template><div class="setting-card"><v-icon icon="mdi-microsoft"/><strong>{{ entra.tenantId || 'No tenant configured' }}</strong><span>{{ entra.clientSecretConfigured ? 'client secret sealed' : 'client secret not configured' }}</span></div></NeonPanel>
      <NeonPanel subtitle="Run Events" title="Alert Delivery"><template #actions><v-btn size="small" variant="text" :disabled="!isAdmin" @click="notificationsWindow = true">Configure</v-btn></template><div class="setting-card"><v-icon icon="mdi-bell-badge-outline"/><strong>{{ notifications.smtpEnabled || notifications.webhookEnabled ? 'delivery armed' : 'delivery disabled' }}</strong><span>{{ notifications.smtpEnabled ? 'SMTP' : '' }}{{ notifications.smtpEnabled && notifications.webhookEnabled ? ' + ' : '' }}{{ notifications.webhookEnabled ? 'HTTP webhook' : '' }}</span></div></NeonPanel>
      <NeonPanel subtitle="Infrastructure" title="VMware Inventory"><template #actions><v-btn size="small" variant="text" @click="vmwareWindow = true">Manage</v-btn></template><div class="setting-card"><v-icon icon="mdi-server-network-outline"/><strong>{{ vmware.connectors.length }} connectors</strong><span>vCenter REST + standalone ESXi SOAP</span></div></NeonPanel>
    </div>
    <NeonPanel subtitle="Security Posture" title="Runtime Protections"><div class="protection-list"><article><v-icon icon="mdi-shield-check-outline" color="success"/>Helmet headers and configurable CORS protect the Express host.</article><article><v-icon icon="mdi-database-lock-outline" color="info"/>SQLite queries use parameterized access paths.</article><article><v-icon icon="mdi-key-chain-variant" color="secondary"/>Vault payloads are sealed through AES-256-GCM.</article></div></NeonPanel>
    <NeonPanel subtitle="Event Routing" title="Notification Policies"><template #actions><v-btn size="small" class="glass-button" prepend-icon="mdi-bell-plus-outline" :disabled="!isAdmin" @click="openPolicy()">Create Policy</v-btn></template><div class="policy-list"><article v-for="policy in policies" :key="policy.id" class="policy-card"><v-icon :color="policy.enabled ? 'success' : undefined" :icon="policy.enabled ? 'mdi-bell-check-outline' : 'mdi-bell-off-outline'"/><div><strong>{{ policy.name }}</strong><span>{{ policy.eventTypes.join(' · ') }}</span><small>{{ policy.recipientUserIds.length }} people · {{ policy.teamIds.length }} teams{{ policy.webhookUrl ? ' · webhook' : '' }}</small></div><div class="policy-actions"><v-btn size="small" variant="text" @click="togglePolicy(policy)">{{ policy.enabled ? 'Disable' : 'Enable' }}</v-btn><v-btn size="small" variant="text" @click="testPolicy(policy)">Test</v-btn><v-btn size="small" icon="mdi-pencil-outline" variant="text" @click="openPolicy(policy)"/><v-btn size="small" icon="mdi-delete-outline" variant="text" @click="removePolicy(policy)"/></div></article><p v-if="!policies.length" class="empty-state">No notification policies exist. Create one to route selected events to people, teams, or a webhook.</p></div></NeonPanel>

    <FloatingWindow v-model="identityWindow" title="Portal Identity" :width="460" :start-x="190" :start-y="115"><form class="window-form" @submit.prevent="saveIdentity"><v-text-field v-model="branding.productName" label="Product name"/><v-text-field v-model="branding.supportEmail" label="Support email"/><div class="actions"><v-btn variant="text" @click="identityWindow = false">Cancel</v-btn><v-btn class="glass-button" type="submit">Save Identity</v-btn></div></form></FloatingWindow>
    <FloatingWindow v-model="runtimeWindow" title="Execution Runtime" :width="460" :start-x="430" :start-y="145"><form class="window-form" @submit.prevent="saveRuntime"><v-text-field v-model="runtime.defaultShell" label="PowerShell executable"/><v-switch v-model="runtime.allowManualRuns" color="secondary" label="Allow manual dispatch"/><div class="actions"><v-btn variant="text" @click="runtimeWindow = false">Cancel</v-btn><v-btn class="glass-button" type="submit">Save Runtime</v-btn></div></form></FloatingWindow>
    <FloatingWindow v-model="entraWindow" title="Microsoft Entra ID" :width="570" :start-x="310" :start-y="105"><form class="window-form" @submit.prevent="saveEntra"><section class="entra-intro"><div><p class="section-eyebrow">Enterprise Login</p><strong>OAuth confidential client</strong></div><v-icon icon="mdi-microsoft"/></section><v-text-field v-model="entra.tenantId" label="Tenant ID or domain" hint="Tenant GUID or verified tenant domain, such as contoso.onmicrosoft.com." persistent-hint/><v-text-field v-model="entra.clientId" label="Application (client) ID" hint="From the Microsoft Entra app registration overview." persistent-hint/><v-text-field v-model="entra.clientSecret" type="password" :label="entra.clientSecretConfigured ? 'Replace client secret (optional)' : 'Client secret'" :hint="entra.clientSecretConfigured ? 'Leave blank to retain the sealed secret.' : 'Create this under Certificates & secrets in the app registration.'" persistent-hint/><v-text-field v-model="entra.redirectUri" label="Redirect URI" hint="This exact URI must be registered as a Web redirect URI in Entra." persistent-hint/><v-alert type="info" variant="tonal" density="compact">The client secret is encrypted before storage and is never returned to this browser. Saving these values enables the Enterprise Login button when tenant, client ID, and a client secret are configured.</v-alert><div class="actions"><v-btn variant="text" @click="entraWindow = false">Cancel</v-btn><v-btn class="glass-button" type="submit">Save Entra Configuration</v-btn></div></form></FloatingWindow>
    <FloatingWindow v-model="notificationsWindow" title="Run Alert Delivery" :width="650" :start-x="280" :start-y="90"><form class="window-form two" @submit.prevent="saveNotifications"><section class="notification-channel full"><div><p class="section-eyebrow">SMTP Email</p><strong>Send run notifications by email</strong></div><v-switch v-model="notifications.smtpEnabled" color="secondary" density="compact" hide-details label="Enable SMTP"/></section><template v-if="notifications.smtpEnabled"><v-text-field v-model="notifications.smtpHost" label="SMTP host"/><v-text-field v-model.number="notifications.smtpPort" label="Port" type="number"/><v-text-field v-model="notifications.smtpUsername" label="Username (optional)"/><v-text-field v-model="notifications.smtpPassword" type="password" :label="notifications.smtpPasswordConfigured ? 'Replace password (optional)' : 'Password'" :hint="notifications.smtpPasswordConfigured ? 'Leave blank to retain the sealed password.' : ''" persistent-hint/><v-text-field v-model="notifications.smtpFrom" label="From address"/><v-text-field v-model="notifications.smtpTo" label="Recipient address(es)" hint="Separate multiple addresses with commas." persistent-hint/><v-switch v-model="notifications.smtpSecure" color="secondary" density="compact" label="Use TLS from connection start" class="full"/></template><section class="notification-channel full"><div><p class="section-eyebrow">HTTP(S) Webhook</p><strong>POST structured job-result events</strong></div><v-switch v-model="notifications.webhookEnabled" color="secondary" density="compact" hide-details label="Enable webhook"/></section><v-text-field v-if="notifications.webhookEnabled" v-model="notifications.webhookUrl" label="Webhook URL" hint="Receives a JSON POST after each selected run result." persistent-hint class="full"/><section class="notification-events full"><div><p class="section-eyebrow">Events</p><strong>Choose which completed jobs generate alerts</strong></div><v-switch v-model="notifications.notifyOnSuccess" color="success" density="compact" hide-details label="Successful runs"/><v-switch v-model="notifications.notifyOnFailure" color="error" density="compact" hide-details label="Failed runs"/></section><v-alert type="info" variant="tonal" density="compact" class="full">Alerts include execution metadata and a short failure summary only. Script content, resolved secrets, and full command output are never sent.</v-alert><div class="actions full"><v-btn variant="text" @click="notificationsWindow = false">Cancel</v-btn><v-btn class="glass-button" type="submit">Save Alert Delivery</v-btn></div></form></FloatingWindow>
    <FloatingWindow v-model="policyWindow" :title="policyDraft.id ? 'Edit Notification Policy' : 'Notification Policy Editor'" :width="720" :start-x="230" :start-y="70"><form class="window-form two" @submit.prevent="savePolicy"><section class="notification-channel full"><div><p class="section-eyebrow">Policy State</p><strong>Route selected operational events</strong></div><v-switch v-model="policyDraft.enabled" color="success" density="compact" hide-details label="Enabled"/></section><v-text-field v-model="policyDraft.name" label="Policy name" class="full"/><v-select v-model="policyDraft.eventTypes" :items="eventOptions" label="Notify for" multiple chips class="full"/><section class="policy-window full"><p class="section-eyebrow">Allowed Delivery Window</p><span>Leave dates, days, and times empty to allow notifications at all times.</span><div><v-select v-model="policyDraft.window.days" :items="weekdayOptions" label="Days" multiple chips/><v-text-field v-model="policyDraft.window.startDate" type="date" label="Start date"/><v-text-field v-model="policyDraft.window.endDate" type="date" label="End date"/><v-text-field v-model="policyDraft.window.startTime" type="time" label="Start time"/><v-text-field v-model="policyDraft.window.endTime" type="time" label="End time"/></div></section><v-select v-model="policyDraft.recipientUserIds" :items="store.catalog.users" item-title="email" item-value="id" label="People" multiple chips/><v-select v-model="policyDraft.teamIds" :items="store.catalog.teams" item-title="name" item-value="id" label="Teams" multiple chips/><v-text-field v-model="policyDraft.webhookUrl" label="Policy webhook URL (optional)" hint="Receives the policy event as JSON; email uses the configured SMTP delivery profile." persistent-hint class="full"/><v-alert type="info" variant="tonal" density="compact" class="full">Event links point to the relevant run, log, or Script Studio view in POSHinit. Team delivery emails every active team member.</v-alert><div class="actions full"><v-btn variant="text" @click="policyWindow = false">Cancel</v-btn><v-btn class="glass-button" type="submit">Save Policy</v-btn></div></form></FloatingWindow>

    <FloatingWindow v-model="vmwareWindow" title="VMware Inventory Connectors" :width="700" :start-x="220" :start-y="90"><div class="connector-window"><div class="connector-header"><p>Register vCenter servers and standalone ESXi hosts side by side. vCenter uses its REST inventory API; host-only environments use the native VMware SOAP API at <code>/sdk</code>.</p><v-btn class="glass-button" prepend-icon="mdi-plus" @click="resetConnector(); connectorWindow = true">Add Connector</v-btn></div><article v-for="connector in vmware.connectors" :key="connector.id" class="connector-card"><span class="connector-icon"><v-icon :icon="connector.kind === 'esxi-host' ? 'mdi-server' : 'mdi-cloud-outline'"/></span><div><strong>{{ connector.name }}</strong><span>{{ connector.kind === 'esxi-host' ? 'Standalone ESXi host / SOAP' : 'vCenter / REST' }} · {{ connector.baseUrl }}</span><small>{{ connector.username || 'No account configured' }}</small></div><div class="connector-actions"><v-btn size="small" variant="text" @click="importConnector(connector)">Import VMs</v-btn><v-btn size="small" icon="mdi-pencil-outline" variant="text" @click="editConnector(connector)"/><v-btn size="small" icon="mdi-delete-outline" variant="text" @click="removeConnector(connector)"/></div></article><p v-if="!vmware.connectors.length" class="empty-state">No VMware connectors registered. Add a vCenter or standalone ESXi host to begin inventory import.</p><v-alert v-if="importSummary" type="info" variant="tonal">{{ importSummary }}</v-alert><div class="actions"><v-btn variant="text" @click="vmwareWindow = false">Close</v-btn></div></div></FloatingWindow>

    <FloatingWindow v-model="connectorWindow" :title="connectorDraft.id ? 'Edit VMware Connector' : 'Add VMware Connector'" :width="560" :start-x="420" :start-y="145"><form class="window-form two" @submit.prevent="saveConnector"><v-select v-model="connectorDraft.kind" :items="[{ title: 'vCenter Server (REST)', value: 'vcenter' }, { title: 'Standalone ESXi Host (SOAP)', value: 'esxi-host' }]" label="Endpoint type" class="full"/><v-text-field v-model="connectorDraft.name" label="Connector name"/><v-text-field v-model="connectorDraft.baseUrl" :label="connectorDraft.kind === 'esxi-host' ? 'ESXi host URL or hostname' : 'vCenter base URL'"/><v-text-field v-model="connectorDraft.username" label="Username"/><v-text-field v-model="connectorDraft.passwordPlain" type="password" label="Password" hint="Leave empty to retain the sealed password." persistent-hint/><v-select v-model="connectorDraft.autoImportGroupId" :items="store.catalog.groups" item-title="name" item-value="id" label="Auto-assign deployment group" class="full"/><v-alert type="info" variant="tonal" class="full">{{ connectorDraft.kind === 'esxi-host' ? 'Connects directly to the host /sdk SOAP service. No vCenter is required.' : 'Uses the vCenter REST inventory endpoint.' }}</v-alert><div class="actions full"><v-btn variant="text" @click="connectorWindow = false">Cancel</v-btn><v-btn class="glass-button" type="submit">Save Connector</v-btn></div></form></FloatingWindow>
  </div>
</template>

<style scoped>
.settings-workspace { display: grid; gap: 14px; }.commandbar { padding: 2px 0 4px; }.settings-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }.setting-card { display: grid; gap: 7px; padding: 15px; }.setting-card .v-icon { color: var(--amber); }.setting-card strong { overflow: hidden; font-family: 'Share Tech Mono', monospace; font-size: .8rem; text-overflow: ellipsis; white-space: nowrap; }.setting-card span, .connector-card span, .connector-card small { color: var(--muted); font-size: .72rem; }.protection-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; padding: 14px; }.protection-list article { display: flex; gap: 10px; padding: 12px; border: 1px solid var(--line); background: rgba(190, 77, 255, .05); font-size: .78rem; }.window-form, .connector-window { display: grid; gap: 12px; }.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }.full { grid-column: 1 / -1; }.actions, .connector-header, .connector-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }.entra-intro, .notification-channel, .notification-events { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 13px; border: 1px solid rgba(40, 211, 255, .32); background: rgba(40, 211, 255, .05); }.entra-intro p, .entra-intro strong, .notification-channel p, .notification-channel strong, .notification-events p, .notification-events strong { margin: 0; }.entra-intro strong, .notification-channel strong, .notification-events strong { font-size: .85rem; }.entra-intro .v-icon { color: var(--cyan); font-size: 1.5rem; }.notification-events { justify-content: flex-start; flex-wrap: wrap; }.notification-events > div { margin-right: auto; }.policy-list { display: grid; gap: 8px; padding: 14px; }.policy-card { display: grid; grid-template-columns: 30px 1fr auto; gap: 10px; align-items: center; padding: 11px; border: 1px solid var(--line); background: rgba(40, 211, 255, .04); }.policy-card > .v-icon { color: var(--cyan); }.policy-card div { display: grid; gap: 2px; min-width: 0; }.policy-card strong { font-size: .84rem; }.policy-card span, .policy-card small, .policy-window > span { overflow: hidden; color: var(--muted); font-size: .74rem; text-overflow: ellipsis; white-space: nowrap; }.policy-actions { display: flex !important; }.policy-window { display: grid; gap: 8px; padding: 12px; border: 1px solid rgba(40, 211, 255, .24); background: rgba(40, 211, 255, .04); }.policy-window p { margin: 0; }.policy-window > div { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }.policy-window > div > :first-child { grid-column: 1 / -1; }.connector-header { align-items: center; justify-content: space-between; padding-bottom: 10px; border-bottom: 1px solid var(--line); }.connector-header p { max-width: 475px; margin: 0; color: var(--muted); font-size: .78rem; line-height: 1.55; }.connector-card { display: grid; grid-template-columns: 36px 1fr auto; gap: 10px; align-items: center; padding: 12px; border: 1px solid var(--line); background: rgba(190, 77, 255, .05); }.connector-icon { display: grid; width: 32px; height: 32px; place-items: center; color: var(--cyan); border: 1px solid rgba(40, 211, 255, .34); }.connector-card div { display: grid; gap: 2px; min-width: 0; }.connector-card strong { font-size: .85rem; }.connector-card span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.connector-actions { display: flex !important; }.empty-state { margin: 8px 0; color: var(--muted); font-size: .8rem; } @media (max-width: 850px) { .settings-grid, .protection-list, .two, .policy-window > div { grid-template-columns: 1fr; }.full { grid-column: auto; }.connector-card, .policy-card { grid-template-columns: 36px 1fr; }.connector-actions, .policy-actions { grid-column: 1 / -1; justify-content: flex-end; }.notification-channel, .notification-events { align-items: flex-start; flex-direction: column; }.notification-events > div { margin-right: 0; } }
</style>
