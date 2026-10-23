import { defineConfig } from 'vite-plus'

export default defineConfig({
  staged: { '*': 'vp check --fix' },
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    options: { typeAware: true, typeCheck: true },
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
  },
  fmt: {
    bracketSameLine: true,
    bracketSpacing: true,
    objectWrap: 'collapse',
    printWidth: 100,
    semi: false,
    singleQuote: true,
    tabWidth: 2,
    trailingComma: 'all',
  },
})
