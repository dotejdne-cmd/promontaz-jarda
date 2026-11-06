// Sestaví dist/jarda.min.js a dist/jarda.css. esbuild je jen nástroj pro build, do webu se nedostane.
import { build, transform } from 'esbuild';
import fs from 'node:fs';

await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife',
  target: ['es2017', 'safari12'], outfile: 'dist/jarda.min.js', legalComments: 'none',
  banner: { js: '/* ProMontaz – Jarda v2 | https://github.com/dotejdne-cmd/promontaz-jarda */' }
});
const css = await transform(fs.readFileSync('src/jarda.css', 'utf8'), { loader: 'css', minify: true, target: ['safari12'] });
fs.writeFileSync('dist/jarda.css', css.code);
JSON.parse(fs.readFileSync('config.json', 'utf8')); // config musí být platný JSON

const js = fs.statSync('dist/jarda.min.js').size, cs = fs.statSync('dist/jarda.css').size;
console.log(`dist/jarda.min.js ${(js / 1024).toFixed(1)} kB, dist/jarda.css ${(cs / 1024).toFixed(1)} kB`);
if (js > 30 * 1024) { console.error('JS je větší než 30 kB'); process.exit(1); }
