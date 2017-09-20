import "mocha";

import * as assert from "power-assert";
import { JavaPackageDeclaration } from "../../../src/operations/generate/java/JavaGrammars";
import { JavaFiles } from "../../../src/operations/generate/java/javaProjectUtils";
import { InMemoryFile } from "../../../src/project/mem/InMemoryFile";
import { InMemoryProject } from "../../../src/project/mem/InMemoryProject";
import { findFileMatches, Match } from "../../../src/project/util/parseUtils";

describe("parseUtils", () => {

    it("gathers matches from files", done => {
        const t = new InMemoryProject("name");
        t.addFileSync("src/main/java/com/foo/bar/Thing.java",
            "package com.foo.bar;\npublic class Thing {}");
        t.addFileSync("src/main/java/com/foo/baz/Thing2.java",
            "package com.foo.baz;\npublic class Thing2 {}");
        findFileMatches<{ name: string }>(t, JavaFiles, JavaPackageDeclaration)
            .then(matches => {
                assert(matches.length === 2);
                assert.deepEqual(matches.map(m => m.file.path), t.filesSync.map(m => m.path));
                matches[0].matches.forEach(m => {
                    assert(m.$offset !== undefined);
                });
                done();
            }).catch(done);
    });

    it("updates matches from files", done => {
        const oldPackage = "com.foo.bar";
        const t = new InMemoryProject("name");
        const initialContent = `package ${oldPackage};\npublic class Thing {}`;
        const f = new InMemoryFile("src/main/java/com/foo/bar/Thing.java", initialContent);
        t.addFileSync(f.path, f.getContentSync());
        findFileMatches<{ name: string }>(t, JavaFiles, JavaPackageDeclaration)
            .then(matches => {
                assert(matches.length === 1);
                assert(matches[0].file.path === f.path);
                assert(matches[0].matches[0].name === oldPackage);
                matches[0].makeUpdatable();
                const m: Match<{ name: string }> = matches[0].matches[0];

                assert(m.name === oldPackage, `Expected [${oldPackage}] got [${m.name}]`);
                // Add x to package names. Yes, this makes no sense in Java
                // but it's not meant to be domain meaningful
                m.name = m.name + "x";
                assert(m.name);

                assert(m.name === oldPackage + "x");

                // Check file persistence
                assert(matches[0].file.getContentSync() === initialContent);
                return t
                    .flush()
                    .then(_ => {
                        const updatedFile = t.findFileSync(f.path);
                        assert(updatedFile.getContentSync() === initialContent.replace(oldPackage, oldPackage + "x"),
                            `Content is [${updatedFile.getContentSync()}]`);
                        done();
                    });
            }).catch(done);
    });

});