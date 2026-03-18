const path = require('path')
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const mineflayer = require('mineflayer')
const { mineflayer: viewer } = require('prismarine-viewer')

const app = express()
const server = http.createServer(app)
const io = new Server(server)

const WEB_PORT = Number(process.env.PORT || 3000)
const VIEW_PORT = Number(process.env.VIEW_PORT || 3001)
const MAX_REACH = 6

let bot = null
let viewerStarted = false
let controlLoop = null
let activeControls = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
  sneak: false
}
let liveState = {
  connected: false,
  connecting: false,
  status: 'Idle',
  username: '',
  host: '',
  port: 25565,
  inventory: [],
  quickBarSlot: 0,
  heldItem: null,
  craftable: [],
  health: 0,
  food: 0,
  experience: 0,
  position: null,
  targetBlock: null
}

app.use(express.static(path.join(__dirname, 'public')))

io.on('connection', (socket) => {
  socket.emit('state', liveState)

  socket.on('connect-bot', async (payload) => {
    if (liveState.connecting) {
      socket.emit('action-error', 'Connection already in progress.')
      return
    }

    const host = String(payload.host || '').trim()
    const port = Number(payload.port || 25565)
    const username = String(payload.username || '').trim()
    const version = String(payload.version || '').trim()

    if (!host || !username) {
      socket.emit('action-error', 'Host and account email are required.')
      return
    }

    cleanupBot()

    liveState = {
      ...liveState,
      connecting: true,
      connected: false,
      status: 'Opening account sign-in flow...',
      host,
      port,
      username,
      inventory: [],
      heldItem: null,
      craftable: [],
      targetBlock: null
    }
    broadcastState()

    try {
      bot = mineflayer.createBot({
        host,
        port,
        username,
        auth: 'microsoft',
        version: version || false,
        viewDistance: 'tiny'
      })
      attachBotEvents(bot)
    } catch (error) {
      setStatus(`Failed to start bot: ${error.message}`)
      liveState.connecting = false
      broadcastState()
    }
  })

  socket.on('control-state', ({ control, state }) => {
    if (!bot || !bot.entity) return
    if (!(control in activeControls)) return

    activeControls[control] = Boolean(state)
    bot.setControlState(control, activeControls[control])
  })

  socket.on('look', ({ yaw, pitch }) => {
    if (!bot || !bot.entity) return
    bot.look(Number(yaw), Number(pitch), true).catch(() => {})
  })

  socket.on('swing', async () => {
    if (!bot || !bot.entity) return
    const target = getTargetBlock()
    if (!target) {
      socket.emit('action-error', 'No block in reach.')
      return
    }

    try {
      setStatus(`Breaking ${target.name}...`)
      await bot.dig(target, true)
      setStatus(`Removed ${target.name}.`)
      emitWorldState()
    } catch (error) {
      socket.emit('action-error', error.message)
      setStatus(`Break failed: ${error.message}`)
    }
  })

  socket.on('use-target', async () => {
    if (!bot || !bot.entity) return
    const target = getTargetBlock()
    if (!target) {
      socket.emit('action-error', 'No block in reach.')
      return
    }

    try {
      await bot.activateBlock(target)
      setStatus(`Used ${target.name}.`)
      emitWorldState()
      refreshCraftable()
    } catch (error) {
      socket.emit('action-error', error.message)
      setStatus(`Use failed: ${error.message}`)
    }
  })

  socket.on('equip-slot', async ({ slot }) => {
    if (!bot || !bot.entity) return

    const targetItem = bot.inventory.items().find((item) => item.slot === Number(slot))
    if (!targetItem) {
      socket.emit('action-error', 'That inventory slot is empty.')
      return
    }

    try {
      await bot.equip(targetItem, 'hand')
      setStatus(`Holding ${targetItem.displayName}.`)
      emitWorldState()
    } catch (error) {
      socket.emit('action-error', error.message)
      setStatus(`Equip failed: ${error.message}`)
    }
  })

  socket.on('craft-item', async ({ itemName, amount }) => {
    if (!bot || !bot.registry) return
    const normalized = String(itemName || '').trim().toLowerCase()
    const count = Math.max(1, Number(amount || 1))

    if (!normalized) {
      socket.emit('action-error', 'Choose an item to craft.')
      return
    }

    const item = bot.registry.itemsByName[normalized]
    if (!item) {
      socket.emit('action-error', 'Unknown item name.')
      return
    }

    const table = getCraftingTable()
    const recipes = bot.recipesFor(item.id, null, count, table)
    if (!recipes.length) {
      socket.emit('action-error', 'No craftable recipe found with current inventory or nearby table.')
      return
    }

    try {
      setStatus(`Crafting ${count} x ${item.displayName}...`)
      await bot.craft(recipes[0], count, table)
      setStatus(`Crafted ${count} x ${item.displayName}.`)
      emitWorldState()
      refreshCraftable()
    } catch (error) {
      socket.emit('action-error', error.message)
      setStatus(`Craft failed: ${error.message}`)
    }
  })

  socket.on('respawn', () => {
    if (!bot) return
    bot.emit('respawn_request')
  })

  socket.on('disconnect', () => {})
})

function attachBotEvents(createdBot) {
  createdBot.once('login', () => {
    liveState = {
      ...liveState,
      connecting: false,
      connected: true,
      status: 'Connected.',
      username: createdBot.username
    }
    startViewer(createdBot)
    ensureControlLoop()
    emitWorldState()
  })

  createdBot.on('spawn', () => {
    setStatus('Spawned and ready.')
    emitWorldState()
    refreshCraftable()
  })

  createdBot.on('health', () => {
    emitWorldState()
  })

  createdBot.on('move', () => {
    emitWorldState(false)
  })

  createdBot.on('heldItemChanged', () => {
    emitWorldState()
  })

  createdBot.on('windowUpdate', () => {
    emitWorldState()
    refreshCraftable()
  })

  createdBot.on('end', (reason) => {
    liveState.connected = false
    liveState.connecting = false
    liveState.status = `Disconnected: ${reason}`
    broadcastState()
    cleanupControls()
  })

  createdBot.on('error', (error) => {
    liveState.status = `Error: ${error.message}`
    liveState.connecting = false
    broadcastState()
  })
}

function startViewer(createdBot) {
  if (viewerStarted) return

  viewer(createdBot, {
    port: VIEW_PORT,
    firstPerson: true,
    viewDistance: 6
  })
  viewerStarted = true
}

function ensureControlLoop() {
  if (controlLoop) return

  controlLoop = setInterval(() => {
    if (!bot || !bot.entity) return
    liveState.targetBlock = formatBlock(getTargetBlock())
    liveState.position = formatPosition(bot.entity.position)
    liveState.health = bot.health
    liveState.food = bot.food
    liveState.experience = bot.experience?.level || 0
    liveState.quickBarSlot = bot.quickBarSlot
    liveState.heldItem = formatItem(bot.heldItem)
    io.emit('telemetry', {
      position: liveState.position,
      health: liveState.health,
      food: liveState.food,
      experience: liveState.experience,
      targetBlock: liveState.targetBlock,
      heldItem: liveState.heldItem,
      quickBarSlot: liveState.quickBarSlot
    })
  }, 150)
}

function emitWorldState(withInventory = true) {
  if (!bot) return

  liveState.position = bot.entity ? formatPosition(bot.entity.position) : null
  liveState.health = bot.health || 0
  liveState.food = bot.food || 0
  liveState.experience = bot.experience?.level || 0
  liveState.quickBarSlot = bot.quickBarSlot || 0
  liveState.heldItem = formatItem(bot.heldItem)
  liveState.targetBlock = formatBlock(getTargetBlock())

  if (withInventory) {
    liveState.inventory = bot.inventory.items().map(formatItem)
  }

  broadcastState()
}

function refreshCraftable() {
  if (!bot || !bot.registry) return

  const table = getCraftingTable()
  const craftable = []
  for (const item of bot.registry.itemsArray) {
    if (!item || !item.name) continue
    const recipes = bot.recipesFor(item.id, null, 1, table)
    if (recipes.length) {
      craftable.push({
        name: item.name,
        displayName: item.displayName
      })
    }
  }

  liveState.craftable = craftable.sort((a, b) => a.displayName.localeCompare(b.displayName)).slice(0, 200)
  broadcastState()
}

function formatItem(item) {
  if (!item) return null
  return {
    slot: item.slot,
    name: item.name,
    displayName: item.displayName,
    count: item.count
  }
}

function formatBlock(block) {
  if (!block) return null
  return {
    name: block.name,
    displayName: block.displayName,
    position: formatPosition(block.position)
  }
}

function formatPosition(position) {
  if (!position) return null
  return {
    x: Number(position.x.toFixed(2)),
    y: Number(position.y.toFixed(2)),
    z: Number(position.z.toFixed(2))
  }
}

function getTargetBlock() {
  if (!bot || !bot.entity) return null
  return bot.blockAtCursor(MAX_REACH)
}

function getCraftingTable() {
  if (!bot || !bot.registry) return null
  const tableId = bot.registry.blocksByName.crafting_table?.id
  if (!tableId) return null
  return bot.findBlock({
    matching: tableId,
    maxDistance: MAX_REACH
  })
}

function setStatus(status) {
  liveState.status = status
  broadcastState()
}

function broadcastState() {
  io.emit('state', liveState)
}

function cleanupControls() {
  if (!bot) return

  for (const control of Object.keys(activeControls)) {
    activeControls[control] = false
    bot.setControlState(control, false)
  }
}

function cleanupBot() {
  if (!bot) return
  cleanupControls()
  try {
    bot.quit('Switching sessions.')
  } catch (_) {}
  bot = null
}

server.listen(WEB_PORT, () => {
  console.log(`Portal ready on http://localhost:${WEB_PORT}`)
  console.log(`Viewer stream on http://localhost:${VIEW_PORT}`)
})
