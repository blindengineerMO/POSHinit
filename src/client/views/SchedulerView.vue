<script setup>
import { computed, reactive, ref } from 'vue'
import DataTable from '../components/common/DataTable.vue'
import FloatingWindow from '../components/common/FloatingWindow.vue'
import NeonPanel from '../components/common/NeonPanel.vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const scheduleWindow = ref(false)
const runWindow = ref(false)
const resultWindow = ref(false)
const runResults = ref([])
const scheduleDraft = reactive({ name: 'New Scheduled Run', mode: 'recurring', cronExpression: '0 * * * *', runAt: '', timezone: 'UTC', status: 'enabled', requireApproval: false, scriptIds: [], groupIds: [], machineIds: [] })
const manualRunDraft = reactive({ scriptIds: [], machineIds: [], triggerType: 'manual' })
const scripts = computed(() => (store.catalog.library || []).filter((entry) => entry.type === 'script'))
const groups = computed(() => store.catalog.groups || [])
const machines = computed(() => store.catalog.machines || [])
const enabledSchedules = computed(() => (store.catalog.schedules || []).filter((item) => item.status === 'enabled').length)

async function saveSchedule() { await store.saveSchedule(scheduleDraft); scheduleWindow.value = false }
async function runNow() { runResults.value = await store.runScripts(manualRunDraft); runWindow.value = false; resultWindow.value = true }
</script>

<template>
  <div class="planner-workspace">
    <div class="toolbar-row page-commandbar">
      <div><p class="section-eyebrow">Execution Control</p><h2 class="page-title">Run Planner</h2></div>
      <div class="chip-line"><v-btn prepend-icon="mdi-history" variant="text">Run History</v-btn><v-btn prepend-icon="mdi-play-circle-outline" variant="text" @click="runWindow = true">Run Now</v-btn><v-btn class="glass-button" prepend-icon="mdi-calendar-plus" @click="scheduleWindow = true">New Schedule</v-btn></div>
    </div>

    <section class="planner-telemetry">
      <article class="telemetry-card primary"><span class="telemetry-icon"><v-icon icon="mdi-calendar-clock-outline" /></span><div><p>ACTIVE SCHEDULES</p><strong>{{ enabledSchedules }}</strong><small>automation lanes armed</small></div></article>
      <article class="telemetry-card"><span class="telemetry-icon amber"><v-icon icon="mdi-server-network-outline" /></span><div><p>AVAILABLE TARGETS</p><strong>{{ machines.length }}</strong><small>managed execution nodes</small></div></article>
      <article class="telemetry-card"><span class="telemetry-icon green"><v-icon icon="mdi-script-text-outline" /></span><div><p>PUBLISHED RUNBOOKS</p><strong>{{ scripts.length }}</strong><small>ready for dispatch</small></div></article>
      <article class="next-run"><p class="section-eyebrow">Next Dispatch Window</p><strong class="mono">{{ store.catalog.schedules?.[0]?.next_run_at || 'No dispatch queued' }}</strong><span class="muted">Configure schedules from the command bar. Drafts and execution controls remain out of this workspace.</span></article>
    </section>

    <NeonPanel subtitle="Schedule Registry" title="Saved Automation Lanes"><template #actions><v-chip variant="outlined">{{ store.catalog.schedules?.length || 0 }} records</v-chip></template><div class="table-pad"><DataTable :items="store.catalog.schedules || []" :columns="[{ key: 'name', label: 'Schedule' }, { key: 'mode', label: 'Mode' }, { key: 'cron_expression', label: 'Cadence' }, { key: 'next_run_at', label: 'Next dispatch' }, { key: 'status', label: 'State' }]" /></div></NeonPanel>

    <FloatingWindow v-model="scheduleWindow" title="Create Schedule" :width="600" :start-x="170" :start-y="96"><div class="window-form two-column"><v-text-field v-model="scheduleDraft.name" label="Schedule name" class="span-all" /><v-select v-model="scheduleDraft.mode" :items="['recurring', 'once']" label="Run mode" /><v-select v-model="scheduleDraft.status" :items="['enabled', 'disabled']" label="State" /><v-text-field v-if="scheduleDraft.mode === 'recurring'" v-model="scheduleDraft.cronExpression" label="Cron expression" hint="0 * * * * runs hourly" persistent-hint class="span-all" /><v-text-field v-else v-model="scheduleDraft.runAt" label="Run at ISO timestamp" class="span-all" /><v-select v-model="scheduleDraft.scriptIds" :items="scripts" item-title="name" item-value="id" label="Runbooks" multiple chips class="span-all" /><v-select v-model="scheduleDraft.groupIds" :items="groups" item-title="name" item-value="id" label="Deployment groups" multiple chips /><v-select v-model="scheduleDraft.machineIds" :items="machines" item-title="name" item-value="id" label="Direct targets" multiple chips /><v-switch v-model="scheduleDraft.requireApproval" color="secondary" label="Require operator approval" class="span-all" /><div class="window-actions span-all"><v-btn variant="text" @click="scheduleWindow = false">Cancel</v-btn><v-btn class="glass-button" prepend-icon="mdi-content-save-outline" @click="saveSchedule">Arm Schedule</v-btn></div></div></FloatingWindow>

    <FloatingWindow v-model="runWindow" title="Dispatch Runbook" :width="480" :start-x="450" :start-y="120"><div class="window-form"><v-select v-model="manualRunDraft.scriptIds" :items="scripts" item-title="name" item-value="id" label="Runbooks" multiple chips /><v-select v-model="manualRunDraft.machineIds" :items="machines" item-title="name" item-value="id" label="Execution targets" multiple chips /><div class="dispatch-note"><v-icon icon="mdi-information-outline" color="info" /> Manual dispatch starts immediately and streams results into the execution ledger.</div><div class="window-actions"><v-btn variant="text" @click="runWindow = false">Cancel</v-btn><v-btn class="glass-button" prepend-icon="mdi-play" @click="runNow">Dispatch Now</v-btn></div></div></FloatingWindow>

    <FloatingWindow v-model="resultWindow" title="Dispatch Results" :width="520" :start-x="500" :start-y="160"><div class="result-list"><article v-for="result in runResults" :key="result.id" class="result-card"><v-icon :icon="result.status === 'success' ? 'mdi-check-circle-outline' : 'mdi-alert-circle-outline'" :color="result.status === 'success' ? 'success' : 'error'" /><div><strong>{{ result.id }}</strong><span class="mono">{{ result.status }} · exit {{ result.exit_code ?? 'pending' }}</span></div></article><p v-if="!runResults.length" class="muted">No dispatch results returned.</p></div></FloatingWindow>
  </div>
</template>

<style scoped>
.planner-workspace { display: grid; gap: 14px; }.page-commandbar { padding: 2px 0 4px; }.planner-telemetry { display: grid; grid-template-columns: repeat(3, minmax(150px, 1fr)) minmax(280px, 1.8fr); gap: 12px; }.telemetry-card, .next-run { min-width: 0; border: 1px solid var(--line); background: linear-gradient(145deg, rgba(10, 28, 38, .9), rgba(5, 14, 20, .84)); }.telemetry-card { display: flex; gap: 11px; align-items: center; padding: 13px; }.telemetry-card p { margin: 0 0 2px; color: var(--muted); font-family: 'Share Tech Mono', monospace; font-size: 9px; letter-spacing: .1em; }.telemetry-card strong { display: block; font-family: 'Share Tech Mono', monospace; font-size: 1.7rem; line-height: 1; }.telemetry-card small { color: var(--faint); font-size: .7rem; }.telemetry-icon { display: grid; width: 31px; height: 31px; place-items: center; color: var(--cyan); border: 1px solid rgba(40, 211, 255, .32); background: rgba(40, 211, 255, .07); }.telemetry-icon.amber { color: var(--amber); border-color: rgba(255, 181, 46, .3); }.telemetry-icon.green { color: var(--green); border-color: rgba(84, 229, 140, .3); }.next-run { display: grid; gap: 7px; padding: 12px 14px; }.next-run strong { overflow: hidden; color: var(--cyan); font-size: .78rem; text-overflow: ellipsis; white-space: nowrap; }.next-run span { font-size: .74rem; }.table-pad { padding: 14px 16px 16px; }.window-form { display: grid; gap: 12px; }.two-column { grid-template-columns: repeat(2, minmax(0, 1fr)); }.span-all { grid-column: 1 / -1; }.window-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }.dispatch-note { display: flex; gap: 8px; padding: 11px; color: var(--muted); border: 1px solid var(--line); background: rgba(40, 211, 255, .04); font-size: .78rem; }.result-list { display: grid; gap: 8px; }.result-card { display: flex; gap: 10px; padding: 10px; border: 1px solid var(--line); background: rgba(40, 211, 255, .04); }.result-card div { display: grid; gap: 3px; }.result-card span { color: var(--muted); font-size: .72rem; } @media (max-width: 1050px) { .planner-telemetry { grid-template-columns: repeat(2, minmax(0, 1fr)); }.next-run { grid-column: span 2; } } @media (max-width: 620px) { .planner-telemetry, .two-column { grid-template-columns: 1fr; }.next-run { grid-column: auto; }.span-all { grid-column: auto; } }
</style>
