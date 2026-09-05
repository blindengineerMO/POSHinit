import { defineStore } from 'pinia'

const persistedToken = globalThis.localStorage?.getItem('poshinit-token') || ''

export const useAppStore = defineStore('app', {
  state: () => ({
    token: persistedToken,
    currentUser: null,
    dashboard: {
      counts: {},
      recentExecutions: [],
      upcomingSchedules: [],
      machineHealth: [],
    },
    catalog: {
      users: [],
      teams: [],
      credentials: [],
      machines: [],
      groups: [],
      schedules: [],
      executions: [],
      settings: {},
    },
    logResults: [],
    loading: false,
    lastError: '',
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.token),
    personalScripts: (state) =>
      state.catalog.library?.filter?.((entry) => entry.scope === 'personal') || [],
    sharedScripts: (state) =>
      state.catalog.library?.filter?.((entry) => entry.scope === 'shared') || [],
  },
  actions: {
    async api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(options.headers || {}),
        },
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        const message = payload.error || `Request failed with status ${response.status}`
        throw new Error(message)
      }

      if (response.status === 204) {
        return null
      }

      return response.json()
    },
    async apiBlob(path) {
      const response = await fetch(path, { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} })
      if (!response.ok) throw new Error(`Download failed with status ${response.status}`)
      return response.blob()
    },
    async login(email, password) {
      this.loading = true
      this.lastError = ''

      try {
        const payload = await this.api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        })
        await this.startSession(payload)
      } catch (error) {
        this.lastError = error.message
        throw error
      } finally {
        this.loading = false
      }
    },
    async completeEnterpriseLogin(ticket) {
      const payload = await this.api('/auth/entra/complete', {
        method: 'POST',
        body: JSON.stringify({ ticket }),
      })
      await this.startSession(payload)
    },
    async startSession(payload) {
      this.token = payload.token
      globalThis.localStorage?.setItem('poshinit-token', payload.token)
      this.currentUser = payload.user
      await this.bootstrap()
    },
    logout() {
      const token = this.token
      this.token = ''
      this.currentUser = null
      this.catalog = {
        users: [],
        teams: [],
        credentials: [],
        machines: [],
        groups: [],
        schedules: [],
        executions: [],
        settings: {},
      }
      globalThis.localStorage?.removeItem('poshinit-token')
      if (token) {
        fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
      }
    },
    async bootstrap() {
      if (!this.token) {
        return
      }

      const payload = await this.api('/api/bootstrap')
      this.currentUser = payload.currentUser
      this.catalog = payload.catalog
      this.dashboard = payload.dashboard
      this.catalog.library = payload.library
    },
    async refreshDashboard() {
      this.dashboard = await this.api('/api/dashboard')
      this.catalog.executions = this.dashboard.recentExecutions
    },
    async saveLibraryEntry(entry) {
      await this.api('/api/library', {
        method: 'POST',
        body: JSON.stringify(entry),
      })
      this.catalog.library = await this.api('/api/library')
    },
    async deleteLibraryEntry(id) {
      await this.api(`/api/library/${id}`, { method: 'DELETE' })
      this.catalog.library = await this.api('/api/library')
    },
    async importLibraryFile(file, metadata = {}) {
      const body = new FormData()
      body.append('file', file)
      Object.entries(metadata).forEach(([key, value]) => body.append(key, value || ''))
      const response = await fetch('/api/library/import', { method: 'POST', headers: this.token ? { Authorization: `Bearer ${this.token}` } : {}, body })
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'File import failed')
      const entry = await response.json()
      this.catalog.library = await this.api('/api/library')
      return entry
    },
    async previewLibraryFile(id) {
      return this.api(`/api/library/${id}/preview`)
    },
    async downloadLibraryFile(id) {
      return this.apiBlob(`/api/library/${id}/download`)
    },
    async readLibraryFile(id) {
      return this.apiBlob(`/api/library/${id}/file`)
    },
    async validateScript(content) {
      return this.api('/api/scripts/validate', {
        method: 'POST',
        body: JSON.stringify({ content }),
      })
    },
    async saveSchedule(schedule) {
      const saved = await this.api('/api/schedules', {
        method: 'POST',
        body: JSON.stringify(schedule),
      })
      this.catalog.schedules = await this.api('/api/schedules')
      await this.refreshDashboard()
      return saved
    },
    async listApprovals() { return this.api('/api/approvals') },
    async decideApproval(id, status, notes = '') { const result = await this.api(`/api/approvals/${id}/decision`, { method: 'POST', body: JSON.stringify({ status, notes }) }); await this.bootstrap(); return result },
    async getScheduleWebhook(id) {
      return this.api(`/api/schedules/${id}/webhook`)
    },
    async runScripts(payload) {
      const results = await this.api('/api/executions/run', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      await this.bootstrap()
      return results
    },
    async streamRunScripts(payload, onEvent) {
      const response = await fetch('/api/executions/run/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }, body: JSON.stringify(payload) })
      if (!response.ok || !response.body) throw new Error(`Run stream failed with status ${response.status}`)
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''
      while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const frames = buffer.split('\n\n'); buffer = frames.pop() || ''; frames.forEach((frame) => { const data = frame.replace(/^data: /, ''); if (data) onEvent(JSON.parse(data)) }) }
      await this.bootstrap()
    },
    async saveMachine(machine) {
      await this.api('/api/machines', {
        method: 'POST',
        body: JSON.stringify(machine),
      })
      this.catalog.machines = await this.api('/api/machines')
    },
    async testMachine(machineId) {
      const result = await this.api(`/api/machines/${machineId}/test`, {
        method: 'POST',
      })
      this.catalog.machines = await this.api('/api/machines')
      return result
    },
    async testMachineCandidate(candidate) {
      return this.api('/api/machines/test-candidate', { method: 'POST', body: JSON.stringify(candidate) })
    },
    async connectTerminal(machineId) {
      return this.api(`/api/machines/${machineId}/terminal/connect`, { method: 'POST' })
    },
    async runTerminalCommand(sessionId, command) {
      return this.api(`/api/terminal/${sessionId}/command`, { method: 'POST', body: JSON.stringify({ command }) })
    },
    async streamTerminalCommand(sessionId, command, onEvent) {
      const response = await fetch(`/api/terminal/${sessionId}/command/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }, body: JSON.stringify({ command }) })
      if (!response.ok || !response.body) throw new Error(`Terminal stream failed with status ${response.status}`)
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''
      while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const frames = buffer.split('\n\n'); buffer = frames.pop() || ''; frames.forEach((frame) => { const payload = frame.replace(/^data: /, ''); if (payload) onEvent(JSON.parse(payload)) }) }
    },
    async cancelTerminalCommand(sessionId) { return this.api(`/api/terminal/${sessionId}/cancel`, { method: 'POST' }) },
    async disconnectTerminal(sessionId) {
      await this.api(`/api/terminal/${sessionId}/disconnect`, { method: 'POST' })
    },
    async saveGroup(group) {
      await this.api('/api/groups', {
        method: 'POST',
        body: JSON.stringify(group),
      })
      this.catalog.groups = await this.api('/api/groups')
    },
    async saveCredential(credential) {
      await this.api('/api/credentials', {
        method: 'POST',
        body: JSON.stringify(credential),
      })
      await this.bootstrap()
    },
    async saveUser(user) {
      await this.api('/api/users', {
        method: 'POST',
        body: JSON.stringify(user),
      })
      this.catalog.users = await this.api('/api/users')
    },
    async saveTeam(team) {
      await this.api('/api/teams', {
        method: 'POST',
        body: JSON.stringify(team),
      })
      this.catalog.teams = await this.api('/api/teams')
    },
    async saveSettings(key, value) {
      const result = await this.api(`/api/settings/${key}`, {
        method: 'POST',
        body: JSON.stringify(value),
      })
      this.catalog.settings[key] = result
      return result
    },
    async listNotificationPolicies() {
      return this.api('/api/notification-policies')
    },
    async saveNotificationPolicy(policy) {
      return this.api('/api/notification-policies', { method: 'POST', body: JSON.stringify(policy) })
    },
    async setNotificationPolicyEnabled(id, enabled) {
      return this.api(`/api/notification-policies/${id}/enabled`, { method: 'POST', body: JSON.stringify({ enabled }) })
    },
    async testNotificationPolicy(id) {
      await this.api(`/api/notification-policies/${id}/test`, { method: 'POST' })
    },
    async deleteNotificationPolicy(id) {
      await this.api(`/api/notification-policies/${id}`, { method: 'DELETE' })
    },
    async importVcenter(payload) {
      const result = await this.api('/api/vcenter/import', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      this.catalog.machines = await this.api('/api/machines')
      return result
    },
    async importVmware(connectorId, passwordPlain) {
      const result = await this.api('/api/vmware/import', {
        method: 'POST',
        body: JSON.stringify({ connectorId, passwordPlain }),
      })
      this.catalog.machines = await this.api('/api/machines')
      return result
    },
    async discoverVmware(connectorId) {
      return this.api('/api/vmware/discover', {
        method: 'POST',
        body: JSON.stringify({ connectorId }),
      })
    },
    async importVmwareSelection(connectorId, vmIds, credentialIds) {
      const result = await this.api('/api/vmware/import-selection', {
        method: 'POST',
        body: JSON.stringify({ connectorId, vmIds, credentialIds }),
      })
      this.catalog.machines = await this.api('/api/machines')
      return result
    },
    async discoverAzureArc(connectorId) {
      return this.api('/api/azure-arc/discover', {
        method: 'POST',
        body: JSON.stringify({ connectorId }),
      })
    },
    async importAzureArcSelection(connectorId, machineIds, credentialIds) {
      const result = await this.api('/api/azure-arc/import-selection', {
        method: 'POST',
        body: JSON.stringify({ connectorId, machineIds, credentialIds }),
      })
      this.catalog.machines = await this.api('/api/machines')
      return result
    },
    async discoverProxmox(connectorId) { return this.api('/api/proxmox/discover', { method: 'POST', body: JSON.stringify({ connectorId }) }) },
    async importProxmoxSelection(connectorId, machineIds, credentialIds) { const result = await this.api('/api/proxmox/import-selection', { method: 'POST', body: JSON.stringify({ connectorId, machineIds, credentialIds }) }); this.catalog.machines = await this.api('/api/machines'); return result },
    async startSubnetScan(payload) {
      return this.api('/api/subnet-scans', { method: 'POST', body: JSON.stringify(payload) })
    },
    async getSubnetScan(id) {
      return this.api(`/api/subnet-scans/${id}`)
    },
    async importSubnetScan(id, machines) {
      const result = await this.api(`/api/subnet-scans/${id}/import`, { method: 'POST', body: JSON.stringify({ machines }) })
      this.catalog.machines = await this.api('/api/machines')
      return result
    },
    async searchLogs(query) {
      this.logResults = await this.api(`/api/logs?q=${encodeURIComponent(query || '')}`)
      return this.logResults
    },
  },
})
