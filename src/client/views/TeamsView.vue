<script setup>
import { reactive, ref } from 'vue'
import DataTable from '../components/common/DataTable.vue'
import FloatingWindow from '../components/common/FloatingWindow.vue'
import NeonPanel from '../components/common/NeonPanel.vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const userWindow = ref(false)
const teamWindow = ref(false)
const userDraft = reactive({ id: '', name: '', email: '', role: 'operator', status: 'active', password: '', entraEnabled: false, entraEmail: '' })
const teamDraft = reactive({ name: '', description: '', memberIds: [] })

function createUser() {
  Object.assign(userDraft, { id: '', name: '', email: '', role: 'operator', status: 'active', password: '', entraEnabled: false, entraEmail: '' })
  userWindow.value = true
}

function editUser(user) {
  Object.assign(userDraft, { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status, password: '', entraEnabled: user.entraEnabled, entraEmail: user.entraEmail || '' })
  userWindow.value = true
}

async function saveUser() {
  await store.saveUser(userDraft)
  userWindow.value = false
}

async function saveTeam() {
  await store.saveTeam(teamDraft)
  teamWindow.value = false
}
</script>

<template>
  <div class="access-workspace">
    <div class="toolbar-row commandbar"><div><p class="section-eyebrow">Governance</p><h2 class="page-title">Access Control</h2></div><div class="chip-line"><v-btn variant="text" prepend-icon="mdi-account-group-outline" @click="teamWindow = true">Create Team</v-btn><v-btn class="glass-button" prepend-icon="mdi-account-plus-outline" @click="createUser">Add User</v-btn></div></div>
    <section class="access-banner"><div><p class="section-eyebrow">Identity Plane</p><strong>{{ store.catalog.users?.length || 0 }} operators / {{ store.catalog.teams?.length || 0 }} access groups</strong></div><span>Enterprise users are explicitly linked to a local operator record before Entra ID can grant access to automation resources.</span></section>
    <div class="content-grid">
      <NeonPanel class="span-7" subtitle="Operator Directory" title="Registered Users"><div class="table-pad"><DataTable :items="store.catalog.users || []" :columns="[{ key: 'name', label: 'Name' }, { key: 'email', label: 'Local identity' }, { key: 'entraEnabled', label: 'Enterprise' }, { key: 'role', label: 'Role' }, { key: 'status', label: 'State' }]"><template #name="{ row }"><button class="user-link" type="button" @click="editUser(row)">{{ row.name }}</button></template><template #entraEnabled="{ row }"><v-chip size="x-small" :color="row.entraEnabled ? 'secondary' : undefined" variant="tonal">{{ row.entraEnabled ? row.entraEmail : 'Local only' }}</v-chip></template></DataTable></div></NeonPanel>
      <NeonPanel class="span-5" subtitle="Group Registry" title="Access Teams"><div class="team-list"><article v-for="team in store.catalog.teams" :key="team.id"><v-icon icon="mdi-account-group-outline" /><div><strong>{{ team.name }}</strong><span>{{ team.description || 'No description' }}</span></div><v-chip variant="outlined">{{ team.memberIds?.length || 0 }} members</v-chip></article></div></NeonPanel>
    </div>
    <FloatingWindow v-model="userWindow" :title="userDraft.id ? 'Edit Operator' : 'Add Operator'" :width="500" :start-x="200" :start-y="110"><form class="window-form" @submit.prevent="saveUser"><v-text-field v-model="userDraft.name" label="Name"/><v-text-field v-model="userDraft.email" label="Local sign-in email" type="email"/><div class="two"><v-select v-model="userDraft.role" :items="['admin', 'operator', 'approver', 'viewer']" label="Role"/><v-select v-model="userDraft.status" :items="['active', 'disabled']" label="State"/></div><v-text-field v-model="userDraft.password" :label="userDraft.id ? 'Set new local password (optional)' : 'Temporary local password'" type="password"/><section class="entra-link"><div><p class="section-eyebrow">Enterprise Identity</p><strong>Microsoft Entra ID</strong></div><v-switch v-model="userDraft.entraEnabled" color="secondary" density="compact" hide-details label="Allow enterprise sign-in"/></section><v-text-field v-if="userDraft.entraEnabled" v-model="userDraft.entraEmail" label="Entra ID logon email" type="email" hint="Must match the email or UPN returned by Entra ID." persistent-hint/><v-alert v-if="userDraft.entraEnabled" type="info" variant="tonal" density="compact">Entra ID authentication, including MFA and Conditional Access, is enforced by your tenant’s policy.</v-alert><div class="actions"><v-btn variant="text" @click="userWindow = false">Cancel</v-btn><v-btn class="glass-button" type="submit">{{ userDraft.id ? 'Save Operator' : 'Create Operator' }}</v-btn></div></form></FloatingWindow>
    <FloatingWindow v-model="teamWindow" title="Create Access Team" :width="480" :start-x="490" :start-y="130"><div class="window-form"><v-text-field v-model="teamDraft.name" label="Team name"/><v-textarea v-model="teamDraft.description" label="Operational purpose" rows="3"/><v-select v-model="teamDraft.memberIds" :items="store.catalog.users" item-title="name" item-value="id" label="Members" multiple chips/><div class="actions"><v-btn variant="text" @click="teamWindow = false">Cancel</v-btn><v-btn class="glass-button" @click="saveTeam">Create Team</v-btn></div></div></FloatingWindow>
  </div>
</template>

<style scoped>
.access-workspace { display: grid; gap: 14px; }.commandbar { padding: 2px 0 4px; }.access-banner { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 15px 18px; border: 1px solid var(--line-hot); background: linear-gradient(105deg, rgba(146, 57, 185, .42), rgba(44, 10, 74, .75)); }.access-banner strong { display: block; margin-top: 4px; color: var(--cyan); font-family: 'Share Tech Mono', monospace; }.access-banner > span { max-width: 53ch; color: var(--muted); font-size: .78rem; }.table-pad { padding: 14px 16px 16px; }.team-list { display: grid; gap: 7px; padding: 14px; }.team-list article { display: grid; grid-template-columns: 22px 1fr auto; gap: 9px; align-items: center; padding: 10px; border: 1px solid var(--line); background: rgba(210, 90, 255, .05); }.team-list .v-icon { color: var(--amber); }.team-list div { display: grid; gap: 2px; }.team-list span { color: var(--muted); font-size: .72rem; }.window-form { display: grid; gap: 12px; }.two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }.actions { display: flex; justify-content: flex-end; gap: 8px; }.user-link { padding: 0; border: 0; background: transparent; color: var(--cyan); cursor: pointer; font: inherit; }.entra-link { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--line); background: rgba(40, 211, 255, .04); }.entra-link p, .entra-link strong { margin: 0; }.entra-link strong { font-size: .84rem; } @media (max-width: 700px) { .access-banner, .two { display: grid; grid-template-columns: 1fr; }.access-banner > span { max-width: none; }.entra-link { align-items: flex-start; flex-direction: column; } }
</style>
