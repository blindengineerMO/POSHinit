<script setup>
import { computed, onMounted, ref } from 'vue'
import NeonPanel from '../components/common/NeonPanel.vue'
import FloatingWindow from '../components/common/FloatingWindow.vue'
import OperationsChart from '../components/dashboard/OperationsChart.vue'
import WidgetBoard from '../components/dashboard/WidgetBoard.vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const recommendations = ref([])
const recommendationsOpen = ref(false)
const aiPreview = ref(null)
const confirmationNote = ref('')
async function refreshRecommendations() { recommendations.value = await store.recommendations() }
async function previewAi(recommendation) { aiPreview.value = await store.recommendationAiPreview(recommendation.id) }
async function confirm(recommendation) { await store.confirmRecommendation(recommendation.id, confirmationNote.value); confirmationNote.value = ''; await refreshRecommendations() }
onMounted(refreshRecommendations)

const metrics = computed(() => [
  { label: 'Scripts', value: store.dashboard.counts.scripts || 0, icon: 'mdi-script-text-outline' },
  { label: 'Machines', value: store.dashboard.counts.machines || 0, icon: 'mdi-server-network-outline' },
  { label: 'Schedules', value: store.dashboard.counts.schedules || 0, icon: 'mdi-calendar-clock-outline' },
  { label: 'Failures', value: store.dashboard.counts.failures || 0, icon: 'mdi-alert-octagon-outline' },
])

const marketComparableFeatures = [
  'Approval workflows and delegated self-service runbooks',
  'Reusable parameter forms and typed script inputs',
  'Script revision history with publish/release states',
  'Interactive remote shell and diagnostics replay',
  'Notification policies for failure, recovery, and audit export',
  'Role-based governance around shared credentials and schedules',
]
</script>

<template>
  <div class="page-grid">
    <NeonPanel subtitle="September 4, 2026 Build" title="PowerShell Operations Mission Deck">
      <div class="hero-body">
        <div>
          <p class="hero-copy">
            This foundation ships the full operator surface area: library, editor, scheduler, reporting, machine inventory, teams, vault, settings, logging, and webhook-triggered execution.
          </p>
          <div class="chip-line">
            <v-chip color="info" variant="tonal">API-first</v-chip>
            <v-chip color="secondary" variant="tonal">Vue + Vuetify</v-chip>
            <v-chip color="success" variant="tonal">PowerShell 7.5 ready</v-chip>
            <v-chip color="warning" variant="tonal">SQLite bootstrap</v-chip>
          </div>
        </div>
        <div class="metric-strip">
          <article v-for="metric in metrics" :key="metric.label" class="metric-card">
            <v-icon :icon="metric.icon" size="20" />
            <strong>{{ metric.value }}</strong>
            <span class="muted">{{ metric.label }}</span>
          </article>
        </div>
      </div>
    </NeonPanel>

    <div class="content-grid">
      <NeonPanel class="span-8" subtitle="Live Execution Signal" title="Automation Reliability"><template #actions><v-chip color="secondary" variant="tonal">last 8 runs</v-chip></template><OperationsChart :executions="store.dashboard.recentExecutions || []" /></NeonPanel>
      <NeonPanel class="span-4" subtitle="Signal Summary" title="Dispatch Health"><div class="health-stack"><div><span>SUCCESS RATE</span><strong>92%</strong></div><v-progress-linear :model-value="92" color="secondary" height="7" rounded="0" /><div><span>QUEUE DEPTH</span><strong>{{ store.dashboard.counts.schedules || 0 }}</strong></div><v-progress-linear :model-value="34" color="primary" height="7" rounded="0" /></div></NeonPanel>
    </div>

    <WidgetBoard :dashboard="store.dashboard" />

    <NeonPanel subtitle="Deterministic Guardrails" title="Operational Recommendations"><template #actions><v-btn size="small" class="glass-button" prepend-icon="mdi-lightbulb-on-outline" @click="recommendationsOpen = true">Review {{ recommendations.length }}</v-btn></template><div class="recommendation-strip"><article v-for="recommendation in recommendations.slice(0, 3)" :key="recommendation.id" :class="recommendation.severity"><v-icon :icon="recommendation.severity === 'high' ? 'mdi-alert-octagon-outline' : 'mdi-alert-outline'"/><div><strong>{{ recommendation.title }}</strong><span>{{ recommendation.summary }}</span></div></article><p v-if="!recommendations.length" class="muted">No deterministic operational risks are currently detected.</p></div></NeonPanel>

    <div class="content-grid">
      <NeonPanel class="span-6" subtitle="Research Additions" title="Market Comparable Features">
        <div class="list-block">
          <article v-for="feature in marketComparableFeatures" :key="feature" class="list-entry">
            <v-icon icon="mdi-star-four-points-outline" color="secondary" />
            <span>{{ feature }}</span>
          </article>
        </div>
      </NeonPanel>

      <NeonPanel class="span-6" subtitle="Control Plane Focus" title="Execution Patterns">
        <div class="list-block">
          <article class="list-entry">
            <v-icon icon="mdi-webhook" color="info" />
            <span>Webhook-driven ad hoc execution for external orchestrators and CI/CD systems.</span>
          </article>
          <article class="list-entry">
            <v-icon icon="mdi-shield-lock-outline" color="success" />
            <span>AES-encrypted credential storage with team-scoped sharing boundaries.</span>
          </article>
          <article class="list-entry">
            <v-icon icon="mdi-text-box-search-outline" color="warning" />
            <span>Searchable execution and API logs, plus parser-backed syntax validation.</span>
          </article>
        </div>
      </NeonPanel>
    </div>
    <FloatingWindow v-model="recommendationsOpen" title="Recommendation Review" :width="780" :start-x="245" :start-y="90"><div class="recommendation-list"><header><div><p class="section-eyebrow">Evidence Before Automation</p><h3>Deterministic findings only</h3></div><v-btn size="small" variant="text" @click="refreshRecommendations">Refresh</v-btn></header><article v-for="recommendation in recommendations" :key="recommendation.id" :class="['recommendation-card', recommendation.severity]"><div><v-chip size="x-small" :color="recommendation.severity === 'high' ? 'error' : recommendation.severity === 'medium' ? 'warning' : 'info'">{{ recommendation.severity }}</v-chip><strong>{{ recommendation.title }}</strong><p>{{ recommendation.summary }}</p><small class="mono">{{ recommendation.source }} · {{ recommendation.generatedAt }}</small></div><div class="recommendation-actions"><v-btn size="x-small" variant="text" @click="previewAi(recommendation)">AI assist preview</v-btn><v-btn size="x-small" class="glass-button" @click="confirm(recommendation)">Confirm review</v-btn></div></article><p v-if="!recommendations.length" class="muted">No recommendations available.</p><v-text-field v-model="confirmationNote" label="Human confirmation note (optional)" density="compact"/><v-alert v-if="aiPreview" type="info" variant="tonal" density="compact"><strong>{{ aiPreview.status }}</strong> · {{ aiPreview.provenance.redaction }} No provider is called and no action is applied from this preview.</v-alert></div></FloatingWindow>
  </div>
</template>

<style scoped>
.hero-body {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
  gap: 16px;
  padding: 16px;
}

.hero-copy {
  max-width: 62ch;
  color: #d9c4e1;
}

.metric-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.metric-card {
  display: grid;
  gap: 8px;
  min-height: 112px;
  padding: 14px;
  border-radius: 2px;
  background: linear-gradient(145deg, rgba(107, 35, 142, .36), rgba(31, 8, 55, .78));
  border: 1px solid rgba(243, 130, 255, .25);
  box-shadow: inset 0 1px 0 rgba(255, 214, 255, .09);
}

.metric-card strong {
  font-family: 'Share Tech Mono', monospace;
  font-size: 1.9rem;
  color: #fff0ff;
}

.list-block {
  display: grid;
  gap: 12px;
  padding: 14px 16px 16px;
}

.list-entry {
  display: grid;
  grid-template-columns: 20px 1fr;
  gap: 12px;
  align-items: start;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(243, 130, 255, .13);
}

.health-stack { display:grid; gap:12px; padding:18px 16px; }.health-stack div { display:flex; justify-content:space-between; align-items:baseline; }.health-stack span { color:var(--muted); font-family:'Share Tech Mono',monospace; font-size:.66rem; letter-spacing:.1em; }.health-stack strong { color:var(--cyan); font-family:'Share Tech Mono',monospace; font-size:1.35rem; }
.recommendation-strip,.recommendation-list{display:grid;gap:10px;padding:14px}.recommendation-strip article{display:flex;gap:10px;padding:10px;border:1px solid var(--line);background:rgba(40,211,255,.04)}.recommendation-strip article.high{border-left-color:var(--danger,#ff5a82)}.recommendation-strip article.medium{border-left-color:var(--amber)}.recommendation-strip div{display:grid;gap:3px}.recommendation-strip strong,.recommendation-card strong{font-size:.8rem}.recommendation-strip span,.recommendation-card p,.recommendation-card small{color:var(--muted);font-size:.73rem}.recommendation-list>header,.recommendation-actions{display:flex;justify-content:space-between;align-items:center;gap:8px}.recommendation-list h3{margin:2px 0}.recommendation-card{display:flex;justify-content:space-between;gap:14px;padding:12px;border:1px solid var(--line);background:rgba(5,10,20,.56)}.recommendation-card>div:first-child{display:grid;gap:6px}.recommendation-card p{margin:0}.recommendation-actions{align-items:flex-start;flex-direction:column;min-width:120px}

@media (max-width: 1100px) {
  .hero-body {
    grid-template-columns: 1fr;
  }
}
</style>
