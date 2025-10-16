#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { parseHTML } from './parser';
import { CompilerLogger } from './utils/logger';
import { SecurityValidator } from './utils/security';
import { ParseOptions } from './types';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('htms')
    .description('HTML to JavaScript compiler')
    .version('1.0.0');

  program
    .command('compile')
    .description('Compile HTML file to JavaScript')
    .argument('<input>', 'Input HTML file path')
    .option('-o, --output <path>', 'Output file path')
    .option('--format <format>', 'Output format (esm|cjs|iife)', 'esm')
    .option('--strict', 'Enable strict mode', false)
    .option('--max-size <size>', 'Maximum file size in bytes', '1048576') // 1MB default
    .option('--mode <mode>', 'Compilation mode (only component supported)', 'component')
    .action(async (input: string, options) => {
    const startTime = Date.now();
    
    try {
      if (options.mode && options.mode !== 'component') {
        console.error('Error: only component mode is supported.');
        process.exit(1);
      }
      // Validate input arguments
      const validationErrors = SecurityValidator.validateFilePath(input);
      if (validationErrors.length > 0) {
        CompilerLogger.logValidationError('Invalid input file path', { 
          input, 
          errors: validationErrors 
        });
        console.error('Error: Invalid input file path');
        validationErrors.forEach(error => console.error(`  - ${error.message}`));
        process.exit(1);
      }

      // Validate file extension
      const extensionErrors = SecurityValidator.validateFileExtension(input, ['html', 'htm']);
      if (extensionErrors.length > 0) {
        CompilerLogger.logValidationError('Invalid file extension', { 
          input, 
          errors: extensionErrors 
        });
        console.error('Error: Invalid file extension');
        extensionErrors.forEach(error => console.error(`  - ${error.message}`));
        process.exit(1);
      }

      // Check if file exists and is readable
      try {
        await fs.access(input, fs.constants.R_OK);
      } catch {
        CompilerLogger.logValidationError('File not accessible', { input });
        console.error(`Error: Cannot read file: ${input}`);
        process.exit(1);
      }

      // Check file size
      const stats = await fs.stat(input);
      const maxSize = parseInt(options.maxSize);
      if (stats.size > maxSize) {
        CompilerLogger.logValidationError('File too large', { 
          input, 
          size: stats.size, 
          maxSize 
        });
        console.error(`Error: File too large. Maximum size: ${maxSize} bytes`);
        process.exit(1);
      }

      // Read and validate file content
      const htmlContent = await fs.readFile(input, 'utf8');
      
      // Security validation
      const contentErrors = SecurityValidator.validateContent(htmlContent);
      if (contentErrors.length > 0) {
        CompilerLogger.logSecurityIssue('Dangerous content detected', { 
          input, 
          errors: contentErrors 
        });
        console.error('Error: Potentially dangerous content detected');
        contentErrors.forEach(error => console.error(`  - ${error.message}`));
        process.exit(1);
      }

      // Parse options
      const parseOptions: ParseOptions = {
        maxFileSize: maxSize,
        strictMode: options.strict,
        outputFormat: options.format,
        mode: 'component'
      };

      CompilerLogger.logInfo('Starting compilation', { input, options: parseOptions });

      // Compile HTML to JavaScript
      const result = parseHTML(htmlContent, parseOptions);

      if (!result.success) {
        CompilerLogger.logCompilerError('Compilation failed', { 
          input, 
          errors: result.errors 
        });
        console.error('Compilation failed:');
        result.errors.forEach(error => {
          console.error(`  ${error.type}: ${error.message}`);
          if (error.line) console.error(`    at line ${error.line}`);
        });
        process.exit(1);
      }

      // Generate output file path
      let outputPath = options.output;
      if (!outputPath) {
        const baseName = path.basename(input, path.extname(input));
        const dir = path.dirname(input);
        outputPath = path.join(dir, `${baseName}.js`);
      }

      // Validate output path
      const outputValidationErrors = SecurityValidator.validateFilePath(outputPath);
      if (outputValidationErrors.length > 0) {
        CompilerLogger.logValidationError('Invalid output file path', { 
          outputPath, 
          errors: outputValidationErrors 
        });
        console.error('Error: Invalid output file path');
        outputValidationErrors.forEach(error => console.error(`  - ${error.message}`));
        process.exit(1);
      }

      // Write output file
      await fs.writeFile(outputPath, result.code!);

      const duration = Date.now() - startTime;
      CompilerLogger.logPerformanceMetric('compilation', duration, { 
        input, 
        output: outputPath,
        codeLength: result.code!.length
      });

      console.log(`✅ Successfully compiled to ${outputPath}`);
      
      if (result.warnings.length > 0) {
        console.log('⚠️  Warnings:');
        result.warnings.forEach(warning => {
          console.log(`  - ${warning.message}`);
          if (warning.line) console.log(`    at line ${warning.line}`);
        });
      }

      CompilerLogger.logInfo('Compilation completed successfully', { 
        input, 
        output: outputPath, 
        duration 
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      CompilerLogger.logCompilerError('Unexpected compilation error', { 
        input, 
        error: error instanceof Error ? error.message : String(error),
        duration
      });
      console.error('❌ Unexpected error during compilation:', error);
      process.exit(1);
    }
    });

  program
    .command('validate')
    .description('Validate HTML file without compilation')
    .argument('<input>', 'Input HTML file path')
    .action(async (input: string) => {
    try {
      const validationErrors = SecurityValidator.validateFilePath(input);
      const extensionErrors = SecurityValidator.validateFileExtension(input, ['html', 'htm']);
      
      if (validationErrors.length > 0 || extensionErrors.length > 0) {
        console.error('❌ Validation failed:');
        [...validationErrors, ...extensionErrors].forEach(error => {
          console.error(`  - ${error.message}`);
        });
        process.exit(1);
      }

      const htmlContent = await fs.readFile(input, 'utf8');
      const contentErrors = SecurityValidator.validateContent(htmlContent);
      
      if (contentErrors.length > 0) {
        console.error('❌ Security validation failed:');
        contentErrors.forEach(error => {
          console.error(`  - ${error.message}`);
        });
        process.exit(1);
      }

      console.log('✅ File validation passed');
    } catch (error) {
      console.error('❌ Validation error:', error);
      process.exit(1);
    }
    });

  return program;
}

export const program = createProgram();

if (require.main === module) {
  if (process.argv.length < 3) {
    program.help();
  }
  program.parse();
}
