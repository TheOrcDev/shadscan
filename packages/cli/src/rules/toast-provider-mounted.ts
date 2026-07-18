import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { analyzeToastRuntime } from "./toast-runtime";

const toastProviderMountedRule: AuditRule = {
  adapters: ["core"],
  category: "states",
  confidence: "high",
  description:
    "Checks whether toast infrastructure is mounted from the app shell.",
  id: "toast-provider-mounted",
  maxScore: 3,
  run: async ({ project }) => {
    const analysis = await analyzeToastRuntime(project);

    if (!analysis.shell) {
      return notApplicable("No supported application shell file was found.");
    }

    if (!analysis.hasDependency) {
      return fail(
        "A toast-like component is mounted without a recognized toast runtime dependency.",
        "Install a toast runtime such as Sonner or Radix Toast and mount its provider from the app shell.",
        { filePath: analysis.shell.path }
      );
    }

    if (analysis.mount && analysis.runtime) {
      return pass(
        `Toast provider is mounted through ${analysis.mount.componentName} with ${analysis.runtime.moduleName} provenance.`,
        analysis.mount.filePath,
        analysis.mount.line
      );
    }

    return fail(
      "Toast infrastructure with recognized runtime provenance is not mounted from the app shell.",
      "Render a provider imported from Sonner, Radix Toast, or React Hot Toast in the root shell, directly or through a mounted wrapper.",
      {
        filePath: analysis.shell.path,
        roast:
          "The toast package is installed. The toast itself remains theoretical.",
      }
    );
  },
  severity: "warning",
  title: "toast provider is mounted",
};

export { toastProviderMountedRule };
