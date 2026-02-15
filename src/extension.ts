/**
 * PARCA - VS Code Extension Entrypoint
 * Registers all commands and the sidebar tree view.
 */
import * as vscode from 'vscode';
import { AssetResolver } from './assetResolver';
import { InstalledAssetsProvider } from './installedAssetsProvider';
import { AssetKind } from './types';

let resolver: AssetResolver | undefined;
let treeProvider: InstalledAssetsProvider;

export function activate(context: vscode.ExtensionContext) {
    treeProvider = new InstalledAssetsProvider();
    vscode.window.registerTreeDataProvider('parca.installedAssets', treeProvider);

    // ---- List Remote ----
    context.subscriptions.push(
        vscode.commands.registerCommand('parca.listRemote', async () => {
            const url = await vscode.window.showInputBox({
                prompt: 'Enter the source repository URL',
                placeHolder: 'https://github.com/my-org/agent-assets',
            });
            if (!url) { return; }

            const kindChoice = await vscode.window.showQuickPick(
                ['all', 'prompt', 'skill', 'instruction'],
                { placeHolder: 'Filter by asset type' },
            );
            const kindFilter = kindChoice === 'all' ? undefined : kindChoice as AssetKind | undefined;

            try {
                const r = getResolver();
                const assets = await r.listRemote(url, kindFilter);

                if (assets.length === 0) {
                    vscode.window.showInformationMessage('No assets found in the remote repository.');
                    return;
                }

                const picked = await vscode.window.showQuickPick(
                    assets.map(a => ({
                        label: `$(package) ${a.id}`,
                        description: `[${a.kind}]`,
                        detail: a.description || undefined,
                        assetId: a.id,
                        versions: a.versions,
                    })),
                    { placeHolder: 'Select an asset', canPickMany: false },
                );

                if (picked) {
                    const version = await vscode.window.showQuickPick(
                        ['latest', ...picked.versions.reverse()],
                        { placeHolder: `Select version for ${picked.assetId}` }
                    );
                    if (version) {
                        await installAsset(url, picked.assetId, version);
                    }
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`PARCA: ${err.message}`);
            }
        }),
    );

    // ---- Install ----
    context.subscriptions.push(
        vscode.commands.registerCommand('parca.install', async () => {
            const url = await vscode.window.showInputBox({
                prompt: 'Enter the source repository URL',
                placeHolder: 'https://github.com/my-org/agent-assets',
            });
            if (!url) { return; }

            const assetId = await vscode.window.showInputBox({
                prompt: 'Enter the asset ID to install',
                placeHolder: 'refactor-logic',
            });
            if (!assetId) { return; }

            const versionRange = await vscode.window.showInputBox({
                prompt: 'Enter version or SemVer range',
                placeHolder: 'latest, 1.0.0, ^1.2.0',
                value: 'latest'
            });
            if (!versionRange) { return; }

            await installAsset(url, assetId, versionRange);
        }),
    );

    // ---- List Installed ----
    context.subscriptions.push(
        vscode.commands.registerCommand('parca.list', async () => {
            const r = getResolver();
            const assets = r.listInstalled();

            if (assets.length === 0) {
                vscode.window.showInformationMessage('No PARCA assets installed in this workspace.');
                return;
            }

            const items = assets.map(a => ({
                label: `$(package) ${a.id}`,
                description: `v${a.version} (${a.source})`,
                detail: a.mapping ? `→ ${a.mapping}` : undefined,
            }));

            vscode.window.showQuickPick(items, { placeHolder: 'Installed PARCA assets' });
        }),
    );

    // ---- Resolve ----
    context.subscriptions.push(
        vscode.commands.registerCommand('parca.resolve', async () => {
            const r = getResolver();

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'PARCA: Resolving assets...' },
                async (progress) => {
                    try {
                        const results = await r.resolveAll({
                            onAssetStart: (id, version) => {
                                progress.report({ message: `${id}@${version}` });
                            },
                            onAssetError: (id, error) => {
                                vscode.window.showWarningMessage(`PARCA: Failed to resolve ${id}: ${error}`);
                            },
                        });

                        treeProvider.refresh();
                        vscode.window.showInformationMessage(`PARCA: Resolved ${results.length} asset(s).`);
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`PARCA: ${err.message}`);
                    }
                },
            );
        }),
    );

    // ---- Publish (Maintainer) ----
    context.subscriptions.push(
        vscode.commands.registerCommand('parca.publish', async () => {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('No workspace folder open.');
                return;
            }

            const { Publisher } = require('./publisher');
            const publisher = new Publisher(workspaceRoot);

            if (!publisher.isSourceRepo()) {
                const initChoice = await vscode.window.showWarningMessage(
                    'This workspace is not a PARCA Source Repository. Initialize one?',
                    'Yes', 'No'
                );
                if (initChoice === 'Yes') {
                    publisher.initManifest();
                    vscode.window.showInformationMessage('Initialized parca-manifest.yaml.');
                } else {
                    return;
                }
            }

            const manifest = publisher.loadManifest();
            const assetIds = Object.keys(manifest.assets);

            let assetId: string | undefined;
            let kind: AssetKind = 'prompt';

            if (assetIds.length > 0) {
                const choice = await vscode.window.showQuickPick(
                    ['[ New Asset ]', ...assetIds],
                    { placeHolder: 'Select an asset to publish' }
                );
                if (!choice) { return; }
                if (choice === '[ New Asset ]') {
                    assetId = await vscode.window.showInputBox({ prompt: 'Enter new asset ID' });
                    const k = await vscode.window.showQuickPick(['prompt', 'skill', 'instruction'], { placeHolder: 'Select asset kind' });
                    kind = (k || 'prompt') as AssetKind;
                } else {
                    assetId = choice;
                    kind = manifest.assets[assetId].kind;
                }
            } else {
                assetId = await vscode.window.showInputBox({ prompt: 'Enter new asset ID' });
                const k = await vscode.window.showQuickPick(['prompt', 'skill', 'instruction'], { placeHolder: 'Select asset kind' });
                kind = (k || 'prompt') as AssetKind;
            }

            if (!assetId) { return; }

            const nextPatch = publisher.proposeNextVersion(manifest, assetId, 'patch');
            const nextMinor = publisher.proposeNextVersion(manifest, assetId, 'minor');
            const nextMajor = publisher.proposeNextVersion(manifest, assetId, 'major');

            const versionChoice = await vscode.window.showQuickPick(
                [
                    { label: nextPatch, description: 'patch' },
                    { label: nextMinor, description: 'minor' },
                    { label: nextMajor, description: 'major' },
                    { label: 'custom', description: 'Enter a custom version' }
                ],
                { placeHolder: `Select new version for ${assetId}` }
            );

            let version: string | undefined;
            if (!versionChoice) { return; }
            if (versionChoice.label === 'custom') {
                version = await vscode.window.showInputBox({ prompt: 'Enter version string', value: nextPatch });
            } else {
                version = versionChoice.label;
            }

            if (!version) { return; }

            // Ask for file path relative to workspace
            const filePath = await vscode.window.showInputBox({
                prompt: `Enter path to the asset file for ${assetId}@${version}`,
                placeHolder: 'prompts/my-prompt.md',
                value: manifest.assets[assetId]?.versions[Object.keys(manifest.assets[assetId].versions)[0]]?.path || ''
            });

            if (!filePath) { return; }

            try {
                await publisher.publishVersion(manifest, assetId, version, filePath, kind);
                vscode.window.showInformationMessage(`Successfully published ${assetId}@${version} to manifest.`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`PARCA: ${err.message}`);
            }
        }),
    );

    // ---- Refresh Tree ----
    context.subscriptions.push(
        vscode.commands.registerCommand('parca.refresh', () => {
            treeProvider.refresh();
        }),
    );

    // Auto-resolve on activation if config exists
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
        const configPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.parca-assets.yaml');
        vscode.workspace.fs.stat(configPath).then(
            () => {
                // Config exists — auto-resolve silently
                vscode.commands.executeCommand('parca.resolve');
            },
            () => { /* No config — do nothing */ },
        );
    }
}

export function deactivate() { }

// ---- Helpers ----

function getResolver(): AssetResolver {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        throw new Error('No workspace folder open.');
    }
    if (!resolver) {
        resolver = new AssetResolver(workspaceRoot);
    }
    return resolver;
}

async function installAsset(url: string, assetId: string, versionRange: string = 'latest'): Promise<void> {
    const r = getResolver();

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `PARCA: Installing ${assetId}@${versionRange}...` },
        async () => {
            try {
                const result = await r.install(url, assetId, versionRange);

                // Check if it returned existing installation info
                if ('existing' in result) {
                    const choice = await vscode.window.showWarningMessage(
                        `Asset "${assetId}" is already installed at version ${result.existing.version}. Replace with version ${result.selectedVersion}?`,
                        'Replace',
                        'Cancel'
                    );

                    if (choice === 'Replace') {
                        // Reinstall with force flag
                        const resolved = await r.install(url, assetId, versionRange, true);
                        if ('id' in resolved) {
                            treeProvider.refresh();
                            vscode.window.showInformationMessage(
                                `PARCA: Installed ${resolved.id}@${resolved.version} → ${resolved.mapping || resolved.cachePath}`,
                            );
                        }
                    }
                } else {
                    // New installation succeeded
                    treeProvider.refresh();
                    vscode.window.showInformationMessage(
                        `PARCA: Installed ${result.id}@${result.version} → ${result.mapping || result.cachePath}`,
                    );
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`PARCA: ${err.message}`);
            }
        },
    );
}
