<script setup>
import { reactive } from 'vue'
import { GridItem, GridLayout } from 'grid-layout-plus'
import NeonPanel from '../common/NeonPanel.vue'

defineProps({
  dashboard: {
    type: Object,
    required: true,
  },
})

const layout = reactive([
  { x: 0, y: 0, w: 4, h: 3, i: 'recent' },
  { x: 4, y: 0, w: 4, h: 3, i: 'schedules' },
  { x: 8, y: 0, w: 4, h: 3, i: 'health' },
])
</script>

<template>
  <GridLayout
    v-model:layout="layout"
    :col-num="12"
    :row-height="82"
    :is-draggable="true"
    :is-resizable="true"
    :margin="[12, 12]"
    use-css-transforms
  >
    <GridItem v-for="item in layout" :key="item.i" v-bind="item" class="grid-item">
      <NeonPanel
        :title="item.i === 'recent' ? 'Recent Executions' : item.i === 'schedules' ? 'Upcoming Schedules' : 'Machine Health'"
        subtitle="Drag And Resize"
        class="widget-panel"
      >
        <div v-if="item.i === 'recent'" class="widget-list">
          <article v-for="run in dashboard.recentExecutions" :key="run.id" class="widget-entry">
            <strong>{{ run.script_name }}</strong>
            <span class="muted">{{ run.machine_name }}</span>
            <v-chip size="small" :color="run.status === 'success' ? 'success' : 'error'" variant="tonal">{{ run.status }}</v-chip>
          </article>
        </div>

        <div v-else-if="item.i === 'schedules'" class="widget-list">
          <article v-for="schedule in dashboard.upcomingSchedules" :key="schedule.id" class="widget-entry">
            <strong>{{ schedule.name }}</strong>
            <span class="mono">{{ schedule.cron_expression || schedule.next_run_at }}</span>
            <span class="muted">{{ schedule.next_run_at || 'Pending' }}</span>
          </article>
        </div>

        <div v-else class="widget-list">
          <article v-for="machine in dashboard.machineHealth" :key="machine.id" class="widget-entry">
            <strong>{{ machine.name }}</strong>
            <span class="muted">{{ machine.os_family }} / {{ machine.transport }}</span>
            <v-chip size="small" :color="machine.last_test_status === 'success' ? 'success' : 'warning'" variant="tonal">
              {{ machine.last_test_status || 'unknown' }}
            </v-chip>
          </article>
        </div>
      </NeonPanel>
    </GridItem>
  </GridLayout>
</template>

<style scoped>
.grid-item,
.widget-panel {
  height: 100%;
}

.widget-panel :deep(.panel) {
  height: 100%;
}

.widget-list {
  display: grid;
  gap: 10px;
  padding: 12px 14px 14px;
}

.widget-entry {
  display: grid;
  gap: 4px;
  padding: 10px 11px;
  border-radius: 2px;
  background: rgba(20, 75, 92, .18);
  border: 1px solid rgba(40, 211, 255, .12);
  font-size: .78rem;
}
</style>
