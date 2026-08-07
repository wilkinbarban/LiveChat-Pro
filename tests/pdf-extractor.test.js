// ============================================================
// Tests for PDF Text Extractor Utility (pdfjs-dist CJS Wrapper)
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractPdfText } = require('../src/utils/pdf.js');

function createValidPdfBuffer(text = 'Documento de prueba PDF') {
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${text.length + 40} >>
stream
BT
/F1 24 Tf
100 100 Td
(${text}) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000246 00000 n 
0000000350 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
430
%%EOF`;
  return Buffer.from(pdfContent, 'binary');
}

describe('PDF Extractor Utility (src/utils/pdf.js)', () => {
  it('rechaza entradas que no sean un Buffer válido', async () => {
    await assert.rejects(
      async () => await extractPdfText(null),
      /Input must be a Buffer/i
    );
    await assert.rejects(
      async () => await extractPdfText('cadena de texto'),
      /Input must be a Buffer/i
    );
  });

  it('valida la firma binaria mágica (%PDF-) al inicio del buffer', async () => {
    const invalidBuffer = Buffer.from('NOT-A-PDF content data');
    await assert.rejects(
      async () => await extractPdfText(invalidBuffer),
      /missing %PDF- magic bytes|not a valid PDF/i
    );
  });

  it('extrae el contenido de texto de un buffer PDF válido', async () => {
    const pdfBuffer = createValidPdfBuffer('Manual de Usuario LiveChat');
    const text = await extractPdfText(pdfBuffer);
    assert.ok(typeof text === 'string', 'El resultado debe ser una cadena');
    assert.match(text, /Manual de Usuario LiveChat/i);
  });

  it('extrae correctamente textos con caracteres de múltiples palabras', async () => {
    const pdfBuffer = createValidPdfBuffer('Guia de configuracion y soporte tecnico RAG');
    const text = await extractPdfText(pdfBuffer);
    assert.match(text, /Guia de configuracion y soporte tecnico RAG/i);
  });

  it('maneja buffers corruptos que inician con %PDF- pero tienen estructura inválida', async () => {
    const corruptPdf = Buffer.from('%PDF-1.4 corrupt data string without pdf structure');
    await assert.rejects(
      async () => await extractPdfText(corruptPdf)
    );
  });
});
