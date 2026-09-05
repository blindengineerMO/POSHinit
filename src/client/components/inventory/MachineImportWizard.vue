<script setup>
import FloatingWindow from '../common/FloatingWindow.vue'

const open = defineModel({ default: false })
const emit = defineEmits(['select'])

const methods = [
  { id: 'standalone', title: 'Standalone Machine', detail: 'Enter a single node record and connection details.', icon: 'mdi-server-plus-outline' },
  { id: 'vcenter', title: 'VM-Ware vCenter', detail: 'Discover virtual machines through the vCenter REST inventory.', icon: 'mdi-vmware' },
  { id: 'esxi', title: 'VM-Ware ESXi', detail: 'Discover virtual machines directly from an ESXi SOAP endpoint.', icon: 'mdi-server-network-outline' },
  { id: 'azure-arc', title: 'Azure Arc', detail: 'Discover Arc-enabled servers through Azure Resource Manager.', icon: 'mdi-microsoft-azure' },
  { id: 'network', title: 'Network Discovery', detail: 'Probe a CIDR, resolve DNS, validate access, then import.', icon: 'mdi-radar' },
]

function select(method) { open.value = false; emit('select', method) }
</script>

<template>
  <FloatingWindow v-model="open" title="Add Or Import Machines" :width="790" :start-x="195" :start-y="95">
    <section class="launcher"><div class="intro"><p class="section-eyebrow">Step 01 / Choose Source</p><h3>How should POSHinit find these machines?</h3><span>Choose a source to continue into its guided discovery and registration workflow.</span></div><div class="method-grid"><button v-for="method in methods" :key="method.id" class="method-card" type="button" @click="select(method.id)"><v-icon :icon="method.icon"/><strong>{{ method.title }}</strong><span>{{ method.detail }}</span><small>Open workflow <v-icon icon="mdi-arrow-right"/></small></button></div></section>
  </FloatingWindow>
</template>

<style scoped>
.launcher { display: grid; gap: 16px; }.intro { display: grid; gap: 5px; }.intro p, .intro h3 { margin: 0; }.intro h3 { font-size: 1.08rem; }.intro span { color: var(--muted); font-size: .8rem; }.method-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }.method-card { display: grid; min-height: 145px; gap: 8px; padding: 16px; border: 1px solid var(--line); background: rgba(40, 211, 255, .035); color: inherit; text-align: left; cursor: pointer; transition: border-color .18s ease, background .18s ease, transform .18s ease; }.method-card:hover { border-color: var(--cyan); background: rgba(40, 211, 255, .09); transform: translateY(-2px); }.method-card > .v-icon { color: var(--cyan); font-size: 1.35rem; }.method-card strong { font: 700 .86rem 'Share Tech Mono', monospace; }.method-card span { color: var(--muted); font-size: .74rem; line-height: 1.45; }.method-card small { display: flex; align-items: center; gap: 4px; margin-top: auto; color: var(--green); font: .65rem 'Share Tech Mono', monospace; text-transform: uppercase; }.method-card small .v-icon { font-size: .85rem; } @media (max-width: 620px) { .method-grid { grid-template-columns: 1fr; }.method-card { min-height: 112px; } }
</style>
