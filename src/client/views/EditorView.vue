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
    })
  },
  { immediate: true },
)

function selectEntry(entry) {
  selectedId.value = entry.id
  propertiesOpen.value = true
}

function createEntry({ parentId, type }) {
  selectedId.value = ''
  Object.assign(draft, {
    id: '',
    parentId: parentId || '',
    type,
    name: type === 'folder' ? 'New Folder' : 'New Script.ps1',
    scope: 'personal',
    content: type === 'script' ? "Write-Output 'Hello from POSHinit'" : '',
    notes: '',
    isPublished: false,
  })
  propertiesOpen.value = true
}

async function saveEntry() {
  await store.saveLibraryEntry(draft)
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
</script>

<template>
  <div class="page-grid">
    <div class="toolbar-row">
      <div>
        <p class="section-eyebrow">Monaco Workspace</p>
        <h2 class="page-title">VSCode-style PowerShell editor with floating library explorer</h2>
      </div>
      <div class="chip-line">
        <v-btn class="glass-button" prepend-icon="mdi-folder-open-outline" @click="explorerOpen = true">Open Library</v-btn>
        <v-btn prepend-icon="mdi-tune-vertical" variant="text" @click="propertiesOpen = true">Properties</v-btn>
        <v-btn prepend-icon="mdi-file-compare" variant="text" @click="loadVersions">Version History</v-btn>
        <v-btn prepend-icon="mdi-check-decagram-outline" variant="text" @click="runValidation">Syntax Check</v-btn>
        <v-btn color="primary" prepend-icon="mdi-content-save-outline" @click="saveEntry">Save</v-btn>
      </div>
    </div>

    <NeonPanel subtitle="Editor Surface" title="Script Authoring">
      <div class="editor-stage"><ScriptEditor v-model="draft.content" /></div>
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
        <v-select v-model="draft.type" :items="['script', 'folder', 'text']" label="Entry Type" />
        <v-select v-model="draft.scope" :items="['personal', 'shared']" label="Library Scope" />
        <v-switch v-model="draft.isPublished" color="secondary" label="Published to shared consumers" />
        <v-textarea v-model="draft.notes" label="Operational notes" rows="4" />
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
          <strong>{{ version.version_label }}</strong>
          <span class="muted mono">{{ version.created_at }}</span>
          <pre class="version-preview">{{ version.content }}</pre>
        </article>
      </div>
    </FloatingWindow>
  </div>
</template>

<style scoped>
.page-title {
  margin: 4px 0 0;
}

.editor-stage { padding: 14px; }

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

</style>
