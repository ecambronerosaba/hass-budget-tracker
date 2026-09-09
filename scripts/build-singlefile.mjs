/**
 * Inline the built CSS and JS into one self-contained index.html.
 * Easier to drop onto a Home Assistant box: one file, no assets/ folder to
 * create, nothing to half-copy.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const assets = join(dist, 'assets');
let html = readFileSync(join(dist, 'index.html'), 'utf8');

for (const file of readdirSync(assets)) {
  const body = readFileSync(join(assets, file), 'utf8');
  if (file.endsWith('.css')) {
    html = html.replace(
      new RegExp(`<link[^>]*href="\\./assets/${file}"[^>]*>`),
      // A function replacement — a string one would interpret `$&` and `$'`
      // inside the bundle as backreferences and splice the tag back in.
      () => `<style>\n${body}\n</style>`,
    );
  } else if (file.endsWith('.js')) {
    html = html.replace(
      new RegExp(`<script[^>]*src="\\./assets/${file}"[^>]*></script>`),
      () => `<script type="module">\n${body}\n</script>`,
    );
  }
}

if (html.includes('./assets/')) throw new Error('An asset reference was left un-inlined.');
writeFileSync('budget.html', html);
console.log(`budget.html — ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB, self-contained`);
