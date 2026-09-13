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
    activeScope: JSON.parse(globalThis.localStorage?.getItem('poshinit-active-scope') || '{"projectId":"project-default","environmentId":"env-default"}'),
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.token),
    personalScripts: (state) =>
      state.catalog.library?.filter?.((entry) => entry.scope === 'personal') || [],
    sharedScripts: (state) =>
      state.catalog.library?.filter?.((entry) => entry.scope === 'shared') || [],
  },
  actions: {
    setActiveScope(scope) { this.activeScope = { projectId: scope.projectId || 'project-default', environmentId: scope.environmentId || 'env-default' }; globalThis.localStorage?.setItem('poshinit-active-scope', JSON.stringify(this.activeScope)) },
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
    async recommendations() { return this.api('/api/recommendations') },
    async recommendationAiPreview(id) { return this.api(`/api/recommendations/${id}/ai-preview`, { method: 'POST' }) },
    async confirmRecommendation(id, note = '') { return this.api(`/api/recommendations/${id}/confirm`, { method: 'POST', body: JSON.stringify({ note }) }) },
    async saveLibraryEntry(entry) {
      const saved = await this.api('/api/library', {
        method: 'POST',
        body: JSON.stringify({ ...entry, ...this.activeScope }),
      })
      this.catalog.library = await this.api('/api/library')
      return saved
    },
    async listWorkflows() { return this.api('/api/workflows') },
    async saveWorkflow(workflow) { return this.api('/api/workflows', { method: 'POST', body: JSON.stringify(workflow) }) },
    async deleteWorkflow(id) { return this.api(`/api/workflows/${id}`, { method: 'DELETE' }) },
    async validateWorkflow(graph) { return this.api('/api/workflows/validate', { method: 'POST', body: JSON.stringify({ graph }) }) },
    async runWorkflow(id, inputs = {}) { return this.api(`/api/workflows/${id}/runs`, { method: 'POST', body: JSON.stringify({ inputs }) }) },
    async workflowRuns(id) { return this.api(`/api/workflows/${id}/runs`) },
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
    async listParameterSets(scriptId = '') { return this.api(`/api/parameter-sets${scriptId ? `?scriptId=${encodeURIComponent(scriptId)}` : ''}`) },
    async saveParameterSet(parameterSet) { return this.api('/api/parameter-sets', { method: 'POST', body: JSON.stringify(parameterSet) }) },
    async saveSchedule(schedule) {
      const saved = await this.api('/api/schedules', {
        method: 'POST',
        body: JSON.stringify({ ...schedule, ...this.activeScope }),
      })
      this.catalog.schedules = await this.api('/api/schedules')
      await this.refreshDashboard()
      return saved
    },
    async previewGroupRule(rule) { return this.api('/api/groups/preview', { method: 'POST', body: JSON.stringify({ rule }) }) },
    async groupMembershipHistory(id) { return this.api(`/api/groups/${id}/history`) },
    async explainGroupMachine(id, machineId) { return this.api(`/api/groups/${id}/machines/${machineId}/explanation`) },
    async listCmdbSources() { return this.api('/api/cmdb-sources') },
    async saveCmdbSource(source) { return this.api('/api/cmdb-sources', { method: 'POST', body: JSON.stringify(source) }) },
    async deleteCmdbSource(id) { return this.api(`/api/cmdb-sources/${id}`, { method: 'DELETE' }) },
    async syncCmdbSource(id) { return this.api(`/api/cmdb-sources/${id}/sync`, { method: 'POST' }) },
    async cmdbSourceRuns(id) { return this.api(`/api/cmdb-sources/${id}/runs`) },
    async listProjects() { return this.api('/api/projects') },
    async saveProject(project) { return this.api('/api/projects', { method: 'POST', body: JSON.stringify(project) }) },
    async saveEnvironment(environment) { return this.api('/api/projects/environments', { method: 'POST', body: JSON.stringify(environment) }) },
    async deleteProject(id) { return this.api(`/api/projects/${id}`, { method: 'DELETE' }) },
    async listApprovals() { return this.api('/api/approvals') },
    async decideApproval(id, status, notes = '') { const result = await this.api(`/api/approvals/${id}/decision`, { method: 'POST', body: JSON.stringify({ status, notes }) }); await this.bootstrap(); return result },
    async listApprovalPolicies() { return this.api('/api/approval-policies') },
    async saveApprovalPolicy(policy) { return this.api('/api/approval-policies', { method: 'POST', body: JSON.stringify(policy) }) },
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
      const idempotencyKey = payload.idempotencyKey || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
      const dispatch = await this.api('/api/executions/run', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ ...payload, idempotencyKey }) })
      onEvent({ type: 'dispatch', dispatchId: dispatch.id })
      let after = 0
      let complete = false
      while (!complete) {
        try {
          await new Promise((resolve, reject) => {
            const scheme = globalThis.location.protocol === 'https:' ? 'wss' : 'ws'
            const socket = new WebSocket(`${scheme}://${globalThis.location.host}/api/executions/dispatch/${encodeURIComponent(dispatch.id)}/socket?after=${after}`, ['poshinit', this.token])
            socket.onmessage = (message) => { const event = JSON.parse(message.data); after = Math.max(after, event.sequence || 0); onEvent(event); if (event.type === 'dispatch-complete') { complete = true; socket.close(); resolve() } }
            socket.onerror = () => reject(new Error('Live output gateway connection failed'))
            socket.onclose = () => resolve()
          })
        } catch (_error) {
          // Durable REST replay keeps the console usable when a proxy blocks WebSockets.
          const events = await this.api(`/api/executions/dispatch/${dispatch.id}/events?after=${after}`)
          events.forEach((event) => { after = Math.max(after, event.sequence || 0); onEvent({ type: event.type, targetId: event.targetId, sequence: event.sequence, ...event.data }) })
          await new Promise((resolve) => setTimeout(resolve, 750))
        }
        if (!complete) {
          const status = await this.api(`/api/executions/dispatch/${dispatch.id}`)
          if (['completed', 'completed_with_errors', 'cancelled'].includes(status.status)) {
            const events = await this.api(`/api/executions/dispatch/${dispatch.id}/events?after=${after}`)
            events.forEach((event) => { after = Math.max(after, event.sequence || 0); onEvent({ type: event.type, targetId: event.targetId, sequence: event.sequence, ...event.data }) })
            complete = true
          }
        }
      }
      await this.bootstrap()
    },
    async cancelRunDispatch(dispatchId) {
      return this.api(`/api/executions/dispatch/${dispatchId}/cancel`, { method: 'POST' })
    },
    async tailDispatchOutput(dispatchId, after = 0) {
      return this.api(`/api/executions/dispatch/${dispatchId}/output/tail?after=${after}`)
    },
    async downloadDispatchOutput(dispatchId) {
      const blob = await this.apiBlob(`/api/executions/dispatch/${dispatchId}/output/download`)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `poshinit-dispatch-${dispatchId}.log`
      link.click()
      URL.revokeObjectURL(url)
    },
    async saveMachine(machine) {
      await this.api('/api/machines', {
        method: 'POST',
        body: JSON.stringify({ ...machine, ...this.activeScope }),
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
    async terminalTranscript(sessionId) { return this.api(`/api/terminal/${sessionId}/transcript`) },
    async auditTerminalClipboard(sessionId, direction, length) { return this.api(`/api/terminal/${sessionId}/clipboard`, { method: 'POST', body: JSON.stringify({ direction, length }) }) },
    async terminalTransferGuard(sessionId, direction) { return this.api(`/api/terminal/${sessionId}/transfer/${direction}`, { method: 'POST' }) },
    async brokerRemoteSession(machineId, kind) { return this.api(`/api/machines/${machineId}/broker/${kind}`, { method: 'POST' }) },
    async remoteSessionSettings() { return this.api('/api/settings/remote-sessions') },
    async saveRemoteSessionSettings(settings) { return this.api('/api/settings/remote-sessions', { method: 'POST', body: JSON.stringify(settings) }) },
    async saveGroup(group) {
      await this.api('/api/groups', {
        method: 'POST',
        body: JSON.stringify({ ...group, ...this.activeScope }),
      })
      this.catalog.groups = await this.api('/api/groups')
    },
    async saveCredential(credential) {
      await this.api('/api/credentials', {
        method: 'POST',
        body: JSON.stringify({ ...credential, ...this.activeScope }),
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
    async getAccessGrants() { return this.api('/api/access-grants') },
    async saveAccessGrant(grant) { return this.api('/api/access-grants', { method: 'POST', body: JSON.stringify(grant) }) },
    async deleteAccessGrant(id) { return this.api(`/api/access-grants/${id}`, { method: 'DELETE' }) },
    async saveSettings(key, value) {
      const result = await this.api(`/api/settings/${key}`, {
        method: 'POST',
        body: JSON.stringify(value),
      })
      this.catalog.settings[key] = result
      return result
    },
    async listInventorySources() { return this.api('/api/inventory-sources') },
    async updateInventorySource(id, source) { return this.api(`/api/inventory-sources/${id}`, { method: 'POST', body: JSON.stringify(source) }) },
    async syncInventorySource(id) { return this.api(`/api/inventory-sources/${id}/sync`, { method: 'POST' }) },
    async inventorySourceHistory(id) { return this.api(`/api/inventory-sources/${id}/history`) },
    async inventorySourceErrors(id) { return this.api(`/api/inventory-sources/${id}/errors`) },
    async getReliabilityStatus() { return this.api('/api/reliability/status') },
    async listDeadLetters() { return this.api('/api/reliability/dead-letters') },
    async requeueDeadLetter(id) { return this.api(`/api/reliability/dead-letters/${id}/requeue`, { method: 'POST' }) },
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
