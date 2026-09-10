import { WebSocketServer, WebSocket } from 'ws'
import { get } from '../db/client.js'
import { hasPermission } from './rbacService.js'
import { getDispatch, listDispatchEvents, subscribeDispatch } from './jobQueueService.js'
import { verifyToken } from '../utils/crypto.js'

function clientEvent(event) {
  return { type: event.type, targetId: event.targetId, sequence: event.sequence, ...event.data }
}

function send(socket, event) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event))
}

function protocolToken(request) {
  return String(request.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map((value) => value.trim())
    .find((value) => value && value !== 'poshinit') || ''
}

function authorizedUser(request) {
  const payload = verifyToken(protocolToken(request))
  if (!payload?.userId) return null
  const user = get('SELECT id, role, status FROM users WHERE id = ?', [payload.userId])
  return user?.status === 'active' && hasPermission(user, 'runs:execute') ? user : null
}

export function attachJobWebSocketGateway(server) {
  const gateway = new WebSocketServer({ noServer: true, handleProtocols: (protocols) => protocols.has('poshinit') ? 'poshinit' : false })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
    const match = url.pathname.match(/^\/api\/executions\/dispatch\/([^/]+)\/socket$/)
    // Leave unrelated upgrades available to Vite's development HMR transport.
    if (!match) return
    const user = authorizedUser(request)
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    request.dispatchId = decodeURIComponent(match[1])
    request.afterSequence = Number(url.searchParams.get('after') || 0)
    gateway.handleUpgrade(request, socket, head, (connection) => gateway.emit('connection', connection, request, user))
  })

  gateway.on('connection', (socket, request) => {
    const dispatchId = request.dispatchId
    if (!getDispatch(dispatchId)) return socket.close(4404, 'Dispatch not found')
    let lastSequence = request.afterSequence || 0
    let completed = false
    const forward = (event) => {
      if (event.sequence <= lastSequence) return
      lastSequence = event.sequence
      send(socket, clientEvent(event))
      if (event.type === 'dispatch-complete') completed = true
    }
    listDispatchEvents(dispatchId, lastSequence).forEach(forward)
    if (completed) return socket.close(1000, 'Dispatch complete')
    const unsubscribe = subscribeDispatch(dispatchId, forward)
    // Polling durable events covers dispatches written by another application instance.
    const replayTimer = setInterval(() => {
      listDispatchEvents(dispatchId, lastSequence).forEach(forward)
      if (completed) socket.close(1000, 'Dispatch complete')
    }, 750)
    socket.on('message', (message) => {
      try {
        const command = JSON.parse(message.toString())
        if (command.type === 'tail') listDispatchEvents(dispatchId, Number(command.after) || lastSequence).forEach(forward)
      } catch (_error) {
        send(socket, { type: 'error', data: 'Invalid gateway message' })
      }
    })
    socket.on('close', () => { clearInterval(replayTimer); unsubscribe() })
  })

  return gateway
}
