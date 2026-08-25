import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

type Lifecycle = "proposed" | "implemented" | "rejected";

interface LifecycleRule {
  status: string;
  headings: string[];
  forbidden?: string[];
}

const root = fileURLToPath(new URL("..", import.meta.url));
const notesRoot = join(root, ".agents", "notes");
const errors: string[] = [];

const lifecycleRules: Record<Lifecycle, LifecycleRule> = {
  proposed: {
    status: "Status: proposed",
    headings: [
      "## Problem",
      "## Proposal",
      "## Alternatives considered",
      "## Acceptance criteria",
      "## Risks",
    ],
  },
  implemented: {
    status: "Status: implemented",
    headings: [
      "## Problem",
      "## Decision",
      "## Alternatives considered",
      "## Consequences",
    ],
    forbidden: ["## Proposal", "## Acceptance criteria", "## Risks"],
  },
  rejected: {
    status: "Status: rejected — ",
    headings: ["## Problem", "## Proposal", "## Alternatives considered"],
  },
};

function markdownFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(path));
    if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "AGENTS.md") {
      files.push(path);
    }
  }
  return files;
}

function checkNote(path: string, lifecycle: Lifecycle, rules: LifecycleRule): void {
  const displayPath = relative(root, path);
  const filename = basename(path);
  const lines = readFileSync(path, "utf8").split("\n");

  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(filename)) {
    errors.push(`${displayPath}: filename must be yyyy-mm-dd-kebab-case.md`);
  }
  if (!lines[0]?.startsWith("# Agent Note: ")) {
    errors.push(`${displayPath}: first line must start with "# Agent Note: "`);
  }
  if (lines[1] !== "" || lines[3] !== "") {
    errors.push(`${displayPath}: title and status must be separated by blank lines`);
  }

  const statusMatches =
    lifecycle === "rejected"
      ? lines[2]?.startsWith(rules.status) && lines[2].length > rules.status.length
      : lines[2] === rules.status;
  if (!statusMatches) {
    errors.push(`${displayPath}: status does not match the ${lifecycle}/ directory`);
  }

  let previousHeading = -1;
  for (const heading of rules.headings) {
    const index = lines.indexOf(heading);
    if (index === -1) {
      errors.push(`${displayPath}: missing required heading "${heading}"`);
    } else if (index <= previousHeading) {
      errors.push(`${displayPath}: heading "${heading}" is out of order`);
    }
    previousHeading = index;
  }

  for (const heading of rules.forbidden ?? []) {
    if (lines.includes(heading)) {
      errors.push(`${displayPath}: implemented notes cannot contain "${heading}"`);
    }
  }
}

function checkSymlink(path: string, expectedTarget: string): void {
  const displayPath = relative(root, path);
  try {
    if (!lstatSync(path).isSymbolicLink()) {
      errors.push(`${displayPath}: must be a symbolic link`);
      return;
    }
    if (realpathSync(path) !== realpathSync(expectedTarget)) {
      errors.push(`${displayPath}: points to the wrong source of truth`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${displayPath}: ${message}`);
  }
}

let noteCount = 0;
for (const lifecycle of Object.keys(lifecycleRules) as Lifecycle[]) {
  const directory = join(notesRoot, lifecycle);
  try {
    const files = markdownFiles(directory);
    noteCount += files.length;
    for (const path of files) checkNote(path, lifecycle, lifecycleRules[lifecycle]);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

checkSymlink(join(root, "CLAUDE.md"), join(root, "AGENTS.md"));
checkSymlink(join(root, ".claude", "skills"), join(root, ".agents", "skills"));

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Agent checks passed (${noteCount} note${noteCount === 1 ? "" : "s"}).`);
}
