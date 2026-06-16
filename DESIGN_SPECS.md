# Book Barcode Scanner — Design Specifications
## Framework: Vue 3 + Vuetify + Tailwind CSS

## Color Palette & Tailwind Configuration

Add to `tailwind.config.js`:

```javascript
export default {
  theme: {
    extend: {
      colors: {
        charcoal: '#1a1a1a',
        'charcoal-light': '#262626',
        'charcoal-border': '#333333',
        'orange-neon': '#ff6600',
        'text-primary': '#f5f5f5',
        'text-secondary': '#a0a0a0',
      },
    },
  },
}
```

Vuetify theme config (in `vuetify.ts`):

```javascript
import { createVuetify } from 'vuetify'

export default createVuetify({
  theme: {
    dark: true,
    themes: {
      dark: {
        colors: {
          background: '#1a1a1a',
          surface: '#262626',
          primary: '#ff6600',
          'on-primary': '#1a1a1a',
          'on-background': '#f5f5f5',
          'on-surface': '#f5f5f5',
          'text-secondary': '#a0a0a0',
          border: '#333333',
        },
      },
    },
  },
})
```

| Role | Color | Hex | Tailwind Class | Vuetify Token |
|------|-------|-----|-----------------|----------------|
| Background | Deep Charcoal | `#1a1a1a` | `bg-charcoal` | `bg-background` |
| Surface (Cards) | Charcoal Light | `#262626` | `bg-charcoal-light` | `bg-surface` |
| Accent | Neon Orange | `#ff6600` | `bg-orange-neon` | `bg-primary` |
| Text Primary | Off-White | `#f5f5f5` | `text-text-primary` | `text-on-background` |
| Text Secondary | Light Gray | `#a0a0a0` | `text-text-secondary` | `text-text-secondary` |
| Border | Dark Gray | `#333333` | `border-charcoal-border` | `border-border` |

## Typography

### Font Stack
- **Font Family**: System sans-serif fallback: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- **Weight**: 400 (regular) and 600 (bold) only—no intermediate weights

### Scale
- **H1 (Page Titles)**: 32px, 600 weight, line-height 1.2, off-white
- **H2 (Section Headers)**: 24px, 600 weight, line-height 1.3, off-white
- **Body Text**: 16px, 400 weight, line-height 1.5, off-white
- **Small Text (Metadata/ISBN)**: 12px, 400 weight, line-height 1.4, light gray
- **Monospace (ISBN/Codes)**: `Courier New`, monospace, 14px, off-white

### Style Rules
- No decorative fonts, no script or serif typefaces
- All caps only for UI labels (buttons, tabs)
- Prioritize readability over style—generous spacing, clear hierarchy

## Components

### Buttons (Vuetify)
**Primary (Scan)**
```vue
<v-btn 
  color="primary" 
  size="large" 
  class="rounded-none"
  @click="scan"
>
  SCAN
</v-btn>
```
- `v-btn` with `color="primary"` (orange)
- `size="large"` → 16px font, 16px 32px padding
- `rounded-none` → 4px border radius via Tailwind
- Hover: Vuetify handles opacity automatically

**Secondary (Cancel, Back)**
```vue
<v-btn 
  variant="outlined" 
  color="primary" 
  class="rounded-none"
>
  CANCEL
</v-btn>
```
- `variant="outlined"` → transparent with border
- `color="primary"` → orange text + border
- Vuetify handles hover state (light overlay)

### Input Fields (Vuetify)
```vue
<v-text-field
  v-model="input"
  placeholder="Enter ISBN or title"
  bg-color="charcoal-light"
  class="rounded-none"
/>
```
- `bg-color="charcoal-light"` → surface color
- Vuetify `v-text-field` handles focus border automatically (set to orange via theme)
- Placeholder: light gray via Tailwind CSS override if needed
- Padding: Vuetify default (12px)

### Lists (Scan Results) (Vuetify + Tailwind)
```vue
<v-list bg-color="charcoal" class="divide-y divide-charcoal-border">
  <v-list-item 
    v-for="book in books" 
    :key="book.id"
    class="py-3 px-4"
  >
    <div class="flex justify-between w-full">
      <div>
        <div class="font-semibold text-text-primary">{{ book.isbn }}</div>
        <div class="text-sm text-text-secondary">{{ book.author }}</div>
      </div>
      <v-btn 
        icon="mdi-delete" 
        variant="text" 
        color="primary"
        size="small"
        @click="deleteBook(book.id)"
      />
    </div>
  </v-list-item>
</v-list>
```
- `v-list` → organized item rows
- Tailwind `divide-y divide-charcoal-border` → dividers between items
- `py-3 px-4` → Tailwind padding
- Last item: `v-list` handles automatically (no extra bottom border)

### Camera Viewfinder (HTML + Tailwind)
```vue
<div class="relative w-full h-screen bg-charcoal">
  <video ref="videoElement" class="w-full h-full object-cover" />
  <!-- Neon orange border frame -->
  <div class="absolute inset-0 border-4 border-orange-neon m-auto" 
       style="width: 300px; height: 400px; pointer-events: none;">
    <!-- Corner markers -->
    <div class="absolute -top-2 -left-2 w-6 h-6 border-t-4 border-l-4 border-orange-neon" />
    <div class="absolute -top-2 -right-2 w-6 h-6 border-t-4 border-r-4 border-orange-neon" />
    <div class="absolute -bottom-2 -left-2 w-6 h-6 border-b-4 border-l-4 border-orange-neon" />
    <div class="absolute -bottom-2 -right-2 w-6 h-6 border-b-4 border-r-4 border-orange-neon" />
  </div>
  <!-- Guide text -->
  <div class="absolute bottom-20 left-0 right-0 text-center text-text-primary text-sm">
    Align barcode in frame
  </div>
</div>
```

### Cards (Vuetify + Tailwind)
```vue
<v-card bg-color="charcoal-light" class="rounded-none border border-charcoal-border p-4 mb-3">
  <!-- card content -->
</v-card>
```
- `v-card` with `bg-color="charcoal-light"`
- `rounded-none` → 4px radius
- `border border-charcoal-border` → Tailwind border
- `p-4` (Tailwind) or `class="pa-4"` (Vuetify) → 16px padding
- `mb-3` → 12px margin bottom

### Auth Forms (Vuetify + Tailwind)
```vue
<div class="h-screen bg-charcoal flex items-center justify-center px-4">
  <v-form class="w-full max-w-sm">
    <h2 class="text-2xl font-bold text-text-primary mb-6">Login</h2>
    
    <v-text-field
      v-model="email"
      label="Email"
      type="email"
      class="mb-4"
      bg-color="charcoal-light"
    />
    
    <v-text-field
      v-model="password"
      label="Password"
      type="password"
      class="mb-6"
      bg-color="charcoal-light"
    />
    
    <v-btn 
      color="primary" 
      size="large" 
      class="w-full rounded-none"
      @click="login"
    >
      LOGIN
    </v-btn>
  </v-form>
</div>
```
- Vuetify `v-form` for structure
- Tailwind `flex`, `items-center`, `justify-center` for centering
- `px-4` → safe horizontal padding
- `mb-4`, `mb-6` → Tailwind margin (8px baseline)

## Layout Principles

- **Mobile-first**: Assume 375px–480px viewport first (`sm:` breakpoint at 640px)
- **Full viewport for scanner**: `h-screen w-screen` or `h-dvh` (dynamic viewport height)
- **Vertical stacking**: Use Tailwind `flex-col` for mobile, no side-by-side layouts
- **Safe areas**: `px-4` (16px) on mobile, `sm:px-6` (24px) on tablet+
- **Spacing**: 8px baseline grid using Tailwind utilities:
  - `mb-1` = 8px
  - `mb-2` = 16px
  - `mb-3` = 24px
  - `mb-4` = 32px
- **No shadows**: Use `border` and color contrast instead of `shadow-*` utilities
- **Vuetify spacing**: Prefer Tailwind classes over `pa-*`, `ma-*` (Vuetify spacing) for consistency

## Specific Screens

### Login/Register (Vuetify + Tailwind)
```vue
<template>
  <div class="h-screen bg-charcoal flex items-center justify-center px-4">
    <v-form class="w-full max-w-sm">
      <h1 class="text-3xl font-bold text-text-primary mb-6">{{ isLogin ? 'Login' : 'Sign Up' }}</h1>
      
      <v-text-field
        v-model="email"
        label="Email"
        type="email"
        class="mb-4"
        bg-color="charcoal-light"
      />
      
      <v-text-field
        v-model="password"
        label="Password"
        type="password"
        class="mb-6"
        bg-color="charcoal-light"
      />
      
      <v-btn 
        color="primary" 
        size="large" 
        class="w-full rounded-none mb-4"
        @click="submit"
      >
        {{ isLogin ? 'LOGIN' : 'SIGN UP' }}
      </v-btn>
      
      <v-btn 
        variant="text" 
        color="primary" 
        class="w-full"
        @click="isLogin = !isLogin"
      >
        {{ isLogin ? 'Need an account?' : 'Already have an account?' }}
      </v-btn>
    </v-form>
  </div>
</template>
```

### Scanner (Main) (Vue + Tailwind)
```vue
<template>
  <div class="h-screen bg-charcoal relative overflow-hidden">
    <!-- Header -->
    <div class="absolute top-0 left-0 right-0 bg-charcoal-light border-b border-charcoal-border px-4 py-3 z-10 flex justify-between items-center">
      <span class="text-text-secondary text-sm">{{ userEmail }}</span>
      <v-btn icon="mdi-logout" variant="text" color="primary" size="small" @click="logout" />
    </div>
    
    <!-- Camera -->
    <video ref="videoElement" class="w-full h-full object-cover" />
    
    <!-- Scanning frame (Tailwind + inline styles for positioning) -->
    <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div class="border-4 border-orange-neon" style="width: 300px; height: 400px;">
        <!-- Corners -->
        <div class="absolute -top-2 -left-2 w-6 h-6 border-t-4 border-l-4 border-orange-neon" />
        <div class="absolute -top-2 -right-2 w-6 h-6 border-t-4 border-r-4 border-orange-neon" />
        <div class="absolute -bottom-2 -left-2 w-6 h-6 border-b-4 border-l-4 border-orange-neon" />
        <div class="absolute -bottom-2 -right-2 w-6 h-6 border-b-4 border-r-4 border-orange-neon" />
      </div>
    </div>
    
    <!-- Guide text -->
    <div class="absolute bottom-24 left-0 right-0 text-center text-text-primary text-sm">
      Align barcode in frame
    </div>
    
    <!-- Floating scan button -->
    <v-btn
      fab
      color="primary"
      size="x-large"
      icon="mdi-camera"
      class="absolute bottom-8 right-8"
      @click="captureFrame"
    />
  </div>
</template>
```

### Scan Results/Library (Vuetify + Tailwind)
```vue
<template>
  <div class="bg-charcoal min-h-screen px-4 py-6">
    <h1 class="text-3xl font-bold text-text-primary mb-6">Your Books</h1>
    
    <v-list bg-color="charcoal" class="divide-y divide-charcoal-border rounded-none">
      <v-list-item 
        v-for="book in books" 
        :key="book.id"
        class="py-3"
      >
        <div class="flex justify-between w-full items-start">
          <div class="flex-1">
            <div class="font-semibold text-text-primary">{{ book.isbn }}</div>
            <div class="text-xs text-text-secondary mt-1">{{ book.author }} • {{ book.year }}</div>
          </div>
          <v-btn 
            icon="mdi-delete" 
            variant="text" 
            color="primary"
            size="small"
            @click="deleteBook(book.id)"
          />
        </div>
      </v-list-item>
    </v-list>
    
    <!-- Floating action button to scan again -->
    <v-btn
      fab
      color="primary"
      size="x-large"
      icon="mdi-plus"
      class="fixed bottom-8 right-8"
      @click="goToScanner"
    />
  </div>
</template>
```

## Dark Mode Consistency
- No light mode variant—dark mode is the only mode
- All text must have sufficient contrast against charcoal background (WCAG AA minimum)
- Test cyan and orange on actual charcoal to confirm readability

## Interactive Feedback

- **Tap/Click**: Vuetify `v-btn` handles opacity change on hover/active (0.1s default)
- **Focus**: `focus-ring` class (Tailwind) or Vuetify's built-in focus outline (set to orange in theme)
  - Use `outline-2 outline-orange-neon` for custom focus rings if needed
- **Disabled**: `disabled:opacity-50 disabled:cursor-not-allowed` (Tailwind)
- **Loading**: Use `v-progress-circular` (Vuetify) with `color="primary"` during async operations

## Framework-Specific Notes

### Vuetify
- Always set `dark: true` in theme config
- Use Vuetify color tokens (`color="primary"`, `bg-color="charcoal-light"`) instead of Tailwind color classes where possible for consistency
- Component defaults handle most styling (borders, focus states, shadows)—override only when necessary with Tailwind
- Import Vuetify components at component level or globally in main.ts

### Tailwind
- Add custom colors to `tailwind.config.js` (charcoal, orange-neon, etc.)
- Use `@apply` in component styles if repeating utility patterns
- Prefer utility classes for spacing (`px-4`, `mb-3`, `py-6`) over custom CSS
- Use `rounded-none` to enforce 4px radius without Tailwind's default larger radii

### Interaction Between Frameworks
- Vuetify handles component logic and built-in dark mode
- Tailwind handles layout, spacing, and fine-tuned styling
- When both have solutions, prefer Vuetify for components (`v-btn`, `v-text-field`), Tailwind for layout (`flex`, `grid`, spacing)
- Test that Vuetify theme colors override Tailwind color utility classes correctly

## Setup & Configuration

### Tailwind CSS Setup
```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

Update `tailwind.config.js`:
```javascript
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        charcoal: '#1a1a1a',
        'charcoal-light': '#262626',
        'charcoal-border': '#333333',
        'orange-neon': '#ff6600',
        'text-primary': '#f5f5f5',
        'text-secondary': '#a0a0a0',
      },
      borderRadius: {
        none: '4px',
      },
    },
  },
  plugins: [],
}
```

### Vuetify Setup
```bash
npm install vuetify
```

Create `src/plugins/vuetify.ts`:
```typescript
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

export default createVuetify({
  components,
  directives,
  theme: {
    dark: true,
    themes: {
      dark: {
        colors: {
          background: '#1a1a1a',
          surface: '#262626',
          primary: '#ff6600',
          'on-primary': '#1a1a1a',
          'on-background': '#f5f5f5',
          'on-surface': '#f5f5f5',
          border: '#333333',
        },
      },
    },
  },
})
```

Import in `src/main.ts`:
```typescript
import vuetify from './plugins/vuetify'

app.use(vuetify)
```

### CSS Entry Point
Add to `src/style.css` or `src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Optional: Vuetify overrides */
body {
  background-color: #1a1a1a;
  color: #f5f5f5;
}
```

## Mobile Considerations
- **Touch targets**: minimum 44px height (use `h-11` or `h-12` in Tailwind, or Vuetify's `size="large"`)
- **Viewport**: always full width, no horizontal scroll (`w-full`, no `overflow-x-auto`)
- **Camera on mobile**: honor device orientation, use portrait lock
  ```html
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  ```
- **Safe areas**: account for notches using Tailwind's `pt-safe` or CSS `env(safe-area-inset-*)`
  ```css
  @supports (padding: env(safe-area-inset-top)) {
    body {
      padding-top: env(safe-area-inset-top);
    }
  }
  ```

## Accessibility Notes
- **Contrast**: Orange on charcoal ~8:1, white on charcoal ~15:1 (both WCAG AA compliant ✓)
- **Keyboard navigation**: All `v-btn` and form inputs are keyboard accessible by default (Vuetify)
- **Focus indicators**: Orange outline (2px, set in Vuetify theme) visible on all interactive elements
- **Testing**: Use axe DevTools or WAVE before launch
- **Screen readers**: Label all icon buttons with `aria-label` or Vuetify's `title` prop
  ```vue
  <v-btn icon="mdi-delete" aria-label="Delete book" />
  ```
