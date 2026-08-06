import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import type { BuiltinGroupBy, GroupBy } from "@/types/library";
import { GROUP_BY_VALUES } from "@/types/library";

export interface CustomFieldMeta {
  def: { id: number; name: string; type: string };
  slug: string;
}

export interface DimensionOption {
  value: GroupBy;
  label: string;
}

// Must match the builtin search/group keys used in index.vue to avoid slug collisions
const BUILTIN_SLUGS = new Set([
  "status",
  "owning",
  "rating",
  "author",
  "genre",
  "series",
  "publisher",
  "language",
  "award",
  "form",
  "country",
  "year",
  "subject",
  "location",
  "title",
  "isbn",
]);

// Typed as a total map over the dimensions, so adding one to GROUP_BY_VALUES without giving it a
// label fails the type-check instead of shipping a dimension the picker can't render.
const GROUP_LABEL_KEYS: Record<BuiltinGroupBy, string> = {
  none: "library.group_none",
  author: "library.group_author",
  series: "library.group_series",
  genre: "library.group_genre",
  status: "library.group_status",
  owning: "library.group_owning",
  rating: "library.group_rating",
  publisher: "library.group_publisher",
  language: "library.group_language",
  form: "library.group_form",
  country: "library.group_country",
  decade: "library.group_decade",
  subject: "library.group_subject",
};

export function useGroupDimensions() {
  const { t } = useI18n();
  const fieldDefsStore = useFieldDefsStore();

  const customFieldMetas = computed<CustomFieldMeta[]>(() => {
    const used = new Set<string>(BUILTIN_SLUGS);
    return fieldDefsStore.defs.map((def) => {
      let slug =
        def.name.toLowerCase().replace(/[^a-z0-9]+/g, "") || `field${def.id}`;
      if (used.has(slug)) slug = `${slug}${def.id}`;
      used.add(slug);
      return { def, slug };
    });
  });

  // All groupable dimensions — no 'none'. Used by home page dropdowns. Derived from
  // GROUP_BY_VALUES (which carries the display order), so a dimension can't exist in the type
  // and the grouping switch yet be missing from the picker.
  const dimensionOptions = computed<DimensionOption[]>(() => [
    ...GROUP_BY_VALUES.filter((v) => v !== "none").map((v) => ({
      value: v as GroupBy,
      label: t(GROUP_LABEL_KEYS[v]),
    })),
    ...customFieldMetas.value
      .filter((m) => m.def.type !== "date" && m.def.type !== "integer")
      .map((m) => ({ value: `cf:${m.def.id}` as GroupBy, label: m.def.name })),
  ]);

  // Full list including 'none' — used by the library toolbar.
  const groupOptions = computed<DimensionOption[]>(() => [
    { value: "none", label: t(GROUP_LABEL_KEYS.none) },
    ...dimensionOptions.value,
  ]);

  return { dimensionOptions, groupOptions, customFieldMetas };
}
