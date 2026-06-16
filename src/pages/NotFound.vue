<template>
  <div class="min-h-screen bg-charcoal flex flex-col px-8">
    <div class="pt-14">
      <span class="text-orange-neon text-[10px] tracking-[0.35em] uppercase font-bold">Bookscan</span>
    </div>
    <div class="flex-1 flex flex-col justify-center pb-20">
      <p class="text-[10px] text-text-secondary tracking-[0.3em] uppercase mb-3">404</p>
      <h1 class="font-heading text-5xl font-bold text-text-primary leading-[1.05] mb-6">
        Page not<br>found.
      </h1>
      <p class="text-sm text-text-secondary leading-relaxed mb-12">
        That page doesn't exist or has moved.
      </p>
      <router-link
        to="/"
        class="self-start text-xs font-bold tracking-[0.25em] uppercase border-b border-text-primary pb-0.5 text-text-primary hover:opacity-70 transition-opacity"
      >
        Go to library
      </router-link>
    </div>
  </div>
</template>
