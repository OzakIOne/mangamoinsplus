export interface ZipFile {
  name: string;
  bytes: Uint8Array;
}

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;
const VERSION = 20;
const METHOD_STORE = 0;
const FLAG_UTF8 = 0x0800;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const MAX_UINT32 = 0xffffffff;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let crc = MAX_UINT32;
  for (let index = 0; index < bytes.length; index++) {
    crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ MAX_UINT32) >>> 0;
};

const dosTimestamp = (date: Date) => {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
};

export const createZip = ({
  files,
  date = new Date(),
}: {
  files: ZipFile[];
  date?: Date;
}): Uint8Array<ArrayBuffer> => {
  const encoder = new TextEncoder();
  const { time, day } = dosTimestamp(date);

  const entries = files.map((file) => {
    const name = encoder.encode(file.name);
    return {
      name,
      bytes: file.bytes,
      crc: crc32(file.bytes),
    };
  });

  const centralSize = entries.reduce(
    (total, entry) => total + CENTRAL_HEADER_SIZE + entry.name.length,
    0,
  );
  const localSize = entries.reduce(
    (total, entry) => total + LOCAL_HEADER_SIZE + entry.name.length + entry.bytes.length,
    0,
  );
  const archive = new Uint8Array(localSize + centralSize + END_OF_CENTRAL_DIRECTORY_SIZE);
  const view = new DataView(archive.buffer);

  let offset = 0;
  let centralOffset = localSize;
  const localOffsets: number[] = [];

  for (const entry of entries) {
    localOffsets.push(offset);
    view.setUint32(offset, LOCAL_HEADER_SIGNATURE, true);
    view.setUint16(offset + 4, VERSION, true);
    view.setUint16(offset + 6, FLAG_UTF8, true);
    view.setUint16(offset + 8, METHOD_STORE, true);
    view.setUint16(offset + 10, time, true);
    view.setUint16(offset + 12, day, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.bytes.length, true);
    view.setUint32(offset + 22, entry.bytes.length, true);
    view.setUint16(offset + 26, entry.name.length, true);
    view.setUint16(offset + 28, 0, true);
    archive.set(entry.name, offset + LOCAL_HEADER_SIZE);
    archive.set(entry.bytes, offset + LOCAL_HEADER_SIZE + entry.name.length);
    offset += LOCAL_HEADER_SIZE + entry.name.length + entry.bytes.length;
  }

  const centralStart = offset;
  for (const [index, entry] of entries.entries()) {
    view.setUint32(centralOffset, CENTRAL_HEADER_SIGNATURE, true);
    view.setUint16(centralOffset + 4, VERSION, true);
    view.setUint16(centralOffset + 6, VERSION, true);
    view.setUint16(centralOffset + 8, FLAG_UTF8, true);
    view.setUint16(centralOffset + 10, METHOD_STORE, true);
    view.setUint16(centralOffset + 12, time, true);
    view.setUint16(centralOffset + 14, day, true);
    view.setUint32(centralOffset + 16, entry.crc, true);
    view.setUint32(centralOffset + 20, entry.bytes.length, true);
    view.setUint32(centralOffset + 24, entry.bytes.length, true);
    view.setUint16(centralOffset + 28, entry.name.length, true);
    view.setUint16(centralOffset + 30, 0, true);
    view.setUint16(centralOffset + 32, 0, true);
    view.setUint16(centralOffset + 34, 0, true);
    view.setUint16(centralOffset + 36, 0, true);
    view.setUint32(centralOffset + 38, 0, true);
    view.setUint32(centralOffset + 42, localOffsets[index] ?? 0, true);
    archive.set(entry.name, centralOffset + CENTRAL_HEADER_SIZE);
    centralOffset += CENTRAL_HEADER_SIZE + entry.name.length;
  }

  const end = centralStart + centralSize;
  view.setUint32(end, END_SIGNATURE, true);
  view.setUint16(end + 4, 0, true);
  view.setUint16(end + 6, 0, true);
  view.setUint16(end + 8, entries.length, true);
  view.setUint16(end + 10, entries.length, true);
  view.setUint32(end + 12, centralSize, true);
  view.setUint32(end + 16, centralStart, true);
  view.setUint16(end + 20, 0, true);

  return archive;
};
