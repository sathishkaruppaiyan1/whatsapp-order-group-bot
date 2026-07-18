/**
 * Filesystem helpers for temp image handling (downloads/ and generated/).
 */
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { moduleLogger } from './logger';

const log = moduleLogger('FileUtils');

/** Creates logs/, downloads/ and generated/ if they do not exist. */
export function ensureRuntimeDirectories(): void {
  for (const dir of [config.paths.logs, config.paths.downloads, config.paths.generated]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      log.info(`Created directory: ${dir}`);
    }
  }
}

/** Deletes the given files, ignoring any that are missing. Never throws. */
export function deleteFiles(filePaths: Array<string | null | undefined>): void {
  for (const filePath of filePaths) {
    if (!filePath) continue;
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        log.info(`Deleted temp file: ${path.basename(filePath)}`);
      }
    } catch (error) {
      log.warn(`Could not delete temp file ${filePath}: ${(error as Error).message}`);
    }
  }
}

/** Builds a safe, unique temp filename inside the given directory. */
export function tempFilePath(dir: string, prefix: string, extension: string): string {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(dir, `${safePrefix}-${unique}.${extension}`);
}
