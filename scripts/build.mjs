// Sestaví verzovanou v3 do dist/<verze>/ a zkontroluje rozpočty, config a zmrazenou v2.
// esbuild je jen nástroj pro build, do webu se nedostane.
import { build, transform } from 'esbuild';
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const V = pkg.version, OUT = `dist/${V}`;
const fail = m => { console.error('✗ ' + m); process.exitCode = 1; };

// 1) zmrazená v2 (běží v produkci z dist/jarda.min.js) – nesmí se změnit
const FROZEN = {
  'dist/jarda.min.js': '50ec3d0dbece0d847800ebf0f57d1849f4130878cd008adbf70dbc08d4f95f57',
  'dist/jarda.css': '5c50d50c35d3c287ac64d6352f2b1cf139f5a08e54842cc4fbe022bb13165740'
};
for (const [f, h] of Object.entries(FROZEN)) {
  const got = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  if (process.env.PRINT_FROZEN) console.log(f, got);
  else if (got !== h) fail(`${f} se změnil – v2 je v produkci zmrazená`);
}

// 2) configy
const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const app = JSON.parse(fs.readFileSync('config.app.json', 'utf8'));
for (const k of ['whatsapp', 'index_url', 'formsubmit_endpoint', 'links', 'facts', 'texts', 'intents']) if (!(k in cfg)) fail(`config.json: chybí ${k}`);
for (const k of ['intent_rules', 'texts_v3', 'quote', 'contact']) if (!(k in app)) fail(`config.app.json: chybí ${k}`);
if (!Array.isArray(cfg.intents.doprava)) fail('config.json: intents musí zůstat ve tvaru pro v2 (pole slov)');
if (cfg.facts.free_shipping_from_czk != null && !process.env.ALLOW_FREE_SHIPPING) console.warn('! doprava zdarma je zapnutá – musí ji potvrdit majitel');

// 3) build
const css = (await transform(fs.readFileSync('src/jarda.css', 'utf8'), { loader: 'css', minify: true, target: ['safari12'] })).code;
fs.mkdirSync(OUT, { recursive: true });
const common = { bundle: true, minify: true, format: 'iife', target: ['es2017', 'safari12'], legalComments: 'none' };
await build({ ...common, entryPoints: ['src/loader.js'], outfile: `${OUT}/jarda.min.js`, define: { __VERSION__: JSON.stringify(V) },
  banner: { js: `/* ProMontaz – Jarda ${V} | github.com/dotejdne-cmd/promontaz-jarda */` } });
await build({ ...common, entryPoints: ['src/app.js'], outfile: `${OUT}/jarda-app.min.js`, define: { __VERSION__: JSON.stringify(V), __CSS__: JSON.stringify(css) },
  banner: { js: `/* ProMontaz – Jarda ${V} app */` } });

// 4) rozpočty (raw i gzip) – zavaděč se stahuje s každou stránkou, aplikace až při interakci
const BUDGET = { 'jarda.min.js': [10 * 1024, 4 * 1024], 'jarda-app.min.js': [48 * 1024, 16 * 1024] };
for (const [f, [raw, gz]] of Object.entries(BUDGET)) {
  const b = fs.readFileSync(`${OUT}/${f}`), g = zlib.gzipSync(b, { level: 9 }).length;
  console.log(`${OUT}/${f}: ${(b.length / 1024).toFixed(1)} kB, gzip ${(g / 1024).toFixed(1)} kB`);
  if (b.length > raw || g > gz) fail(`${f} přesahuje rozpočet ${raw / 1024} kB / gzip ${gz / 1024} kB`);
}
