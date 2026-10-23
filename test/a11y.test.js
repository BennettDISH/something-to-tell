// Accessibility floor for the pages (checklist item 7): the document language, a viewport that
// doesn't block zoom, and exactly one <main> landmark around the routed page. A static check of
// the sources, so no browser is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('index.html names the language and lets the page zoom', () => {
  const html = read('index.html');
  assert.match(html, /<html[^>]*\blang="[a-z-]+"/i);
  const viewport = html.match(/<meta[^>]*name="viewport"[^>]*>/i)?.[0] ?? '';
  assert.ok(viewport, 'a viewport tag');
  assert.doesNotMatch(viewport, /user-scalable\s*=\s*(no|0)/i);
  assert.doesNotMatch(viewport, /maximum-scale\s*=\s*1(\.0)?\b/i);
});

test('every page renders inside exactly one <main id="main">', () => {
  const app = read('src/App.jsx');
  assert.equal(app.match(/<main\b/g)?.length, 1);
  assert.match(app, /<main id="main"/);
  // The pages sit inside it, so none may add a second landmark of its own.
  const dir = path.join(root, 'src');
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.jsx$/.test(entry.name) && full !== path.join(dir, 'App.jsx')) {
        assert.doesNotMatch(fs.readFileSync(full, 'utf8'), /<main\b/, `${path.relative(root, full)} has its own <main>`);
      }
    }
  }
});
