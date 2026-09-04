<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['update:modelValue'])

const host = ref(null)
let editor

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'json') {
      return new jsonWorker()
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker()
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker()
    }
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker()
    }
    return new editorWorker()
  },
}

onMounted(() => {
  monaco.editor.defineTheme('poshinit-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6d8ca6' },
      { token: 'string', foreground: '82f0c5' },
      { token: 'keyword', foreground: '78b7ff' },
    ],
    colors: {
      'editor.background': '#091121',
      'editor.lineHighlightBackground': '#132241',
      'editorCursor.foreground': '#7be8ff',
      'editor.selectionBackground': '#2f3f7a66',
    },
  })

  editor = monaco.editor.create(host.value, {
    value: props.modelValue,
    language: 'shell',
    theme: 'poshinit-dark',
    automaticLayout: true,
    minimap: { enabled: true },
    fontFamily: 'Azeret Mono',
    fontSize: 13,
    padding: { top: 18, bottom: 18 },
    smoothScrolling: true,
  })

  editor.onDidChangeModelContent(() => {
    emit('update:modelValue', editor.getValue())
  })
})

watch(
  () => props.modelValue,
  (value) => {
    if (editor && value !== editor.getValue()) {
      editor.setValue(value || '')
    }
  },
)

onBeforeUnmount(() => {
  editor?.dispose()
})
</script>

<template>
  <div ref="host" class="editor-host" />
</template>

<style scoped>
.editor-host {
  min-height: 520px;
  border-radius: 24px;
  overflow: hidden;
  border: 1px solid rgba(145, 201, 255, 0.12);
}
</style>
