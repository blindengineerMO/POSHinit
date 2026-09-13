<script setup>
import { onMounted, reactive, ref } from 'vue'
import FloatingWindow from '../components/common/FloatingWindow.vue'
import NeonPanel from '../components/common/NeonPanel.vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const workers = ref([])
const pools = ref([])
const editor = ref(false)
const error = ref('')
const pool = reactive({ id: '', name: '', labelsText: '', requiredLabelsText: '', draining: false })
function toLabels(text) { return text.split(',').map((item) => item.trim()).filter(Boolean).reduce((labels, item) => { const [key, ...rest] = item.split('='); if (key && rest.length) labels[key.trim()] = rest.join('=').trim(); return labels }, {}) }
function labelsText(labels = {}) { return Object.entries(labels).map(([key, value]) => `${key}=${value}`).join(', ') }
async function load() { try { error.value = ''; const data = await store.workerControl(); workers.value = data.workers; pools.value = data.pools } catch (cause) { error.value = cause.message } }
function openPool(item = null) { Object.assign(pool, item ? { id: item.id, name: item.name, labelsText: labelsText(item.labels), requiredLabelsText: labelsText(item.placement?.requiredLabels), draining: item.draining } : { id: '', name: '', labelsText: '', requiredLabelsText: '', draining: false }); editor.value = true }
async function save() { await store.saveWorkerPool({ id: pool.id || undefined, name: pool.name, labels: toLabels(pool.labelsText), placement: { requiredLabels: toLabels(pool.requiredLabelsText) }, draining: pool.draining }); editor.value = false; await load() }
async function drain(worker) { await store.setWorkerDrain(worker.id, !worker.draining); await load() }
onMounted(load)
</script>

<template>
  <div class="worker-workspace">
    <div class="toolbar-row"><div><p class="section-eyebrow">Outbound Execution Plane</p><h2 class="page-title">Worker Fleet</h2><p class="lede">Private-network workers poll the control plane, claim eligible targets, and return redacted execution evidence.</p></div><v-btn class="glass-button" prepend-icon="mdi-server-plus-outline" @click="openPool()">Create Worker Pool</v-btn></div>
    <v-alert v-if="error" type="error" variant="tonal" density="compact">{{ error }}</v-alert>
    <NeonPanel subtitle="Placement Fabric" title="Worker Pools"><template #actions><span class="count mono">{{ pools.length }} POOLS</span></template><div class="pool-grid"><article v-for="item in pools" :key="item.id"><div><strong>{{ item.name }}</strong><span>{{ item.draining ? 'Draining: no new claims' : 'Ready for placement' }}</span></div><code>requires {{ labelsText(item.placement?.requiredLabels) || 'any worker labels' }}</code><v-btn size="small" variant="text" prepend-icon="mdi-pencil-outline" @click="openPool(item)">Edit</v-btn></article><p v-if="!pools.length" class="empty">Create a pool, enroll a worker into it, then target the pool from a dispatch.</p></div></NeonPanel>
    <NeonPanel subtitle="Authenticated Agents" title="Worker Health"><v-table density="compact"><thead><tr><th>Worker</th><th>Pool</th><th>Version / Capabilities</th><th>Labels</th><th>Heartbeat</th><th>State</th><th /></tr></thead><tbody><tr v-for="worker in workers" :key="worker.id"><td><strong>{{ worker.name }}</strong><small class="mono">{{ worker.id }}</small></td><td>{{ worker.pool_name || 'Unassigned' }}</td><td>{{ worker.version }}<small>{{ worker.capabilities.join(', ') || 'No capabilities reported' }}</small></td><td class="mono">{{ labelsText(worker.labels) || '-' }}</td><td>{{ worker.last_heartbeat_at ? new Date(worker.last_heartbeat_at).toLocaleString() : 'Never' }}</td><td><v-chip size="x-small" :color="worker.draining ? 'warning' : worker.online ? 'success' : 'error'">{{ worker.draining ? 'DRAINING' : worker.online ? 'ONLINE' : 'OFFLINE' }}</v-chip></td><td><v-btn size="small" variant="text" :color="worker.draining ? 'success' : 'warning'" @click="drain(worker)">{{ worker.draining ? 'Activate' : 'Drain' }}</v-btn></td></tr><tr v-if="!workers.length"><td colspan="7" class="empty">No workers have enrolled. The local in-process executor remains available for unplaced work.</td></tr></tbody></v-table></NeonPanel>
    <FloatingWindow v-model="editor" title="Worker Pool Editor" :width="620" :start-x="310" :start-y="110"><form class="pool-form" @submit.prevent="save"><v-text-field v-model="pool.name" label="Pool name" autofocus/><v-text-field v-model="pool.labelsText" label="Pool labels" hint="Comma-separated key=value metadata, such as region=west, network=private." persistent-hint/><v-text-field v-model="pool.requiredLabelsText" label="Required worker labels" hint="Only workers matching every label may claim this pool's work." persistent-hint/><v-switch v-model="pool.draining" color="warning" density="compact" label="Drain this pool"/><v-alert type="info" density="compact" variant="tonal">Workers use outbound polling. Enrollment returns a one-time token; persist it only on the worker host.</v-alert><div class="actions"><v-btn variant="text" @click="editor = false">Cancel</v-btn><v-btn class="glass-button" type="submit">Save Pool</v-btn></div></form></FloatingWindow>
  </div>
</template>

<style scoped>
.worker-workspace,.pool-form{display:grid;gap:14px}.lede,.empty,small{color:var(--muted);font-size:.76rem}.pool-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(235px,1fr));gap:10px;padding:14px}.pool-grid article{display:grid;gap:10px;padding:14px;border:1px solid var(--line);background:linear-gradient(135deg,rgba(40,211,255,.07),rgba(190,77,255,.06))}.pool-grid article div{display:grid;gap:3px}.pool-grid code{color:var(--cyan);font-size:.68rem;white-space:normal}.count{color:var(--cyan);font-size:.7rem}td small{display:block;margin-top:3px;font-family:'Share Tech Mono',monospace;font-size:.65rem}.actions{display:flex;justify-content:flex-end;gap:8px}.empty{padding:14px;text-align:center}
</style>
