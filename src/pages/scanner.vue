<template>
  <div class="h-screen bg-charcoal relative overflow-hidden">
    <!-- Header -->
    <div
      class="absolute top-0 left-0 right-0 bg-charcoal-light border-b border-charcoal-border px-4 py-3 z-10 flex justify-between items-center"
    >
      <span class="text-text-secondary text-sm">{{ authStore.email }}</span>
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

    <!-- Scanning frame (Tailwind + inline styles for positioning) -->
    <div
      class="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
    >
      <div
        class="border-4 border-orange-neon"
        style="width: 300px; height: 150px"
      >
        <!-- Corners -->
        <div
          class="absolute -top-2 -left-2 w-6 h-6 border-t-4 border-l-4 border-orange-neon"
        />
        <div
          class="absolute -top-2 -right-2 w-6 h-6 border-t-4 border-r-4 border-orange-neon"
        />
        <div
          class="absolute -bottom-2 -left-2 w-6 h-6 border-b-4 border-l-4 border-orange-neon"
        />
        <div
          class="absolute -bottom-2 -right-2 w-6 h-6 border-b-4 border-r-4 border-orange-neon"
        />
      </div>
    </div>

    <!-- Guide text -->
    <div
      class="absolute bottom-24 left-0 right-0 text-center text-text-primary text-sm z-20"
    >
      {{ isScanning ? "Processing..." : "Align barcode in frame" }}
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
  if (isScanning.value) return; // Prevent multiple scans
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
    if (!res.ok) throw new Error(data.error || "Failed to save scan");

    showToast(`Saved: ${data.title || decodedText}`);
    // Optionally wait a bit before allowing another scan
    setTimeout(() => {
      isScanning.value = false;
    }, 2000);
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
