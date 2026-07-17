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
const EXPORTED_TOAST_COMPONENT_PATTERN =
  /(?:function|const)\s+(Toaster|ToastProvider)\b[\s\S]*?export\s*\{[\s\S]*?\b\1\b[\s\S]*?\}/;
const TOAST_IMPORT_PATTERN =
  /from\s+["'](?:sonner|react-hot-toast|@radix-ui\/react-toast)["']/;
const TOAST_DEPENDENCIES = [
  "@radix-ui/react-toast",
  "react-hot-toast",
  "sonner",
] as const;

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

    const hasToastDependency = TOAST_DEPENDENCIES.some(
      (dependency) => project.dependencies[dependency]
    );

    if (!hasToastDependency) {
      return fail(
        "A toast-like component is mounted without a recognized toast runtime dependency.",
        "Install a toast runtime such as Sonner or Radix Toast and mount its provider from the app shell.",
        { filePath: shell.path }
      );
    }

    const directLine = getTextLineNumber(shell.content, TOASTER_JSX_PATTERN);

    if (directLine !== undefined && TOAST_IMPORT_PATTERN.test(shell.content)) {
      return pass(
        "Toast provider from a recognized runtime is mounted directly in the app shell.",
        shell.path,
        directLine
      );
    }

    const files = await getProjectSourceFiles(project);

    for (const file of files) {
      if (!TOAST_IMPORT_PATTERN.test(file.content)) {
        continue;
      }

      EXPORTED_COMPONENT_PATTERN.lastIndex = 0;
      const componentMatch = EXPORTED_COMPONENT_PATTERN.exec(file.content);
      EXPORTED_TOAST_COMPONENT_PATTERN.lastIndex = 0;
      const toastComponentMatch = EXPORTED_TOAST_COMPONENT_PATTERN.exec(
        file.content
      );
      const componentName =
        componentMatch?.[1] ?? componentMatch?.[2] ?? toastComponentMatch?.[1];

      if (!componentName) {
        continue;
      }

      const mountedComponentPattern = new RegExp(`<${componentName}(?:\\s|>)`);
      const line = getTextLineNumber(shell.content, mountedComponentPattern);

      if (line !== undefined) {
        return pass(
          `Recognized toast provider is mounted through ${componentName}.`,
          shell.path,
          line
        );
      }
    }

    return fail(
      "Toast infrastructure with recognized runtime provenance is not mounted from the app shell.",
      "Render a provider imported from Sonner, Radix Toast, or React Hot Toast in the root shell, directly or through a mounted wrapper.",
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
