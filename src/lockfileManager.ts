/**
 * PARCA - LockfileManager
 * Reads and writes .parca-assets.lock for deterministic resolution.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ParcaLockfile, ParcaLockedAsset } from './types';

const LOCKFILE_FILENAME = '.parca-assets.lock';

export class LockfileManager {
    private lockfilePath: string;

    constructor(private workspaceRoot: string) {
        this.lockfilePath = path.join(workspaceRoot, LOCKFILE_FILENAME);
    }

    /** Check if a lockfile exists. */
    exists(): boolean {
        return fs.existsSync(this.lockfilePath);
    }

    /** Load and parse the lockfile. */
    load(): ParcaLockfile {
        if (!this.exists()) {
            return { assets: [] };
        }
        const raw = fs.readFileSync(this.lockfilePath, 'utf-8');
        return JSON.parse(raw) as ParcaLockfile;
    }

    /** Save the lockfile to disk. */
    save(lockfile: ParcaLockfile): void {
        const content = JSON.stringify(lockfile, null, 2);
        fs.writeFileSync(this.lockfilePath, content, 'utf-8');
    }

    /** Find a locked asset by id and source. */
    findAsset(lockfile: ParcaLockfile, id: string, source: string): ParcaLockedAsset | undefined {
        return lockfile.assets.find(a => a.id === id && a.source === source);
    }

    /** Update or add a locked asset entry. */
    upsertAsset(lockfile: ParcaLockfile, entry: ParcaLockedAsset): ParcaLockfile {
        lockfile.assets = lockfile.assets.filter(a => !(a.id === entry.id && a.source === entry.source));
        lockfile.assets.push(entry);
        return lockfile;
    }

    /** Remove a locked asset entry. */
    removeAsset(lockfile: ParcaLockfile, id: string, source: string): ParcaLockfile {
        lockfile.assets = lockfile.assets.filter(a => !(a.id === id && a.source === source));
        return lockfile;
    }
}
