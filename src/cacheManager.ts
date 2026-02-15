/**
 * PARCA - CacheManager
 * Manages the central cache at ~/.parca-cache/ and handles SHA-256 integrity.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export class CacheManager {
    private cacheRoot: string;

    constructor(cacheRoot?: string) {
        this.cacheRoot = cacheRoot || path.join(os.homedir(), '.parca-cache');
    }

    /** Get the cache directory for a specific asset version. */
    getAssetDir(sourceAlias: string, assetId: string, version: string): string {
        return path.join(this.cacheRoot, sourceAlias, assetId, version);
    }

    /** Get the full path to a cached asset file/directory. */
    getAssetPath(sourceAlias: string, assetId: string, version: string, kind: 'prompt' | 'skill' | 'instruction'): string {
        const dir = this.getAssetDir(sourceAlias, assetId, version);
        if (kind === 'skill') {
            // For skills, the asset is the directory itself
            return dir;
        }
        // For others, it's a single file inside the version dir
        return path.join(dir, `${assetId}.md`);
    }

    /** Check if a cached file exists and matches the expected SHA. */
    isCached(sourceAlias: string, assetId: string, version: string, kind: 'prompt' | 'skill' | 'instruction', expectedSha256?: string): boolean {
        const assetPath = this.getAssetPath(sourceAlias, assetId, version, kind);
        if (!fs.existsSync(assetPath)) {
            return false;
        }

        // For skills, verify SKILL.md exists (case-insensitive)
        if (kind === 'skill') {
            const files = fs.readdirSync(assetPath);
            if (!files.some(f => f.toLowerCase() === 'skill.md')) {
                return false;
            }
        }

        if (expectedSha256) {
            const actualHash = this.computeHash(assetPath);
            return actualHash === expectedSha256;
        }
        return true;
    }

    /** Write a single file to the cache. */
    writeToCache(sourceAlias: string, assetId: string, version: string, content: string): { filePath: string; sha256: string } {
        const dir = this.getAssetDir(sourceAlias, assetId, version);
        fs.mkdirSync(dir, { recursive: true });

        const normalized = content.replace(/\r\n/g, '\n');
        const filePath = this.getAssetPath(sourceAlias, assetId, version, 'prompt'); // default kind
        fs.writeFileSync(filePath, normalized, 'utf-8');

        const sha256 = this.computeHashFromString(normalized);
        return { filePath, sha256 };
    }

    /** Write a directory of files to the cache. */
    writeDirectoryToCache(sourceAlias: string, assetId: string, version: string, files: Array<{ path: string, content: string }>): { dirPath: string; sha256: string } {
        const dir = this.getAssetDir(sourceAlias, assetId, version);
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });

        for (const file of files) {
            const filePath = path.join(dir, file.path);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            const normalized = file.content.replace(/\r\n/g, '\n');
            fs.writeFileSync(filePath, normalized, 'utf-8');
        }

        const sha256 = this.computeHash(dir);
        return { dirPath: dir, sha256 };
    }

    /** Read a cached file. */
    readFromCache(sourceAlias: string, assetId: string, version: string, kind: 'prompt' | 'skill' | 'instruction'): string | undefined {
        const assetPath = this.getAssetPath(sourceAlias, assetId, version, kind);
        if (!fs.existsSync(assetPath)) {
            return undefined;
        }
        if (kind === 'skill') {
            // For skills, we return the content of SKILL.md (case-insensitive)
            const files = fs.readdirSync(assetPath);
            const skillFile = files.find(f => f.toLowerCase() === 'skill.md');
            if (!skillFile) return undefined;
            return fs.readFileSync(path.join(assetPath, skillFile), 'utf-8');
        }
        return fs.readFileSync(assetPath, 'utf-8');
    }

    /** Compute SHA-256 of a file or directory on disk. */
    computeHash(targetPath: string): string {
        const stats = fs.statSync(targetPath);
        if (stats.isDirectory()) {
            return this.computeDirectoryHash(targetPath);
        }
        const content = fs.readFileSync(targetPath, 'utf-8');
        return this.computeHashFromString(content);
    }

    private computeDirectoryHash(dirPath: string): string {
        const hash = crypto.createHash('sha256');
        const files = this.getAllFiles(dirPath).sort(); // Sort for deterministic hash

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf-8').replace(/\r\n/g, '\n');
            const relPath = path.relative(dirPath, file).replace(/\\/g, '/');
            hash.update(relPath);
            hash.update(content);
        }

        return hash.digest('hex');
    }

    private getAllFiles(dirPath: string): string[] {
        let results: string[] = [];
        const list = fs.readdirSync(dirPath);
        for (const file of list) {
            const filePath = path.join(dirPath, file);
            const stat = fs.statSync(filePath);
            if (stat && stat.isDirectory()) {
                results = results.concat(this.getAllFiles(filePath));
            } else {
                results.push(filePath);
            }
        }
        return results;
    }

    /** Compute SHA-256 from a string (LF-normalized). */
    computeHashFromString(content: string): string {
        const normalized = content.replace(/\r\n/g, '\n');
        return crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex');
    }

    /** Clear the entire cache. */
    clearAll(): void {
        if (fs.existsSync(this.cacheRoot)) {
            fs.rmSync(this.cacheRoot, { recursive: true, force: true });
        }
    }
}
