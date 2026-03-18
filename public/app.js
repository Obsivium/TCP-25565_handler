const socket = io()

const form = document.getElementById('connect-form')
const statusEl = document.getElementById('status')
const healthEl = document.getElementById('health')
const foodEl = document.getElementById('food')
const xpEl = document.getElementById('xp')
const heldItemEl = document.getElementById('held-item')
const positionEl = document.getElementById('position')
const targetBlockEl = document.getElementById('target-block')
const inventoryEl = document.getElementById('inventory')
const craftNameEl = document.getElementById('craft-name')
const craftAmountEl = document.getElementById('craft-amount')
const craftableListEl = document.getElementById('craftable-list')
const breakBtn = document.getElementById('break-btn')
const useBtn = document.getElementById('use-btn')
const craftBtn = document.getElementById('craft-btn')
const toastEl = document.getElementById('toast')
const connectionPill = document.getElementById('connection-pill')
const viewerCapture = document.getElementById('viewer-capture')
const viewerFrame = document.getElementById('viewer-frame')

const keyMap = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint',
  ControlLeft: 'sneak'
}

let liveState = null
let lookState = {
  active: false,
  yaw: 0,
  pitch: 0
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  const formData = new FormData(form)
  socket.emit('connect-bot', Object.fromEntries(formData.entries()))
})

breakBtn.addEventListener('click', () => socket.emit('swing'))
useBtn.addEventListener('click', () => socket.emit('use-target'))
craftBtn.addEventListener('click', () => {
  socket.emit('craft-item', {
    itemName: craftNameEl.value,
    amount: Number(craftAmountEl.value || 1)
  })
})

window.addEventListener('keydown', (event) => {
  const control = keyMap[event.code]
  if (!control || event.repeat) return
  socket.emit('control-state', { control, state: true })
})

window.addEventListener('keyup', (event) => {
  const control = keyMap[event.code]
  if (!control) return
  socket.emit('control-state', { control, state: false })
})

viewerCapture.addEventListener('mousedown', () => {
  lookState.active = true
})

window.addEventListener('mouseup', () => {
  lookState.active = false
})

window.addEventListener('mousemove', (event) => {
  if (!lookState.active || !liveState?.connected) return
  lookState.yaw -= event.movementX * 0.0025
  lookState.pitch -= event.movementY * 0.0025
  const limit = Math.PI / 2
  lookState.pitch = Math.max(-limit, Math.min(limit, lookState.pitch))
  socket.emit('look', { yaw: lookState.yaw, pitch: lookState.pitch })
})

viewerFrame.addEventListener('load', () => {
  viewerFrame.contentWindow?.focus()
})

socket.on('state', (state) => {
  liveState = state
  renderState(state)
})

socket.on('telemetry', (telemetry) => {
  if (!liveState) return
  renderTelemetry(telemetry)
})

socket.on('action-error', (message) => {
  toastEl.textContent = message
  toastEl.classList.remove('hidden')
  window.setTimeout(() => toastEl.classList.add('hidden'), 3200)
})

function renderState(state) {
  statusEl.textContent = state.status
  connectionPill.textContent = state.connected ? 'online' : state.connecting ? 'connecting' : 'offline'
  connectionPill.classList.toggle('online', state.connected)

  renderTelemetry(state)
  renderInventory(state.inventory)
  renderCraftable(state.craftable)
}

function renderTelemetry(data) {
  healthEl.textContent = data.health ?? 0
  foodEl.textContent = data.food ?? 0
  xpEl.textContent = data.experience ?? 0
  heldItemEl.textContent = data.heldItem ? `${data.heldItem.displayName} ×${data.heldItem.count}` : 'None'

  if (data.position) {
    positionEl.textContent = `x: ${data.position.x}, y: ${data.position.y}, z: ${data.position.z}`
  }

  targetBlockEl.textContent = data.targetBlock
    ? `Target: ${data.targetBlock.displayName} @ ${data.targetBlock.position.x}, ${data.targetBlock.position.y}, ${data.targetBlock.position.z}`
    : 'Target: none'
}

function renderInventory(items = []) {
  inventoryEl.innerHTML = ''
  if (!items.length) {
    inventoryEl.innerHTML = '<div class="inventory-entry">Inventory is empty.</div>'
    return
  }

  for (const item of items) {
    const wrapper = document.createElement('div')
    wrapper.className = 'inventory-entry'
    wrapper.innerHTML = `
      <div class="inventory-meta">
        <strong>${item.displayName}</strong>
        <small>${item.name} · slot ${item.slot}</small>
      </div>
      <div class="button-row">
        <span>×${item.count}</span>
        <button type="button">Hold</button>
      </div>
    `
    wrapper.querySelector('button').addEventListener('click', () => {
      socket.emit('equip-slot', { slot: item.slot })
    })
    inventoryEl.appendChild(wrapper)
  }
}

function renderCraftable(items = []) {
  craftableListEl.innerHTML = ''
  for (const item of items) {
    const option = document.createElement('option')
    option.value = item.name
    option.label = item.displayName
    craftableListEl.appendChild(option)
  }
}
