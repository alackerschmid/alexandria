<template>
  <div class="h-screen bg-charcoal relative overflow-hidden">
    <!-- Header -->
    <div
      class="absolute top-0 left-0 right-0 px-4 py-3 z-10 flex justify-between items-center"
      style="background: linear-gradient(to bottom, rgba(26,26,26,0.85) 0%, transparent 100%)"
    >
      <span class="text-text-secondary text-xs tracking-wide">{{ authStore.email }}</span>
      <v-btn
        icon="mdi-close"
        variant="text"
        color="primary"
        size="small"
        @click="$router.push('/')"
      />
    </div>

    <!-- Camera Target -->
    <div id="qr-reader" class="w-full h-full object-cover"></div>

    <!-- Scanning frame — corners only -->
    <div
      class="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
    >
      <div class="relative" style="width: 300px; height: 150px">
        <div class="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-orange-neon" />
        <div class="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-orange-neon" />
        <div class="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-orange-neon" />
        <div class="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-orange-neon" />
      </div>
    </div>

    <!-- Guide text -->
    <div
      class="absolute bottom-24 left-0 right-0 flex justify-center z-20"
    >
      <span class="text-text-primary text-xs tracking-wide px-4 py-1.5 rounded-full"
            style="background: rgba(26,26,26,0.7)">
        {{ isScanning ? "Processing…" : "Align barcode in frame" }}
      </span>
    </div>

    <!-- Feedback toast -->
    <v-snackbar
      v-model="toast"
      :timeout="3000"
      location="bottom"
      :color="toastColor"
      class="mb-20"
    >
      {{ toastMessage }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { Html5Qrcode } from "html5-qrcode";

const router = useRouter();
const authStore = useAuthStore();
const isScanning = ref(false);
const toast = ref(false);
const toastMessage = ref("");
const toastColor = ref("success");
const API_BASE = import.meta.env.VITE_API_URL || "";

let html5QrCode: Html5Qrcode | null = null;

const showToast = (message: string, color: string = "success") => {
  toastMessage.value = message;
  toastColor.value = color;
  toast.value = true;
};

const onScanSuccess = async (decodedText: string) => {
  if (isScanning.value) return;
  isScanning.value = true;

  try {
    const res = await fetch(`${API_BASE}/api/scans`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.token}`,
      },
      body: JSON.stringify({ isbn: decodedText }),
    });

    const data = await res.json();

    if (res.status === 409) {
      showToast("Already in your list", "warning");
      isScanning.value = false;
      return;
    }

    if (!res.ok) throw new Error(data.error || "Failed to save scan");

    showToast("Saved!");
    // Brief cooldown so the camera doesn't immediately re-scan the same barcode
    setTimeout(() => {
      isScanning.value = false;
    }, 1500);
  } catch (err: any) {
    showToast(err.message, "error");
    isScanning.value = false;
  }
};

onMounted(() => {
  html5QrCode = new Html5Qrcode("qr-reader");

  html5QrCode
    .start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: { width: 300, height: 150 },
        aspectRatio: 1.0,
        disableFlip: false,
      },
      onScanSuccess,
      (errorMessage) => {
        // Ignore routine scan errors (no barcode in view)
      },
    )
    .catch((err) => {
      showToast("Failed to access camera", "error");
      console.error(err);
    });
});

onBeforeUnmount(() => {
  if (html5QrCode && html5QrCode.isScanning) {
    html5QrCode
      .stop()
      .then(() => {
        html5QrCode?.clear();
      })
      .catch((err) => console.error(err));
  }
});
</script>

<style>
/* Override html5-qrcode inline styles that mess up layout */
#qr-reader {
  border: none !important;
  width: 100% !important;
  height: 100vh !important;
}
#qr-reader img,
#qr-reader video {
  object-fit: cover !important;
  width: 100% !important;
  height: 100% !important;
}
#qr-reader__scan_region {
  /* hide the default html5-qrcode region to use our neon-orange one instead */
  display: none !important;
}
#qr-reader__dashboard_section_csr span {
  color: white !important;
}
</style>
