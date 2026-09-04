<script setup>
import { computed, reactive, ref } from 'vue'
import DataTable from '../components/common/DataTable.vue'
import FloatingWindow from '../components/common/FloatingWindow.vue'
import NeonPanel from '../components/common/NeonPanel.vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const machineDialog = ref(false)
const groupDialog = ref(false)
const connectionResult = ref(null)
const connectionDialog = computed({
  get: () => Boolean(connectionResult.value),
  set: (value) => {
    if (!value) {
      connectionResult.value = null
    }
  },
})

const machineDraft = reactive({
  name: '',
  fqdn: '',
  ipAddress: '',
  notes: '',
  osFamily: 'linux',
  transport: 'local',
  port: 22,
  credentialId: '',
})

const groupDraft = reactive({
  name: '',
  description: '',
  machineIds: [],
})

const credentialOptions = computed(() => store.catalog.credentials || [])

async function saveMachine() {
  await store.saveMachine(machineDraft)
  machineDialog.value = false
}

async function saveGroup() {
  await store.saveGroup(groupDraft)
  groupDialog.value = false
}

async function testConnection(machineId) {
  connectionResult.value = await store.testMachine(machineId)
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
        <v-btn class="glass-button" prepend-icon="mdi-plus" @click="machineDialog = true">Add Machine</v-btn>
        <v-btn prepend-icon="mdi-folder-network-outline" variant="text" @click="groupDialog = true">Create Group</v-btn>
      </div>
    </div>

    <div class="content-grid">
      <NeonPanel class="span-8" subtitle="Inventory Table" title="Registered Machines">
        <div class="table-pad">
          <DataTable
            :items="store.catalog.machines || []"
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
                <v-btn size="x-small" variant="text" @click="testConnection(row.id)">Test</v-btn>
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
        <v-select v-model="machineDraft.transport" :items="['local', 'ssh']" label="Transport" />
        <v-text-field v-model="machineDraft.port" type="number" label="Port" />
        <v-select
          v-model="machineDraft.credentialId"
          :items="credentialOptions"
          item-title="name"
          item-value="id"
          label="Credential"
        />
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

    <FloatingWindow v-model="connectionDialog" title="Connection Test Result" :width="460" :start-x="260" :start-y="210">
      <div v-if="connectionResult" class="detail-grid">
        <v-alert :type="connectionResult.ok ? 'success' : 'warning'" variant="tonal">
          {{ connectionResult.ok ? 'Connection succeeded' : 'Connection failed' }}
        </v-alert>
        <pre class="output-block">{{ connectionResult.stdout || 'No stdout output.' }}</pre>
        <pre class="output-block error-block">{{ connectionResult.stderr || 'No stderr output.' }}</pre>
      </div>
    </FloatingWindow>
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
</style>
