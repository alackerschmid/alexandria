<template>
  <div class="w-full md:max-w-[66.6667%] mx-auto px-6 md:px-10">
    <slot />
  </div>
</template>

<script lang="ts" setup>
// The detail view's content measure — the middle ~⅔ of the page, with empty gutters either side,
// matching the rest of the app.
//
// It exists as a component rather than a repeated utility string because four separate bands (top
// bar, masthead, tab row, panes) have to agree on it exactly or their contents visibly fail to
// line up. The *bands* stay full-bleed — their backgrounds and hairlines span the whole width, the
// same way `AppHeader` does — and only what sits inside them is constrained.
//
// Needed because the full detail is a fullscreen `v-dialog`: it teleports to the overlay container
// and so escapes `App.vue`'s `max-w-[1440px]` wrapper entirely.
</script>
