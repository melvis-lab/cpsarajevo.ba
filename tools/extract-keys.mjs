// Lists every English string the home page can show (used as keys for js/i18n-ar.js).
// Usage: node tools/extract-keys.mjs > /tmp/keys.json
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ent = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const keys = new Set();
for (const attr of ['data-en', 'data-ph-en', 'data-al-en', 'data-pre-en'])
  for (const m of html.matchAll(new RegExp(attr + `=(?:"([^"]*)"|'([^']*)')`, 'g'))) keys.add(ent(m[1] ?? m[2]));
// JS data blocks
const grab = name => { const i = html.indexOf('const ' + name + ' ='); const j = i < 0 ? html.indexOf('const ' + name + '=') : i;
  if (j < 0) throw new Error(name); let k = html.indexOf('=', j) + 1, d = 0, st = -1;
  for (; k < html.length; k++) { const c = html[k]; if (c === '{' || c === '[') { if (st < 0) st = k; d++; } else if (c === '}' || c === ']') { d--; if (d === 0) break; } }
  return vm.runInNewContext('(' + html.slice(st, k + 1) + ')', { sw: () => '' }); };
const P = grab('P'), GL = grab('GL'), FILMS = grab('FILMS'), R = grab('R'), TYPES = grab('TYPES'), Q = grab('Q'), D = grab('D');
P.forEach(p => p.en.forEach(x => keys.add(x)));
Object.values(GL).forEach(a => keys.add(a[1]));
Object.values(FILMS).forEach(a => keys.add(a[1]));
R.forEach(r => keys.add(r[1]));
Object.values(TYPES).forEach(t => { keys.add(t[1]); keys.add(t[3]); });
Q.forEach(q => { keys.add(q.t[1]); q.o.forEach(o => { keys.add(o[1]); if (o[3]) keys.add(o[3]); }); });
Object.values(D).forEach(d => { keys.add(d.h[1]); keys.add(d.d[1]); d.w[1].forEach(x => keys.add(x)); });
for (const m of html.matchAll(/L\('((?:[^'\\]|\\.)*)','((?:[^'\\]|\\.)*)'(,|\))/g)) keys.add(m[2].replace(/\\'/g, "'"));
keys.delete('');
console.log(JSON.stringify([...keys], null, 0));
