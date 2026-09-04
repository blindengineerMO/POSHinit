<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  entries: {
    type: Array,
    default: () => [],
  },
  selectedId: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['select', 'requestCreate', 'requestDelete'])

const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  entryId: null,
})

const flatEntries = computed(() => {
  const byParent = new Map()
  props.entries.forEach((entry) => {
    const parentId = entry.parent_id || null
    if (!byParent.has(parentId)) {
      byParent.set(parentId, [])
    }
    byParent.get(parentId).push(entry)
  })

  byParent.forEach((items) => {
    items.sort((left, right) => left.name.localeCompare(right.name))
  })

  const results = []
  function walk(parentId = null, depth = 0) {
    for (const entry of byParent.get(parentId) || []) {
      results.push({ ...entry, depth })
      walk(entry.id, depth + 1)
    }
  }

  walk()
  return results
})

function onContext(event, entryId) {
  event.preventDefault()
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    entryId,
  }
}

function requestCreate(type) {
  emit('requestCreate', {
    parentId: contextMenu.value.entryId,
    type,
  })
  contextMenu.value.visible = false
}

function requestDelete() {
  if (contextMenu.value.entryId) {
    emit('requestDelete', contextMenu.value.entryId)
  }
  contextMenu.value.visible = false
}
</script>

<template>
  <div class="tree-wrap" @click="contextMenu.visible = false">
    <button
      v-for="entry in flatEntries"
      :key="entry.id"
      class="tree-row"
      :class="{ active: selectedId === entry.id }"
      :style="{ paddingLeft: `${14 + entry.depth * 18}px` }"
      type="button"
      @click="$emit('select', entry)"
      @contextmenu="onContext($event, entry.id)"
    >
      <v-icon :icon="entry.type === 'folder' ? 'mdi-folder-outline' : entry.type === 'image' ? 'mdi-image-outline' : 'mdi-script-text-outline'" size="18" />
      <span>{{ entry.name }}</span>
      <small class="mono">{{ entry.scope }}</small>
    </button>

    <div v-if="contextMenu.visible" class="context-menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }">
      <button type="button" @click="requestCreate('folder')">New folder</button>
      <button type="button" @click="requestCreate('script')">New script</button>
      <button type="button" @click="requestDelete">Delete</button>
    </div>
  </div>
</template>

<style scoped>
.tree-wrap {
  position: relative;
  display: grid;
  gap: 6px;
}

.tree-row {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.tree-row.active,
.tree-row:hover {
  background: linear-gradient(90deg, rgba(74, 203, 255, 0.12), rgba(140, 99, 255, 0.12));
  border-color: rgba(148, 208, 255, 0.16);
}

small {
  color: #9ab6e9;
}

.context-menu {
  position: fixed;
  z-index: 70;
  display: grid;
  min-width: 160px;
  padding: 8px;
  border-radius: 14px;
  border: 1px solid rgba(147, 202, 255, 0.16);
  background: rgba(8, 13, 29, 0.96);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
}

.context-menu button {
  border: 0;
  padding: 10px 12px;
  border-radius: 10px;
  text-align: left;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.context-menu button:hover {
  background: rgba(80, 192, 255, 0.12);
}
</style>
