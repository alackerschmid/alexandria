import vuetify from "eslint-config-vuetify";

export default [
  ...(await vuetify({
    ts: true,
  })),
  {
    // The codebase is formatted by Prettier/IDE conventions (and is mixed between
    // single/double quotes and semicolon styles across older files). Disable the
    // purely-stylistic rules from the shared config so `npm run lint` reports
    // real problems instead of thousands of formatting complaints.
    rules: {
      // Formatting — owned by the editor/Prettier, not ESLint.
      "@stylistic/semi": "off",
      "@stylistic/quotes": "off",
      "@stylistic/quote-props": "off",
      "@stylistic/member-delimiter-style": "off",
      "@stylistic/space-before-function-paren": "off",
      "@stylistic/no-multi-spaces": "off",
      "@stylistic/arrow-parens": "off",
      "@stylistic/brace-style": "off",
      "@stylistic/comma-dangle": "off",
      "@stylistic/operator-linebreak": "off",
      "@stylistic/key-spacing": "off",
      "@stylistic/max-statements-per-line": "off",
      "@stylistic/indent": "off",
      "@stylistic/multiline-ternary": "off",
      "@stylistic/object-curly-spacing": "off",

      // Vue template/script formatting.
      "vue/script-indent": "off",
      "vue/html-indent": "off",
      "vue/padding-line-between-tags": "off",
      "vue/attributes-order": "off",
      "vue/html-self-closing": "off",
      "vue/html-closing-bracket-newline": "off",
      "vue/custom-event-name-casing": "off",
      "vue/multiline-html-element-content-newline": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/max-attributes-per-line": "off",
      "vue/first-attribute-linebreak": "off",

      // Import ordering — cosmetic.
      "perfectionist/sort-imports": "off",
      "perfectionist/sort-named-imports": "off",
      "import/first": "off",

      "@stylistic/eol-last": "off",

      // Opinionated style preferences that the codebase doesn't follow.
      curly: "off",
      "no-nested-ternary": "off",
      "antfu/top-level-function": "off",
      "unicorn/catch-error-name": "off",
      "unicorn/explicit-length-check": "off",
      "unicorn/no-negated-condition": "off",
      "unicorn/no-nested-ternary": "off",
      "unicorn/switch-case-braces": "off",
      "unicorn/prefer-split-limit": "off",
      "unicorn/prefer-number-properties": "off",
      "unicorn/no-array-for-each": "off",
      "unicorn/no-array-reverse": "off",
      "unicorn/no-array-sort": "off",
      "unicorn/prefer-ternary": "off",
      "unicorn/prefer-optional-catch-binding": "off",
      "unicorn/error-message": "off",

      // The worker intentionally swallows best-effort fetch failures.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // Claude Code hook scripts. The exit code *is* the hook protocol — 0 allows,
    // 2 blocks — so `process.exit()` is the interface here, not a smell.
    files: [".claude/hooks/**/*.mjs"],
    rules: {
      "unicorn/no-process-exit": "off",
    },
  },
];
