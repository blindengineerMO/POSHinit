<script setup>
import { computed, reactive, ref } from 'vue'
import DataTable from '../components/common/DataTable.vue'
import FloatingWindow from '../components/common/FloatingWindow.vue'
import NeonPanel from '../components/common/NeonPanel.vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const editorOpen = ref(false)
const credentialTypes = [
  { title: 'Username / password', value: 'username_password' },
  { title: 'Username / password / domain (LDAP / AD)', value: 'domain_password' },
  { title: 'Token (string)', value: 'token' },
]
const transportOptions = [
  { title: 'PowerShell Remoting (recommended)', value: 'psremoting' },
  { title: 'SSH', value: 'ssh' },
  { title: 'Local host', value: 'local' },
]
const emptyDraft = () => ({
  name: '',
  scope: 'personal',
  secretType: 'username_password',
  username: '',
  domainName: '',
  protocol: 'psremoting',
  secret: '',
  teamIds: [],
  notes: '',
})
const credentialDraft = reactive(emptyDraft())
const teams = computed(() => store.catalog.teams || [])
const secretLabel = computed(() => (credentialDraft.secretType === 'token' ? 'Token value' : 'Password'))
const templateExample = computed(() => {
  const name = credentialDraft.name.trim() || 'credential-name'
  const property = credentialDraft.secretType === 'token' ? 'token' : 'password'
  return `{{secret:${name}.${property}}}`
})

function resetDraft() {
  Object.assign(credentialDraft, emptyDraft())
}

function closeEditor() {
  editorOpen.value = false
  resetDraft()
}

async function saveCredential() {
  await store.saveCredential(credentialDraft)
  closeEditor()
}
</script>

<template>
  <div class="vault-workspace">
    <div class="toolbar-row commandbar">
      <div>
        <p class="section-eyebrow">Security Boundary</p>
        <h2 class="page-title">Secret Vault</h2>
      </div>
      <div class="chip-line">
        <v-chip color="secondary" variant="tonal">AES-256-GCM</v-chip>
        <v-btn class="glass-button" prepend-icon="mdi-key-plus" @click="editorOpen = true">Store Secret</v-btn>
      </div>
    </div>

    <div class="vault-metrics">
      <article><v-icon icon="mdi-key-variant" /><strong>{{ store.catalog.credentials?.length || 0 }}</strong><span>accessible secrets</span></article>
      <article><v-icon icon="mdi-account-group-outline" /><strong>{{ teams.length }}</strong><span>sharing boundaries</span></article>
      <article><v-icon icon="mdi-lock-check-outline" /><strong>SEALED</strong><span>runtime encryption state</span></article>
    </div>

    <NeonPanel subtitle="Credential Registry" title="Accessible Secrets">
      <template #actions><v-btn size="small" variant="text" prepend-icon="mdi-filter-variant">Filter</v-btn></template>
      <div class="table-pad">
        <DataTable
          :items="store.catalog.credentials || []"
          :columns="[
            { key: 'name', label: 'Secret' },
            { key: 'secretType', label: 'Type' },
            { key: 'scope', label: 'Scope' },
            { key: 'username', label: 'Principal' },
            { key: 'protocol', label: 'Transport' },
            { key: 'notes', label: 'Notes' },
          ]"
        />
      </div>
    </NeonPanel>

    <FloatingWindow v-model="editorOpen" title="Store Secret" :width="650" :start-x="220" :start-y="110">
      <form class="window-form two-col" @submit.prevent="saveCredential">
        <v-text-field v-model="credentialDraft.name" label="Secret name" hint="Used by the script template" persistent-hint class="full" />
        <v-select v-model="credentialDraft.secretType" :items="credentialTypes" label="Secret type" class="full" />
        <v-select v-model="credentialDraft.scope" :items="['personal', 'shared']" label="Visibility" />
        <v-select
          v-if="credentialDraft.secretType !== 'token'"
          v-model="credentialDraft.protocol"
          :items="transportOptions"
          label="Machine transport"
        />
        <div v-else class="field-note"><v-icon icon="mdi-code-braces" /> Script injection only</div>
        <v-text-field v-if="credentialDraft.secretType !== 'token'" v-model="credentialDraft.username" label="Username" />
        <v-text-field v-if="credentialDraft.secretType === 'domain_password'" v-model="credentialDraft.domainName" label="Domain / LDAP realm" />
        <v-text-field v-model="credentialDraft.secret" type="password" :label="secretLabel" class="full" />
        <v-alert v-if="credentialDraft.protocol === 'psremoting' && credentialDraft.secretType !== 'token'" type="info" variant="tonal" density="compact" class="full">
          Use a Windows or domain principal. The target must have PS Remoting and WinRM enabled.
        </v-alert>
        <v-select v-if="credentialDraft.scope === 'shared'" v-model="credentialDraft.teamIds" :items="teams" item-title="name" item-value="id" label="Authorized teams" multiple chips class="full" />
        <v-textarea v-model="credentialDraft.notes" label="Operator notes" rows="3" class="full" />

        <section class="template-guide full">
          <p class="section-eyebrow">Script Template</p>
          <code>{{ templateExample }}</code>
          <span>Templates are resolved in memory immediately before a run. Use <b>.username</b>, <b>.password</b>, and <b>.domain</b> for credentials, or <b>.token</b> for token secrets.</span>
        </section>

        <div class="actions full">
          <v-btn variant="text" @click="closeEditor">Cancel</v-btn>
          <v-btn class="glass-button" type="submit">Seal Secret</v-btn>
        </div>
      </form>
    </FloatingWindow>
  </div>
</template>

<style scoped>
.vault-workspace { display: grid; gap: 14px; }
.commandbar { padding: 2px 0 4px; }
.vault-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.vault-metrics article { display: grid; grid-template-columns: 30px 1fr; column-gap: 10px; align-items: center; padding: 13px; border: 1px solid var(--line); background: linear-gradient(135deg, rgba(87, 27, 126, .78), rgba(32, 8, 58, .8)); }
.vault-metrics .v-icon { grid-row: span 2; color: var(--amber); }
.vault-metrics strong { font-family: 'Share Tech Mono', monospace; font-size: 1.2rem; }
.vault-metrics span { color: var(--muted); font-size: .72rem; }
.table-pad { padding: 14px 16px 16px; }
.window-form { display: grid; gap: 12px; }
.two-col { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.full { grid-column: 1 / -1; }
.field-note { display: flex; align-items: center; gap: 8px; min-height: 56px; padding: 0 12px; border: 1px dashed var(--line); color: var(--muted); font-size: .83rem; }
.field-note .v-icon { color: var(--cyan); }
.template-guide { display: grid; gap: 7px; padding: 13px; border: 1px solid rgba(70, 214, 255, .3); background: rgba(8, 32, 48, .48); }
.template-guide p { margin: 0; }
.template-guide code { width: fit-content; color: var(--cyan); font-family: 'Share Tech Mono', monospace; font-size: .85rem; }
.template-guide span { color: var(--muted); font-size: .78rem; line-height: 1.5; }
.template-guide b { color: var(--text); font-family: 'Share Tech Mono', monospace; font-weight: 400; }
.actions { display: flex; justify-content: flex-end; gap: 8px; }
@media (max-width: 620px) { .vault-metrics, .two-col { grid-template-columns: 1fr; } .full { grid-column: auto; } }
</style>
