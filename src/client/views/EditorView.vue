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
const validation = ref(null)
const selectedId = ref('')
const loadedRevision = ref('')
const previewOpen = ref(false)
const preview = ref(null)
const fileInput = ref(null)
const parameterSchemaText = ref('[]')

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
  })
  propertiesOpen.value = true
}

async function saveEntry() {
  try { draft.parameterSchema = JSON.parse(parameterSchemaText.value || '[]') } catch { throw new Error('Parameter schema must be valid JSON') }
  await store.saveLibraryEntry(draft)
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
}

</style>
