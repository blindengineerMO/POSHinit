import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '../views/DashboardView.vue'
import EditorView from '../views/EditorView.vue'
import SchedulerView from '../views/SchedulerView.vue'
import ApprovalsView from '../views/ApprovalsView.vue'
import ReportsView from '../views/ReportsView.vue'
import InventoryView from '../views/InventoryView.vue'
import VaultView from '../views/VaultView.vue'
import TeamsView from '../views/TeamsView.vue'
import SettingsView from '../views/SettingsView.vue'
import ProjectsView from '../views/ProjectsView.vue'
import WorkflowsView from '../views/WorkflowsView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', name: 'dashboard', component: DashboardView },
    { path: '/editor', name: 'editor', component: EditorView },
    { path: '/scheduler', name: 'scheduler', component: SchedulerView },
    { path: '/approvals', name: 'approvals', component: ApprovalsView },
    { path: '/workflows', name: 'workflows', component: WorkflowsView },
    { path: '/reports', name: 'reports', component: ReportsView },
    { path: '/inventory', name: 'inventory', component: InventoryView },
    { path: '/vault', name: 'vault', component: VaultView },
    { path: '/teams', name: 'teams', component: TeamsView },
    { path: '/projects', name: 'projects', component: ProjectsView },
    { path: '/settings', name: 'settings', component: SettingsView },
  ],
})

export default router
