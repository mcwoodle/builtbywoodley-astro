import type { MiddlewareHandler } from 'astro';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const TEST_PROJECTS_BASE = './test/content/projects';

function getTestSlugs(projectsBase: string): Set<string> {
  const dir = resolve(process.cwd(), projectsBase);
  const files = readdirSync(dir, { withFileTypes: true });
  const slugs = new Set<string>();
  for (const f of files) {
    if (f.isFile() && f.name.endsWith('.mdx')) {
      slugs.add(f.name.replace(/\.mdx$/, ''));
    }
  }
  return slugs;
}

let cachedTestSlugs: Set<string> | null = null;

export const onRequest: MiddlewareHandler = async (context, next) => {
  const base = process.env.CONTENT_PROJECTS_BASE;
  if (base !== TEST_PROJECTS_BASE) {
    return next();
  }

  const pathname = context.url.pathname;
  const projectsPrefix = '/projects/';
  if (!pathname.startsWith(projectsPrefix)) {
    return next();
  }

  const slug = pathname.slice(projectsPrefix.length).replace(/\/.*$/, '');
  if (cachedTestSlugs === null) {
    cachedTestSlugs = getTestSlugs(TEST_PROJECTS_BASE);
  }
  if (cachedTestSlugs.has(slug)) {
    return next();
  }

  return context.redirect('/');
};
