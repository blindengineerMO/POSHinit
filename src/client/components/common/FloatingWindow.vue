<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  modelValue: Boolean,
  title: {
    type: String,
    required: true,
  },
  width: {
    type: Number,
    default: 360,
  },
  startX: {
    type: Number,
    default: 48,
  },
  startY: {
    type: Number,
    default: 140,
  },
})

const emit = defineEmits(['update:modelValue'])

const position = ref({ x: props.startX, y: props.startY })
const dragging = ref(false)
let dragStart = null

const windowStyle = computed(() => ({
  width: `${props.width}px`,
  transform: `translate(${position.value.x}px, ${position.value.y}px)`,
}))

function close() {
  emit('update:modelValue', false)
}

function beginDrag(event) {
  dragging.value = true
  dragStart = {
    x: event.clientX - position.value.x,
    y: event.clientY - position.value.y,
  }
}

function onMove(event) {
  if (!dragging.value || !dragStart) {
    return
  }

  position.value = {
    x: Math.max(12, Math.min(window.innerWidth - props.width - 12, event.clientX - dragStart.x)),
    y: Math.max(88, Math.min(window.innerHeight - 220, event.clientY - dragStart.y)),
  }
}

function endDrag() {
  dragging.value = false
  dragStart = null
}

onMounted(() => {
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', endDrag)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', endDrag)
})
</script>

<template>
  <Teleport to="body">
    <transition name="window-fade">
      <section v-if="modelValue" class="window-frame" :style="windowStyle">
        <header class="window-head" @pointerdown="beginDrag">
          <div>
            <p class="section-eyebrow">Floating Workspace</p>
            <h3>{{ title }}</h3>
          </div>
          <v-btn icon="mdi-close" size="small" variant="text" @click="close" />
        </header>
        <div class="window-body">
          <slot />
        </div>
      </section>
    </transition>
  </Teleport>
</template>

<style scoped>
.window-frame {
  position: fixed;
  top: 0;
  left: 0;
  max-width: min(calc(100vw - 24px), 100%);
  max-height: min(74vh, 760px);
  z-index: 50;
  border-radius: 2px;
  border: 1px solid var(--line-hot);
  background: linear-gradient(180deg, rgba(52, 16, 84, .98), rgba(20, 5, 39, .98));
  box-shadow: 0 24px 70px rgba(4, 0, 14, .7), 0 0 30px rgba(255, 91, 210, .18);
  backdrop-filter: blur(20px);
  overflow: hidden;
}

.window-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  padding: 10px 13px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(90deg, rgba(208, 106, 255, .23), rgba(255, 97, 208, .1));
  cursor: move;
}

.window-body {
  padding: 14px;
  overflow: auto;
  max-height: calc(72vh - 82px);
}

h3 {
  margin: 3px 0 0;
  font-family: Rajdhani, sans-serif;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.window-fade-enter-active,
.window-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.window-fade-enter-from,
.window-fade-leave-to {
  opacity: 0;
}

@media (max-width: 900px) {
  .window-frame {
    inset: 92px 12px auto 12px;
    width: auto !important;
    transform: none !important;
    max-height: calc(100vh - 124px);
  }

  .window-body {
    max-height: calc(100vh - 206px);
  }
}
</style>
