import fs from 'fs';
import path from 'path';
import { parseHTML } from './parser';

const filePath: string = process.argv[2];

fs.readFile(filePath, 'utf8', (err, htmlContent) => {
  if (err) throw err;
  
  // Parse the HTML content to generate JavaScript code
  const finalCode: string = parseHTML(htmlContent);
  
  // Get the base name without extension
  const baseName = path.basename(filePath, path.extname(filePath));

  // Construct the output file path
  const outputFilePath = path.join(path.dirname(filePath), `${baseName}.js`);
  
  // Write the generated code to the output file
  fs.writeFile(outputFilePath, finalCode, (writeErr) => {
    if (writeErr) throw writeErr;
    console.log(`Successfully generated ${outputFilePath}`);
  });
});
