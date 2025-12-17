#!/usr/bin/env node

import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const browser = process.argv[2] || 'chrome';
const isWatch = process.argv.includes('--watch');

console.log(`Building for ${browser}...`);

const DIST = join(ROOT, 'dist', browser);

const STATIC_ITEMS = ['icons', '_locales'];

const entryConfigs = [
  {
    out: 'src/background/service-worker',
    entry: join(ROOT, 'src/background/service-worker.js'),
    format: { chrome: 'esm', firefox: 'iife' },
  },
  {
    out: 'src/content/content-script',
    entry: join(ROOT, 'src/content/content-script.js'),
    format: { chrome: 'iife', firefox: 'iife' },
  },
  {
    out: 'src/sidepanel/sidepanel',
    entry: join(ROOT, 'src/sidepanel/sidepanel.js'),
    format: { chrome: 'esm', firefox: 'iife' },
  },
  {
    out: 'src/popup/popup',
    entry: join(ROOT, 'src/popup/popup.js'),
    format: { chrome: 'esm', firefox: 'iife' },
  },
  {
    out: 'src/options/options',
    entry: join(ROOT, 'src/options/options.js'),
    format: { chrome: 'esm', firefox: 'iife' },
  },
];

const targets = {
  chrome: ['chrome120'],
  firefox: ['firefox109'],
};

function cleanDist() {
  if (existsSync(DIST)) {
    rmSync(DIST, { recursive: true });
  }
  mkdirSync(DIST, { recursive: true });
}

function copyStaticAssets() {
  for (const item of STATIC_ITEMS) {
    const src = join(ROOT, item);
    const dest = join(DIST, item);
    if (!existsSync(src)) continue;

    const copyRecursive = (source, destination) => {
      const stats = statSync(source);
      if (stats.isDirectory()) {
        mkdirSync(destination, { recursive: true });
        for (const entry of readdirSync(source)) {
          copyRecursive(join(source, entry), join(destination, entry));
        }
      } else {
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(source, destination);
      }
    };

    copyRecursive(src, dest);
  }
}

function copyNonJsFiles(stripModuleType = false) {
  const srcRoot = join(ROOT, 'src');
  const destRoot = join(DIST, 'src');

  const walk = (srcDir, destDir) => {
    if (!existsSync(srcDir)) return;
    mkdirSync(destDir, { recursive: true });
    const entries = readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(srcDir, entry.name);
      const destPath = join(destDir, entry.name);

      if (entry.isDirectory()) {
        walk(srcPath, destPath);
      } else if (!entry.name.endsWith('.js')) {
        if (entry.name.endsWith('.html') && stripModuleType) {
          let html = readFileSync(srcPath, 'utf8');
          html = html.replace(/ type="module"/g, '');
          writeFileSync(destPath, html);
        } else {
          copyFileSync(srcPath, destPath);
        }
      }
    }
  };

  walk(srcRoot, destRoot);
}

async function bundleEntryFiles() {
  for (const config of entryConfigs) {
    const format = config.format[browser] || 'esm';
    const outfile = join(DIST, `${config.out}.js`);
    mkdirSync(dirname(outfile), { recursive: true });
    await esbuild.build({
      entryPoints: [config.entry],
      bundle: true,
      format,
      target: targets[browser] || ['chrome120'],
      outfile,
      minify: false,
      sourcemap: false,
    });
    console.log(`  Bundled: ${config.out}.js (${format})`);
  }
}

function copyManifest() {
  const manifestFile = browser === 'firefox' ? 'manifest.firefox.json' : 'manifest.json';
  copyFileSync(join(ROOT, manifestFile), join(DIST, 'manifest.json'));
}

async function build() {
  console.log(`[Build] Cleaning dist/${browser}...`);
  cleanDist();
  copyStaticAssets();
  copyNonJsFiles(browser === 'firefox');
  await bundleEntryFiles();
  copyManifest();
  console.log(`Build complete! Output: dist/${browser}/`);
}

await build();

if (isWatch) {
  console.log('Watching for changes... (press Ctrl+C to stop)');
  const { watch } = await import('fs');
  const watchDirs = ['src', 'icons', '_locales', 'manifest.json', 'manifest.firefox.json'];

  for (const dir of watchDirs) {
    const path = join(ROOT, dir);
    if (!existsSync(path)) continue;
    watch(path, { recursive: true }, async (_, filename) => {
      console.log(`Change detected (${filename}); rebuilding...`);
      try {
        await build();
      } catch (err) {
        console.error('Rebuild failed:', err);
      }
    });
  }
}
