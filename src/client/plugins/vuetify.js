import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
import { createVuetify } from 'vuetify'

export default createVuetify({
  theme: { defaultTheme: 'poshinit', themes: { poshinit: { dark: true, colors: { background: '#16072b', surface: '#221040', primary: '#dd8aff', secondary: '#ff62d1', success: '#a879ff', warning: '#ff62d1', error: '#ff5a9b', info: '#dd8aff' } } } },
  defaults: { VBtn: { rounded: 0, variant: 'flat', height: 32 }, VTextField: { density: 'compact', variant: 'outlined' }, VTextarea: { density: 'compact', variant: 'outlined' }, VSelect: { density: 'compact', variant: 'outlined' }, VTable: { density: 'compact' }, VChip: { rounded: 0, size: 'small' } },
})
