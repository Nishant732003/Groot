#!/usr/bin/env node

import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import chalk from "chalk";
import { diffLines } from "diff";


// Now you can access diffLines using the imported module


import { Command } from "commander";

const program = new Command();
class Groot {
  constructor(repoPath = ".") {
    //repo ->repository
    // when we do git init this repo path will be path  where our own .git folder will be saved
    this.repoPath = path.join(repoPath, ".groot");
    this.objectsPath = path.join(this.repoPath, "objects"); // groot/objects
    this.headPath = path.join(this.repoPath, "HEAD"); //.groot/HEAD
    this.indexPath = path.join(this.repoPath, "index"); // .groot /index//like staging area
    this.initPromise = this.init();
  }
  //add a init method
  async init() {
    await fs.mkdir(this.objectsPath, { recursive: true });
    try {
      await fs.writeFile(this.headPath, "", { flag: "wx" }); //' ' content of the file
      //flag {wx}
      //w means write
      // x is exclusive
      //together they means write only if file already exist throw an error
      await fs.writeFile(this.indexPath, JSON.stringify([]), { flag: "wx" });
      //json.stringfy empty array as nothing is in staging area
      console.log(".groot directory initialized successfully.");
    } catch (error) {
      if (error.code === "EEXIST") {
        console.log(".groot directory already initialized.");
      } else {
        console.error("Error initializing .groot directory:", error);
      }
    }
  }

  hashObject(content) {
    return crypto.createHash("sha1").update(content, "utf-8").digest("hex");
  }

 

  async add(fileToBeadded) {
    await this.initPromise;
    const ignorePatterns = await this.readIgnoreFile();
    if (this.isIgnored(fileToBeadded, ignorePatterns)) {
      console.log(`File ${fileToBeadded} is ignored.`);
      return;
    }
    // Read file data
    const fileData = await fs.readFile(fileToBeadded, { encoding: "utf-8" });

    // Calculate file hash
    const filehash = this.hashObject(fileData);

    // Determine object directory and file path
    const objectDir = path.join(this.objectsPath, filehash.slice(0, 2));
    const objectFile = filehash.slice(2);
    const newFilehashedObjectPath = path.join(objectDir, objectFile);

    try {
      // Create the object directory if it doesn't exist
      await fs.mkdir(objectDir, { recursive: true });

      // Write file data to object path
      await fs.writeFile(newFilehashedObjectPath, fileData);

      // Update staging area
      await this.updateStagingArea(fileToBeadded, filehash);

      console.log(`Added ${fileToBeadded}`);
    } catch (error) {
      console.error(`Error adding ${fileToBeadded}: ${error.message}`);
    }
  }
  async updateStagingArea(filePath, filehash) {
    const index = JSON.parse(
      await fs.readFile(this.indexPath, { encoding: "utf-8" })
    );
    index.push({ path: filePath, hash: filehash });
    await fs.writeFile(this.indexPath, JSON.stringify(index));
  }

  async commit(message) {
    await this.initPromise;

    const index = JSON.parse(
      await fs.readFile(this.indexPath, { encoding: "utf-8" })
    );

    const parentCommit = await this.getCurrentHead();
    const commitData = {
      timestamp: new Date().toISOString(),
      message,
      files: index,
      parent: parentCommit,
    };

    // Calculate commit hash
    const commitHash = this.hashObject(JSON.stringify(commitData));

    // Determine commit directory and file path
    const commitDir = path.join(
      this.objectsPath,
      "commits",
      commitHash.slice(0, 2)
    );
    const commitFile = commitHash.slice(2);
    const commitPath = path.join(commitDir, commitFile);

    try {
      // Create the commit directory if it doesn't exist
      await fs.mkdir(commitDir, { recursive: true });

      // Write commit data to commit path
      await fs.writeFile(commitPath, JSON.stringify(commitData));

      // Update HEAD to point to the new commit
      await fs.writeFile(this.headPath, commitHash);

      // Clear the staging area
      await fs.writeFile(this.indexPath, JSON.stringify([]));

      console.log(`Commit successfully created: ${commitHash}`);
    } catch (error) {
      console.error(`Error committing changes: ${error.message}`);
    }
  }

  async getCurrentHead() {
    try {
      const head = await fs.readFile(this.headPath, { encoding: "utf-8" });
      return head.trim();
    } catch (error) {
      return null;
    }
  }
  async log() {
    await this.initPromise;
    let currentCommitHash = await this.getCurrentHead();
    while (currentCommitHash) {
      try {
        const commitData = JSON.parse(
          await fs.readFile(
            path.join(
              this.objectsPath,
              "commits",
              currentCommitHash.slice(0, 2),
              currentCommitHash.slice(2)
            ),
            {
              encoding: "utf-8",
            }
          )
        );
        console.log(
          `commit ${currentCommitHash}\nDate: ${commitData.timestamp}\n${commitData.message}\n`
        );
        currentCommitHash = commitData.parent;
      } catch (error) {
        console.error(
          `Error reading commit ${currentCommitHash}: ${error.message}`
        );
        break;
      }
    }
  }

  async showCommitDiff(commitHash) {
    await this.initPromise;
    const commitData = JSON.parse(await this.getCommitData(commitHash));
    if (!commitData) {
      console.log("commit not found");
      return;
    }
    console.log("changes in the last commit are:");
    //multiple files could have changed
    for (const file of commitData.files) {
      console.log(`file: ${file.path}`);

      const fileContent = await this.getFileContent(file.hash);

      console.log(fileContent);

      if (commitData.parent) {
        //get the parent commit data
        const parentcommitData = JSON.parse(
          await this.getCommitData(commitData.parent)
        );
        const getParentFileContent = await this.getParentFileContent(
          parentcommitData,
          file.path
        );
        if (getParentFileContent != undefined) {
          console.log("\nDiff:");
          const diff = diffLines(getParentFileContent, fileContent);
          // console.log(diff);
          diff.forEach((part) => {
            if (part.added) {
              process.stdout.write(chalk.green("++" + part.value));
            } else if (part.removed) {
              process.stdout.write(chalk.red("--" + part.value));
            } else {
              process.stdout.write(chalk.grey(part.value));
            }
          });
          console.log(); //for new lines
        } else {
          console.log("New File in this commit");
        }
      } else {
        console.log("first commit");
      }
    }
  }

  async getParentFileContent(parentcommitData, filePath) {
    //got to all my files of parent commit data and find if the file in parent commit then read the content of file
    const parentFile = parentcommitData.files.find(
      (file) => file.path == filePath
    );
    if (parentFile) {
      //get the file content from the parent commit and return the content
      return await this.getFileContent(parentFile.hash);
    }
  }

  async getCommitData(commitHash) {
    await this.initPromise;
    const commitPath = path.join(
      this.objectsPath,
      "commits",
      commitHash.slice(0, 2),
      commitHash.slice(2)
    );
    try {
      return await fs.readFile(commitPath, { encoding: "utf-8" });
    } catch (error) {
      console.log("Failed to read commit data", error);
      return null;
    }
  }

  async getFileContent(filehash) {
    const objectDir = path.join(this.objectsPath, filehash.slice(0, 2));
    const objectFile = filehash.slice(2);
    const objectPath = path.join(objectDir, objectFile);
    try {
      return await fs.readFile(objectPath, { encoding: "utf-8" });
    } catch (error) {
      console.log("Failed to read file content", error);
      return null;
    }
  }

  async restore(filePath, commitHash) {
    await this.initPromise;
    const commitData = JSON.parse(await this.getCommitData(commitHash));
    if (!commitData) {
      console.log("Commit not found");
      return;
    }
    const fileEntry = commitData.files.find((file) => file.path === filePath);
    if (!fileEntry) {
      console.log(`File ${filePath} not found in commit ${commitHash}`);
      return;
    }
    const fileContent = await this.getFileContent(fileEntry.hash);
    await fs.writeFile(filePath, fileContent);
    console.log(`Restored ${filePath} to its state at commit ${commitHash}`);
  }

  async status() {
    await this.initPromise;
    const stagedFiles = JSON.parse(await fs.readFile(this.indexPath, "utf-8"));
    const workingDirectoryFiles = await this.getWorkingDirectoryFiles();
    const ignorePatterns = await this.readIgnoreFile();

    console.log("Changes to be committed:");
    for (const file of stagedFiles) {
      if (!this.isIgnored(file.path, ignorePatterns)) {
        console.log(chalk.green(`  new file:   ${file.path}`));
      }
    }

    console.log("\nChanges not staged for commit:");
    for (const file of workingDirectoryFiles) {
      if (
        !this.isIgnored(file, ignorePatterns) &&
        !stagedFiles.some((f) => f.path === file)
      ) {
        console.log(chalk.red(`  modified:   ${file}`));
      }
    }

    console.log("\nUntracked files:");
    const untrackedFiles = workingDirectoryFiles.filter(
      (file) =>
        !this.isIgnored(file, ignorePatterns) &&
        !stagedFiles.some((f) => f.path === file)
    );

    if (untrackedFiles.length > 0) {
      for (const file of untrackedFiles) {
        console.log(chalk.red(`  ${file}`));
      }
    } else {
      console.log("  (no untracked files)");
    }
  }

  async readIgnoreFile() {
    const ignorePath = path.join(process.cwd(), ".grootignore");
    try {
      const content = await fs.readFile(ignorePath, "utf-8");
      return content.split("\n").filter((line) => line.trim() !== "");
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  isIgnored(filePath, ignorePatterns) {
    const normalizedPath = path.normalize(filePath);
    return ignorePatterns.some((pattern) => {
      if (pattern.endsWith("/")) {
        return (
          normalizedPath.startsWith(pattern) ||
          normalizedPath === pattern.slice(0, -1)
        );
      }
      if (pattern.startsWith("*")) {
        const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
        return regex.test(path.basename(normalizedPath));
      }
      return (
        normalizedPath === pattern ||
        normalizedPath.startsWith(pattern + path.sep)
      );
    });
  }

  async getWorkingDirectoryFiles(dir = ".") {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const res = path.join(dir, entry.name);
        return entry.isDirectory() ? this.getWorkingDirectoryFiles(res) : res;
      })
    );
    return files.flat().map((file) => path.relative(process.cwd(), file));
  }
}




// (async () => {
//     const groot = new Groot();
//     await groot.add("sample.txt");
//     // await groot.add("sample2.txt");
//     // await groot.commit("Fifth Commit");
//     // // await groot.commit("Second commit");
//     await groot.log();
//     // await groot.showCommitDiff("21f10abf3f846c8322a34694feb365d363454530");

// })();

program.command("init").action(async () => {
  const groot = new Groot();
});

program.command("add <file>").action(async (file) => {
  const groot = new Groot();
  await groot.add(file);
});

program.command("commit <message>").action(async (message) => {
  const groot = new Groot();
  await groot.commit(message);
});

program.command("log").action(async () => {
  const groot = new Groot();
  await groot.log();
});

program.command("show <commitHash>").action(async (commitHash) => {
  const groot = new Groot();
  await groot.showCommitDiff(commitHash);
});

program
  .command("restore <file> <commitHash>")
  .action(async (file, commitHash) => {
    const groot = new Groot();
    await groot.restore(file, commitHash);
  });

  program.command("status").action(async () => {
    const groot = new Groot();
    await groot.status();
  });

program.parse(process.argv);
