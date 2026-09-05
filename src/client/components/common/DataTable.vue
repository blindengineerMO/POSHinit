<script setup>
import { computed, ref, watch } from 'vue'

const emit = defineEmits(['row-click'])

const props = defineProps({
  title: {
    type: String,
    default: '',
  },
  items: {
    type: Array,
    default: () => [],
  },
  columns: {
    type: Array,
    default: () => [],
  },
  pageSize: {
    type: Number,
    default: 8,
  },
  clickable: {
    type: Boolean,
    default: false,
  },
})

const page = ref(1)
const query = ref('')
const sortKey = ref(props.columns[0]?.key || '')
const sortDirection = ref('asc')

watch(
  () => props.items,
  () => {
    page.value = 1
  },
)

const filteredRows = computed(() => {
  const needle = query.value.trim().toLowerCase()
  const rows = !needle
    ? props.items
    : props.items.filter((item) =>
        props.columns.some((column) =>
          String(item[column.key] ?? '')
            .toLowerCase()
            .includes(needle),
        ),
      )

  return [...rows].sort((left, right) => {
    const leftValue = String(left[sortKey.value] ?? '')
    const rightValue = String(right[sortKey.value] ?? '')
    const result = leftValue.localeCompare(rightValue, undefined, { numeric: true })
    return sortDirection.value === 'asc' ? result : -result
  })
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / props.pageSize)))
const pagedRows = computed(() => {
  const start = (page.value - 1) * props.pageSize
  return filteredRows.value.slice(start, start + props.pageSize)
})

function toggleSort(columnKey) {
  if (sortKey.value === columnKey) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
    return
  }

  sortKey.value = columnKey
  sortDirection.value = 'asc'
}
</script>

<template>
  <div>
    <div class="toolbar-row table-head">
      <div>
        <h3 v-if="title">{{ title }}</h3>
        <p class="muted">{{ filteredRows.length }} records</p>
      </div>
      <v-text-field
        v-model="query"
        prepend-inner-icon="mdi-magnify"
        hide-details
        density="compact"
        label="Search"
        class="table-search"
      />
    </div>

    <div class="table-wrap">
      <table class="app-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column.key">
              <button class="sort-button mono" type="button" @click="toggleSort(column.key)">
                {{ column.label }}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in pagedRows" :key="row.id || row.name" :class="{ 'clickable-row': clickable }" @click="emit('row-click', row)">
            <td v-for="column in columns" :key="column.key">
              <slot :name="column.key" :row="row">
                {{ row[column.key] }}
              </slot>
            </td>
          </tr>
          <tr v-if="!pagedRows.length">
            <td :colspan="columns.length" class="muted empty-state">No matching records.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="pager mono">
      <span>Page {{ page }} / {{ totalPages }}</span>
      <div class="pager-actions">
        <v-btn size="small" variant="text" :disabled="page <= 1" @click="page -= 1">Prev</v-btn>
        <v-btn size="small" variant="text" :disabled="page >= totalPages" @click="page += 1">Next</v-btn>
      </div>
    </div>
  </div>
</template>

<style scoped>
h3 {
  margin: 0;
}

.table-head {
  margin-bottom: 10px;
}

.table-search {
  max-width: 240px;
}

.table-wrap {
  overflow: auto;
  border: 1px solid rgba(40, 211, 255, .1);
  background: rgba(3, 10, 15, .3);
}

.sort-button {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.pager {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  color: var(--muted);
  font-size: .72rem;
}

.pager-actions {
  display: flex;
  gap: 8px;
}

.empty-state {
  text-align: center;
  padding: 28px 12px;
}

.clickable-row { cursor: pointer; }
.clickable-row:hover td { background: rgba(40, 211, 255, .06); }
</style>
