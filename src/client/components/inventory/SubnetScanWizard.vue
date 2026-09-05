<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import FloatingWindow from '../common/FloatingWindow.vue'
import DataTable from '../common/DataTable.vue'
import { useAppStore } from '../../stores/app'

const open = defineModel({ default: false })
const store = useAppStore()
const step = ref(1)
const loading = ref(false)
const error = ref('')
const scan = ref(null)
const draft = reactive({ cidr: '', credentialId: '' })
const selectedOs = reactive({})
let pollTimer
const credentials = computed(() => (store.catalog.credentials || []).filter((credential) => credential.secretType !== 'token' && ['psremoting', 'ssh'].includes(credential.protocol)))
const successful = computed(() => (scan.value?.results || []).filter((result) => result.connectionOk))
const progress = computed(() => scan.value?.total ? Math.round((scan.value.completed / scan.value.total) * 100) : 0)

function stopPolling() { if (pollTimer) globalThis.clearInterval(pollTimer); pollTimer = undefined }
function reset() { stopPolling(); step.value = 1; loading.value = false; error.value = ''; scan.value = null; draft.cidr = ''; draft.credentialId = ''; Object.keys(selectedOs).forEach((key) => delete selectedOs[key]) }
function close() { open.value = false; reset() }
watch(open, (value) => { if (!value) reset() })
onBeforeUnmount(stopPolling)

async function refreshScan() {
  if (!scan.value?.id) return
  try {
    scan.value = await store.getSubnetScan(scan.value.id)
    if (scan.value.status !== 'running') {
      stopPolling()
      if (scan.value.status === 'failed') error.value = scan.value.error || 'Subnet scan failed.'
      else {
        successful.value.forEach((result) => { selectedOs[result.address] ||= scan.value.transport === 'ssh' ? 'linux' : 'windows' })
        step.value = 3
      }
    }
  } catch (requestError) { error.value = requestError.message; stopPolling() }
}

async function startScan() {
  error.value = ''
  if (!draft.cidr || !draft.credentialId) return void (error.value = 'Enter a subnet and select a credential before scanning.')
  loading.value = true
  try {
    scan.value = await store.startSubnetScan(draft)
    step.value = 2
    pollTimer = globalThis.setInterval(refreshScan, 700)
    await refreshScan()
  } catch (requestError) { error.value = requestError.message } finally { loading.value = false }
}

async function completeImport() {
  if (!scan.value?.id) return
  loading.value = true
  error.value = ''
  try {
    await store.importSubnetScan(scan.value.id, successful.value.map((result) => ({ address: result.address, osFamily: selectedOs[result.address] })))
    close()
  } catch (requestError) { error.value = requestError.message } finally { loading.value = false }
}
</script>

<template>
  <FloatingWindow v-model="open" title="Add Machines From Subnet" :width="820" :start-x="175" :start-y="75">
    <div class="scan-shell">
      <div class="scan-steps"><button v-for="item in [{ id: 1, label: 'Network scope', icon: 'mdi-lan-connect' }, { id: 2, label: 'Probe and resolve', icon: 'mdi-radar' }, { id: 3, label: 'Review and import', icon: 'mdi-server-plus-outline' }]" :key="item.id" type="button" :class="['scan-step', { active: step === item.id, complete: step > item.id }]" :disabled="item.id > step" @click="step = item.id"><v-icon :icon="item.icon"/><span>{{ item.label }}</span></button></div>
      <v-alert v-if="error" type="error" density="compact" variant="tonal">{{ error }}</v-alert>
      <v-window v-model="step" class="scan-carousel">
        <v-window-item :value="1"><section class="scan-stage"><div class="stage-intro"><p class="section-eyebrow">Step 01 / Network Scope</p><h3>Provide the subnet and access identity.</h3><span>Scanning runs from the POSHinit server. CIDRs are limited to 1,024 usable IPv4 addresses per scan.</span></div><v-text-field v-model="draft.cidr" label="IPv4 subnet (CIDR)" placeholder="10.20.30.0/24" hint="Use an IPv4 range between /8 and /30." persistent-hint/><v-select v-model="draft.credentialId" :items="credentials" item-title="name" item-value="id" label="Connection credential" hint="A pure Node.js TCP probe checks port 5985 for PS Remoting or port 22 for SSH before DNS and credential validation." persistent-hint/><v-alert v-if="!credentials.length" type="warning" density="compact" variant="tonal">Create a PowerShell Remoting or SSH username/password credential in Secret Vault first.</v-alert><div class="scan-actions"><v-btn variant="text" @click="close">Cancel</v-btn><v-btn class="glass-button" :loading="loading" prepend-icon="mdi-radar" @click="startScan">Start Scan</v-btn></div></section></v-window-item>
        <v-window-item :value="2"><section class="scan-stage"><div class="stage-intro"><p class="section-eyebrow">Step 02 / Live Discovery</p><h3>{{ scan?.stage || 'Preparing scan' }}</h3><span>{{ scan?.completed || 0 }} of {{ scan?.total || 0 }} addresses pinged · {{ scan?.reachable || 0 }} responsive · {{ scan?.connected || 0 }} validated</span></div><v-progress-linear :model-value="progress" height="14" color="secondary" rounded><template #default="{ value }"><strong>{{ Math.ceil(value) }}%</strong></template></v-progress-linear><div class="scan-results"><article v-for="result in scan?.results || []" :key="result.address" class="scan-row"><v-icon :color="result.connectionOk ? 'success' : 'warning'" :icon="result.connectionOk ? 'mdi-check-circle-outline' : 'mdi-lan-pending'"/><div><strong>{{ result.hostname || result.address }}</strong><span>{{ result.hostname ? `${result.address} · ` : '' }}{{ result.connectionDetail }}</span></div><v-chip size="x-small" variant="tonal">{{ result.connectionOk ? 'connected' : 'reachable' }}</v-chip></article><div v-if="!scan?.results?.length" class="empty-panel"><v-icon icon="mdi-radar"/><span>Waiting for responsive addresses.</span></div></div><div class="scan-actions"><v-btn variant="text" :disabled="loading" @click="close">Cancel Scan</v-btn></div></section></v-window-item>
        <v-window-item :value="3"><section class="scan-stage"><div class="stage-intro"><p class="section-eyebrow">Step 03 / Import Summary</p><h3>Review validated nodes before registration.</h3><span>Only addresses that passed the selected credential connection test are included. Select the operating system for each node, then complete import.</span></div><DataTable :items="successful" :columns="[{ key: 'address', label: 'Address' }, { key: 'hostname', label: 'DNS name' }, { key: 'connectionDetail', label: 'Connection test' }, { key: 'os', label: 'Operating system' }]"><template #hostname="{ row }">{{ row.hostname || 'No PTR record' }}</template><template #connectionDetail="{ row }"><span class="connection-ok">{{ row.connectionDetail }}</span></template><template #os="{ row }"><v-select v-model="selectedOs[row.address]" :items="[{ title: 'Windows', value: 'windows' }, { title: 'Linux', value: 'linux' }]" density="compact" hide-details/></template></DataTable><div v-if="!successful.length" class="empty-panel"><v-icon icon="mdi-alert-circle-outline"/><span>No nodes passed the connection test. Return to network scope to try another credential or subnet.</span></div><div class="scan-actions"><v-btn variant="text" @click="close">Cancel</v-btn><v-btn class="glass-button" :disabled="!successful.length" :loading="loading" prepend-icon="mdi-server-plus-outline" @click="completeImport">Complete Import</v-btn></div></section></v-window-item>
      </v-window>
    </div>
  </FloatingWindow>
</template>

<style scoped>
.scan-shell, .scan-stage { display: grid; gap: 15px; }.scan-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--line); background: rgba(5, 13, 22, .55); }.scan-step { display: flex; align-items: center; justify-content: center; gap: 7px; min-width: 0; padding: 10px; border: 0; border-right: 1px solid var(--line); background: transparent; color: var(--muted); font: 600 .7rem 'Share Tech Mono', monospace; letter-spacing: .04em; cursor: pointer; }.scan-step:last-child { border-right: 0; }.scan-step.active { color: var(--cyan); background: rgba(40, 211, 255, .1); }.scan-step.complete { color: var(--green); }.scan-step:disabled { cursor: default; opacity: .65; }.stage-intro { display: grid; gap: 5px; }.stage-intro p, .stage-intro h3 { margin: 0; }.stage-intro h3 { font-size: 1rem; }.stage-intro span { color: var(--muted); font-size: .78rem; }.scan-results { display: grid; max-height: 300px; overflow: auto; border: 1px solid var(--line); }.scan-row { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; min-width: 0; padding: 9px 12px; border-bottom: 1px solid rgba(40, 211, 255, .1); background: rgba(40, 211, 255, .035); }.scan-row:last-child { border-bottom: 0; }.scan-row > div { display: grid; gap: 2px; min-width: 0; }.scan-row span, .connection-ok { overflow: hidden; color: var(--muted); font-size: .72rem; text-overflow: ellipsis; white-space: nowrap; }.connection-ok { color: var(--green); }.empty-panel { display: flex; min-height: 150px; align-items: center; justify-content: center; gap: 10px; padding: 20px; border: 1px dashed var(--line); color: var(--muted); font-size: .8rem; text-align: center; }.empty-panel .v-icon { color: var(--cyan); }.scan-actions { display: flex; justify-content: flex-end; gap: 8px; }.scan-carousel { min-height: 390px; } @media (max-width: 620px) { .scan-steps { grid-template-columns: 1fr; }.scan-step { justify-content: flex-start; border-right: 0; border-bottom: 1px solid var(--line); }.scan-step:last-child { border-bottom: 0; }.scan-carousel { min-height: 510px; } }
</style>
