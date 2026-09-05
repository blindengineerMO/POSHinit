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
const runOutput = ref([])
const dispatchRunning = ref(false)
const webhookDetails = ref(null)
const today = new Date().toISOString().slice(0, 10)
const scheduleDraft = reactive({ id: '', name: '', cadence: 'daily', startDate: today, runTime: '02:00', intervalDays: 1, weekdays: [1], timezone: 'UTC', enabled: true, requireApproval: false, webhookEnabled: false, scriptIds: [], groupIds: [], machineIds: [], parameters: {} })
const manualRunDraft = reactive({ scriptIds: [], machineIds: [], triggerType: 'manual' })
const scripts = computed(() => (store.catalog.library || []).filter((entry) => entry.type === 'script'))
const groups = computed(() => store.catalog.groups || [])
const machines = computed(() => store.catalog.machines || [])
const enabledSchedules = computed(() => (store.catalog.schedules || []).filter((item) => item.status === 'enabled').length)
const weekdays = [{ id: 0, label: 'Sun' }, { id: 1, label: 'Mon' }, { id: 2, label: 'Tue' }, { id: 3, label: 'Wed' }, { id: 4, label: 'Thu' }, { id: 5, label: 'Fri' }, { id: 6, label: 'Sat' }]

function resetSchedule() {
  webhookDetails.value = null
  Object.assign(scheduleDraft, { id: '', name: '', cadence: 'daily', startDate: today, runTime: '02:00', intervalDays: 1, weekdays: [1], timezone: 'UTC', enabled: true, requireApproval: false, webhookEnabled: false, scriptIds: [], groupIds: [], machineIds: [], parameters: {} })
}

function toCron() {
  const [hour = '0', minute = '0'] = scheduleDraft.runTime.split(':')
  if (scheduleDraft.cadence === 'hourly') return `${Number(minute)} * * * *`
  if (scheduleDraft.cadence === 'daily') return `${Number(minute)} ${Number(hour)} * * *`
  if (scheduleDraft.cadence === 'weekly') return `${Number(minute)} ${Number(hour)} * * ${scheduleDraft.weekdays.join(',') || 1}`
  return `${Number(minute)} ${Number(hour)} */${Math.max(1, Number(scheduleDraft.intervalDays) || 1)} * *`
}

function openSchedule(schedule = null) {
  if (!schedule) {
    resetSchedule()
    scheduleWindow.value = true
    return
  }
  webhookDetails.value = null
  const parts = (schedule.cron_expression || '').split(' ')
  const runAt = schedule.run_at ? new Date(schedule.run_at) : null
  const hasWeekdays = parts[4] && parts[4] !== '*'
  const hasInterval = parts[2]?.startsWith('*/')
  Object.assign(scheduleDraft, {
    id: schedule.id,
    name: schedule.name,
    cadence: schedule.mode === 'once' ? 'once' : parts[1] === '*' ? 'hourly' : hasWeekdays ? 'weekly' : hasInterval ? 'interval' : 'daily',
    startDate: runAt ? runAt.toISOString().slice(0, 10) : today,
    runTime: runAt ? runAt.toISOString().slice(11, 16) : `${String(parts[1] === '*' ? 0 : parts[1] || 2).padStart(2, '0')}:${String(parts[0] || 0).padStart(2, '0')}`,
    intervalDays: hasInterval ? Number(parts[2].slice(2)) : 1,
    weekdays: hasWeekdays ? parts[4].split(',').map(Number) : [1],
    timezone: schedule.timezone || 'UTC',
    enabled: schedule.status === 'enabled',
    requireApproval: Boolean(schedule.requireApproval),
    webhookEnabled: Boolean(schedule.webhookEnabled),
    scriptIds: [...(schedule.scriptIds || [])],
    groupIds: [...(schedule.groupIds || [])],
    machineIds: [...(schedule.machineIds || [])],
    parameters: {},
  })
  if (schedule.webhookEnabled && store.currentUser?.role === 'admin') store.getScheduleWebhook(schedule.id).then((details) => { webhookDetails.value = details }).catch(() => {})
  scheduleWindow.value = true
}

async function saveSchedule() {
  const isOnce = scheduleDraft.cadence === 'once'
  const runAt = isOnce ? new Date(`${scheduleDraft.startDate}T${scheduleDraft.runTime}:00`).toISOString() : ''
  const savedSchedule = await store.saveSchedule({
    id: scheduleDraft.id || undefined,
    name: scheduleDraft.name,
    mode: isOnce ? 'once' : 'recurring',
    cronExpression: isOnce ? '' : toCron(),
    runAt,
    timezone: scheduleDraft.timezone,
    status: scheduleDraft.enabled ? 'enabled' : 'disabled',
    requireApproval: scheduleDraft.requireApproval,
    webhookEnabled: scheduleDraft.webhookEnabled,
    scriptIds: scheduleDraft.scriptIds,
    groupIds: scheduleDraft.groupIds,
    machineIds: scheduleDraft.machineIds,
    parameters: scheduleDraft.parameters,
  })
  if (scheduleDraft.webhookEnabled) {
    if (store.currentUser?.role === 'admin') webhookDetails.value = await store.getScheduleWebhook(savedSchedule.id)
  }
}
function copyWebhook(value) { navigator.clipboard?.writeText(value) }
async function runNow() { runResults.value = []; runOutput.value = []; dispatchRunning.value = true; runWindow.value = false; resultWindow.value = true; try { await store.streamRunScripts(manualRunDraft, (event) => { if (event.type === 'stdout' || event.type === 'stderr') runOutput.value.push({ ...event, id: `${event.executionId}-${runOutput.value.length}` }); if (event.type === 'complete') runResults.value.push(event.execution) }) } finally { dispatchRunning.value = false } }
</script>

<template>
  <div class="planner-workspace">
    <div class="toolbar-row page-commandbar"><div><p class="section-eyebrow">Execution Control</p><h2 class="page-title">Run Planner</h2></div><div class="chip-line"><v-btn prepend-icon="mdi-play-circle-outline" variant="text" @click="runWindow = true">Run Now</v-btn><v-btn class="glass-button" prepend-icon="mdi-calendar-plus" @click="openSchedule()">New Schedule</v-btn></div></div>
    <section class="planner-telemetry"><article class="telemetry-card primary"><span class="telemetry-icon"><v-icon icon="mdi-calendar-clock-outline" /></span><div><p>ACTIVE SCHEDULES</p><strong>{{ enabledSchedules }}</strong><small>automation lanes armed</small></div></article><article class="telemetry-card"><span class="telemetry-icon amber"><v-icon icon="mdi-server-network-outline" /></span><div><p>AVAILABLE TARGETS</p><strong>{{ machines.length }}</strong><small>managed execution nodes</small></div></article><article class="telemetry-card"><span class="telemetry-icon green"><v-icon icon="mdi-script-text-outline" /></span><div><p>PUBLISHED RUNBOOKS</p><strong>{{ scripts.length }}</strong><small>ready for dispatch</small></div></article><article class="next-run"><p class="section-eyebrow">Next Dispatch Window</p><strong class="mono">{{ store.catalog.schedules?.[0]?.next_run_at || 'No dispatch queued' }}</strong><span class="muted">Configure schedules from the command bar. Drafts and execution controls remain out of this workspace.</span></article></section>
    <NeonPanel subtitle="Schedule Registry" title="Saved Automation Lanes"><template #actions><v-chip variant="outlined">{{ store.catalog.schedules?.length || 0 }} records</v-chip></template><div class="table-pad"><DataTable :items="store.catalog.schedules || []" :columns="[{ key: 'name', label: 'Schedule' }, { key: 'mode', label: 'Mode' }, { key: 'next_run_at', label: 'Next dispatch' }, { key: 'status', label: 'State' }, { key: 'actions', label: '' }]" ><template #name="{ row }"><button class="schedule-link" type="button" @click="openSchedule(row)">{{ row.name }}</button></template><template #actions="{ row }"><v-btn size="x-small" variant="text" @click="openSchedule(row)">Edit</v-btn></template></DataTable></div></NeonPanel>

    <FloatingWindow v-model="scheduleWindow" :title="scheduleDraft.id ? 'Update Schedule' : 'Create Schedule'" :width="720" :start-x="155" :start-y="80"><form class="schedule-composer" @submit.prevent="saveSchedule"><section class="composer-header"><div><p class="section-eyebrow">Schedule Composer</p><h3>{{ scheduleDraft.name || 'Untitled automation lane' }}</h3></div><v-switch v-model="scheduleDraft.enabled" color="secondary" density="compact" hide-details :label="scheduleDraft.enabled ? 'Armed' : 'Paused'"/></section><v-text-field v-model="scheduleDraft.name" label="Task name" density="compact" hide-details/><section class="cadence-section"><p class="section-eyebrow">Run Pattern</p><div class="cadence-grid"><button v-for="option in [{ id: 'once', label: 'One time', icon: 'mdi-calendar-arrow-right' }, { id: 'hourly', label: 'Hourly', icon: 'mdi-clock-outline' }, { id: 'daily', label: 'Daily', icon: 'mdi-calendar-today' }, { id: 'weekly', label: 'Weekly', icon: 'mdi-calendar-week' }, { id: 'interval', label: 'Every N days', icon: 'mdi-repeat' }]" :key="option.id" type="button" :class="['cadence-option', { active: scheduleDraft.cadence === option.id }]" @click="scheduleDraft.cadence = option.id"><v-icon :icon="option.icon"/><span>{{ option.label }}</span></button></div></section><section class="time-grid"><v-text-field v-model="scheduleDraft.startDate" type="date" :label="scheduleDraft.cadence === 'once' ? 'Run date' : 'Start date'" density="compact" hide-details/><v-text-field v-model="scheduleDraft.runTime" type="time" label="Run time" density="compact" hide-details/><v-text-field v-if="scheduleDraft.cadence === 'interval'" v-model="scheduleDraft.intervalDays" type="number" min="1" label="Repeat every days" density="compact" hide-details/></section><section v-if="scheduleDraft.cadence === 'weekly'" class="weekday-section"><p class="section-eyebrow">Days of week</p><div class="weekday-grid"><v-switch v-for="day in weekdays" :key="day.id" v-model="scheduleDraft.weekdays" :value="day.id" color="secondary" density="compact" hide-details :label="day.label"/></div></section><section class="targets-section"><p class="section-eyebrow">Runbook And Targets</p><div class="target-grid"><v-select v-model="scheduleDraft.scriptIds" :items="scripts" item-title="name" item-value="id" label="Runbooks" density="compact" multiple chips/><v-select v-model="scheduleDraft.groupIds" :items="groups" item-title="name" item-value="id" label="Deployment groups" density="compact" multiple chips/><v-select v-model="scheduleDraft.machineIds" :items="machines" item-title="name" item-value="id" label="Direct targets" density="compact" multiple chips/></div></section><section class="policy-row"><v-switch v-model="scheduleDraft.requireApproval" color="secondary" density="compact" hide-details label="Require operator approval before execution"/><span>{{ scheduleDraft.cadence === 'once' ? 'Runs once at the chosen local date and time.' : `Generated cadence: ${toCron()}` }}</span></section><section class="webhook-section"><div><p class="section-eyebrow">External Trigger</p><strong>Schedule Webhook</strong><span>Authenticated POST runs this schedule on demand; GET returns current run status.</span></div><v-switch v-model="scheduleDraft.webhookEnabled" color="secondary" density="compact" hide-details label="Enable webhook"/></section><div v-if="scheduleDraft.webhookEnabled && webhookDetails" class="webhook-details"><div><span>Webhook address</span><code>{{ webhookDetails.url }}</code><v-btn size="x-small" variant="text" @click="copyWebhook(webhookDetails.url)">Copy</v-btn></div><div><span>Header token</span><code>{{ webhookDetails.token }}</code><v-btn size="x-small" variant="text" @click="copyWebhook(webhookDetails.token)">Copy</v-btn></div><small>Send <code>x-poshinit-webhook-token: &lt;token&gt;</code> with an empty POST or GET.</small></div><p v-else-if="scheduleDraft.webhookEnabled" class="webhook-pending">Save this schedule to generate its unique address and token.</p><div class="window-actions"><v-btn variant="text" @click="scheduleWindow = false">Close</v-btn><v-btn class="glass-button" type="submit" prepend-icon="mdi-content-save-outline">{{ scheduleDraft.enabled ? 'Arm Schedule' : 'Save Paused' }}</v-btn></div></form></FloatingWindow>
    <FloatingWindow v-model="runWindow" title="Dispatch Runbook" :width="480" :start-x="450" :start-y="120"><div class="window-form"><v-select v-model="manualRunDraft.scriptIds" :items="scripts" item-title="name" item-value="id" label="Runbooks" multiple chips/><v-select v-model="manualRunDraft.machineIds" :items="machines" item-title="name" item-value="id" label="Execution targets" multiple chips/><div class="dispatch-note"><v-icon icon="mdi-information-outline" color="info"/>Manual dispatch starts immediately and streams results into the execution ledger.</div><div class="window-actions"><v-btn variant="text" @click="runWindow = false">Cancel</v-btn><v-btn class="glass-button" prepend-icon="mdi-play" @click="runNow">Dispatch Now</v-btn></div></div></FloatingWindow>
    <FloatingWindow v-model="resultWindow" title="Live Dispatch Console" :width="720" :start-x="330" :start-y="120"><div class="result-list"><div class="dispatch-note"><v-icon :icon="dispatchRunning ? 'mdi-progress-clock' : 'mdi-check-circle-outline'" :color="dispatchRunning ? 'secondary' : 'success'"/>{{ dispatchRunning ? 'Run Now is active. Output is streaming as each target executes.' : 'Dispatch completed. Review the execution ledger for full reports.' }}</div><pre class="live-output"><span v-for="item in runOutput" :key="item.id" :class="item.type">[{{ item.executionId }}] {{ item.data }}</span><span v-if="!runOutput.length" class="muted">Waiting for execution output...</span></pre><article v-for="result in runResults" :key="result.id" class="result-card"><v-icon :icon="result.status === 'success' ? 'mdi-check-circle-outline' : 'mdi-alert-circle-outline'" :color="result.status === 'success' ? 'success' : 'error'"/><div><strong>{{ result.id }}</strong><span class="mono">{{ result.status }} · exit {{ result.exit_code ?? 'pending' }}</span></div></article></div></FloatingWindow>
  </div>
</template>

<style scoped>
.planner-workspace { display: grid; gap: 14px; }.page-commandbar { padding: 2px 0 4px; }.planner-telemetry { display: grid; grid-template-columns: repeat(3, minmax(150px, 1fr)) minmax(280px, 1.8fr); gap: 12px; }.telemetry-card, .next-run { min-width: 0; border: 1px solid var(--line); background: linear-gradient(145deg, rgba(10, 28, 38, .9), rgba(5, 14, 20, .84)); }.telemetry-card { display: flex; gap: 11px; align-items: center; padding: 13px; }.telemetry-card p { margin: 0 0 2px; color: var(--muted); font-family: 'Share Tech Mono', monospace; font-size: 9px; letter-spacing: .1em; }.telemetry-card strong { display: block; font-family: 'Share Tech Mono', monospace; font-size: 1.7rem; line-height: 1; }.telemetry-card small { color: var(--faint); font-size: .7rem; }.telemetry-icon { display: grid; width: 31px; height: 31px; place-items: center; color: var(--cyan); border: 1px solid rgba(40, 211, 255, .32); background: rgba(40, 211, 255, .07); }.telemetry-icon.amber { color: var(--amber); border-color: rgba(255, 181, 46, .3); }.telemetry-icon.green { color: var(--green); border-color: rgba(84, 229, 140, .3); }.next-run { display: grid; gap: 7px; padding: 12px 14px; }.next-run strong { overflow: hidden; color: var(--cyan); font-size: .78rem; text-overflow: ellipsis; white-space: nowrap; }.next-run span { font-size: .74rem; }.table-pad { padding: 14px 16px 16px; }.schedule-link { padding: 0; border: 0; background: transparent; color: var(--cyan); cursor: pointer; font: inherit; text-align: left; }.window-form, .schedule-composer { display: grid; gap: 13px; }.composer-header, .policy-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }.composer-header p, .composer-header h3 { margin: 0; }.composer-header h3 { margin-top: 4px; font-size: 1rem; }.cadence-section, .targets-section, .weekday-section { display: grid; gap: 8px; }.cadence-section p, .targets-section p, .weekday-section p { margin: 0; }.cadence-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 7px; }.cadence-option { display: grid; gap: 5px; place-items: center; padding: 10px 6px; border: 1px solid var(--line); background: rgba(40, 211, 255, .035); color: var(--muted); cursor: pointer; font: 600 .65rem 'Share Tech Mono', monospace; }.cadence-option.active { color: var(--cyan); border-color: rgba(40, 211, 255, .62); background: rgba(40, 211, 255, .12); box-shadow: inset 0 2px 0 var(--cyan); }.time-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }.weekday-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 3px; padding: 4px 8px; border: 1px solid var(--line); }.target-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }.policy-row { padding: 10px; border: 1px solid var(--line); background: rgba(40, 211, 255, .035); }.policy-row span { color: var(--muted); font: .68rem 'Share Tech Mono', monospace; }.window-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }.dispatch-note { display: flex; gap: 8px; padding: 11px; color: var(--muted); border: 1px solid var(--line); background: rgba(40, 211, 255, .04); font-size: .78rem; }.result-list { display: grid; gap: 8px; }.live-output { max-height: 300px; overflow: auto; margin: 0; padding: 12px; border: 1px solid var(--line); background: #03070b; color: #a9e7ff; font: .72rem 'Azeret Mono', monospace; white-space: pre-wrap; }.live-output span { display: block; }.live-output .stderr { color: #ff9dbd; }.result-card { display: flex; gap: 10px; padding: 10px; border: 1px solid var(--line); background: rgba(40, 211, 255, .04); }.result-card div { display: grid; gap: 3px; }.result-card span { color: var(--muted); font-size: .72rem; } @media (max-width: 1050px) { .planner-telemetry { grid-template-columns: repeat(2, minmax(0, 1fr)); }.next-run { grid-column: span 2; }.target-grid { grid-template-columns: 1fr; } } @media (max-width: 620px) { .planner-telemetry, .time-grid, .target-grid { grid-template-columns: 1fr; }.next-run { grid-column: auto; }.cadence-grid { grid-template-columns: repeat(2, 1fr); }.weekday-grid { grid-template-columns: repeat(2, 1fr); }.composer-header, .policy-row { align-items: flex-start; flex-direction: column; } }
.webhook-section { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:11px; border:1px solid rgba(40,211,255,.28); background:rgba(40,211,255,.05); }.webhook-section p,.webhook-section strong,.webhook-section span { margin:0; }.webhook-section div { display:grid; gap:3px; }.webhook-section span { color:var(--muted); font-size:.72rem; }.webhook-details { display:grid; gap:8px; padding:11px; border:1px solid var(--line); background:rgba(4,12,20,.42); }.webhook-details > div { display:grid; grid-template-columns:100px 1fr auto; gap:8px; align-items:center; }.webhook-details span,.webhook-details small { color:var(--muted); font-size:.7rem; }.webhook-details code { overflow:hidden; color:var(--cyan); text-overflow:ellipsis; white-space:nowrap; font:.68rem 'Share Tech Mono',monospace; }.webhook-pending { margin:0; padding:9px 11px; border:1px dashed var(--line); color:var(--muted); font-size:.74rem; }
</style>
