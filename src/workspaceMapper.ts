/**
 * PARCA - WorkspaceMapper
 * Creates symlinks from cache to workspace and manages .gitignore entries.
 */
import * as fs from 'fs';
import * as path from 'path';

export class WorkspaceMapper {
    constructor(private workspaceRoot: string) { }

    /**
     * Create a symlink from the cached file/dir to the workspace mapping location.
     */
    createSymlink(cachedPath: string, mapping: string, assetId: string, kind: 'prompt' | 'skill' | 'instruction'): string {
        let targetPath: string;
        if (mapping.endsWith('/') || mapping.endsWith('\\')) {
            if (kind === 'skill') {
                targetPath = path.join(this.workspaceRoot, mapping, assetId);
            } else {
                targetPath = path.join(this.workspaceRoot, mapping, `${assetId}.md`);
            }
        } else {
            targetPath = path.join(this.workspaceRoot, mapping);
        }

        // Ensure parent directory exists
        const parentDir = path.dirname(targetPath);
        fs.mkdirSync(parentDir, { recursive: true });

        // Remove existing file/symlink at target
        if (fs.existsSync(targetPath)) {
            const stats = fs.lstatSync(targetPath);
            if (stats.isDirectory() && !stats.isSymbolicLink()) {
                fs.rmSync(targetPath, { recursive: true, force: true });
            } else {
                fs.unlinkSync(targetPath);
            }
        }

        // Create symlink
        // On Windows, 'file' or 'dir' type is needed
        const type = kind === 'skill' ? 'dir' : 'file';
        fs.symlinkSync(cachedPath, targetPath, type);

        // Add to .gitignore
        this.ensureGitignored(targetPath);

        return targetPath;
    }

    /**
     * Remove a symlink and its .gitignore entry.
     */
    removeSymlink(mapping: string, assetId: string): void {
        let targetPath: string;
        if (mapping.endsWith('/') || mapping.endsWith('\\')) {
            targetPath = path.join(this.workspaceRoot, mapping, `${assetId}.md`);
        } else {
            targetPath = path.join(this.workspaceRoot, mapping);
        }

        if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
        }
    }

    /**
     * Ensure a file path is listed in the workspace .gitignore.
     * Adds a comment marker so PARCA-managed entries are identifiable.
     */
    private ensureGitignored(absolutePath: string): void {
        const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
        const relativePath = path.relative(this.workspaceRoot, absolutePath).replace(/\\/g, '/');

        let content = '';
        if (fs.existsSync(gitignorePath)) {
            content = fs.readFileSync(gitignorePath, 'utf-8');
        }

        // Check if already present
        if (content.includes(relativePath)) {
            return;
        }

        // Append under a PARCA section
        const marker = '# PARCA managed assets';
        if (!content.includes(marker)) {
            content += `\n${marker}\n`;
        }

        // Insert the entry right after the marker
        const markerIdx = content.indexOf(marker);
        const insertPos = markerIdx + marker.length;
        const before = content.substring(0, insertPos);
        const after = content.substring(insertPos);
        content = before + `\n${relativePath}` + after;

        fs.writeFileSync(gitignorePath, content, 'utf-8');
    }
}
