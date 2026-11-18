/**
 * Minimal ZIP writer/reader (Node built-ins only).
 *
 * Why not `tar -a`: it can emit "./" prefixed entries, which some extractors turn into an unwanted
 * extra folder level. This writer stores clean relative names with forward slashes, explicit
 * directory entries, fixed timestamps (reproducible output) and Unix permissions.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 2026-01-01 00:00:00 in DOS format, so identical input always gives identical bytes.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** Entry names must be relative, use "/" and never contain "." / ".." segments. */
function assertSafeName(name) {
  const bare = name.endsWith('/') ? name.slice(0, -1) : name;
  if (!bare || bare.startsWith('/') || bare.includes('\\') || /^[A-Za-z]:/.test(bare) || bare.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error(`Unsafe zip entry name: "${name}"`);
  }
}

/** Collects every file and directory below `dir` as zip entries (names relative to `dir`, no "./"). */
export function entriesFromDir(dir) {
  const entries = [];
  const visit = (current, prefix) => {
    for (const dirent of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, dirent.name);
      const name = prefix + dirent.name;
      if (dirent.isDirectory()) {
        entries.push({ name: `${name}/`, dir: true });
        visit(full, `${name}/`);
      } else if (dirent.isFile()) {
        entries.push({ name, data: fs.readFileSync(full) });
      }
    }
  };
  visit(dir, '');
  return entries;
}

/** @param {{name: string, data?: Buffer, dir?: boolean}[]} entries */
export function writeZip(zipPath, entries) {
  const seen = new Set();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    assertSafeName(entry.name);
    if (seen.has(entry.name)) throw new Error(`Duplicate zip entry: ${entry.name}`);
    seen.add(entry.name);

    const name = Buffer.from(entry.name, 'utf8');
    const raw = entry.dir ? Buffer.alloc(0) : entry.data;
    const deflated = raw.length > 0 ? zlib.deflateRawSync(raw, { level: 9 }) : raw;
    const useDeflate = raw.length > 0 && deflated.length < raw.length;
    const data = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    const mode = entry.dir ? 0o40755 : 0o100644;
    const externalAttrs = ((mode << 16) | (entry.dir ? 0x10 : 0)) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(externalAttrs, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(seen.size, 8);
  end.writeUInt16LE(seen.size, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.writeFileSync(zipPath, Buffer.concat([...locals, centralBuf, end]));
}

/** Reads a zip back (used to verify packages). Returns [{name, dir, data}] with CRC checked. */
export function readZip(zipPath) {
  const buf = fs.readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${zipPath}: not a zip file`);

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`${zipPath}: corrupt central directory`);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const stored = buf.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? zlib.inflateRawSync(stored) : Buffer.from(stored);
    if (!name.endsWith('/') && crc32(data) !== crc) throw new Error(`${zipPath}: CRC mismatch for ${name}`);
    out.push({ name, dir: name.endsWith('/'), data });
  }
  return out;
}

/** Extracts like an unzip tool into `dest` (rejects entries that would escape it). */
export function extractZip(zipPath, dest) {
  const root = path.resolve(dest);
  for (const entry of readZip(zipPath)) {
    assertSafeName(entry.name);
    const target = path.resolve(root, entry.name);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Zip entry escapes destination: ${entry.name}`);
    if (entry.dir) {
      fs.mkdirSync(target, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.data);
    }
  }
}
