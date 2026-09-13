<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AppShell from './components/app/AppShell.vue'
import { useAppStore } from './stores/app'

const store = useAppStore()

const form = reactive({
  email: 'admin@poshinit.local',
  password: 'ChangeMe123!',
  mfaCode: '',
})

const loginDisabled = computed(() => store.loading || !form.email || !form.password)
const enterpriseEnabled = ref(false)
const enterprisePending = ref(false)

async function submitLogin() {
  await store.login(form.email, form.password, form.mfaCode)
}

watch(() => store.currentUser?.theme, (theme) => { document.documentElement.dataset.theme = theme || 'purple' }, { immediate: true })

function startEnterpriseLogin() {
  globalThis.location.assign('/auth/entra/start')
}

onMounted(async () => {
  const url = new URL(globalThis.location.href)
  const ticket = url.searchParams.get('enterpriseTicket')
  if (ticket) {
    enterprisePending.value = true
    try {
      await store.completeEnterpriseLogin(ticket)
    } catch (error) {
      store.lastError = error.message
    } finally {
      enterprisePending.value = false
      url.searchParams.delete('enterpriseTicket')
      globalThis.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    }
  } else if (url.searchParams.get('enterpriseError')) {
    store.lastError = 'Enterprise sign-in was not completed. Contact an administrator if the problem persists.'
    url.searchParams.delete('enterpriseError')
    globalThis.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }

  try {
    const response = await fetch('/auth/entra/status')
    enterpriseEnabled.value = Boolean((await response.json()).enabled)
  } catch (_error) {
    enterpriseEnabled.value = false
  }

  if (store.token) {
    try {
      await store.bootstrap()
    } catch (_error) {
      store.logout()
    }
  }
})
</script>

<template>
  <v-app>
    <template v-if="store.isAuthenticated && store.currentUser">
      <AppShell />
    </template>

    <v-main v-else class="login-wrap">
      <div class="login-backdrop" />
      <div class="login-veil" />
      <v-container class="fill-height">
        <v-row class="fill-height" align="center" justify="center">
          <v-col cols="12" md="7" lg="5">
            <div class="login-card">
              <div class="login-brand"><img src="./assets/poshinit-mark.svg" alt="POSHinit" /><div><p class="section-eyebrow">PowerShell Control Plane</p><h1 class="hero-title">POSHinit</h1></div></div>
              <p class="muted login-copy">
                Multi-user PowerShell automation, scheduling, reporting, vaulting, and vCenter-backed inventory in one operator workspace.
              </p>

              <v-form @submit.prevent="submitLogin">
                <v-text-field v-model="form.email" label="Email" autocomplete="email" prepend-inner-icon="mdi-account-circle-outline" />
                <v-text-field
                  v-model="form.password"
                  label="Password"
                  type="password"
                  autocomplete="current-password"
                  prepend-inner-icon="mdi-key-outline"
                />
                <v-text-field v-model="form.mfaCode" label="Authenticator code (if enrolled)" autocomplete="one-time-code" inputmode="numeric" prepend-inner-icon="mdi-shield-key-outline" />
                <v-alert v-if="store.lastError" type="error" variant="tonal" class="mb-4">
                  {{ store.lastError }}
                </v-alert>
                <v-btn type="submit" size="large" block class="glass-button" :disabled="loginDisabled">
                  Enter Control Plane
                </v-btn>
                <div class="enterprise-divider"><span>or</span></div>
                <v-btn size="large" block variant="outlined" prepend-icon="mdi-microsoft" :loading="enterprisePending" :disabled="enterprisePending || !enterpriseEnabled" @click="startEnterpriseLogin">
                  Enterprise Login With Entra ID
                </v-btn>
                <p class="enterprise-note"><v-icon icon="mdi-shield-lock-outline" size="15" /> Uses your organization’s Entra ID and MFA policy.</p>
              </v-form>

              <div class="login-foot mono">
                Demo login: <strong>admin@poshinit.local</strong> / <strong>ChangeMe123!</strong>
              </div>
            </div>
          </v-col>
        </v-row>
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
.login-wrap {
  position: relative;
  overflow: hidden;
}

.login-backdrop {
  position: absolute;
  inset: 0;
  background: url('./assets/poshinit-login-nebula.png') center / cover no-repeat;
  transform: scale(1.02);
}

.login-veil { position:absolute; inset:0; background:linear-gradient(90deg,rgba(16,4,31,.84),rgba(19,5,38,.57) 48%,rgba(13,3,27,.84)),radial-gradient(circle at 20% 48%,rgba(255,82,204,.16),transparent 29%); }

.login-brand { display:flex; align-items:center; gap:15px; }
.login-brand img { width:60px; height:60px; filter:drop-shadow(0 0 14px rgba(255,95,216,.5)); }
.login-brand .hero-title { font-size:2.7rem; }

.login-card {
  position: relative;
  padding: 32px;
  border-radius: 0;
  clip-path: polygon(0 18px, 18px 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%);
  border: 1px solid rgba(247, 162, 255, .46);
  background: linear-gradient(145deg, rgba(53, 18, 87, .92), rgba(20, 5, 41, .94));
  backdrop-filter: blur(28px);
  box-shadow:
    0 20px 70px rgba(0, 0, 0, .56),
    0 0 42px rgba(223, 80, 255, .16),
    inset 0 1px 0 rgba(255, 231, 255, .12);
}

.login-copy {
  margin: 10px 0 28px;
}

.login-foot {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid rgba(151, 191, 255, 0.16);
  font-size: 0.82rem;
  color: #d6b6e4;
}

.enterprise-divider { display:flex; align-items:center; gap:10px; margin:16px 0; color:#c7a8d6; font:10px 'Share Tech Mono',monospace; text-transform:uppercase; letter-spacing:.1em; }.enterprise-divider::before,.enterprise-divider::after { content:''; flex:1; border-top:1px solid rgba(151,191,255,.16); }.enterprise-note { display:flex; align-items:center; justify-content:center; gap:6px; margin:10px 0 0; color:#c7a8d6; font-size:.72rem; }
</style>
