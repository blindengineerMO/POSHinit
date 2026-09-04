<script setup>
defineProps({
  title: {
    type: String,
    default: '',
  },
  subtitle: {
    type: String,
    default: '',
  },
})
</script>

<template>
  <section class="panel">
    <div v-if="title || subtitle" class="panel-head">
      <div>
        <p v-if="subtitle" class="section-eyebrow">{{ subtitle }}</p>
        <h3 v-if="title">{{ title }}</h3>
      </div>
      <slot name="actions" />
    </div>
    <slot />
  </section>
</template>

<style scoped>
.panel {
  position: relative;
  overflow: hidden;
  border-radius: 2px;
  clip-path: polygon(0 10px, 10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%);
  border: 1px solid var(--line);
  background: linear-gradient(145deg, rgba(55, 19, 88, .83), rgba(25, 7, 47, .91));
  backdrop-filter: blur(16px);
  box-shadow: inset 0 1px 0 rgba(255, 212, 255, .09), 0 14px 35px rgba(11, 0, 21, .28);
}

.panel::before {
  content: '';
  position: absolute;
  inset: 0 auto auto 0;
  width: 100%;
  height: 1px;
  background: linear-gradient(90deg, var(--cyan), var(--amber), transparent 72%);
}

.panel-head {
  display: flex;
  gap: 18px;
  justify-content: space-between;
  align-items: flex-start;
  padding: 14px 16px 0;
}

h3 {
  margin: 3px 0 0;
  font-family: Rajdhani, sans-serif;
  font-size: 1.05rem;
  letter-spacing: .065em;
  text-transform: uppercase;
}
</style>
