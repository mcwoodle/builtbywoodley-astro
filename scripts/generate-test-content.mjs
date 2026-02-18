#!/usr/bin/env node
/**
 * Generates placeholder MDX entries into test/content/projects/ for scale testing.
 * Run: npm run generate-test-content
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const projectsDir = path.join(root, 'test', 'content', 'projects');
const placeholderCover = 'placeholder-cover.svg';
const sourceFavicon = path.join(root, 'public', 'favicon.svg');

const PROJECT_TYPES = ['woodworking', 'renovation', 'tech-setup', 'other'];
const TAG_POOL = [
  'shop-furniture',
  'joinery',
  'electrical',
  'plumbing',
  'home-server',
  'network',
  'desk-setup',
  'shelving',
  'finishing',
  'hand-tools',
];
const VIDEO_URLS = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://vimeo.com/123456789',
  null,
  null,
  null,
];

const titles = [
  'Building the Ultimate Garage Workbench',
  'Kitchen Cabinet Refresh',
  'Home Server and NAS Setup',
  'Desk Cable Management',
  'Floating Shelves in the Office',
  'Bathroom Vanity Renovation',
  'Outdoor Deck Staining',
  'Network Rack and Patch Panel',
  'Shop Dust Collection Upgrade',
  'Monitor Arm and Ergonomic Setup',
  'Closet Built-Ins',
  'Smart Home Hub and Zigbee Network',
  'Workbench Tool Tray',
  'Mudroom Bench with Storage',
  'Living Room Built-In Shelves',
  'Garage Epoxy Floor',
  'Router Table Build',
  'Study Nook Renovation',
  'Backyard Shed Wiring',
  'Standing Desk Build',
];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomSlice(arr, min, max) {
  const n = min + Math.floor(Math.random() * (max - min + 1));
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}
function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function generateEntry(index) {
  const title = titles[index % titles.length];
  const projectType = randomChoice(PROJECT_TYPES);
  const tags = randomSlice(TAG_POOL, 1, 4);
  const videoUrl = randomChoice(VIDEO_URLS);
  const year = 2024;
  const month = 1 + (index % 12);
  const day = 1 + (index % 25);
  const publishDate = new Date(year, month - 1, day);
  const slug = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-${title.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}`;

  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `publishDate: ${formatDate(publishDate)}`,
    `description: "Generated test entry #${index + 1} for scale and layout testing."`,
    `coverImage: "./${placeholderCover}"`,
    `projectType: "${projectType}"`,
    `tags: [${tags.map((t) => `"${t}"`).join(', ')}]`,
    videoUrl ? `videoUrl: "${videoUrl}"` : null,
    '---',
  ]
    .filter(Boolean)
    .join('\n');

  const body = [
    '',
    `# ${title}`,
    '',
    `This is generated test content (entry #${index + 1}) to exercise the site with many projects.`,
    '',
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    '',
  ].join('\n');

  return { slug: slug.slice(0, 80), content: frontmatter + body };
}

// Ensure directory exists
fs.mkdirSync(projectsDir, { recursive: true });

// Remove existing MDX files so we don't keep old test-prefixed names
const existing = fs.readdirSync(projectsDir);
for (const name of existing) {
  if (name.endsWith('.mdx')) {
    fs.unlinkSync(path.join(projectsDir, name));
  }
}

// Copy shared cover image
if (fs.existsSync(sourceFavicon)) {
  fs.copyFileSync(sourceFavicon, path.join(projectsDir, placeholderCover));
} else {
  // Minimal valid SVG if favicon is missing
  fs.writeFileSync(
    path.join(projectsDir, placeholderCover),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#ccc"/></svg>'
  );
}

const count = 20;
for (let i = 0; i < count; i++) {
  const { slug, content } = generateEntry(i);
  const safeSlug = slug.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-');
  const filename = `${safeSlug}.mdx`;
  const filepath = path.join(projectsDir, filename);
  fs.writeFileSync(filepath, content, 'utf8');
}

console.log(`Wrote ${count} test MDX files to test/content/projects/`);
console.log(`Run npm run test-dev to use this content.`);
