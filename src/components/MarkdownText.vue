<template>
  <!-- eslint-disable-next-line vue/no-v-html -- html comes from renderMarkdown, which sanitizes
       with DOMPurify against a fixed tag/attribute allowlist. It is the only source of v-html
       in the app; never bind raw user text here. -->
  <div class="md" v-html="html" />
</template>

<script lang="ts" setup>
import { ref, watchEffect } from "vue";

const props = defineProps<{ source: string }>();

// marked + DOMPurify are ~60 kB and only ever needed once a review actually renders, so the
// module is pulled in on demand rather than riding in the library page's chunk. Renders empty
// for the one tick it takes to arrive.
const render = ref<((source: string) => string) | null>(null);
const html = ref("");

import("@/utils/markdown").then((m) => (render.value = m.renderMarkdown));

watchEffect(() => {
  html.value = render.value ? render.value(props.source) : "";
});
</script>

<style scoped>
/* Typographic defaults for rendered markdown. Vuetify/Tailwind reset every element to
   unstyled, so each tag the sanitizer allows through needs its own rule here. */
.md {
  font-size: 15px;
  line-height: 1.7;
  color: var(--color-text-secondary);
  overflow-wrap: break-word;
}
.md :deep(p) {
  margin-bottom: 0.85em;
}
.md :deep(> :last-child) {
  margin-bottom: 0;
}
.md :deep(h1),
.md :deep(h2),
.md :deep(h3),
.md :deep(h4),
.md :deep(h5),
.md :deep(h6) {
  font-family: var(--font-heading);
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.25;
  margin: 1.4em 0 0.5em;
}
.md :deep(> :first-child) {
  margin-top: 0;
}
.md :deep(h1) {
  font-size: 1.5em;
}
.md :deep(h2) {
  font-size: 1.28em;
}
.md :deep(h3) {
  font-size: 1.12em;
}
.md :deep(h4),
.md :deep(h5),
.md :deep(h6) {
  font-size: 1em;
}
.md :deep(strong) {
  font-weight: 700;
  color: var(--color-text-primary);
}
.md :deep(em) {
  font-style: italic;
}
.md :deep(del) {
  text-decoration: line-through;
  opacity: 0.7;
}
.md :deep(a) {
  color: var(--color-orange-neon);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.md :deep(ul),
.md :deep(ol) {
  margin: 0 0 0.85em;
  padding-left: 1.35em;
}
.md :deep(ul) {
  list-style: disc;
}
.md :deep(ol) {
  list-style: decimal;
}
.md :deep(li) {
  margin-bottom: 0.25em;
}
.md :deep(li > ul),
.md :deep(li > ol) {
  margin: 0.25em 0 0;
}
.md :deep(blockquote) {
  border-left: 2px solid var(--color-charcoal-border);
  padding-left: 1rem;
  margin: 0 0 0.85em;
  font-style: italic;
}
.md :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.86em;
  background: var(--color-charcoal-light);
  border: 1px solid var(--color-charcoal-border);
  padding: 0.1em 0.35em;
}
.md :deep(pre) {
  background: var(--color-charcoal-light);
  border: 1px solid var(--color-charcoal-border);
  padding: 0.75rem 0.9rem;
  margin: 0 0 0.85em;
  overflow-x: auto;
}
.md :deep(pre code) {
  background: none;
  border: 0;
  padding: 0;
}
.md :deep(hr) {
  border: 0;
  border-top: 1px solid var(--color-charcoal-border);
  margin: 1.4em 0;
}
.md :deep(table) {
  border-collapse: collapse;
  margin: 0 0 0.85em;
  display: block;
  overflow-x: auto;
}
.md :deep(th),
.md :deep(td) {
  border: 1px solid var(--color-charcoal-border);
  padding: 0.35em 0.6em;
  text-align: left;
}
.md :deep(th) {
  color: var(--color-text-primary);
  font-weight: 700;
}
</style>
