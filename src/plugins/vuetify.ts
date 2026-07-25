/**
 * plugins/vuetify.ts
 *
 * Framework documentation: https://vuetifyjs.com
 */

import { createVuetify } from "vuetify";
import "@mdi/font/css/materialdesignicons.css";
import "../styles/layers.css";
import "vuetify/styles";
import { THEME_HINT_KEY } from "../stores/theme";

export default createVuetify({
  theme: {
    defaultTheme:
      localStorage.getItem(THEME_HINT_KEY) === "dark"
        ? "editorial-dark"
        : "editorial",
    themes: {
      editorial: {
        dark: false,
        colors: {
          background: "#fafaf8",
          surface: "#ffffff",
          primary: "#ff6600",
          "on-primary": "#111110",
          "on-background": "#0f0f0f",
          "on-surface": "#0f0f0f",
          "text-secondary": "#7a736e",
          border: "#e2ddd8",
          error: "#c0392b",
          warning: "#d97706",
          success: "#276749",
          info: "#1d4ed8",
        },
      },
      "editorial-dark": {
        dark: true,
        colors: {
          background: "#0a0a09",
          surface: "#1c1b19",
          primary: "#ff6600",
          "on-primary": "#111110",
          "on-background": "#f0ede8",
          "on-surface": "#f0ede8",
          "text-secondary": "#8a8078",
          border: "#2e2b28",
          error: "#e05252",
          warning: "#e8a838",
          success: "#4caf80",
          info: "#5b8def",
        },
      },
    },
    utilities: false,
  },
  display: {
    mobileBreakpoint: "md",
    thresholds: {
      xs: 0,
      sm: 600,
      md: 840,
      lg: 1145,
      xl: 1545,
      xxl: 2138,
    },
  },
});
