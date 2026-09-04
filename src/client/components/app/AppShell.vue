<script setup>
import { computed, ref } from 'vue'
import { useRoute, RouterView } from 'vue-router'
import { useAppStore } from '../../stores/app'

const route = useRoute()
const store = useAppStore()
const compact = ref(false)
const items = [
  { to: '/dashboard', icon: 'mdi-view-dashboard-outline', label: 'Command Deck' },
  { to: '/editor', icon: 'mdi-console-line', label: 'Script Studio' },
  { to: '/scheduler', icon: 'mdi-calendar-clock-outline', label: 'Run Planner' },
  { to: '/reports', icon: 'mdi-pulse', label: 'Run Ledger' },
  { to: '/inventory', icon: 'mdi-server-network-outline', label: 'Node Inventory' },
  { to: '/vault', icon: 'mdi-key-variant', label: 'Secret Vault' },
  { to: '/teams', icon: 'mdi-account-group-outline', label: 'Access Control' },
  { to: '/settings', icon: 'mdi-cog-outline', label: 'System Settings' },
]
const page = computed(() => items.find((item) => item.to === route.path) || items[0])
</script>

<template>
  <div class="operator-shell" :class="{ compact }">
    <header class="topnav">
      <RouterLink to="/dashboard" class="brand" aria-label="POSHinit command deck"><img src="../../assets/poshinit-mark.svg" class="brand-mark" alt="" /><span class="brand-name">POSHINIT</span></RouterLink>
      <v-btn icon="mdi-menu" size="small" variant="text" class="nav-toggle" :aria-label="compact ? 'Expand navigation' : 'Collapse navigation'" @click="compact = !compact" />
      <div class="breadcrumb mono"><span>CONTROL PLANE</span><v-icon icon="mdi-chevron-right" size="14" /><strong>{{ page.label.toUpperCase() }}</strong></div>
      <div class="top-actions">
        <div class="connection"><span class="signal" /> API ONLINE</div>
        <v-btn icon="mdi-refresh" size="small" variant="text" aria-label="Refresh data" @click="store.bootstrap" />
        <v-menu location="bottom end"><template #activator="{ props }"><v-btn v-bind="props" variant="text" class="operator-user" append-icon="mdi-chevron-down"><v-icon icon="mdi-account-circle-outline" /><span>{{ store.currentUser?.email }}</span></v-btn></template><v-list class="user-menu" density="compact"><v-list-item :title="store.currentUser?.role || 'operator'" prepend-icon="mdi-shield-account-outline" /><v-list-item title="Sign out" prepend-icon="mdi-logout" @click="store.logout" /></v-list></v-menu>
      </div>
    </header>
    <aside class="sidenav">
      <p class="nav-caption">Automation</p>
      <nav class="nav-links" aria-label="Primary navigation"><RouterLink v-for="item in items" :key="item.to" :to="item.to" class="nav-link" :class="{ active: route.path === item.to }" :title="compact ? item.label : undefined"><v-icon :icon="item.icon" size="19" /><span>{{ item.label }}</span></RouterLink></nav>
      <div class="nav-footer"><span class="nav-caption">Runtime</span><div class="runtime-row"><span class="signal cyan" /><span>PowerShell 7.5</span></div><div class="runtime-row"><v-icon icon="mdi-server-outline" size="14" /><span>{{ store.catalog.machines.length }} managed nodes</span></div></div>
    </aside>
    <main class="workspace"><div class="workspace-tabs"><RouterLink :to="page.to" class="workspace-tab"><v-icon :icon="page.icon" size="15" /> {{ page.label }} <v-icon icon="mdi-close" size="13" /></RouterLink></div><section class="workspace-scroll"><RouterView /></section></main>
    <footer class="statusbar mono"><span><i class="signal" />SYSTEM READY</span><span>{{ store.catalog.machines.length }} NODES</span><span>{{ store.catalog.schedules.length }} SCHEDULES</span><span>{{ store.catalog.executions.length }} RECENT RUNS</span><span class="status-right">LOCAL API :4000</span></footer>
  </div>
</template>

<style scoped>
.operator-shell { --current-sidebar: var(--sidebar); min-height: 100vh; } .operator-shell.compact { --current-sidebar: var(--sidebar-compact); }
.topnav { position: fixed; inset: 0 0 auto; z-index: 30; height: var(--topbar); display: flex; align-items: center; gap: 9px; padding: 0 12px; border-bottom: 1px solid var(--line); background: rgba(23, 6, 43, .94); backdrop-filter: blur(18px); } .topnav::after { content: ''; position: absolute; bottom: -1px; left: 0; width: 42%; height: 1px; background: linear-gradient(90deg, var(--cyan), var(--amber), transparent); opacity: .78; }
.brand { display: flex; align-items: center; gap: 8px; padding-right: 13px; border-right: 1px solid var(--line); color: var(--cyan); font-family: Rajdhani, sans-serif; font-size: 16px; font-weight: 700; letter-spacing: .16em; } .brand-mark { width: 29px; height: 29px; filter: drop-shadow(0 0 8px rgba(235, 76, 239, .5)); }
.nav-toggle { border: 1px solid var(--line) !important; } .breadcrumb { display: flex; align-items: center; gap: 5px; min-width: 0; color: var(--muted); font-size: 10px; letter-spacing: .06em; } .breadcrumb strong { color: var(--cyan); font-weight: 400; } .top-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; } .connection { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid var(--line); color: var(--muted); font-family: 'Share Tech Mono', monospace; font-size: 9px; letter-spacing: .05em; }
.signal { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--green); box-shadow: 0 0 9px var(--green); } .signal.cyan { background: var(--cyan); box-shadow: 0 0 9px var(--cyan); } .operator-user { color: var(--text) !important; text-transform: none !important; } .operator-user span { max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .user-menu { border: 1px solid var(--line); background: var(--surface) !important; color: var(--text) !important; }
.sidenav { position: fixed; top: var(--topbar); bottom: var(--statusbar); left: 0; z-index: 20; display: flex; width: var(--current-sidebar); flex-direction: column; overflow: hidden; border-right: 1px solid var(--line); background: rgba(26, 7, 47, .9); backdrop-filter: blur(15px); transition: width .22s ease; } .nav-caption { margin: 14px 14px 7px; overflow: hidden; color: var(--faint); font-family: 'Share Tech Mono', monospace; font-size: 9px; letter-spacing: .16em; text-transform: uppercase; white-space: nowrap; } .nav-links { display: grid; gap: 2px; padding: 0 7px; } .nav-link { position: relative; display: flex; align-items: center; gap: 12px; min-height: 36px; padding: 0 9px; overflow: hidden; color: var(--muted); font-size: 12px; letter-spacing: .025em; white-space: nowrap; } .nav-link::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 2px; background: transparent; } .nav-link:hover { color: var(--text); background: rgba(235, 76, 239, .07); } .nav-link.active { color: var(--cyan); background: linear-gradient(90deg, rgba(221, 138, 255, .19), transparent); } .nav-link.active::before { background: linear-gradient(var(--cyan), var(--amber)); box-shadow: 0 0 10px var(--cyan); }
.nav-footer { display: grid; gap: 7px; margin-top: auto; padding: 10px 14px 14px; border-top: 1px solid var(--line); overflow: hidden; } .nav-footer .nav-caption { margin: 0; } .runtime-row { display: flex; align-items: center; gap: 7px; color: var(--faint); font-family: 'Share Tech Mono', monospace; font-size: 9px; white-space: nowrap; }
.workspace { min-height: 100vh; padding: var(--topbar) 0 var(--statusbar) var(--current-sidebar); transition: padding-left .22s ease; position: relative; z-index: 1; } .workspace-tabs { height: 30px; display: flex; align-items: end; padding: 0 18px; border-bottom: 1px solid var(--line); background: linear-gradient(180deg, rgba(37, 11, 68, .94), rgba(22, 6, 41, .7)); } .workspace-tab { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 11px; border-right: 1px solid var(--line); border-left: 1px solid var(--line); color: var(--cyan); font-family: 'Share Tech Mono', monospace; font-size: 10px; background: rgba(221, 138, 255, .1); } .workspace-scroll { height: calc(100vh - var(--topbar) - var(--statusbar) - 30px); overflow: auto; padding: 18px; }
.statusbar { position: fixed; inset: auto 0 0; z-index: 30; display: flex; align-items: center; gap: 17px; height: var(--statusbar); padding: 0 12px; border-top: 1px solid var(--line); background: rgba(23, 6, 43, .95); color: var(--faint); font-size: 9px; letter-spacing: .07em; } .statusbar span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; } .status-right { margin-left: auto; color: var(--cyan); }
@media (max-width: 800px) { .operator-shell { --current-sidebar: var(--sidebar-compact); } .brand-name, .sidenav .nav-link span, .sidenav .nav-caption, .nav-footer span:not(.signal), .connection, .operator-user span, .workspace-tabs { display: none; } .sidenav { width: var(--sidebar-compact); } .workspace { padding-left: var(--sidebar-compact); } .nav-footer { padding-inline: 20px; } .top-actions { gap: 3px; } .workspace-scroll { padding: 12px; } .statusbar { gap: 9px; } .statusbar span:nth-child(3), .statusbar span:nth-child(4) { display: none; } }
</style>
