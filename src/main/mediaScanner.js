'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.jfif'
]);

/**
 * Scans a folder (optionally recursive) for image files.
 * Returns a list of media descriptors. Pure I/O, no app state.
 *
 * @param {string} folderPath absolute path to a directory
 * @param {object} [opts]
 * @param {boolean} [opts.recursive=true]
 * @returns {Promise<Array<{path:string, url:string, name:string, size:number}>>}
 */
async function scanFolder(folderPath, opts = {}) {
  const recursive = opts.recursive !== false;
  const results = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      // Unreadable directory: skip rather than crash the live app.
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !entry.name.startsWith('.')) {
          await walk(full);
        }
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) continue;

      let size = 0;
      try {
        const stat = await fs.promises.stat(full);
        size = stat.size;
      } catch {
        continue; // file vanished between readdir and stat
      }

      results.push({
        path: full,
        url: pathToFileURL(full).href,
        name: entry.name,
        size
      });
    }
  }

  await walk(folderPath);

  // Stable alphabetical base order; randomisation happens in the playlist layer.
  results.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return results;
}

module.exports = { scanFolder, IMAGE_EXTENSIONS };
