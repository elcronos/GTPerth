#!/usr/bin/env node
// node <skill>/tools/scaffold.mjs <gameDir> [--node-modules <dir to symlink instead of npm i>]
// Creates a new onefile-aaa game: template + cookbook (flattened into src/cookbook/) + tools, git init, first build.
import { cpSync, mkdirSync, existsSync, symlinkSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.argv[2] || '');
const nmIdx = process.argv.indexOf('--node-modules');
if (!process.argv[2]) { console.error('usage: scaffold.mjs <gameDir> [--node-modules <dir>]'); process.exit(1); }
if (existsSync(dir) && readdirSync(dir).length) { console.error(`refusing: ${dir} exists and is not empty`); process.exit(1); }
mkdirSync(path.join(dir, 'src', 'cookbook'), { recursive: true });
cpSync(path.join(SK, 'templates', 'three'), dir, { recursive: true });
cpSync(path.join(SK, 'cookbook', 'three'), path.join(dir, 'src', 'cookbook'), { recursive: true });   // main.js imports ./cookbook/<area>/...
cpSync(path.join(SK, 'cookbook', 'CONTRACT.md'), path.join(dir, 'src', 'cookbook', 'CONTRACT.md'));
cpSync(path.join(SK, 'tools'), path.join(dir, 'tools'), { recursive: true, filter: (s) => !s.includes('node_modules') });
writeFileSync(path.join(dir, '.gitignore'), 'node_modules\ndist\nshots\n*.tmp\nbench-*.json\n');
const run = (c) => execSync(c, { cwd: dir, stdio: 'inherit' });
if (nmIdx > 0) symlinkSync(path.resolve(process.argv[nmIdx + 1]), path.join(dir, 'node_modules'));
else run('npm i --no-audit --no-fund');
run('git init -q && git add -A && git commit -qm scaffold');
run('node build.mjs');
console.log(`\nscaffolded ${dir}\nsmoke: cd ${dir} && node tools/capture.mjs --url dist/index.html --out shots/smoke --critic`);
