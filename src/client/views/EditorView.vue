<script setup>
import { computed, reactive, ref, watch } from 'vue'
import FloatingWindow from '../components/common/FloatingWindow.vue'
import NeonPanel from '../components/common/NeonPanel.vue'
import ScriptEditor from '../components/script/ScriptEditor.vue'
import ScriptLibraryTree from '../components/script/ScriptLibraryTree.vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()

const explorerOpen = ref(false)
const propertiesOpen = ref(false)
const versionsOpen = ref(false)
const releasesOpen = ref(false)
const validation = ref(null)
const selectedId = ref('')
const loadedRevision = ref('')
const previewOpen = ref(false)
const preview = ref(null)
const fileInput = ref(null)
const parameterSchemaText = ref('[]')
const releases = ref([])
const releaseError = ref('')
const reviewNotes = ref('')
const releaseDraft = reactive({ version: '', changeTicket: '', environmentId: '', requiredReviewerIds: [] })

const draft = reactive({
  id: '',
  parentId: '',
  type: 'script',
  name: '',
  scope: 'personal',
  content: "Write-Output 'Hello from POSHinit'",
  language: 'powershell',
  notes: '',
  isPublished: false,
  assetPath: '',
  parameterSchema: [],
  lifecycleState: 'draft',
  releaseVersion: '',
  environmentId: '',
})

const libraryEntries = computed(() => store.catalog.library || [])
const scriptVersions = ref([])
const selectedEntry = computed(() => libraryEntries.value.find((entry) => entry.id === selectedId.value))

watch(
  selectedEntry,
  (entry) => {
    if (!entry) {
      return
    }

    Object.assign(draft, {
      id: entry.id,
      parentId: entry.parent_id || '',
      type: entry.type,
      name: entry.name,
      scope: entry.scope,
      content: entry.content || '',
      language: entry.language || 'powershell',
      notes: entry.notes || '',
      isPublished: Boolean(entry.is_published),
      assetPath: entry.asset_path || '',
      parameterSchema: JSON.parse(entry.parameter_schema_json || '[]'),
      lifecycleState: entry.lifecycle_state || 'draft',
      releaseVersion: entry.release_version || '',
      environmentId: entry.environment_id || '',
    })
    parameterSchemaText.value = JSON.stringify(draft.parameterSchema, null, 2)
  },
  { immediate: true },
)

function selectEntry(entry) {
  selectedId.value = entry.id
  loadedRevision.value = ''
  propertiesOpen.value = true
}

function createEntry({ parentId, type }) {
  selectedId.value = ''
  loadedRevision.value = ''
  Object.assign(draft, {
    id: '',
    parentId: parentId || '',
    type,
    name: type === 'folder' ? 'New Folder' : 'New Script.ps1',
    scope: 'personal',
    content: type === 'script' ? "Write-Output 'Hello from POSHinit'" : '',
    notes: '',
    isPublished: false,
    assetPath: '',
    parameterSchema: [],
    lifecycleState: 'draft',
    releaseVersion: '',
    environmentId: store.activeScope.environmentId,
  })
  propertiesOpen.value = true
}

async function saveEntry() {
  try { draft.parameterSchema = JSON.parse(parameterSchemaText.value || '[]') } catch { throw new Error('Parameter schema must be valid JSON') }
  const saved = await store.saveLibraryEntry(draft)
  draft.lifecycleState = saved.lifecycle_state || 'draft'
  draft.releaseVersion = saved.release_version || ''
  loadedRevision.value = ''
}

async function deleteEntry(entryId) {
  await store.deleteLibraryEntry(entryId)
  if (selectedId.value === entryId) {
    createEntry({ parentId: '', type: 'script' })
  }
}

async function runValidation() {
  validation.value = await store.validateScript(draft.content)
  propertiesOpen.value = true
}

async function loadVersions() {
  if (!draft.id) {
    return
  }

  versionsOpen.value = true
  scriptVersions.value = await store.api(`/api/library/${draft.id}/versions`)
}

function loadRevision(version) {
  draft.content = version.content || ''
  validation.value = null
  loadedRevision.value = version.version_label
  versionsOpen.value = false
}

const releaseUsers = computed(() => (store.catalog.users || []).filter((user) => user.status === 'active' && user.id !== store.currentUser?.id))
const releaseStateColor = (state) => ({ released: 'success', approved: 'secondary', review: 'warning', deprecated: 'orange', retired: 'error' }[state] || 'default')

async function openReleases() {
  if (!draft.id || draft.type !== 'script') return
  releaseError.value = ''
  releaseDraft.environmentId = draft.environmentId || selectedEntry.value?.environment_id || store.activeScope.environmentId
  releaseDraft.version = draft.releaseVersion ? `${draft.releaseVersion.split('.').slice(0, 2).join('.')}.${Number(draft.releaseVersion.split('.')[2] || 0) + 1}` : '1.0.0'
  releaseDraft.changeTicket = draft.change_ticket || ''
  releaseDraft.requiredReviewerIds = []
  releases.value = await store.api(`/api/library/${draft.id}/releases`)
  releasesOpen.value = true
}

async function submitRelease() {
  try {
    releaseError.value = ''
    await store.api(`/api/library/${draft.id}/releases`, { method: 'POST', body: JSON.stringify(releaseDraft) })
    releases.value = await store.api(`/api/library/${draft.id}/releases`)
    await store.bootstrap()
    draft.lifecycleState = selectedEntry.value?.lifecycle_state || 'review'
  } catch (error) { releaseError.value = error.message }
}

async function decideRelease(release, decision) {
  try {
    releaseError.value = ''
    await store.api(`/api/library/releases/${release.id}/reviews`, { method: 'POST', body: JSON.stringify({ decision, notes: reviewNotes.value }) })
    reviewNotes.value = ''
    releases.value = await store.api(`/api/library/${draft.id}/releases`)
    await store.bootstrap()
  } catch (error) { releaseError.value = error.message }
}

async function transitionRelease(release, state) {
  try {
    releaseError.value = ''
    await store.api(`/api/library/releases/${release.id}/transition`, { method: 'POST', body: JSON.stringify({ state }) })
    releases.value = await store.api(`/api/library/${draft.id}/releases`)
    await store.bootstrap()
    draft.lifecycleState = selectedEntry.value?.lifecycle_state || state
    draft.releaseVersion = selectedEntry.value?.release_version || ''
  } catch (error) { releaseError.value = error.message }
}

function chooseImport() {
  fileInput.value?.click()
}

async function importFile(event) {
  const [file] = event.target.files || []
  if (!file) return
  const entry = await store.importLibraryFile(file, { parentId: draft.parentId, scope: draft.scope, isPublished: draft.isPublished })
  selectedId.value = entry.id
  event.target.value = ''
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

async function downloadEntry() {
  if (draft.id) downloadBlob(await store.downloadLibraryFile(draft.id), draft.name || 'library-export')
}

async function openPreview() {
  if (!draft.id) return
  const result = await store.previewLibraryFile(draft.id)
  if (result.kind === 'image') result.url = URL.createObjectURL(await store.readLibraryFile(draft.id))
  preview.value = result
  previewOpen.value = true
}
</script>

<template>
  <div class="page-grid">
    <input ref="fileInput" class="file-input" type="file" @change="importFile" />
    <div class="toolbar-row">
      <div>
        <p class="section-eyebrow">Script Studio</p>
        <h2 class="page-title">VSCode-style PowerShell editor with floating library explorer</h2>
      </div>
      <div class="chip-line">
        <v-btn class="glass-button" prepend-icon="mdi-folder-open-outline" @click="explorerOpen = true">Open Library</v-btn>
        <v-btn prepend-icon="mdi-tune-vertical" variant="text" @click="propertiesOpen = true">Properties</v-btn>
        <v-btn prepend-icon="mdi-file-compare" variant="text" @click="loadVersions">Version History</v-btn>
        <v-btn :disabled="!draft.id || draft.type !== 'script'" prepend-icon="mdi-rocket-launch-outline" variant="text" @click="openReleases">Release Control</v-btn>
        <v-btn prepend-icon="mdi-upload" variant="text" @click="chooseImport">Import File</v-btn>
        <v-btn :disabled="!draft.id" prepend-icon="mdi-eye-outline" variant="text" @click="openPreview">Preview</v-btn>
        <v-btn :disabled="!draft.id" prepend-icon="mdi-download" variant="text" @click="downloadEntry">Export</v-btn>
        <v-btn prepend-icon="mdi-check-decagram-outline" variant="text" @click="runValidation">Syntax Check</v-btn>
        <v-btn color="primary" prepend-icon="mdi-content-save-outline" @click="saveEntry">Save</v-btn>
      </div>
    </div>

    <NeonPanel subtitle="Script Studio" title="Script Authoring">
      <div v-if="draft.type === 'script' || draft.type === 'text'" class="editor-stage"><ScriptEditor v-model="draft.content" /></div>
      <div v-else class="asset-stage"><v-icon :icon="draft.type === 'image' ? 'mdi-image-outline' : draft.type === 'folder' ? 'mdi-folder-outline' : 'mdi-file-outline'" size="44" /><strong>{{ draft.name || 'Library item' }}</strong><span>{{ draft.assetPath ? 'Imported asset. Use Preview or Export from the command bar.' : 'Select or import a file to work with it here.' }}</span></div>
      <div v-if="loadedRevision" class="revision-loaded">
        <v-icon icon="mdi-history" />
        <span>{{ loadedRevision }} loaded into the draft. Save to make it the current revision.</span>
      </div>
      <div v-if="draft.type === 'script'" class="release-strip">
        <v-icon icon="mdi-source-branch" />
        <span>Lifecycle: <strong>{{ draft.lifecycleState }}</strong>{{ draft.releaseVersion ? ` · latest ${draft.releaseVersion}` : '' }}</span>
        <v-btn size="x-small" variant="text" @click="openReleases">Manage release</v-btn>
      </div>
    </NeonPanel>

    <FloatingWindow v-model="explorerOpen" title="Script Library" :width="380" :start-x="28" :start-y="132">
      <div class="toolbar-row mb-4">
        <v-btn size="small" class="glass-button" @click="createEntry({ parentId: '', type: 'script' })">New Script</v-btn>
        <v-btn size="small" variant="text" @click="createEntry({ parentId: '', type: 'folder' })">New Folder</v-btn>
      </div>
      <ScriptLibraryTree
        :entries="libraryEntries"
        :selected-id="selectedId"
        @select="selectEntry"
        @request-create="createEntry"
        @request-delete="deleteEntry"
      />
    </FloatingWindow>

    <FloatingWindow v-model="propertiesOpen" title="Script Properties" :width="400" :start-x="430" :start-y="132">
      <div class="editor-meta">
        <v-text-field v-model="draft.name" label="Name" />
        <v-select v-model="draft.type" :items="['script', 'folder', 'text', 'file', 'image']" label="Entry Type" />
        <v-select v-model="draft.scope" :items="['personal', 'shared']" label="Library Scope" />
        <v-switch v-model="draft.isPublished" color="secondary" label="Published to shared consumers" />
        <v-textarea v-model="draft.notes" label="Operational notes" rows="4" />
        <v-textarea v-if="draft.type === 'script'" v-model="parameterSchemaText" label="Parameter schema" hint='JSON array: [{"name":"ServerName","type":"string","required":true,"default":""}]' persistent-hint rows="6" />
        <div class="property-actions"><v-btn class="glass-button" prepend-icon="mdi-content-save-outline" @click="saveEntry">Save Properties</v-btn></div>
        <div v-if="validation" class="validation-block">
          <v-alert :type="validation.ok ? 'success' : 'warning'" variant="tonal">
            {{ validation.ok ? 'PowerShell parser did not detect syntax errors.' : 'Parser found one or more issues.' }}
          </v-alert>
          <article v-for="issue in validation.errors" :key="issue.Message" class="validation-item mono">{{ issue.Message }}</article>
        </div>
      </div>
    </FloatingWindow>

    <FloatingWindow v-model="versionsOpen" title="Revision History" :width="420" :start-x="438" :start-y="160">
      <div class="version-list">
        <article v-for="version in scriptVersions" :key="version.id" class="version-entry">
          <div class="version-header">
            <div><strong>{{ version.version_label }}</strong><span class="muted mono">{{ version.created_at }}</span></div>
            <v-btn size="x-small" variant="tonal" prepend-icon="mdi-file-restore-outline" @click="loadRevision(version)">Load Into Draft</v-btn>
          </div>
          <pre class="version-preview">{{ version.content }}</pre>
        </article>
        <p v-if="!scriptVersions.length" class="muted">No saved revisions are available for this entry.</p>
      </div>
    </FloatingWindow>
    <FloatingWindow v-model="releasesOpen" title="Runbook Release Control" :width="790" :start-x="250" :start-y="90">
      <div class="release-manager">
        <header class="release-heading"><div><p class="section-eyebrow">Signed Promotion Pipeline</p><h3>{{ draft.name }}</h3><span>Draft edits remain separate from immutable release artifacts.</span></div><v-chip :color="releaseStateColor(draft.lifecycleState)" size="small">{{ draft.lifecycleState }}</v-chip></header>
        <v-alert v-if="releaseError" type="error" density="compact" variant="tonal">{{ releaseError }}</v-alert>
        <form class="release-form" @submit.prevent="submitRelease">
          <v-text-field v-model="releaseDraft.version" label="Semantic version" hint="Example: 1.4.0" persistent-hint />
          <v-text-field v-model="releaseDraft.changeTicket" label="Change ticket" hint="Required by protected environments" persistent-hint />
          <v-text-field v-model="releaseDraft.environmentId" label="Target environment ID" hint="Release policy and reviewer gate apply here" persistent-hint />
          <v-select v-model="releaseDraft.requiredReviewerIds" :items="releaseUsers" item-title="email" item-value="id" label="Additional required reviewers" multiple chips clearable />
          <div class="release-submit"><span>Creates a SHA-256 artifact signed by this deployment.</span><v-btn class="glass-button" type="submit" prepend-icon="mdi-send-check-outline">Submit for review</v-btn></div>
        </form>
        <v-text-field v-model="reviewNotes" density="compact" label="Review note (used for approve/reject)" />
        <div class="release-list">
          <article v-for="release in releases" :key="release.id" class="release-entry">
            <div class="release-entry-head"><div><strong>v{{ release.version }}</strong><span>{{ release.environment_name || release.environment_id }} · {{ release.change_ticket || 'No change ticket' }}</span></div><div class="chip-line"><v-chip :color="releaseStateColor(release.state)" size="x-small">{{ release.state }}</v-chip><v-chip :color="release.artifactValid ? 'success' : 'error'" size="x-small">{{ release.artifactValid ? 'signature verified' : 'signature failed' }}</v-chip></div></div>
            <p class="artifact-hash mono">SHA-256 {{ release.artifact_hash }}</p>
            <p v-if="release.requiredReviewerIds.length" class="muted">Required: {{ release.requiredReviewerIds.length }} reviewer{{ release.requiredReviewerIds.length === 1 ? '' : 's' }} · {{ release.reviews.filter((review) => review.decision === 'approved').length }} approved</p>
            <div class="release-actions"><v-btn v-if="release.state === 'review' && release.requiredReviewerIds.includes(store.currentUser?.id)" size="x-small" color="success" variant="tonal" @click="decideRelease(release, 'approved')">Approve</v-btn><v-btn v-if="release.state === 'review' && release.requiredReviewerIds.includes(store.currentUser?.id)" size="x-small" color="error" variant="text" @click="decideRelease(release, 'rejected')">Reject</v-btn><v-btn v-if="release.state === 'approved'" size="x-small" color="secondary" variant="tonal" @click="transitionRelease(release, 'released')">Release</v-btn><v-btn v-if="release.state === 'released'" size="x-small" variant="text" @click="transitionRelease(release, 'deprecated')">Deprecate</v-btn><v-btn v-if="['released', 'deprecated'].includes(release.state)" size="x-small" color="error" variant="text" @click="transitionRelease(release, 'retired')">Retire</v-btn></div>
          </article>
          <p v-if="!releases.length" class="muted">No signed release artifacts yet. Save a draft, then submit the first release.</p>
        </div>
      </div>
    </FloatingWindow>
    <FloatingWindow v-model="previewOpen" :title="`Preview: ${preview?.name || ''}`" :width="680" :start-x="330" :start-y="120"><div v-if="preview" class="file-preview"><img v-if="preview.kind === 'image'" :src="preview.url" :alt="preview.name" /><pre v-else-if="preview.kind === 'text'">{{ preview.content || 'This file is empty.' }}</pre><div v-else class="asset-stage"><v-icon icon="mdi-file-question-outline" size="42" /><span>This file cannot be previewed safely. Export it to inspect it locally.</span></div></div></FloatingWindow>
  </div>
</template>

<style scoped>
.page-title {
  margin: 4px 0 0;
}

.editor-stage { padding: 14px; }
.asset-stage { display:grid; min-height:520px; place-items:center; align-content:center; gap:12px; padding:24px; color:var(--muted); text-align:center; border:1px dashed var(--line); }.asset-stage strong { color:var(--text); }.file-input { display:none; }.file-preview { display:grid; max-height:62vh; overflow:auto; }.file-preview img { max-width:100%; max-height:56vh; margin:auto; }.file-preview pre { margin:0; padding:14px; white-space:pre-wrap; overflow-wrap:anywhere; color:#9fd7ff; background:rgba(3,6,14,.78); font:12px 'Azeret Mono',monospace; }

.revision-loaded {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 14px 14px;
  padding: 10px 12px;
  border: 1px solid rgba(40, 211, 255, .28);
  border-radius: 12px;
  background: rgba(40, 211, 255, .07);
  color: #9fd7ff;
  font-size: .78rem;
}

.release-strip { display:flex; align-items:center; gap:8px; margin:0 14px 14px; padding:9px 12px; border:1px solid rgba(93,220,175,.25); background:rgba(93,220,175,.06); color:var(--muted); font-size:.76rem; }.release-strip strong { color:#9ceccc; text-transform:uppercase; }.release-strip .v-btn { margin-left:auto; }
.release-manager { display:grid; gap:14px; }.release-heading,.release-entry-head,.release-submit,.release-actions { display:flex; align-items:center; justify-content:space-between; gap:12px; }.release-heading h3 { margin:3px 0; }.release-heading span,.release-submit span,.release-entry-head span { color:var(--muted); font-size:.76rem; }.release-heading > div,.release-entry-head > div:first-child { display:grid; gap:3px; }.release-form { display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:14px; border:1px solid rgba(40,211,255,.23); background:linear-gradient(135deg,rgba(40,211,255,.07),rgba(190,77,255,.05)); }.release-submit { grid-column:1 / -1; }.release-list { display:grid; gap:10px; max-height:42vh; overflow:auto; }.release-entry { display:grid; gap:8px; padding:12px; border:1px solid var(--line); background:rgba(5,11,21,.68); }.artifact-hash { margin:0; overflow-wrap:anywhere; color:#9fd7ff; font-size:.69rem; }.release-entry .muted { margin:0; font-size:.74rem; }.release-actions { justify-content:flex-start; }

.editor-meta {
  display: grid;
  gap: 12px;
}

.property-actions { display: flex; justify-content: flex-end; padding-top: 2px; }

.validation-block {
  display: grid;
  gap: 10px;
}

.validation-item {
  padding: 12px;
  border-radius: 2px;
  background: rgba(255, 181, 46, .08);
  border: 1px solid rgba(255, 181, 46, .2);
  color: #ffd799;
  overflow-wrap: anywhere;
}

.version-list {
  display: grid;
  gap: 12px;
}

.version-entry {
  display: grid;
  gap: 8px;
  padding: 12px;
  border-radius: 16px;
  background: rgba(70, 118, 215, 0.08);
}

.version-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.version-header > div {
  display: grid;
  gap: 3px;
}

.version-preview {
  margin: 0;
  max-height: 140px;
  overflow: auto;
  padding: 10px;
  border-radius: 12px;
  background: rgba(3, 6, 14, 0.78);
  color: #9fd7ff;
  font-family: 'Azeret Mono', monospace;
  font-size: 0.8rem;
}

@media (max-width: 520px) {
  .version-header {
    align-items: stretch;
    flex-direction: column;
  }
  .release-form { grid-template-columns:1fr; }.release-submit,.release-heading { align-items:flex-start; flex-direction:column; }
}

</style>
