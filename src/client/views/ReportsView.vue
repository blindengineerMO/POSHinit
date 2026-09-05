<script setup>
import { ref } from 'vue'
import DataTable from '../components/common/DataTable.vue'
import FloatingWindow from '../components/common/FloatingWindow.vue'
import NeonPanel from '../components/common/NeonPanel.vue'
import { useAppStore } from '../stores/app'
import { downloadExecutionReport } from '../utils/executionReport'

const store = useAppStore()
const detailOpen = ref(false)
const selectedExecution = ref(null)
const logQuery = ref('')

function openExecution(row) {
  selectedExecution.value = row
  detailOpen.value = true
}

async function searchLogs() {
  await store.searchLogs(logQuery.value)
}

async function exportExecution(row) {
  await downloadExecutionReport(row)
}
</script>

<template>
  <div class="page-grid">
    <NeonPanel subtitle="Execution Reporting" title="Scheduled And Manual Run Output">
      <div class="table-pad">
        <DataTable
          :items="store.catalog.executions || []"
          :columns="[
            { key: 'script_name', label: 'Script' },
            { key: 'machine_name', label: 'Machine' },
            { key: 'status', label: 'Status' },
            { key: 'started_at', label: 'Started' },
            { key: 'exit_code', label: 'Exit' },
            { key: 'actions', label: 'Report' },
          ]"
        >
          <template #script_name="{ row }">
            <button class="link-button" type="button" @click="openExecution(row)">{{ row.script_name }}</button>
          </template>
          <template #actions="{ row }">
            <v-btn size="x-small" variant="text" prepend-icon="mdi-file-pdf-box" @click="exportExecution(row)">PDF</v-btn>
          </template>
        </DataTable>
      </div>
    </NeonPanel>

    <NeonPanel subtitle="Searchable Logs" title="API And PowerShell Log Browser">
      <div class="toolbar-row log-toolbar">
        <v-text-field v-model="logQuery" label="Search full logs" prepend-inner-icon="mdi-text-search" hide-details />
        <v-btn class="glass-button" prepend-icon="mdi-magnify" @click="searchLogs">Search</v-btn>
      </div>

      <div class="log-list">
        <article v-for="entry in store.logResults" :key="entry.id" class="log-entry">
          <div class="chip-line">
            <v-chip size="small" variant="tonal">{{ entry.channel }}</v-chip>
            <v-chip size="small" :color="entry.level === 'error' ? 'error' : 'info'" variant="tonal">{{ entry.level }}</v-chip>
          </div>
          <strong>{{ entry.message }}</strong>
          <span class="mono muted">{{ entry.created_at }}</span>
          <pre class="log-context">{{ JSON.stringify(entry.context, null, 2) }}</pre>
        </article>
      </div>
    </NeonPanel>

    <FloatingWindow v-model="detailOpen" title="Execution Detail" :width="560" :start-x="320" :start-y="132">
      <div v-if="selectedExecution" class="detail-grid">
        <div class="detail-actions">
          <span class="muted">Download the complete execution ledger, including output streams.</span>
          <v-btn class="glass-button" size="small" prepend-icon="mdi-file-pdf-box" @click="exportExecution(selectedExecution)">Download PDF Report</v-btn>
        </div>
        <div class="kv-grid">
          <div>
            <p class="section-eyebrow">Script</p>
            <strong>{{ selectedExecution.script_name }}</strong>
          </div>
          <div>
            <p class="section-eyebrow">Machine</p>
            <strong>{{ selectedExecution.machine_name }}</strong>
          </div>
          <div>
            <p class="section-eyebrow">Status</p>
            <strong>{{ selectedExecution.status }}</strong>
          </div>
          <div>
            <p class="section-eyebrow">Exit Code</p>
            <strong>{{ selectedExecution.exit_code }}</strong>
          </div>
        </div>
        <pre class="output-block">{{ selectedExecution.stdout || 'No stdout output.' }}</pre>
        <pre class="output-block error-block">{{ selectedExecution.stderr || 'No stderr output.' }}</pre>
      </div>
    </FloatingWindow>
  </div>
</template>

<style scoped>
.table-pad,
.log-list {
  padding: 20px;
}

.link-button {
  padding: 0;
  border: 0;
  background: transparent;
  color: #7addff;
  cursor: pointer;
}

.log-toolbar {
  padding: 20px 20px 0;
}

.log-list {
  display: grid;
  gap: 12px;
}

.log-entry {
  display: grid;
  gap: 6px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(71, 115, 214, 0.08);
}

.log-context,
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

.detail-grid {
  display: grid;
  gap: 16px;
}

.detail-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 12px;
  border: 1px solid rgba(40, 211, 255, .2);
  border-radius: 14px;
  background: rgba(40, 211, 255, .05);
  font-size: .75rem;
}

@media (max-width: 560px) {
  .detail-actions {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
