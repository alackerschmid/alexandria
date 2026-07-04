<template>
  <div class="bg-charcoal min-h-screen flex flex-col">
    <AppHeader />

    <div class="flex flex-1 min-h-0">
      <!-- ── Desktop nav rail ──────────────────────────────────────────────── -->
      <aside
        class="hidden md:flex flex-col flex-none w-[280px] border-r border-charcoal-border py-8 sticky top-0 h-[calc(100vh-57px)] overflow-y-auto shrink-0"
      >
        <h1
          class="font-heading text-[30px] font-black text-text-primary px-7 leading-none mb-1"
        >
          {{ $t("settings.heading") }}
        </h1>
        <p
          class="font-mono text-[10px] text-text-secondary/70 px-7 mb-7 truncate"
        >
          {{ $t("settings.signed_in_as", { email: authStore.email }) }}
        </p>
        <nav>
          <a
            v-for="s in NAV_SECTIONS"
            :key="s.id"
            :href="`#${s.id}`"
            class="flex items-center gap-3 px-7 py-[11px] text-[13px] transition-colors border-l-2 cursor-pointer"
            :class="
              activeSection === s.id
                ? 'border-orange-neon text-text-primary bg-white/[0.03]'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            "
            @click.prevent="scrollTo(s.id)"
          >
            {{ s.label }}
          </a>
        </nav>
      </aside>

      <!-- ── Main content ──────────────────────────────────────────────────── -->
      <main class="flex-1 min-w-0 px-6 md:px-12 pt-8 md:pt-10 pb-28 md:pb-10 overflow-y-auto">
        <div class="max-w-[720px] flex flex-col gap-14">
          <!-- Mobile heading -->
          <div class="md:hidden">
            <h1
              class="font-heading text-[34px] font-black text-text-primary leading-none"
            >
              {{ $t("settings.heading") }}
            </h1>
            <p
              class="font-mono text-[10px] text-text-secondary/70 mt-2 truncate"
            >
              {{ $t("settings.signed_in_as", { email: authStore.email }) }}
            </p>
          </div>

          <!-- ── ACCOUNT ──────────────────────────────────────────────────── -->
          <section id="account" ref="sectionRefs.account">
            <SectionHeading
              :title="$t('settings.account.heading')"
              :description="$t('settings.account.description')"
            />

            <div class="grid md:grid-cols-2 gap-5 md:gap-x-7 max-w-full">
              <SettingsField :label="$t('settings.account.firstname')">
                <input
                  v-model="accountForm.firstname"
                  type="text"
                  class="settings-input"
                  autocomplete="given-name"
                />
              </SettingsField>
              <SettingsField :label="$t('settings.account.email')">
                <input
                  v-model="accountForm.email"
                  type="email"
                  class="settings-input"
                  autocomplete="email"
                />
              </SettingsField>
            </div>

            <!-- Password change toggle -->
            <div class="mt-5">
              <button
                v-if="!showPasswordForm"
                class="font-mono text-[10px] tracking-[0.14em] uppercase text-text-secondary hover:text-text-primary transition-colors"
                @click="showPasswordForm = true"
              >
                {{ $t("settings.account.change_password") }} →
              </button>

              <div v-else class="flex flex-col gap-4 max-w-xs">
                <SettingsField :label="$t('settings.account.current_password')">
                  <input
                    v-model="passwordForm.current"
                    type="password"
                    class="settings-input"
                    autocomplete="current-password"
                  />
                </SettingsField>
                <SettingsField :label="$t('settings.account.new_password')">
                  <input
                    v-model="passwordForm.next"
                    type="password"
                    class="settings-input"
                    autocomplete="new-password"
                  />
                </SettingsField>
                <SettingsField :label="$t('settings.account.confirm_password')">
                  <input
                    v-model="passwordForm.confirm"
                    type="password"
                    class="settings-input"
                    autocomplete="new-password"
                  />
                </SettingsField>
                <p
                  v-if="passwordError"
                  class="text-[11px]"
                  style="color: rgb(var(--v-theme-error))"
                >
                  {{ passwordError }}
                </p>
                <button
                  class="self-start font-mono text-[10px] tracking-[0.14em] uppercase text-text-secondary/60 hover:text-text-secondary transition-colors"
                  @click="
                    showPasswordForm = false;
                    Object.assign(passwordForm, {
                      current: '',
                      next: '',
                      confirm: '',
                    });
                    passwordError = '';
                  "
                >
                  {{ $t("settings.account.hide_password_form") }}
                </button>
              </div>
            </div>

            <div class="mt-6 flex items-center gap-4">
              <v-btn
                variant="flat"
                color="primary"
                rounded="0"
                elevation="0"
                size="small"
                class="text-[10px] tracking-[0.16em] uppercase font-bold px-2"
                :loading="savingAccount"
                @click="saveAccount"
              >
                {{ $t("settings.account.save") }}
              </v-btn>
              <transition name="fade">
                <span
                  v-if="accountSaved"
                  class="font-mono text-[11px] text-text-secondary"
                >
                  {{ $t("settings.account.saved") }} ✓
                </span>
              </transition>
              <span
                v-if="accountError"
                class="font-mono text-[11px]"
                style="color: rgb(var(--v-theme-error))"
              >
                {{ accountError }}
              </span>
            </div>
          </section>

          <!-- ── ACCENT ───────────────────────────────────────────────────── -->
          <section id="accent" ref="sectionRefs.accent">
            <SectionHeading
              :title="$t('settings.accent.heading')"
              :description="$t('settings.accent.description')"
            />

            <div class="flex items-center gap-3 flex-wrap">
              <button
                v-for="preset in ACCENT_PRESETS"
                :key="preset"
                class="w-[34px] h-[34px] rounded-full transition-all"
                :style="{
                  background: preset,
                  border:
                    accentStore.color === preset
                      ? '2px solid rgb(var(--v-theme-on-background))'
                      : '2px solid transparent',
                  boxShadow:
                    accentStore.color === preset
                      ? `0 0 0 1px ${preset}`
                      : 'none',
                }"
                :title="preset"
                @click="accentStore.set(preset)"
              />

              <span class="w-px h-[34px] bg-charcoal-border mx-1" />

              <!-- Native color picker -->
              <label
                class="inline-flex items-center gap-2.5 border border-charcoal-border px-3 py-[7px] cursor-pointer hover:border-orange-neon transition-colors"
              >
                <span
                  class="w-5 h-5 rounded-full border border-white/15 flex-none"
                  :style="{ background: accentStore.color }"
                />
                <span
                  class="font-mono text-[12px] text-text-primary uppercase tracking-[0.04em]"
                >
                  {{
                    isPreset(accentStore.color)
                      ? accentStore.color
                      : $t("settings.accent.custom")
                  }}
                </span>
                <input
                  type="color"
                  :value="accentStore.color"
                  class="w-0 h-0 opacity-0 absolute pointer-events-none"
                  @input="
                    accentStore.set(($event.target as HTMLInputElement).value)
                  "
                />
              </label>
            </div>
          </section>

          <!-- ── CUSTOM FIELDS ────────────────────────────────────────────── -->
          <section id="fields" ref="sectionRefs.fields">
            <SectionHeading
              :title="$t('settings.fields.heading')"
              :description="$t('settings.fields.description')"
            />

            <div class="border border-charcoal-border">
              <!-- Header row -->
              <div
                class="grid gap-0 px-4 border-b border-charcoal-border bg-charcoal-light"
                style="grid-template-columns: 1fr 120px 96px 40px"
              >
                <div class="settings-col-head">
                  {{ $t("settings.fields.col_name") }}
                </div>
                <div class="settings-col-head">
                  {{ $t("settings.fields.col_type") }}
                </div>
                <div class="settings-col-head">
                  {{ $t("settings.fields.col_required") }}
                </div>
                <div />
              </div>

              <!-- Existing fields -->
              <div
                v-for="(def, i) in fieldDefsStore.defs"
                :key="def.id"
                class="grid items-center gap-0 px-4 transition-colors hover:bg-white/[0.02]"
                :class="i > 0 ? 'border-t border-charcoal-border/60' : ''"
                style="grid-template-columns: 1fr 120px 96px 40px"
              >
                <input
                  :value="def.name"
                  type="text"
                  class="bg-transparent border-0 border-b border-transparent text-[14px] text-text-primary pt-3 pb-2 mb-2 w-[calc(100%-1rem)] focus-ring-none transition-colors focus-visible:border-orange-neon"
                  @blur="onFieldNameBlur(def, $event)"
                  @keydown.enter="($event.target as HTMLInputElement).blur()"
                />
                <div>
                  <button
                    class="border border-charcoal-border/60 text-text-secondary font-mono text-[10px] tracking-[0.08em] uppercase px-2.5 py-1.5 hover:border-charcoal-border transition-colors"
                    @click="cycleFieldType(def)"
                  >
                    {{ typeLabel(def.type) }} ⇅
                  </button>
                </div>
                <div>
                  <button
                    role="switch"
                    :aria-checked="def.required"
                    :aria-label="$t('settings.fields.col_required')"
                    class="w-9 h-5 rounded-full relative transition-colors flex-none"
                    :style="{
                      background: def.required
                        ? accentStore.color
                        : 'rgba(138,128,120,0.3)',
                    }"
                    @click="
                      fieldDefsStore.update(def.id, { required: !def.required })
                    "
                  >
                    <span
                      class="absolute top-0.5 w-4 h-4 rounded-full bg-charcoal transition-all duration-150"
                      :style="{
                        left: def.required ? 'calc(100% - 18px)' : '2px',
                      }"
                    />
                  </button>
                </div>
                <div class="flex justify-end">
                  <button
                    class="text-base leading-none p-1 transition-colors"
                    :class="
                      confirmingDeleteFieldId === def.id
                        ? 'text-error'
                        : 'text-text-secondary/50 hover:text-text-primary'
                    "
                    :aria-label="
                      confirmingDeleteFieldId === def.id
                        ? $t('settings.fields.confirm_delete', {
                            name: def.name,
                          })
                        : $t('settings.fields.delete', { name: def.name })
                    "
                    @click="deleteField(def.id)"
                    @blur="confirmingDeleteFieldId = null"
                  >
                    ×
                  </button>
                </div>
              </div>

              <!-- New field input row -->
              <div
                v-if="addingField"
                class="grid items-center gap-0 px-4 border-t border-charcoal-border/60"
                style="grid-template-columns: 1fr 120px 96px 40px"
              >
                <input
                  ref="newFieldInput"
                  v-model="newFieldName"
                  type="text"
                  :placeholder="$t('settings.fields.new_placeholder')"
                  class="bg-transparent border-0 border-b border-transparent text-[14px] text-text-primary pt-3 pb-2 mb-1 w-[calc(100%-1rem)] placeholder:text-text-secondary/30 focus-ring-none transition-colors focus-visible:border-orange-neon"
                  @keydown.enter="confirmAddField"
                  @keydown.escape="
                    addingField = false;
                    newFieldName = '';
                  "
                />
                <div>
                  <button
                    class="border border-charcoal-border/60 text-text-secondary font-mono text-[10px] tracking-[0.08em] uppercase px-2.5 py-1.5 hover:border-charcoal-border transition-colors"
                    @click="cycleNewFieldType"
                  >
                    {{ typeLabel(newFieldType) }} ⇅
                  </button>
                </div>
                <div />
                <div class="flex justify-end">
                  <button
                    class="text-text-secondary/50 hover:text-text-primary transition-colors text-base leading-none p-1"
                    :aria-label="$t('detail.edit_cancel')"
                    @click="
                      addingField = false;
                      newFieldName = '';
                    "
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>

            <div class="mt-4 flex items-center gap-4">
              <button
                class="inline-flex items-center gap-2 border border-dashed border-charcoal-border px-[18px] py-3 font-mono text-[10px] tracking-[0.14em] uppercase transition-colors hover:border-orange-neon"
                :style="{ color: accentStore.color }"
                @click="startAddField"
              >
                <span class="text-sm leading-none">+</span>
                {{ $t("settings.fields.add") }}
              </button>
              <v-btn
                v-if="addingField"
                variant="flat"
                color="primary"
                rounded="0"
                elevation="0"
                size="small"
                class="text-[10px] tracking-[0.16em] uppercase px-2"
                :loading="savingField"
                @click="confirmAddField"
              >
                {{ $t("settings.account.save") }}
              </v-btn>
            </div>
          </section>

          <!-- ── EXPORT ───────────────────────────────────────────────────── -->
          <section id="export" ref="sectionRefs.export">
            <SectionHeading :title="$t('settings.export.heading')" />

            <div
              class="flex items-center justify-between gap-6 border border-charcoal-border p-6"
            >
              <div>
                <p class="text-[15px] text-text-primary font-medium">
                  {{ $t("settings.export.description") }}
                </p>
              </div>
              <v-tooltip
                :text="$t('settings.export.coming_soon')"
                location="top"
              >
                <template #activator="{ props: tipProps }">
                  <button
                    v-bind="tipProps"
                    aria-disabled="true"
                    class="flex-none border font-mono text-[10px] tracking-[0.16em] uppercase px-[22px] py-3 opacity-40 cursor-not-allowed whitespace-nowrap"
                    :style="{
                      color: 'rgb(var(--v-theme-on-background))',
                      borderColor: accentStore.color,
                    }"
                    @click.prevent
                  >
                    {{ $t("settings.export.button") }}
                  </button>
                </template>
              </v-tooltip>
            </div>
          </section>

          <!-- ── DEFAULTS ─────────────────────────────────────────────────── -->
          <section id="defaults" ref="sectionRefs.defaults">
            <SectionHeading
              :title="$t('settings.defaults.heading')"
              :description="$t('settings.defaults.description')"
            />

            <div class="flex flex-col">
              <DefaultRow
                :label="$t('settings.defaults.language')"
                :first="true"
              >
                <SegControl
                  :options="[
                    { value: 'en', label: 'English' },
                    { value: 'de', label: 'Deutsch' },
                  ]"
                  :model-value="localeStore.locale"
                  @update:model-value="localeStore.set($event)"
                />
              </DefaultRow>
              <DefaultRow :label="$t('settings.defaults.theme')">
                <SegControl
                  :options="[
                    {
                      value: 'light',
                      label: $t('settings.defaults.theme_light'),
                    },
                    {
                      value: 'dark',
                      label: $t('settings.defaults.theme_dark'),
                    },
                    {
                      value: 'auto',
                      label: $t('settings.defaults.theme_auto'),
                    },
                  ]"
                  :model-value="themeStore.mode"
                  @update:model-value="themeStore.setMode($event as ThemeMode)"
                />
              </DefaultRow>
              <DefaultRow :label="$t('settings.defaults.view')">
                <SegControl
                  :options="[
                    { value: 'list', label: $t('settings.defaults.view_list') },
                    { value: 'tile', label: $t('settings.defaults.view_tile') },
                  ]"
                  :model-value="libraryDefaultsStore.defaultView"
                  @update:model-value="
                    libraryDefaultsStore.setView($event as 'list' | 'tile')
                  "
                />
              </DefaultRow>
              <DefaultRow :label="$t('settings.defaults.scan_status')">
                <SegControl
                  :options="[
                    { value: 'unread', label: $t('book.unread') },
                    { value: 'reading', label: $t('book.reading') },
                    { value: 'read', label: $t('book.read') },
                  ]"
                  :model-value="libraryDefaultsStore.defaultScanStatus"
                  @update:model-value="
                    libraryDefaultsStore.setStatus($event as ReadStatus)
                  "
                />
              </DefaultRow>
            </div>
          </section>

          <!-- ── DANGER ───────────────────────────────────────────────────── -->
          <section id="danger" ref="sectionRefs.danger" class="pb-16">
            <div class="flex items-baseline gap-4 mb-[18px]">
              <span
                class="font-heading font-black text-[22px] leading-none"
                style="color: rgb(var(--v-theme-error))"
              >
                {{ $t("settings.danger.heading") }}
              </span>
              <span
                class="flex-1 h-px"
                style="background: rgba(var(--v-theme-error), 0.25)"
              />
            </div>

            <div
              class="flex items-center justify-between gap-6 border p-6"
              style="
                border-color: rgba(var(--v-theme-error), 0.3);
                background: rgba(var(--v-theme-error), 0.04);
              "
            >
              <div>
                <p class="text-[15px] text-text-primary font-medium">
                  {{ $t("settings.danger.delete_heading") }}
                </p>
                <p
                  class="text-[12px] text-text-secondary mt-1 max-w-md leading-relaxed"
                >
                  {{ $t("settings.danger.delete_body") }}
                </p>
              </div>
              <button
                class="flex-none border font-mono text-[10px] tracking-[0.16em] uppercase px-[22px] py-3 transition-colors whitespace-nowrap hover:opacity-80"
                style="
                  color: rgb(var(--v-theme-error));
                  border-color: rgb(var(--v-theme-error));
                "
                @click="deleteDialog = true"
              >
                {{ $t("settings.danger.delete_button") }}
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>

    <!-- ── Delete account dialog ────────────────────────────────────────── -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card rounded="0" :color="themeStore.isDark ? '#1c1b19' : '#ffffff'">
        <v-card-title
          class="font-heading text-xl pt-6 px-6 font-black text-text-primary"
          style="color: rgb(var(--v-theme-error))"
        >
          {{ $t("settings.danger.dialog_heading") }}
        </v-card-title>
        <v-card-text class="px-6 text-sm text-text-secondary leading-relaxed">
          {{ $t("settings.danger.dialog_body") }}
          <div class="flex flex-col gap-3 mt-5">
            <SettingsField :label="$t('settings.danger.dialog_email_label')">
              <input
                v-model="deleteConfirmEmail"
                type="email"
                class="settings-input"
                autocomplete="off"
              />
            </SettingsField>
            <SettingsField :label="$t('settings.danger.dialog_password_label')">
              <input
                v-model="deleteConfirmPassword"
                type="password"
                class="settings-input"
                autocomplete="current-password"
              />
            </SettingsField>
            <p
              v-if="deleteError"
              class="text-[11px]"
              style="color: rgb(var(--v-theme-error))"
            >
              {{ deleteError }}
            </p>
          </div>
        </v-card-text>
        <v-card-actions class="px-4 pb-4 gap-2">
          <v-spacer />
          <v-btn
            variant="text"
            size="small"
            class="text-[10px] tracking-[0.2em] uppercase text-text-secondary"
            @click="
              deleteDialog = false;
              deleteConfirmEmail = '';
              deleteConfirmPassword = '';
              deleteError = '';
            "
          >
            {{ $t("settings.danger.dialog_cancel") }}
          </v-btn>
          <v-btn
            variant="flat"
            size="small"
            color="error"
            rounded="0"
            class="text-[10px] tracking-[0.2em] uppercase"
            :loading="deletingAccount"
            :disabled="
              deleteConfirmEmail.toLowerCase() !==
                (authStore.email ?? '').toLowerCase() || !deleteConfirmPassword
            "
            @click="confirmDeleteAccount"
          >
            {{ $t("settings.danger.dialog_confirm") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <AppToast
      v-model="toast.show"
      :message="toast.message"
      :type="toast.type"
      :timeout="3500"
    />
  </div>
</template>

<script lang="ts" setup>
import {
  ref,
  reactive,
  nextTick,
  onMounted,
  onUnmounted,
  defineComponent,
  h,
} from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import { useThemeStore, type ThemeMode } from "@/stores/theme";
import { useLocaleStore } from "@/stores/locale";
import { useAccentStore } from "@/stores/accent";
import { useLibraryDefaultsStore } from "@/stores/libraryDefaults";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import { useApi } from "@/composables/useApi";
import type { ReadStatus } from "@/types/book";
import AppHeader from "@/components/AppHeader.vue";
import AppToast from "@/components/AppToast.vue";

const { t } = useI18n();
const authStore = useAuthStore();
const themeStore = useThemeStore();
const localeStore = useLocaleStore();
const accentStore = useAccentStore();
const libraryDefaultsStore = useLibraryDefaultsStore();
const fieldDefsStore = useFieldDefsStore();
const { apiFetch } = useApi();

// ── Nav sections ─────────────────────────────────────────────────────────────

const NAV_SECTIONS = [
  {
    id: "account",
    get label() {
      return t("settings.account.heading");
    },
  },
  {
    id: "accent",
    get label() {
      return t("settings.accent.heading");
    },
  },
  {
    id: "fields",
    get label() {
      return t("settings.fields.heading");
    },
  },
  {
    id: "export",
    get label() {
      return t("settings.export.heading");
    },
  },
  {
    id: "defaults",
    get label() {
      return t("settings.defaults.heading");
    },
  },
  {
    id: "danger",
    get label() {
      return t("settings.danger.heading");
    },
  },
];

const activeSection = ref("account");

function scrollTo(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Scrollspy via IntersectionObserver
let observer: IntersectionObserver | null = null;

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          activeSection.value = entry.target.id;
        }
      }
    },
    { rootMargin: "-40% 0px -55% 0px", threshold: 0 },
  );
  for (const s of NAV_SECTIONS) {
    const el = document.getElementById(s.id);
    if (el) observer.observe(el);
  }
});

onUnmounted(() => observer?.disconnect());

// ── Accent presets ────────────────────────────────────────────────────────────

const ACCENT_PRESETS = [
  "#ff6600",
  "#d9534f",
  "#d4a017",
  "#2d8f4e",
  "#3b6dde",
  "#9b4dca",
];
const isPreset = (c: string) => ACCENT_PRESETS.includes(c);

// ── Account form ──────────────────────────────────────────────────────────────

const accountForm = reactive({
  firstname: authStore.firstname ?? "",
  email: authStore.email ?? "",
});
const showPasswordForm = ref(false);
const passwordForm = reactive({ current: "", next: "", confirm: "" });
const passwordError = ref("");
const savingAccount = ref(false);
const accountError = ref("");
const accountSaved = ref(false);

let savedTimer: ReturnType<typeof setTimeout> | null = null;

async function saveAccount() {
  accountError.value = "";
  passwordError.value = "";
  savingAccount.value = true;

  const body: Record<string, string> = {};

  const trimmedName = accountForm.firstname.trim();
  if (trimmedName && trimmedName !== (authStore.firstname ?? ""))
    body.firstname = trimmedName;
  const trimmedEmail = accountForm.email.trim().toLowerCase();
  if (trimmedEmail && trimmedEmail !== (authStore.email ?? "").toLowerCase())
    body.email = trimmedEmail;

  if (showPasswordForm.value) {
    if (passwordForm.next !== passwordForm.confirm) {
      passwordError.value = t("settings.account.password_mismatch");
      savingAccount.value = false;
      return;
    }
    if (passwordForm.next) {
      body.currentPassword = passwordForm.current;
      body.newPassword = passwordForm.next;
    }
  }

  if (Object.keys(body).length === 0) {
    savingAccount.value = false;
    return;
  }

  try {
    const res = await apiFetch(
      "/api/auth/me",
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
      { on401: "ignore" },
    );
    const data = (await res.json()) as {
      firstname?: string;
      email?: string;
      passwordChanged?: boolean;
      error?: string;
    };
    if (!res.ok) {
      accountError.value = data.error ?? t("detail.edit_error");
    } else {
      if (data.firstname) authStore.setFirstname(data.firstname);
      if (data.email) authStore.setEmail(data.email);
      if (data.passwordChanged) {
        showPasswordForm.value = false;
        Object.assign(passwordForm, { current: "", next: "", confirm: "" });
        showToast(t("settings.account.password_saved"), "success");
      }
      accountSaved.value = true;
      if (savedTimer) clearTimeout(savedTimer);
      savedTimer = setTimeout(() => {
        accountSaved.value = false;
      }, 2500);
    }
  } catch {
    accountError.value = t("detail.edit_error");
  } finally {
    savingAccount.value = false;
  }
}

// ── Custom fields ─────────────────────────────────────────────────────────────

// "select" is intentionally excluded — existing select fields still render (as text) via
// TYPE_LABELS/worker VALID_TYPES, but the type isn't offered until proper option editing exists.
const FIELD_TYPES = ["text", "integer", "tag", "date"];
const TYPE_LABELS: Record<string, string> = {
  text: t("settings.fields.type_text"),
  integer: t("settings.fields.type_number"),
  select: t("settings.fields.type_select"),
  tag: t("settings.fields.type_tag"),
  date: t("settings.fields.type_date"),
};
function typeLabel(type: string) {
  return TYPE_LABELS[type] ?? type;
}

function cycleFieldType(def: { id: number; type: string }) {
  const next =
    FIELD_TYPES[(FIELD_TYPES.indexOf(def.type) + 1) % FIELD_TYPES.length];
  fieldDefsStore.update(def.id, { type: next });
}

async function onFieldNameBlur(
  def: { id: number; name: string },
  e: FocusEvent,
) {
  const val = (e.target as HTMLInputElement).value.trim();
  if (val && val !== def.name) {
    const result = await fieldDefsStore.update(def.id, { name: val });
    if (result && !result.ok) {
      showToast(result.error ?? t("detail.edit_error"), "error");
      (e.target as HTMLInputElement).value = def.name;
    }
  } else {
    (e.target as HTMLInputElement).value = def.name;
  }
}

const confirmingDeleteFieldId = ref<number | null>(null);

async function deleteField(id: number) {
  if (confirmingDeleteFieldId.value !== id) {
    confirmingDeleteFieldId.value = id;
    return;
  }
  confirmingDeleteFieldId.value = null;
  try {
    const res = await apiFetch(`/api/field-definitions/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      fieldDefsStore.remove(id);
    } else {
      showToast(t("detail.edit_error"), "error");
    }
  } catch {
    showToast(t("detail.edit_error"), "error");
  }
}

const addingField = ref(false);
const newFieldName = ref("");
const newFieldType = ref("text");
const newFieldInput = ref<HTMLInputElement | null>(null);
const savingField = ref(false);

function cycleNewFieldType() {
  newFieldType.value =
    FIELD_TYPES[
      (FIELD_TYPES.indexOf(newFieldType.value) + 1) % FIELD_TYPES.length
    ];
}

async function startAddField() {
  if (addingField.value) {
    await confirmAddField();
    return;
  }
  addingField.value = true;
  await nextTick();
  newFieldInput.value?.focus();
}

async function confirmAddField() {
  const name = newFieldName.value.trim();
  if (!name) return;
  savingField.value = true;
  try {
    const res = await apiFetch("/api/field-definitions", {
      method: "POST",
      body: JSON.stringify({ name, type: newFieldType.value }),
    });
    const data = await res.json();
    if (res.ok) {
      fieldDefsStore.add({ ...data, required: false });
      newFieldName.value = "";
      newFieldType.value = "text";
      addingField.value = false;
    } else {
      showToast(data.error ?? t("detail.edit_error"), "error");
    }
  } catch {
    showToast(t("detail.edit_error"), "error");
  } finally {
    savingField.value = false;
  }
}

// ── Delete account ────────────────────────────────────────────────────────────

const deleteDialog = ref(false);
const deleteConfirmEmail = ref("");
const deleteConfirmPassword = ref("");
const deleteError = ref("");
const deletingAccount = ref(false);

async function confirmDeleteAccount() {
  deleteError.value = "";
  deletingAccount.value = true;
  try {
    const res = await apiFetch(
      "/api/auth/me",
      {
        method: "DELETE",
        body: JSON.stringify({ password: deleteConfirmPassword.value }),
      },
      { on401: "ignore" },
    );
    if (res.status === 204 || res.ok) {
      authStore.logout();
    } else {
      const data = (await res.json()) as { error?: string };
      deleteError.value = data.error ?? t("detail.edit_error");
    }
  } catch {
    deleteError.value = t("detail.edit_error");
  } finally {
    deletingAccount.value = false;
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

const toast = reactive({
  show: false,
  message: "",
  type: "error" as "error" | "success",
});
function showToast(message: string, type: "error" | "success" = "error") {
  toast.message = message;
  toast.type = type;
  toast.show = true;
}

// ── Init ──────────────────────────────────────────────────────────────────────

onMounted(() => {
  fieldDefsStore.loaded = false;
  fieldDefsStore.load();
});

// ── Inline sub-components ─────────────────────────────────────────────────────

const SectionHeading = defineComponent({
  props: { title: String, description: String },
  setup(props) {
    return () =>
      h("div", { class: "mb-6" }, [
        h("div", { class: "flex items-baseline gap-4 mb-1.5" }, [
          h(
            "h2",
            {
              class:
                "font-heading font-black text-[22px] text-text-primary leading-none",
            },
            props.title,
          ),
          h("span", { class: "flex-1 h-px bg-charcoal-border" }),
        ]),
        props.description
          ? h(
              "p",
              {
                class:
                  "text-[13px] text-text-secondary max-w-lg leading-relaxed",
              },
              props.description,
            )
          : null,
      ]);
  },
});

const SettingsField = defineComponent({
  props: { label: String },
  setup(props, ctx) {
    return () =>
      h("label", { class: "flex flex-col gap-2" }, [
        h(
          "span",
          {
            class:
              "font-mono text-[10px] tracking-[0.16em] uppercase text-text-secondary",
          },
          props.label,
        ),
        ctx.slots.default?.(),
      ]);
  },
});

const DefaultRow = defineComponent({
  props: { label: String, first: Boolean },
  setup(props, ctx) {
    return () =>
      h(
        "div",
        {
          class: [
            "flex items-center justify-between gap-6 py-4",
            !props.first ? "border-t border-charcoal-border/60" : "",
          ].join(" "),
        },
        [
          h("span", { class: "text-[14px] text-text-primary" }, props.label),
          ctx.slots.default?.(),
        ],
      );
  },
});

const SegControl = defineComponent({
  props: {
    options: {
      type: Array as () => { value: string; label: string }[],
      required: true,
    },
    modelValue: { type: String, required: true },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h(
        "div",
        {
          class:
            "inline-flex border border-charcoal-border overflow-hidden flex-wrap",
        },
        props.options.map((opt, k) =>
          h(
            "button",
            {
              key: opt.value,
              onClick: () => emit("update:modelValue", opt.value),
              class: [
                "px-4 py-2 font-mono text-[10px] tracking-[0.1em] uppercase transition-colors",
                k > 0 ? "border-l border-charcoal-border" : "",
              ].join(" "),
              style:
                opt.value === props.modelValue
                  ? {
                      background: accentStore.color,
                      color: "#111110",
                      fontWeight: 700,
                    }
                  : {
                      background: "transparent",
                      color: "rgb(var(--v-theme-text-secondary))",
                    },
            },
            opt.label,
          ),
        ),
      );
  },
});
</script>

<style scoped>
.settings-input {
  width: 100%;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgb(var(--v-theme-border));
  color: rgb(var(--v-theme-on-surface));
  font-size: 14px;
  padding: 12px 14px;
  outline: none;
  transition: border-color 0.15s;
  font-family: inherit;
}
.settings-input:focus {
  border-color: var(--color-orange-neon);
}
.settings-col-head {
  font-family: "Roboto Mono", monospace;
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-text-secondary));
  padding: 11px 0;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
