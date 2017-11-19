import { exec } from "child-process-promise";

import axios from "axios";
import * as os from "os";
import { isLocalProject } from "../local/LocalProject";
import { Project } from "../Project";

import { ActionResult } from "../../action/ActionResult";
import { CommandResult, runCommand } from "../../action/cli/commandLine";
import { logger } from "../../internal/util/logger";
import { hideString } from "../../internal/util/string";
import { GitHubRepoRef, isGitHubRepoRef } from "../../operations/common/GitHubRepoRef";
import { ProjectOperationCredentials } from "../../operations/common/ProjectOperationCredentials";
import { RemoteRepoRef, RepoRef } from "../../operations/common/RepoId";
import { CloneOptions, DefaultCloneOptions, DirectoryManager } from "../../spi/clone/DirectoryManager";
import { StableDirectoryManager } from "../../spi/clone/StableDirectoryManager";
import { NodeFsLocalProject } from "../local/NodeFsLocalProject";
import { GitProject } from "./GitProject";

/**
 * Default Atomist working directory
 * @type {string}
 */
const AtomistWorkingDirectory = ".atomist-working";

export const DefaultDirectoryManager = new StableDirectoryManager({
    baseDir: os.homedir() + "/" + AtomistWorkingDirectory,
    cleanOnExit: false,
    reuseDirectories: false,
});

/**
 * Implements GitProject interface using the Git binary from the command line.
 * Works only if git is installed.
 */
export class GitCommandGitProject extends NodeFsLocalProject implements GitProject {

    public static fromProject(p: Project, credentials: ProjectOperationCredentials): GitProject {
        if (isLocalProject(p)) {
            return GitCommandGitProject.fromBaseDir(p.id, p.baseDir, credentials);
        }
        throw new Error(`Project ${p.name} doesn't have a local directory`);
    }

    /**
     * Create a project from an existing git directory
     * @param {RepoRef} id
     * @param {string} baseDir
     * @param {ProjectOperationCredentials} credentials
     * @return {GitCommandGitProject}
     */
    public static fromBaseDir(id: RepoRef, baseDir: string,
                              credentials: ProjectOperationCredentials): GitCommandGitProject {
        return new GitCommandGitProject(id, baseDir, credentials);
    }

    /**
     * Create a new GitCommandGitProject by cloning the given remote project
     * @param {ProjectOperationCredentials} credentials
     * @param {RemoteRepoRef} id
     * @param {CloneOptions} opts
     * @param {DirectoryManager} directoryManager
     * @return {Promise<GitCommandGitProject>}
     */
    public static cloned(credentials: ProjectOperationCredentials,
                         id: RemoteRepoRef,
                         opts: CloneOptions = DefaultCloneOptions,
                         directoryManager: DirectoryManager = DefaultDirectoryManager): Promise<GitCommandGitProject> {
        return clone(credentials, id, opts, directoryManager)
            .then(p => {
                const pathIntoRepo = !!id.path ?
                    id.path.startsWith("/") ? id.path : "/" + id.path :
                    "";
                const gp = GitCommandGitProject.fromBaseDir(id, p.baseDir + pathIntoRepo, credentials);
                return gp;
            });
    }

    public branch: string;

    public remote: string;

    public newRepo: boolean = false;

    private constructor(id: RepoRef, public baseDir: string, private credentials: ProjectOperationCredentials) {
        super(id, baseDir);
        logger.debug(`Created GitProject with token '${hideString(this.credentials.token)}'`);
    }

    public init(): Promise<CommandResult<this>> {
        this.newRepo = true;
        this.branch = "master";
        return this.runCommandInCurrentWorkingDirectory("git init");
    }

    public isClean(): Promise<CommandResult<this>> {
        return this.runCommandInCurrentWorkingDirectory("git status --porcelain")
            .then(commandResult => {
                return {
                    ...commandResult,
                    success: commandResult.stdout !== undefined && commandResult.stdout === "",
                };
            });
    }

    /**
     * Remote is of form https://github.com/USERNAME/REPOSITORY.git
     * @param remote
     */
    public setRemote(remote: string): Promise<CommandResult<this>> {
        this.remote = remote;
        return this.runCommandInCurrentWorkingDirectory(`git remote add origin ${remote}`);
    }

    public setGitHubRemote(owner: string, repo: string): Promise<CommandResult<this>> {
        this.id = new GitHubRepoRef(owner, repo);
        return this.setRemote(`https://${this.credentials.token}@github.com/${owner}/${repo}.git`);
    }

    public setUserConfig(user: string, email: string): Promise<CommandResult<this>> {
        return this.runCommandInCurrentWorkingDirectory(`git config user.name "${user}"`)
            .then(() => this.runCommandInCurrentWorkingDirectory(`git config user.email "${email}"`));
    }

    public setGitHubUserConfig(): Promise<CommandResult<this>> {
        const config = {
            headers: {
                Authorization: `token ${this.credentials.token}`,
            },
        };

        return isGitHubRepoRef(this.id) ?
            Promise.all([axios.get(`${this.id.apiBase}/user`, config),
                axios.get(`${this.id.apiBase}/user/emails`, config)])
                .then(results => {
                    const name = results[0].data.name;
                    let email = results[0].data.email;

                    if (!email) {
                        email = results[1].data.find(e => e.primary === true).email;
                    }

                    if (name && email) {
                        return this.setUserConfig(name, email);
                    } else {
                        return this.setUserConfig("Atomist Bot", "bot@atomist.com");
                    }
                })
                .catch(() => this.setUserConfig("Atomist Bot", "bot@atomist.com")) :
            Promise.reject("Not a GitHub repo id: " + JSON.stringify(this.id));

    }

    public createAndSetGitHubRemote(owner: string, name: string, description: string = name,
                                    visibility: "private" | "public"): Promise<CommandResult<this>> {
        const config = {
            headers: {
                Authorization: `token ${this.credentials.token}`,
            },
        };
        const gid = new GitHubRepoRef(owner, name, "master");
        this.id = gid;

        return axios.get(`${gid.apiBase}/orgs/${owner}`, config)
            .then(result => {
                // We now know the owner is an org
                const url = `${gid.apiBase}/orgs/${owner}/repos`;
                return this.createRepo(owner, url, name, description, visibility);
            })
            .catch(error => {
                // We now know the owner is an user
                const url = `${gid.apiBase}/user/repos`;
                return this.createRepo(owner, url, name, description, visibility);
            });
    }

    /**
     * Raise a PR after a push to this branch
     * @param title
     * @param body
     */
    public raisePullRequest(title: string, body: string = name): Promise<ActionResult<this>> {
        if (!(this.branch)) {
            throw new Error("Cannot create a PR: no branch has been created");
        }
        const config = {
            headers: {
                Authorization: `token ${this.credentials.token}`,
            },
        };
        if (isGitHubRepoRef(this.id)) {
            const url = `${this.id.apiBase}/repos/${this.id.owner}/${this.id.repo}/pulls`;
            logger.debug(`Making request to '${url}' to raise PR`);
            return axios.post(url, {
                title,
                body,
                head: this.branch,
                base: "master",
            }, config)
                .then(axiosResponse => {
                    return {
                        target: this,
                        success: true,
                        axiosResponse,
                    };
                })
                .catch(err => {
                    logger.error("Error attempting to raise PR: " + err);
                    return Promise.reject(err);
                });
        } else {
            return Promise.reject("Not a GitHub remote: " + JSON.stringify(this.id));
        }
    }

    public commit(message: string): Promise<CommandResult<this>> {
        return this.runCommandInCurrentWorkingDirectory(`git add .`)
            .then(() =>
            this.runCommandInCurrentWorkingDirectory(`git commit -a -m "${message}"`));
    }

    /**
     * Check out a particular commit. We'll end in detached head state
     * @param sha
     * @return {any}
     */
    public checkout(sha: string): Promise<CommandResult<this>> {
        return this.runCommandInCurrentWorkingDirectory(`git checkout ${sha}`);
    }

    public push(): Promise<CommandResult<this>> {
        if (!!this.branch && !!this.remote) {
            // We need to set the remote
            return this.runCommandInCurrentWorkingDirectory(`git push ${this.remote} ${this.branch}`)
                .catch(err => {
                    logger.error("Unable to push with existing remote: %s", err);
                    return Promise.reject(err);
                });
        }
        return this.runCommandInCurrentWorkingDirectory(`git push --set-upstream origin ${this.branch}`)
            .catch(err => {
                logger.error("Unable to push with set upstream origin: %s", err);
                return Promise.reject(err);
            });
    }

    public createBranch(name: string): Promise<CommandResult<this>> {
        this.branch = name;
        return this.runCommandInCurrentWorkingDirectory(`git branch ${name}`).then(() =>
            this.runCommandInCurrentWorkingDirectory(`git checkout ${name}`));
    }

    private runCommandInCurrentWorkingDirectory(cmd: string): Promise<CommandResult<this>> {
        return runCommand(cmd, { cwd: this.baseDir })
            .then(result => {
                return {
                    target: this,
                    ...result,
                };
            });
    }

    private createRepo(owner: string, url: string, name: string, description: string = name,
                       visibility: "private" | "public"): Promise<any> {
        const config = {
            headers: {
                Authorization: `token ${this.credentials.token}`,
            },
        };

        const payload = {
            name,
            description,
            private: visibility === "private" ? true : false,
        };
        logger.debug(`Request to '${url}' with '${JSON.stringify(payload)}' ` +
            `and auth token '${hideString(this.credentials.token)}'`);
        return axios.post(url, payload, config)
            .then(res => {
                logger.debug(`Repo created ok: ${res.statusText}`);
                return this.setRemote(`https://${this.credentials.token}@github.com/${owner}/${name}.git`);
            });
    }
}

/**
 * Clone the given repo from GitHub
 * @param credentials git provider credentials
 * @param id remote repo ref
 * @param opts options for clone
 * @param directoryManager strategy for cloning
 */
function clone(credentials: ProjectOperationCredentials,
               id: RemoteRepoRef,
               opts: CloneOptions,
               directoryManager: DirectoryManager): Promise<GitProject> {
    return directoryManager.directoryFor(id.owner, id.repo, id.sha, opts)
        .then(cloneDirectoryInfo => {
                switch (cloneDirectoryInfo.type) {
                    case "parent-directory" :
                        const repoDir = `${cloneDirectoryInfo.path}/${id.repo}`;
                        const command = (id.sha === "master") ?
                            `git clone --depth 1 ${id.cloneUrl(credentials)}` :
                            `git clone ${id.cloneUrl(credentials)}; cd ${id.repo};git checkout ${id.sha}`;

                        logger.info(`Cloning repo '${id.url}' to '${cloneDirectoryInfo.path}'`);
                        return exec(command, { cwd: cloneDirectoryInfo.path })
                            .then(_ => {
                                logger.debug(`Clone succeeded with URL '${id.url}'`);
                                // fs.chmodSync(repoDir, "0777");
                                return NodeFsLocalProject.fromExistingDirectory(id, repoDir);
                            });
                    case "actual-directory" :
                        throw new Error("actual-directory clone directory type not yet supported");
                }
            },
        );
}
