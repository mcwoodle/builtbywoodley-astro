# Test content

This folder holds **generated test content** for scale and design testing. It is used when running the site in test mode (`npm run test-dev` or `npm run test-build`) so you can develop and verify layout, chunking, and performance with many entries before real content exists.

- **Location:** `test/content/projects/` — MDX files here are loaded when `CONTENT_PROJECTS_BASE=./test/content/projects`.
- **Source:** Content can be created by an agent or by the project’s generator: `npm run generate-test-content`.

The same pages, layouts, and components from `./src` are used; only the project content source changes.
