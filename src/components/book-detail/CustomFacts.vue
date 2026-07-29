<template>
  <!-- The "Custom fields" ledger column of the Details pane. Like EditionDetails and WorkFacts it
       renders only the rows — the pane supplies the heading, so the three columns match. -->
  <div>
    <div
      v-for="row in rows"
      :key="row.id"
      class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50"
    >
      <span
        class="shrink-0 text-[11px] tracking-[0.1em] uppercase text-text-secondary/60"
        >{{ row.name }}</span
      >
      <span
        class="font-mono text-xs text-right"
        :class="row.value ? 'text-text-primary' : 'text-text-secondary/50'"
      >
        {{ row.value || "—" }}
      </span>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { customFieldDisplay } from "@/utils/custom-fields";
import type { FieldDef } from "@/stores/fieldDefs";
import type { Book } from "@/types/book";

// Read-only, like the two catalogue columns it sits beside: editing every custom field happens on
// the one edit screen behind "Edit fields", never inline here.
const props = defineProps<{
  book: Book;
  defs: FieldDef[];
}>();

// Resolved once per book/defs change rather than per render: the template reads each value twice
// (to pick the muted class and to print it), and `customFieldDisplay` scans the value list and
// JSON-parses tag fields on every call.
const rows = computed(() =>
  props.defs.map((def) => ({
    id: def.id,
    name: def.name,
    value: customFieldDisplay(props.book, def),
  })),
);
</script>
