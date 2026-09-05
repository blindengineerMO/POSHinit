<script setup>
import { computed, reactive, ref, watch } from 'vue'
import FloatingWindow from '../common/FloatingWindow.vue'
import { useAppStore } from '../../stores/app'

const open = defineModel({ default: false })
const props = defineProps({ kindFilter: { type: String, default: '' } })
const store = useAppStore()
const step = ref(1)
const loading = ref(false)
const discovered = ref([])
const selectedIds = ref([])
const imported = ref([])
const results = ref([])
const error = ref('')
const wizard = reactive({ connectorId: '', defaultCredentialId: '', credentialIds: {} })
const connectors = computed(() => (store.catalog.settings.vcenter?.connectors || []).filter((connector) => !props.kindFilter || connector.kind === props.kindFilter))
const credentials = computed(() => (store.catalog.credentials || []).filter((credential) => credential.protocol === 'psremoting'))
const selectedMachines = computed(() => discovered.value.filter((machine) => selectedIds.value.includes(machine.id)))

function reset() {
  step.value = 1
  discovered.value = []
  selectedIds.value = []
  imported.value = []
  results.value = []
  error.value = ''
  wizard.connectorId = connectors.value[0]?.id || ''
  wizard.defaultCredentialId = ''
  wizard.credentialIds = {}
}
watch(() => props.kindFilter, reset, { immediate: true })

async function discover() {
  error.value = ''
  if (!wizard.connectorId) {
    error.value = 'Choose a VMware connector first.'
    return
  }
  loading.value = true
  try {
    discovered.value = await store.discoverVmware(wizard.connectorId)
    selectedIds.value = discovered.value.map((machine) => machine.id)
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    loading.value = false
  }
}

function applyDefaultCredential() {
  selectedMachines.value.forEach((machine) => {
    wizard.credentialIds[machine.id] = wizard.defaultCredentialId
  })
}

async function verifyConnections() {
  error.value = ''
  loading.value = true
  try {
    imported.value = await store.importVmwareSelection(wizard.connectorId, selectedIds.value, wizard.credentialIds)
    results.value = []
    for (const machine of imported.value) {
      try {
        // Run serially to avoid flooding WinRM during an initial onboarding pass.
        // eslint-disable-next-line no-await-in-loop
        const result = await store.testMachine(machine.id)
        results.value.push({ machine, ...result })
      } catch (requestError) {
        results.value.push({ machine, ok: false, stdout: '', stderr: requestError.message })
      }
    }
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    loading.value = false
  }
}

function close() {
  open.value = false
  reset()
}
</script>

<template>
  <FloatingWindow v-model="open" title="Import VMware Virtual Machines" :width="760" :start-x="185" :start-y="92">
    <div class="wizard-shell">
      <div class="wizard-steps"><button v-for="item in [{ id: 1, label: 'Select inventory', icon: 'mdi-view-list-outline' }, { id: 2, label: 'Assign access', icon: 'mdi-key-outline' }, { id: 3, label: 'Verify nodes', icon: 'mdi-lan-check' }]" :key="item.id" type="button" :class="['wizard-step', { active: step === item.id, complete: step > item.id }]" :disabled="item.id > step" @click="step = item.id"><v-icon :icon="item.icon"/><span>{{ item.label }}</span></button></div>
      <v-alert v-if="error" type="error" variant="tonal" density="compact">{{ error }}</v-alert>
      <v-window v-model="step" class="wizard-carousel">
        <v-window-item :value="1"><section class="wizard-stage"><div class="stage-intro"><p class="section-eyebrow">Step 01 / Inventory Scan</p><h3>Choose virtual machines to bring under control.</h3><span>Discovery reads the selected vCenter or ESXi host without writing machine records.</span></div><div class="discovery-bar"><v-select v-model="wizard.connectorId" :items="connectors" item-title="name" item-value="id" label="VMware connector" density="compact" hide-details/><v-btn class="glass-button" :loading="loading" prepend-icon="mdi-radar" @click="discover">Discover</v-btn></div><div v-if="!connectors.length" class="empty-panel"><v-icon icon="mdi-server-network-off"/><span>Add a VMware connector from System Settings first.</span></div><div v-else-if="discovered.length" class="vm-list"><article v-for="machine in discovered" :key="machine.id" class="vm-row"><v-switch v-model="selectedIds" :value="machine.id" color="secondary" density="compact" hide-details/><div><strong>{{ machine.name }}</strong><span>{{ machine.guestOs || 'Guest OS unknown' }} · {{ machine.ipAddress || 'No guest IP reported' }}</span></div><v-chip size="x-small" variant="tonal">{{ machine.powerState || 'unknown' }}</v-chip></article></div><div v-else class="empty-panel"><v-icon icon="mdi-radar"/><span>Choose a connector and scan its VMware inventory.</span></div><div class="wizard-actions"><v-btn variant="text" @click="close">Cancel</v-btn><v-btn class="glass-button" :disabled="!selectedIds.length" @click="step = 2">Assign Credentials</v-btn></div></section></v-window-item>
        <v-window-item :value="2"><section class="wizard-stage"><div class="stage-intro"><p class="section-eyebrow">Step 02 / Access Binding</p><h3>Bind a PowerShell Remoting credential to each VM.</h3><span>All imported targets are configured for the preferred WinRM/PowerShell Remoting transport.</span></div><div class="credential-bar"><v-select v-model="wizard.defaultCredentialId" :items="credentials" item-title="name" item-value="id" label="Apply a credential to all selected VMs" density="compact" hide-details/><v-btn variant="text" :disabled="!wizard.defaultCredentialId" @click="applyDefaultCredential">Apply to all</v-btn></div><div class="assignment-list"><article v-for="machine in selectedMachines" :key="machine.id" class="assignment-row"><div><strong>{{ machine.name }}</strong><span>{{ machine.ipAddress || machine.guestOs || 'Inventory metadata only' }}</span></div><v-select v-model="wizard.credentialIds[machine.id]" :items="credentials" item-title="name" item-value="id" label="Remoting credential" density="compact" hide-details/></article></div><v-alert v-if="!credentials.length" type="warning" variant="tonal" density="compact">Create a PowerShell Remoting credential in Secret Vault before continuing.</v-alert><div class="wizard-actions"><v-btn variant="text" @click="step = 1">Back</v-btn><v-btn class="glass-button" :disabled="!selectedMachines.length || selectedMachines.some((machine) => !wizard.credentialIds[machine.id])" @click="step = 3">Verify Connectivity</v-btn></div></section></v-window-item>
        <v-window-item :value="3"><section class="wizard-stage"><div class="stage-intro"><p class="section-eyebrow">Step 03 / Node Verification</p><h3>Import selected machines and verify remote access.</h3><span>Each test uses the selected PowerShell Remoting credential and reports directly in this completion screen.</span></div><div v-if="!results.length" class="verify-callout"><v-icon icon="mdi-lan-connect"/><span>Ready to import {{ selectedMachines.length }} machines and test their remoting endpoints.</span></div><div v-else class="verification-list"><article v-for="result in results" :key="result.machine.id" :class="['verification-row', result.ok ? 'success' : 'failed']"><v-icon :icon="result.ok ? 'mdi-check-circle-outline' : 'mdi-alert-circle-outline'"/><div><strong>{{ result.machine.name }}</strong><span>{{ result.ok ? (result.stdout || 'PowerShell Remoting connected.') : (result.stderr || 'Connectivity test failed.') }}</span></div></article></div><div class="wizard-actions"><v-btn variant="text" :disabled="loading || results.length" @click="step = 2">Back</v-btn><v-btn v-if="!results.length" class="glass-button" :loading="loading" prepend-icon="mdi-lan-check" @click="verifyConnections">Import And Test</v-btn><v-btn v-else class="glass-button" prepend-icon="mdi-check" @click="close">Complete Import</v-btn></div></section></v-window-item>
      </v-window>
    </div>
  </FloatingWindow>
</template>

<style scoped>
.wizard-shell, .wizard-stage { display: grid; gap: 15px; }.wizard-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--line); background: rgba(5, 13, 22, .55); }.wizard-step { display: flex; align-items: center; justify-content: center; gap: 7px; min-width: 0; padding: 10px; border: 0; border-right: 1px solid var(--line); background: transparent; color: var(--muted); font: 600 .7rem 'Share Tech Mono', monospace; letter-spacing: .04em; cursor: pointer; }.wizard-step:last-child { border-right: 0; }.wizard-step.active { color: var(--cyan); background: rgba(40, 211, 255, .1); }.wizard-step.complete { color: var(--green); }.wizard-step:disabled { cursor: default; opacity: .65; }.stage-intro { display: grid; gap: 5px; }.stage-intro p, .stage-intro h3 { margin: 0; }.stage-intro h3 { font-size: 1rem; }.stage-intro span { color: var(--muted); font-size: .78rem; }.discovery-bar, .credential-bar { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; }.vm-list, .assignment-list, .verification-list { display: grid; max-height: 295px; overflow: auto; border: 1px solid var(--line); }.vm-row, .assignment-row, .verification-row { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; min-width: 0; padding: 9px 12px; border-bottom: 1px solid rgba(40, 211, 255, .1); background: rgba(40, 211, 255, .035); }.vm-row:last-child, .assignment-row:last-child, .verification-row:last-child { border-bottom: 0; }.vm-row > div, .assignment-row > div, .verification-row > div { display: grid; gap: 2px; min-width: 0; }.vm-row span, .assignment-row span, .verification-row span { overflow: hidden; color: var(--muted); font-size: .72rem; text-overflow: ellipsis; white-space: nowrap; }.assignment-row { grid-template-columns: minmax(130px, .75fr) minmax(210px, 1fr); }.verification-row { grid-template-columns: auto 1fr; }.verification-row.success { border-left: 2px solid var(--green); }.verification-row.success > .v-icon { color: var(--green); }.verification-row.failed { border-left: 2px solid #ff799b; }.verification-row.failed > .v-icon { color: #ff799b; }.empty-panel, .verify-callout { display: flex; min-height: 120px; align-items: center; justify-content: center; gap: 10px; padding: 20px; border: 1px dashed var(--line); color: var(--muted); font-size: .8rem; text-align: center; }.empty-panel .v-icon, .verify-callout .v-icon { color: var(--cyan); }.wizard-actions { display: flex; justify-content: flex-end; gap: 8px; }.wizard-carousel { min-height: 390px; } @media (max-width: 620px) { .wizard-steps { grid-template-columns: 1fr; }.wizard-step { justify-content: flex-start; border-right: 0; border-bottom: 1px solid var(--line); }.wizard-step:last-child { border-bottom: 0; }.discovery-bar, .credential-bar, .assignment-row { grid-template-columns: 1fr; }.wizard-carousel { min-height: 510px; } }
</style>
