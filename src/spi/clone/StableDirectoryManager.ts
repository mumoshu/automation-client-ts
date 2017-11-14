import { registerShutdownHook } from "../../internal/util/shutdown";

import { logger } from "../../internal/util/logger";

import * as fs from "fs-extra";
import { CloneDirectoryInfo, CloneOptions, DirectoryManager } from "./DirectoryManager";

export interface StableDirectoryManagerOpts {

    /**
     * Attempt to reuse directories?
     */
    reuseDirectories: boolean;

    /**
     * Clean up directories on exit?
     */
    cleanOnExit?: boolean;

    /**
     * If provided, number of directories
     */
    baseDir: string;
}

const DefaultOpts = {
    reuseDirectories: false,
    cleanOnExit: true,
};

/**
 * Build a stable working directory structure.
 * Options determine whether it's cleared on exit.
 */
export class StableDirectoryManager implements DirectoryManager {

    public opts: StableDirectoryManagerOpts;

    private directoriesUsed = 0;

    constructor(pOpts: StableDirectoryManagerOpts) {
        this.opts = {
            ...DefaultOpts,
            ...pOpts,
        };

        if (this.opts.cleanOnExit === true) {
            registerShutdownHook(() => {
                logger.verbose("Cleaning up temporary directories under '%s'", this.opts.baseDir);
                return fs.remove(this.opts.baseDir).then(() => 0);
            });
        }
    }

    public directoryFor(owner: string, repo: string, branch: string, opts: CloneOptions): Promise<CloneDirectoryInfo> {
        if (this.opts.reuseDirectories) {
            // Attempt to reuse the directory
            return this.existingDirectoryFor(owner, repo, branch, opts)
                .then(existing =>
                    !!existing ? existing : this.freshDirectoryFor(owner, repo, branch, opts));
        } else {
            return this.freshDirectoryFor(owner, repo, branch, opts);
        }
    }

    /**
     * Return undefined if not found
     */
    private existingDirectoryFor(owner: string, repo: string, branch: string,
                                 opts: CloneOptions): Promise<CloneDirectoryInfo> {
        const expectedPath = this.pathFor(owner, repo);
        return fs.pathExists(expectedPath)
            .then(exists => {
                if (exists) {
                    logger.debug("%s directories used: Reusing path '%s'",
                        this.directoriesUsed, expectedPath);
                    return {
                        path: expectedPath,
                        type: "actual-directory" as any,
                    };
                } else {
                    // It doesn't exist
                    return undefined;
                }
            });
    }

    private freshDirectoryFor(user: string, repo: string, branch: string,
                              opts: CloneOptions): Promise<CloneDirectoryInfo> {
        return this.createFreshDir(user, repo)
            .then(path => {
                this.directoriesUsed++;
                logger.debug("%s directories used: Returning new path '%s'",
                    this.directoriesUsed, path);
                return {
                    path,
                    type: "parent-directory" as any,
                };
            });
    }

    private pathFor(user: string, repo: string): string {
        return `${this.opts.baseDir}/${user}/${repo}`;
    }

    private createFreshDir(user: string, repo: string): Promise<string> {
        // assume the baseDir exists
        const userDir = `${this.opts.baseDir}/${user}`;
        const repoDir = userDir + "/" + repo;
        return assureDirectoryExists(this.opts.baseDir)
            .then(() => assureDirectoryExists(userDir))
            .then(() => fs.remove(repoDir))
            .then(() => userDir);
    }
}

function assureDirectoryExists(name: string): Promise<void> {
    return fs.stat(name).then(stats => {
        if (!stats.isDirectory()) {
            throw new Error(name + "exists but is not a directory.");
        }
    }, err => {
        console.log(`Hope this means 'directory does not exist': ${err}`);
        return fs.mkdir(name);
    });
}
