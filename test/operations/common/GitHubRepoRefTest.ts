
import "mocha";

import * as assert from "power-assert";

import { GitHubDotComBase, GitHubRepoRef } from "../../../src/operations/common/GitHubRepoRef";

describe("GitHubRepoRef", () => {

    it("defaults apiBase correctly", () => {
        const gh = new GitHubRepoRef("owner", "repo");
        assert(gh.apiBase === GitHubDotComBase);
    });

    it("takes new apiBase correctly", () => {
        const apiBase = "https//somewhere.com";
        const gh = new GitHubRepoRef("owner", "repo", undefined, apiBase);
        assert(gh.apiBase === apiBase);
    });

    it("strips new apiBase trailing / correctly", () => {
        const apiBase = "https//somewhere.com";
        const gh = new GitHubRepoRef("owner", "repo", undefined, apiBase + "/");
        assert(gh.apiBase === apiBase);
    });

});
