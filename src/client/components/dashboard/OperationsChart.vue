<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CategoryScale, Chart, Filler, LineController, LineElement, LinearScale, PointElement, Tooltip } from 'chart.js'

Chart.register(CategoryScale, LineController, LineElement, LinearScale, PointElement, Tooltip, Filler)

const props = defineProps({ executions: { type: Array, default: () => [] } })
const canvas = ref(null)
let chart

function buildChart() {
  const runs = [...props.executions].slice(0, 8).reverse()
  const labels = runs.map((run, index) => run.started_at ? new Date(run.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : `RUN ${index + 1}`)
  const values = runs.map((run) => run.status === 'success' ? 92 : run.status === 'failed' ? 28 : 58)
  chart?.destroy()
  chart = new Chart(canvas.value, {
    type: 'line',
    data: { labels: labels.length ? labels : ['NO DATA'], datasets: [{ data: values.length ? values : [0], borderColor: '#ff77d8', backgroundColor: 'rgba(180, 69, 255, .18)', pointBackgroundColor: '#f9d2ff', pointBorderColor: '#ff77d8', pointRadius: 3, borderWidth: 2, tension: .38, fill: true }] },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 650 }, plugins: { legend: { display: false }, tooltip: { displayColors: false, backgroundColor: '#251044', titleColor: '#fbeeff', bodyColor: '#d8b9ec', borderColor: 'rgba(255, 121, 214, .55)', borderWidth: 1 } }, scales: { x: { grid: { color: 'rgba(242, 166, 255, .07)' }, border: { display: false }, ticks: { color: '#9d7fad', font: { family: 'Share Tech Mono', size: 9 }, maxRotation: 0 } }, y: { display: false, min: 0, max: 100 } } },
  })
}

onMounted(buildChart)
watch(() => props.executions, buildChart, { deep: true })
onBeforeUnmount(() => chart?.destroy())
</script>

<template><div class="chart-wrap"><canvas ref="canvas" /></div></template>

<style scoped>.chart-wrap{height:210px;min-width:0;padding:10px 12px 4px}</style>
