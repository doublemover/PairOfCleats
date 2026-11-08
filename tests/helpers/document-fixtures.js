import zlib from 'node:zlib';
const PDF_HEADER = '%PDF-1.4\n';

const escapePdfText = (value) => String(value || '')
  .replace(/\\/g, '\\\\')
  .replace(/\(/g, '\\(')
  .replace(/\)/g, '\\)');

const buildPdfBodyObjects = (text) => {
  const stream = `BT /F1 24 Tf 72 96 Td (${escapePdfText(text)}) Tj ET`;
  return [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n',
    `4 0 obj << /Length ${Buffer.byteLength(stream, 'utf8')} >> stream\n${stream}\nendstream endobj\n`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n'
  ];
};

const buildPdfObjectBuffer = objects => {
  const chunks = [PDF_HEADER];
  const offsets = [0];
  let cursor = Buffer.byteLength(PDF_HEADER, 'utf8');
  for (const object of objects) {
    offsets.push(cursor);
    chunks.push(object);
    cursor += Buffer.byteLength(object, 'utf8');
  }
  const xrefOffset = cursor;
  const xrefRows = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n'];
  for (let i = 1; i <= objects.length; i += 1) {
    xrefRows.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  const trailer = `trailer << /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(chunks.join('') + xrefRows.join('') + trailer, 'utf8');
};

export const buildMinimalPdfBuffer = (text = 'pdf fixture text') => buildPdfObjectBuffer(buildPdfBodyObjects(text));

/** Tiny real PDF pages: blank content is distinct from an inline image with no
 * text operator. Neither fixture requires rendering/OCR or a document tool. */
export const buildMinimalPdfPagesBuffer = pages => {
  const font = 3 + pages.length * 2;
  const objects = ['1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    `2 0 obj << /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >> endobj\n`];
  for (const [index, page] of pages.entries()) {
    const id = 3 + index * 2;
    const stream = page.image ? 'q 1 0 0 1 72 72 cm BI /W 1 /H 1 /BPC 8 /CS /RGB /F /AHx ID FF0000> EI Q'
      : page.text ? `BT /F1 24 Tf 72 96 Td (${escapePdfText(page.text)}) Tj ET` : '';
    objects.push(`${id} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents ${id + 1} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >> endobj\n`,
      `${id + 1} 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj\n`);
  }
  objects.push(`${font} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n`);
  return buildPdfObjectBuffer(objects);
};

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let j = 0; j < 8; j += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[i] = value >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    const index = (crc ^ buffer[i]) & 0xff;
    crc = (crc >>> 8) ^ CRC32_TABLE[index];
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const toBuffer = (value) => Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'utf8');

const writeUInt16 = (value) => {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16LE(value >>> 0, 0);
  return buffer;
};

const writeUInt32 = (value) => {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
};

export const buildStoredZip = (entries) => {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = String(entry?.name || '');
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = toBuffer(entry?.data);
    const compression = entry.compression === 8 ? 8 : 0;
    const payload = compression ? zlib.deflateRawSync(data) : data;
    const declaredSize = entry.declaredSize ?? data.length;
    const checksum = crc32(data);
    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(compression),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(checksum),
      writeUInt32(payload.length),
      writeUInt32(declaredSize),
      writeUInt16(nameBuffer.length),
      writeUInt16(0),
      nameBuffer
    ]);
    localParts.push(localHeader, payload);
    const centralHeader = Buffer.concat([
      writeUInt32(0x02014b50),
      writeUInt16(20),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(compression),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(checksum),
      writeUInt32(payload.length),
      writeUInt32(declaredSize),
      writeUInt16(nameBuffer.length),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(localOffset),
      nameBuffer
    ]);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + payload.length;
  }
  const central = Buffer.concat(centralParts);
  const local = Buffer.concat(localParts);
  const eocd = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(entries.length),
    writeUInt16(entries.length),
    writeUInt32(central.length),
    writeUInt32(local.length),
    writeUInt16(0)
  ]);
  return Buffer.concat([local, central, eocd]);
};

const escapeXml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

export const buildMinimalDocxBuffer = (paragraphs = ['docx fixture text'], { xml = null, stylesXml = null } = {}) => {
  const paragraphXml = paragraphs.map((text) => (
    `<w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`
  )).join('');
  const documentXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body>',
    paragraphXml,
    '<w:sectPr/>',
    '</w:body>',
    '</w:document>'
  ].join('');
  const entries = [
    {
      name: '[Content_Types].xml',
      data: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
        '</Types>'
      ].join('')
    },
    {
      name: '_rels/.rels',
      data: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
        '</Relationships>'
      ].join('')
    },
    {
      name: 'word/document.xml',
      data: xml ?? documentXml
    }
  ];
  if (stylesXml !== null) entries[0].data = entries[0].data.replace('</Types>', '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  if (stylesXml !== null) entries.push({ name: 'word/styles.xml', data: stylesXml }, {
    name: 'word/_rels/document.xml.rels',
    data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
  });
  return buildStoredZip(entries);
};

export const buildEncryptedDocxBuffer = () => buildStoredZip([
  { name: 'EncryptedPackage', data: 'encrypted-payload' },
  { name: 'EncryptionInfo', data: 'encryption-info' }
]);
