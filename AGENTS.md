# AGENTS.md

This file provides guidance to AI coding assistants when working with code in this repository.

## Project Overview

Built by Woodley: A personal portfolio and workshop journal built with Astro, showcasing projects, setups, and experiments.

## Commands

**Install dependencies:**
```bash
npm install
```

**Run development server:**
```bash
npm run dev
```

**Build for production:**
```bash
npm run build
```

## Authoring

### Commit Messages
- Use conventional commits format: `type(scope): description`
- Types: feat, fix, refactor, docs, test, chore, style, content
- Keep the subject line under 72 characters
- Add 0-3 sentences to the commit message body to describe the changes.
- Use imperative mood ("Add feature" not "Added feature")
- ALWAYS use "Co-Authored-By" in commit messages (For Claude, use your default, for Antigravity IDE only use "[model] <antigravity.git@gmail.com>" - replacing [model] with the actual model name and version)

## Architecture

The site is built as a static site using Astro.

### Pages & Layouts (`src/pages/`, `src/layouts/`)
The main entry points are in `src/pages/`. Layout components are in `src/layouts/BaseLayout.astro`.

### Components (`src/components/`)
Astro components used to build the UI (e.g., Header, ContentCarousel, BlogEntry).

### Content Collections (`src/content/projects/`)
Project entries are stored as Markdown/MDX files within Astro content collections. They use frontmatter for metadata (title, description, publishDate, projectType, etc.).

### Styling (`src/styles/`)
Global styles and CSS custom properties (tokens) are defined in `src/styles/global.css`. Tailwind CSS is also configured for utility classes (`tailwind.config.ts`).
