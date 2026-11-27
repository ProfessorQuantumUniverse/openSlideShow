'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.jfif'
]);

// Containers Chromium's media stack plays natively (hardware-decoded where the
// GPU supports the codec): MP4/MOV/M4V (H.264, H.265, AV1), WebM/MKV (VP8, VP9,
// AV1) and Ogg. Files with an unsupported codec are skipped at playback time.
const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.mov', '.webm', '.mkv', '.ogv'
]);

// Guard against a single pathological image (e.g. a multi-GB BMP) that would
// choke the renderer's decoder and stall the whole show. Videos are streamed
// from disk instead of decoded in one go, so they have no size limit.
const MAX_IMAGE_BYTES = 256 * 1024 * 1024; // 256 MB

function mediaType(ext) {
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return null;
}

/**
 * Scans a folder (optionally recursive) for image and video files.
 * Returns a list of media descriptors. Pure I/O, no app state.
 *
 * @param {string} folderPath absolute path to a directory
 * @param {object} [opts]
 * @param {boolean} [opts.recursive=true]
 * @returns {Promise<Array<{path:string, url:string, name:string, type:'image'|'video', size:number, mtime:number}>>}
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

    const subdirs = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Note: symlinked directories report isDirectory() === false here
        // (withFileTypes uses lstat semantics), so they're never followed —
        // no risk of a symlink recursion loop.
        if (recursive && !entry.name.startsWith('.')) subdirs.push(full);
        continue;
      }
      const type = mediaType(path.extname(entry.name).toLowerCase());
      if (!type) continue;

      let size = 0;
      let mtime = 0;
      try {
        const stat = await fs.promises.stat(full);
        size = stat.size;
        mtime = stat.mtimeMs;
      } catch {
        continue; // file vanished between readdir and stat
      }
      if (type === 'image' && size > MAX_IMAGE_BYTES) continue; // too large to decode safely

      results.push({
        path: full,
        url: pathToFileURL(full).href,
        name: entry.name,
        type,
        size,
        mtime
      });
    }

    // Walk subdirectories in parallel — markedly faster on deep trees than the
    // previous sequential depth-first descent. Final order is fixed by the sort
    // below, so concurrency here doesn't affect the result.
    await Promise.all(subdirs.map(walk));
  }

  await walk(folderPath);

  // Stable alphabetical base order (equal names in different subfolders are
  // tie-broken by path); the play order is derived from it in the playlist layer.
  const collate = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  results.sort((a, b) => collate(a.name, b.name) || collate(a.path, b.path));
  return results;
}

module.exports = { scanFolder, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS };
