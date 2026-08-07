'use strict';

const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

/**
 * Extracts raw text content from a PDF Buffer using pdfjs-dist legacy CJS wrapper.
 * Validates magic bytes (%PDF-) and throws descriptive errors on invalid input or format.
 *
 * @param {Buffer} buffer - Raw PDF file buffer
 * @returns {Promise<string>} Extracted text string
 */
async function extractPdfText(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Input must be a Buffer');
  }

  if (buffer.length < 5 || buffer.toString('utf8', 0, 5) !== '%PDF-') {
    throw new Error('Not a valid PDF file: missing %PDF- magic bytes');
  }

  const data = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  });

  const pdfDocument = await loadingTask.promise;
  const pageTexts = [];

  for (let i = 1; i <= pdfDocument.numPages; i++) {
    const page = await pdfDocument.getPage(i);
    const textContent = await page.getTextContent();
    const pageString = textContent.items
      .map((item) => item.str)
      .filter((str) => str.trim().length > 0)
      .join(' ');

    if (pageString) {
      pageTexts.push(pageString);
    }
  }

  return pageTexts.join('\n\n').trim();
}

module.exports = {
  extractPdfText,
  extractText: extractPdfText,
};
