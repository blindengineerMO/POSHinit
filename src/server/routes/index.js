import express from 'express'
import multer from 'multer'
import path from 'node:path'
import { config } from '../config.js'
import { requireAuth } from '../middleware/auth.js'
import { login, recordLogout } from '../services/authService.js'
import { getCatalog } from '../services/catalogService.js'
import { getDashboardSummary } from '../services/dashboardService.js'
import { executeAdHocRun } from '../services/executionService.js'
import { listGroups, saveGroup } from '../services/groupService.js'
import { deleteLibraryEntry, listLibrary, listScriptVersions, saveLibraryEntry } from '../services/libraryService.js'
import { searchLogs } from '../services/logService.js'
import { listMachines, saveCredential, saveMachine, testMachineConnection, uploadAsset } from '../services/machineService.js'
import { getSettings, saveSettings } from '../services/settingsService.js'
import { listSchedules, saveSchedule } from '../services/scheduleService.js'
import { listTeams, saveTeam } from '../services/teamService.js'
import { listUsers, saveUser } from '../services/userService.js'
import { discoverVmwareMachines, importVcenterMachines, importVmwareMachines, importVmwareSelection, saveVcenterSettings } from '../services/vcenterService.js'
import { validatePowerShell } from '../services/powershellService.js'
import { encryptSecret } from '../utils/crypto.js'
import { beginEntraSignIn, consumeEnterpriseTicket, enterpriseFailureRedirect, enterpriseSignInFailure, entraStatus, finishEntraSignIn } from '../services/entraService.js'

const upload = multer({
  dest: path.join(config.uploadsDir),
})

export function createRouter() {
  const router = express.Router()

  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'poshinit' })
  })

  router.post('/auth/login', (req, res) => {
    res.json(login(req.body, { ip: req.ip }))
  })

  router.get('/auth/entra/status', (_req, res) => {
    res.json(entraStatus())
  })

  router.get('/auth/entra/start', async (req, res, next) => {
    try {
      res.redirect(await beginEntraSignIn({ ip: req.ip }))
    } catch (error) {
      next(error)
    }
  })

  router.get('/auth/entra/callback', async (req, res) => {
    try {
      const result = await finishEntraSignIn({ code: req.query.code, state: req.query.state }, { ip: req.ip })
      res.redirect(result.redirectUrl)
    } catch (error) {
      enterpriseSignInFailure(error, { ip: req.ip })
      res.redirect(enterpriseFailureRedirect())
    }
  })

  router.post('/auth/entra/complete', (req, res) => {
    res.json(consumeEnterpriseTicket(req.body.ticket))
  })

  router.post('/webhooks/execute', async (req, res) => {
    const secret = req.headers['x-poshinit-webhook-secret'] || req.body.secret
    if (secret !== config.webhookSecret) {
      res.status(401).json({ error: 'Invalid webhook secret' })
      return
    }

    res.json(
      await executeAdHocRun(
        {
          triggerType: 'webhook',
          scriptIds: req.body.scriptIds || [],
          machineIds: req.body.machineIds || [],
        },
        null,
      ),
    )
  })

  router.use('/api', requireAuth)

  router.post('/api/auth/logout', (req, res) => {
    recordLogout(req.user, { ip: req.ip })
    res.status(204).end()
  })

  router.get('/api/bootstrap', (req, res) => {
    res.json({
      currentUser: req.user,
      catalog: getCatalog(),
      dashboard: getDashboardSummary(),
      library: listLibrary(),
    })
  })

  router.get('/api/dashboard', (_req, res) => {
    res.json(getDashboardSummary())
  })

  router.get('/api/library', (_req, res) => {
    res.json(listLibrary())
  })

  router.post('/api/library', (req, res) => {
    res.json(saveLibraryEntry(req.body, req.user.id))
  })

  router.delete('/api/library/:id', (req, res) => {
    deleteLibraryEntry(req.params.id)
    res.status(204).end()
  })

  router.get('/api/library/:id/versions', (req, res) => {
    res.json(listScriptVersions(req.params.id))
  })

  router.post('/api/library/assets', upload.single('file'), (req, res) => {
    res.json(uploadAsset(req.file))
  })

  router.post('/api/scripts/validate', async (req, res) => {
    res.json(await validatePowerShell(req.body.content || ''))
  })

  router.get('/api/machines', (_req, res) => {
    res.json(listMachines())
  })

  router.post('/api/machines', (req, res) => {
    res.json(saveMachine(req.body))
  })

  router.post('/api/machines/:id/test', async (req, res) => {
    res.json(await testMachineConnection(req.params.id))
  })

  router.post('/api/credentials', (req, res) => {
    res.json(
      saveCredential(
        {
          ...req.body,
          secretEncrypted: encryptSecret(req.body.secret || ''),
        },
        req.user.id,
      ),
    )
  })

  router.get('/api/groups', (_req, res) => {
    res.json(listGroups())
  })

  router.post('/api/groups', (req, res) => {
    res.json(saveGroup(req.body))
  })

  router.get('/api/schedules', (_req, res) => {
    res.json(listSchedules())
  })

  router.post('/api/schedules', (req, res) => {
    res.json(saveSchedule(req.body, req.user.id))
  })

  router.post('/api/executions/run', async (req, res) => {
    res.json(await executeAdHocRun(req.body, req.user.id))
  })

  router.get('/api/users', (_req, res) => {
    res.json(listUsers())
  })

  router.post('/api/users', (req, res) => {
    res.json(saveUser(req.body))
  })

  router.get('/api/teams', (_req, res) => {
    res.json(listTeams())
  })

  router.post('/api/teams', (req, res) => {
    res.json(saveTeam(req.body))
  })

  router.get('/api/settings', (_req, res) => {
    res.json(getSettings())
  })

  router.post('/api/settings/:key', (req, res) => {
    if (req.params.key === 'vcenter') {
      res.json(saveVcenterSettings(req.body))
      return
    }

    res.json(saveSettings(req.params.key, req.body))
  })

  router.post('/api/vcenter/import', async (req, res) => {
    res.json(await importVcenterMachines(req.body))
  })

  router.post('/api/vmware/import', async (req, res) => {
    const settings = getSettings().vcenter
    const connector = (settings.connectors || []).find((item) => item.id === req.body.connectorId)
    res.json(
      await importVmwareMachines(
        { connectors: [{ ...connector, passwordPlain: req.body.passwordPlain }] },
        req.body.connectorId,
      ),
    )
  })

  router.post('/api/vmware/discover', async (req, res) => {
    res.json(await discoverVmwareMachines(getSettings().vcenter, req.body.connectorId))
  })

  router.post('/api/vmware/import-selection', async (req, res) => {
    res.json(
      await importVmwareSelection(
        getSettings().vcenter,
        req.body.connectorId,
        req.body.vmIds,
        req.body.credentialIds,
      ),
    )
  })

  router.get('/api/logs', (req, res) => {
    res.json(searchLogs(req.query.q || ''))
  })

  return router
}
