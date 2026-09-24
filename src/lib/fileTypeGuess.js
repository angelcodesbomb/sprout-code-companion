/**
 * fileTypeGuess.js
 *
 * Maps a file or folder node to a plain-English tooltip description.
 * This is intentionally kept as a simple lookup so it can be swapped out
 * for a real LLM call later without touching any component code.
 *
 * Rule-based descriptions used as fallback tier in the shared repo map
 * (see src/lib/repoMap.js and /api/filemap/summarize). AI summaries are
 * requested lazily on hover — do not call an LLM from this module.
 */

import { countFiles } from "./parseGithubTree.js";

// ── Exact filename matches (checked before extension) ─────────────────────────
const FILENAME_MAP = {
  // Package / dependency management
  "package.json": "Project dependencies and npm scripts",
  "package-lock.json": "Locked dependency versions (auto-generated)",
  "yarn.lock": "Locked dependency versions for Yarn",
  "pnpm-lock.yaml": "Locked dependency versions for pnpm",
  "bun.lockb": "Locked dependency versions for Bun",
  "composer.json": "PHP project dependencies",
  "Gemfile": "Ruby gem dependencies",
  "Gemfile.lock": "Locked Ruby gem versions",
  "requirements.txt": "Python package dependencies",
  "Pipfile": "Python virtual environment dependencies",
  "Pipfile.lock": "Locked Python dependency versions",
  "pyproject.toml": "Python project config and dependencies",
  "go.mod": "Go module definition",
  "go.sum": "Go module checksums",
  "Cargo.toml": "Rust package manifest",
  "Cargo.lock": "Locked Rust dependency versions",

  // Config / tooling
  ".env": "Environment variables (keep this secret!)",
  ".env.local": "Local environment variable overrides",
  ".env.example": "Example environment variables template",
  ".gitignore": "Files and folders excluded from git",
  ".gitattributes": "Git file attribute rules",
  ".prettierrc": "Prettier code formatter config",
  ".prettierignore": "Files excluded from Prettier formatting",
  ".eslintrc": "ESLint linting rules",
  ".eslintrc.js": "ESLint linting rules (JS format)",
  ".eslintrc.json": "ESLint linting rules (JSON format)",
  "eslint.config.js": "ESLint linting rules (flat config)",
  ".editorconfig": "Editor indentation and encoding rules",
  ".nvmrc": "Node.js version pin for nvm",
  ".node-version": "Node.js version pin",
  "tsconfig.json": "TypeScript compiler configuration",
  "jsconfig.json": "JavaScript project path aliases and settings",
  "babel.config.js": "Babel transpiler configuration",
  "babel.config.json": "Babel transpiler configuration",
  "jest.config.js": "Jest test runner configuration",
  "jest.config.ts": "Jest test runner configuration",
  "vitest.config.js": "Vitest test runner configuration",
  "vitest.config.ts": "Vitest test runner configuration",
  "vite.config.js": "Vite build tool configuration",
  "vite.config.ts": "Vite build tool configuration",
  "webpack.config.js": "Webpack bundler configuration",
  "rollup.config.js": "Rollup bundler configuration",
  "tailwind.config.js": "Tailwind CSS configuration",
  "tailwind.config.ts": "Tailwind CSS configuration",
  "postcss.config.js": "PostCSS plugin pipeline",
  "next.config.js": "Next.js framework configuration",
  "next.config.ts": "Next.js framework configuration",
  "nuxt.config.ts": "Nuxt framework configuration",
  "astro.config.mjs": "Astro framework configuration",
  "svelte.config.js": "SvelteKit framework configuration",
  "remix.config.js": "Remix framework configuration",
  "turbo.json": "Turborepo monorepo pipeline config",
  "nx.json": "Nx monorepo workspace config",
  "lerna.json": "Lerna monorepo config",
  ".travis.yml": "Travis CI pipeline definition",
  "Makefile": "Build and task automation commands",
  "Dockerfile": "Docker container build instructions",
  "docker-compose.yml": "Multi-container Docker setup",
  "docker-compose.yaml": "Multi-container Docker setup",
  ".dockerignore": "Files excluded from Docker build context",
  "Procfile": "Heroku process definitions",

  // Docs / metadata
  "README.md": "Project overview and getting-started guide",
  "readme.md": "Project overview and getting-started guide",
  "CHANGELOG.md": "History of changes across versions",
  "CONTRIBUTING.md": "Guide for contributors",
  "LICENSE": "Software license terms",
  "LICENSE.md": "Software license terms",
  "SECURITY.md": "Security policy and disclosure guide",
  "CODE_OF_CONDUCT.md": "Community behavior guidelines",

  // Lock / generated
  "schema.prisma": "Prisma database schema definition",
  "schema.graphql": "GraphQL type definitions",
  "schema.json": "JSON Schema or generated type data",

  // Common root files
  "index.js": "Main entry point for this module",
  "index.ts": "Main entry point for this module",
  "index.jsx": "Root React component entry point",
  "index.tsx": "Root React component entry point",
  "main.js": "Application entry point",
  "main.ts": "Application entry point",
  "app.js": "Application bootstrap and setup",
  "app.ts": "Application bootstrap and setup",
  "server.js": "HTTP server setup and middleware",
  "server.ts": "HTTP server setup and middleware",
};

// ── Common folder name matches ────────────────────────────────────────────────
const FOLDER_NAME_MAP = {
  src: "Primary source code",
  app: "Application pages and routing",
  pages: "Page-level route components",
  components: "Reusable UI components",
  lib: "Shared utility functions and helpers",
  utils: "Utility and helper functions",
  helpers: "Helper functions",
  hooks: "Custom React hooks",
  context: "React context providers",
  store: "State management (Redux / Zustand / etc.)",
  services: "External API and service integrations",
  api: "API route handlers",
  routes: "Route definitions",
  middleware: "Request/response middleware",
  models: "Data models and schemas",
  schemas: "Validation schemas",
  types: "TypeScript type definitions",
  interfaces: "TypeScript interfaces",
  constants: "Shared constants and enums",
  config: "Configuration files",
  styles: "CSS and styling files",
  css: "CSS stylesheets",
  assets: "Static assets (images, fonts, etc.)",
  images: "Image assets",
  icons: "Icon assets",
  fonts: "Font files",
  public: "Publicly served static files",
  static: "Static files",
  tests: "Test files",
  test: "Test files",
  __tests__: "Jest test files",
  spec: "Test spec files",
  e2e: "End-to-end tests",
  scripts: "Build and automation scripts",
  bin: "Executable scripts",
  docs: "Documentation",
  ".github": "GitHub Actions workflows and templates",
  workflows: "CI/CD workflow definitions",
  prisma: "Prisma ORM schema and migrations",
  migrations: "Database migration files",
  seeds: "Database seed data",
  locales: "Internationalisation string files",
  i18n: "Internationalisation config",
  node_modules: "Installed npm dependencies",
  dist: "Compiled output (auto-generated)",
  build: "Build output (auto-generated)",
  out: "Next.js static export output",
  ".next": "Next.js build cache",
  coverage: "Test coverage reports",
};

// ── Extension map ─────────────────────────────────────────────────────────────
const EXTENSION_MAP = {
  // JavaScript / TypeScript
  js: "JavaScript file",
  mjs: "ES module JavaScript file",
  cjs: "CommonJS module file",
  ts: "TypeScript file",
  mts: "ES module TypeScript file",
  cts: "CommonJS TypeScript file",
  jsx: "React JSX component",
  tsx: "React TypeScript component",
  vue: "Vue single-file component",
  svelte: "Svelte component",
  astro: "Astro component",

  // Styles
  css: "CSS stylesheet",
  scss: "Sass stylesheet",
  sass: "Sass stylesheet",
  less: "Less stylesheet",
  styl: "Stylus stylesheet",

  // Markup / templates
  html: "HTML file",
  htm: "HTML file",
  xml: "XML data file",
  svg: "SVG vector graphic",
  pug: "Pug HTML template",
  ejs: "EJS template",
  hbs: "Handlebars template",
  njk: "Nunjucks template",
  liquid: "Liquid template",
  erb: "Ruby ERB template",

  // Data / config
  json: "JSON data file",
  jsonc: "JSON file with comments",
  json5: "JSON5 data file",
  yaml: "YAML configuration file",
  yml: "YAML configuration file",
  toml: "TOML configuration file",
  ini: "INI configuration file",
  env: "Environment variable file",
  csv: "Comma-separated data file",
  tsv: "Tab-separated data file",

  // Docs / text
  md: "Markdown document",
  mdx: "MDX document (Markdown + JSX)",
  txt: "Plain text file",
  rst: "reStructuredText document",
  pdf: "PDF document",

  // Images
  png: "PNG image",
  jpg: "JPEG image",
  jpeg: "JPEG image",
  gif: "GIF image",
  webp: "WebP image",
  ico: "Icon file",
  avif: "AVIF image",
  bmp: "Bitmap image",

  // Fonts
  woff: "Web font file",
  woff2: "Web font file (compressed)",
  ttf: "TrueType font",
  otf: "OpenType font",
  eot: "Embedded OpenType font",

  // Backend languages
  py: "Python file",
  rb: "Ruby file",
  php: "PHP file",
  java: "Java source file",
  kt: "Kotlin source file",
  go: "Go source file",
  rs: "Rust source file",
  cpp: "C++ source file",
  c: "C source file",
  h: "C/C++ header file",
  cs: "C# source file",
  swift: "Swift source file",
  dart: "Dart source file",
  ex: "Elixir source file",
  exs: "Elixir script file",
  lua: "Lua script file",
  r: "R statistical script",
  jl: "Julia source file",
  scala: "Scala source file",
  clj: "Clojure source file",
  hs: "Haskell source file",
  elm: "Elm source file",

  // Shell / scripting
  sh: "Shell script",
  bash: "Bash script",
  zsh: "Zsh shell script",
  fish: "Fish shell script",
  ps1: "PowerShell script",
  bat: "Windows batch script",
  cmd: "Windows command script",

  // DB / data
  sql: "SQL query or schema file",
  graphql: "GraphQL schema or query",
  gql: "GraphQL schema or query",
  prisma: "Prisma schema file",

  // Build / infra
  dockerfile: "Docker container build instructions",
  tf: "Terraform infrastructure config",
  tfvars: "Terraform variable values",
  bicep: "Azure Bicep template",
  hcl: "HashiCorp config language file",
  nix: "Nix expression file",

  // Other
  lock: "Dependency lock file (auto-generated)",
  log: "Application log file",
  map: "Source map for debugging",
  wasm: "WebAssembly binary",
  zip: "Compressed archive",
  tar: "Tape archive",
  gz: "Gzip compressed file",
};

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Returns a plain-English fallback description for a file or folder node.
 * Used when building the repo map and when Grok is unavailable.
 *
 * @param {{ name: string, path: string, type: "file"|"folder", children?: any[] }} node
 * @returns {string}
 */
export function guessDescription(node) {
  const { name, type, children } = node;

  // ── Folders ────────────────────────────────────────────────────────────────
  if (type === "folder") {
    // Named folder lookup first
    const folderLabel = FOLDER_NAME_MAP[name] ?? FOLDER_NAME_MAP[name.toLowerCase()];
    const fileCount = countFiles(node);
    const countLabel =
      fileCount === 0
        ? "Empty folder"
        : fileCount === 1
          ? "1 file inside"
          : `${fileCount} files inside`;

    if (folderLabel) return `${folderLabel} — ${countLabel}`;
    return countLabel;
  }

  // ── Files ─────────────────────────────────────────────────────────────────
  // 1. Exact filename match (case-insensitive)
  const exactMatch =
    FILENAME_MAP[name] ?? FILENAME_MAP[name.toLowerCase()];
  if (exactMatch) return exactMatch;

  // 2. Extension match
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx !== -1) {
    const ext = name.slice(dotIdx + 1).toLowerCase();
    const extMatch = EXTENSION_MAP[ext];
    if (extMatch) return extMatch;
  }

  // 3. Dot-file with no extension (e.g. .gitkeep, .babelrc)
  if (name.startsWith(".")) return "Configuration or dotfile";

  // 4. Fallback
  return "Project file";
}
