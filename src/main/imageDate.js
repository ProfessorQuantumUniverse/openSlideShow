'use strict';

const fs = require('fs');

// The Exif block sits in the first APP1 segment, which is capped at 64 KB, and
// is almost always preceded only by a small APP0/JFIF header. Reading a fixed
// head of the file is enough and avoids loading multi-MB photos into memory.
const HEAD_BYTES = 128 * 1024;

const TAG_EXIF_IFD = 0x8769;          // IFD0 -> pointer to the Exif sub-IFD
const TAG_DATETIME = 0x0132;          // IFD0: last modification by the camera/editor
const TAG_DATETIME_ORIGINAL = 0x9003; // Exif IFD: moment the photo was taken

/**
 * Best-effort "picture date" for sorting: the Exif capture time of a JPEG,
 * otherwise the file's modification time (which survives copying on Windows,
 * unlike the creation time). Never throws.
 *
 * @param {{path:string, mtime:number}} item
 * @returns {Promise<number>} epoch milliseconds
 */
async function readImageDate(item) {
  try {
    const exif = await readExifDate(item.path);
    if (exif != null) return exif;
  } catch {
    // unreadable or malformed file: fall through to mtime
  }
  return item.mtime;
}

async function readExifDate(file) {
  const fh = await fs.promises.open(file, 'r');
  let buf;
  try {
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(HEAD_BYTES), 0, HEAD_BYTES, 0);
    buf = buffer.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }

  const tiff = findJpegExif(buf);
  return tiff ? parseTiffDate(tiff) : null;
}

/** Walks the JPEG marker segments and returns the TIFF payload of APP1/Exif. */
function findJpegExif(buf) {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null; // not a JPEG
  let off = 2;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xFF) return null;
    const marker = buf[off + 1];
    if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
      off += 2; // standalone markers carry no length
      continue;
    }
    if (marker === 0xDA || marker === 0xD9) return null; // image data starts: no Exif
    const len = buf.readUInt16BE(off + 2);
    const start = off + 4;
    if (marker === 0xE1 && buf.toString('latin1', start, start + 6) === 'Exif\0\0') {
      return buf.subarray(start + 6, Math.min(buf.length, off + 2 + len));
    }
    off += 2 + len;
  }
  return null;
}

/** Reads DateTimeOriginal (or DateTime as a fallback) from a TIFF/Exif block. */
function parseTiffDate(tiff) {
  if (tiff.length < 8) return null;
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));

  // Returns {tag: valueOffset} for the entries of the IFD at `ifdOff`.
  function readIfd(ifdOff) {
    const entries = {};
    if (ifdOff + 2 > tiff.length) return entries;
    const n = u16(ifdOff);
    for (let i = 0; i < n; i++) {
      const e = ifdOff + 2 + i * 12;
      if (e + 12 > tiff.length) break;
      entries[u16(e)] = { count: u32(e + 4), value: e + 8 };
    }
    return entries;
  }

  // ASCII values longer than 4 bytes live at the offset stored in the entry.
  function readAscii(entry) {
    if (!entry || entry.count < 19) return null;
    const at = entry.count > 4 ? u32(entry.value) : entry.value;
    if (at + 19 > tiff.length) return null;
    return tiff.toString('latin1', at, at + 19);
  }

  const ifd0 = readIfd(u32(4));
  let raw = null;
  if (ifd0[TAG_EXIF_IFD]) {
    const exifIfd = readIfd(u32(ifd0[TAG_EXIF_IFD].value));
    raw = readAscii(exifIfd[TAG_DATETIME_ORIGINAL]);
  }
  return parseExifTimestamp(raw) ?? parseExifTimestamp(readAscii(ifd0[TAG_DATETIME]));
}

/** "YYYY:MM:DD HH:MM:SS" (camera local time) -> epoch ms, or null if blank/invalid. */
function parseExifTimestamp(raw) {
  const m = raw && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31) return null; // e.g. "0000:00:00 …"
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

module.exports = { readImageDate };
