<template>
  <div class="min-h-screen bg-charcoal flex flex-col px-8">
    <!-- Header -->
    <div class="pt-14 flex justify-between items-center mb-16">
      <router-link
        to="/"
        class="text-orange-neon text-[10px] tracking-[0.35em] uppercase font-bold"
      >
        Bookscan
      </router-link>
    </div>

    <!-- Content -->
    <div class="flex-1 pb-20 max-w-prose space-y-10">
      <div>
        <p class="text-[10px] text-text-secondary tracking-[0.3em] uppercase mb-3">Legal</p>
        <h1 class="font-heading text-4xl font-bold text-text-primary leading-[1.05]">
          Privacy<br>Policy.
        </h1>
      </div>

      <section class="space-y-3">
        <h2 class="text-[10px] tracking-[0.25em] uppercase text-text-secondary">Data collected</h2>
        <p class="text-sm text-text-secondary leading-relaxed">
          Bookscan stores your email address and the books you scan: ISBN, title, author, cover image URL, and reading status. No other personal data is collected.
        </p>
      </section>

      <section class="space-y-3">
        <h2 class="text-[10px] tracking-[0.25em] uppercase text-text-secondary">Storage</h2>
        <p class="text-sm text-text-secondary leading-relaxed">
          Data is stored in Cloudflare D1 (SQLite), hosted across Cloudflare's global network. Your password is never stored — only a bcrypt hash.
        </p>
      </section>

      <section class="space-y-3">
        <h2 class="text-[10px] tracking-[0.25em] uppercase text-text-secondary">Third parties</h2>
        <p class="text-sm text-text-secondary leading-relaxed">
          Book metadata (title, author, cover) is fetched from Google Books API and OpenLibrary using only the scanned ISBN. No account information is sent to these services.
        </p>
      </section>

      <section class="space-y-3">
        <h2 class="text-[10px] tracking-[0.25em] uppercase text-text-secondary">Data retention</h2>
        <p class="text-sm text-text-secondary leading-relaxed">
          Your data is retained for as long as your account exists. Deleting a book removes it immediately. Account deletion removes all associated data.
        </p>
      </section>

      <section class="space-y-3">
        <h2 class="text-[10px] tracking-[0.25em] uppercase text-text-secondary">Contact</h2>
        <p class="text-sm text-text-secondary leading-relaxed">
          Questions? <a
            href="mailto:lackerschmida@gmail.com"
            class="text-text-primary underline underline-offset-4 hover:opacity-70 transition-opacity"
          >lackerschmida@gmail.com</a>
        </p>
      </section>
    </div>

    <AppFooter />
  </div>
</template>

<script setup lang="ts">
import AppFooter from "@/components/AppFooter.vue";
</script>
