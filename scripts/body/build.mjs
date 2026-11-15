// Builds assets/body/body.html, the one file the app shows in a web view: the page, three.js and
// the model, all inline, since a web view opened on a file of the app cannot fetch the ones next to it.
//
//   node scripts/body/build.mjs [body.js]
//
// The model (BodyParts3D, CC BY-SA 2.1 JP, 131 parts joined into 11 muscle groups, the other
// muscles and the skin) is kept only inside the built file: without an argument it is taken
// from there. Pass a `body.js` (window.__BODY_B64="…") to put in a new one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '../../assets/body/body.html');
const MARK = /window\.__BODY_B64\s*=\s*"([A-Za-z0-9+/=]+)"/;

const from = process.argv[2] ?? out;
const model = fs.readFileSync(from, 'utf8').match(MARK)?.[1];
if (!model) throw new Error(`No model in ${from}`);

const read = (name) => fs.readFileSync(path.join(here, name), 'utf8');
// A function as replacement: the sources hold `$&` and the like.
const page = read('page.html')
  .replace('/*THREE*/', () => read('three.min.js'))
  .replace('/*ORBIT*/', () => read('OrbitControls.js'))
  .replace('/*BODY*/', () => model);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`${out}: ${(page.length / 1e6).toFixed(1)} MB`);
