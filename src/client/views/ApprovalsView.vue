<script setup>
import { onMounted, ref } from 'vue'
import FloatingWindow from '../components/common/FloatingWindow.vue'
import NeonPanel from '../components/common/NeonPanel.vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const approvals = ref([])
const selected = ref(null)
const notes = ref('')
const working = ref(false)
const detailWindow = ref(false)
async function refresh() { approvals.value = await store.listApprovals() }
function open(approval) { selected.value = approval; notes.value = ''; detailWindow.value = true }
async function decide(status) { if (!selected.value) return; working.value = true; try { await store.decideApproval(selected.value.id, status, notes.value); detailWindow.value = false; await refresh() } finally { working.value = false } }
onMounted(refresh)
</script>

<template><div class="approval-workspace"><div class="toolbar-row"><div><p class="section-eyebrow">Governed Execution</p><h2 class="page-title">Approval Queue</h2></div><v-btn variant="text" prepend-icon="mdi-refresh" @click="refresh">Refresh</v-btn></div><NeonPanel subtitle="Human Gate" title="Pending Run Requests"><div class="approval-list"><article v-for="approval in approvals" :key="approval.id" :class="['approval-card', approval.status]"><v-icon :icon="approval.status === 'pending' ? 'mdi-clock-alert-outline' : approval.status === 'approved' ? 'mdi-check-decagram-outline' : 'mdi-close-octagon-outline'" :color="approval.status === 'approved' ? 'success' : approval.status === 'rejected' ? 'error' : 'warning'"/><div><strong>{{ approval.schedule_name || approval.entity_type }}</strong><span>{{ approval.status }} · requested by {{ approval.requester_name || 'system' }}</span><small>{{ approval.notes }}</small></div><v-btn v-if="approval.status === 'pending'" size="small" class="glass-button" @click="open(approval)">Review</v-btn><v-chip v-else size="x-small" :color="approval.status === 'approved' ? 'success' : 'error'" variant="tonal">{{ approval.status }}</v-chip></article><p v-if="!approvals.length" class="empty-state">No approval requests have been queued.</p></div></NeonPanel><FloatingWindow v-model="detailWindow" title="Review Run Approval" :width="560" :start-x="380" :start-y="120"><div v-if="selected" class="review"><p class="section-eyebrow">Scheduled Execution Gate</p><h3>{{ selected.schedule_name }}</h3><p>Approve to dispatch this queued schedule immediately. Rejecting records the decision and prevents this occurrence from running.</p><v-textarea v-model="notes" label="Decision notes" rows="3"/><div class="actions"><v-btn variant="text" @click="detailWindow = false">Close</v-btn><v-btn color="error" variant="text" :loading="working" @click="decide('rejected')">Reject</v-btn><v-btn class="glass-button" :loading="working" @click="decide('approved')">Approve And Run</v-btn></div></div></FloatingWindow></div></template>
<style scoped>.approval-workspace,.approval-list,.review{display:grid;gap:14px}.approval-list{padding:14px}.approval-card{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;padding:12px;border:1px solid var(--line);background:rgba(40,211,255,.04)}.approval-card.pending{border-left:2px solid var(--amber)}.approval-card div{display:grid;gap:3px}.approval-card span,.approval-card small,.review p,.empty-state{color:var(--muted);font-size:.76rem}.approval-card strong,.review h3{margin:0}.actions{display:flex;justify-content:flex-end;gap:8px}</style>
