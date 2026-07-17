import path from "node:path";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import {
  getProjectSourceFiles,
  getTextLineNumber,
  readProjectSourceFile,
  type SourceFile,
} from "./source-files";

const TOASTER_JSX_PATTERN = /<(?:Toaster|ToastProvider)(?:\s|>)/;
const EXPORTED_COMPONENT_PATTERN =
  /export\s+(?:default\s+)?function\s+(\w+)|export\s+const\s+(\w+)\s*=/;

const getShellPaths = ({
  appDir,
  rootDir,
  viteEntry,
}: {
  appDir: string | null;
  rootDir: string;
  viteEntry: string | null;
}): string[] => {
  if (appDir) {
    return ["layout.tsx", "layout.jsx", "layout.ts", "layout.js"].map(
      (fileName) => path.join(appDir, fileName)
    );
  }

  if (viteEntry) {
    return [viteEntry];
  }

  return ["src/main.tsx", "src/main.jsx", "src/App.tsx", "src/App.jsx"].map(
    (fileName) => path.join(rootDir, fileName)
  );
};

const toastProviderMountedRule: AuditRule = {
  adapters: ["core"],
  category: "states",
  confidence: "high",
  description:
    "Checks whether toast infrastructure is mounted from the app shell.",
  id: "toast-provider-mounted",
  maxScore: 3,
  run: async ({ project }) => {
    const shellPaths = getShellPaths({
      appDir: project.paths.appDir,
      rootDir: project.rootDir,
      viteEntry: project.paths.viteEntry,
    });
    let shell: SourceFile | null = null;

    for (const shellPath of shellPaths) {
      shell = await readProjectSourceFile(project, shellPath);

      if (shell) {
        break;
      }
    }

    if (!shell) {
      return notApplicable("No supported application shell file was found.");
    }

    const directLine = getTextLineNumber(shell.content, TOASTER_JSX_PATTERN);

    if (directLine !== undefined) {
      return pass(
        "Toast provider is mounted directly in the app shell.",
        shell.path,
        directLine
      );
    }

    const files = await getProjectSourceFiles(project);

    for (const file of files) {
      if (!TOASTER_JSX_PATTERN.test(file.content)) {
        continue;
      }

      EXPORTED_COMPONENT_PATTERN.lastIndex = 0;
      const componentMatch = EXPORTED_COMPONENT_PATTERN.exec(file.content);
      const componentName = componentMatch?.[1] ?? componentMatch?.[2];

      if (!componentName) {
        continue;
      }

      const mountedComponentPattern = new RegExp(`<${componentName}(?:\\s|>)`);
      const line = getTextLineNumber(shell.content, mountedComponentPattern);

      if (line !== undefined) {
        return pass(
          `Toast provider is mounted through ${componentName}.`,
          shell.path,
          line
        );
      }
    }

    return fail(
      "Toast infrastructure is not mounted from the app shell.",
      "Render Toaster or ToastProvider in the root shell, directly or through a mounted provider wrapper.",
      {
        filePath: shell.path,
        roast:
          "The toast package is installed. The toast itself remains theoretical.",
      }
    );
  },
  severity: "warning",
  title: "toast provider is mounted",
};

export { toastProviderMountedRule };
