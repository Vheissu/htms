#!/usr/bin/env ts-node

import fs from 'fs';
import path from 'path';
import { parseHTML } from './src/parser';
import { ParseOptions } from './src/types';

const filePath: string | undefined = process.argv[2];

if (!filePath) {
  console.error('Usage: ts-node main.ts <input.html>');
  process.exit(1);
}

fs.readFile(filePath, 'utf8', (err, htmlContent) => {
  if (err) throw err;

  const parseOptions: ParseOptions = { mode: 'component' };
  const result = parseHTML(htmlContent, parseOptions);

  if (!result.success || !result.code) {
    console.error('Compilation failed:');
    result.errors.forEach(error => console.error(`  ${error.type}: ${error.message}`));
    process.exit(1);
  }

  const baseName = path.basename(filePath, path.extname(filePath));
  const outputFilePath = path.join(path.dirname(filePath), `${baseName}.js`);

  fs.writeFile(outputFilePath, result.code, writeErr => {
    if (writeErr) throw writeErr;
    console.log(`Successfully generated ${outputFilePath}`);
  });
});
