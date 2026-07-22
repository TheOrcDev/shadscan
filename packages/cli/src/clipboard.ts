import crossSpawn from "cross-spawn";

// Common terminals silently truncate OSC 52 payloads beyond roughly 100 KB;
// stay comfortably below after base64 expansion.
const MAX_OSC52_TEXT_BYTES = 72 * 1024;

type ClipboardMethod = "osc52" | "utility";

interface ClipboardResult {
  copied: boolean;
  method: ClipboardMethod | null;
}

interface ClipboardCommand {
  args: string[];
  command: string;
}

type SpawnImplementation = typeof crossSpawn;

interface CopyToClipboardOptions {
  osc52Write?: ((sequence: string) => void) | null;
  platform?: NodeJS.Platform;
  spawnImplementation?: SpawnImplementation;
}

const getClipboardCommands = (
  platform: NodeJS.Platform
): ClipboardCommand[] => {
  if (platform === "darwin") {
    return [{ args: [], command: "pbcopy" }];
  }

  if (platform === "win32") {
    return [{ args: [], command: "clip" }];
  }

  return [
    { args: [], command: "wl-copy" },
    { args: ["-selection", "clipboard"], command: "xclip" },
    { args: ["--clipboard", "--input"], command: "xsel" },
  ];
};

const copyWithUtility = (
  text: string,
  clipboardCommand: ClipboardCommand,
  spawnImplementation: SpawnImplementation
): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawnImplementation(
      clipboardCommand.command,
      clipboardCommand.args,
      { stdio: ["pipe", "ignore", "ignore"] }
    );

    child.once("error", () => {
      resolve(false);
    });
    child.once("close", (code) => {
      resolve(code === 0);
    });

    child.stdin?.once("error", () => {
      // The close handler reports the outcome; swallow pipe errors.
    });
    child.stdin?.end(text);
  });

const copyWithOsc52 = (
  text: string,
  osc52Write: (sequence: string) => void
): boolean => {
  if (Buffer.byteLength(text, "utf8") > MAX_OSC52_TEXT_BYTES) {
    return false;
  }

  const encodedText = Buffer.from(text, "utf8").toString("base64");
  osc52Write(`\u001b]52;c;${encodedText}\u0007`);
  return true;
};

const copyToClipboard = async (
  text: string,
  {
    osc52Write = null,
    platform = process.platform,
    spawnImplementation = crossSpawn,
  }: CopyToClipboardOptions = {}
): Promise<ClipboardResult> => {
  for (const clipboardCommand of getClipboardCommands(platform)) {
    if (await copyWithUtility(text, clipboardCommand, spawnImplementation)) {
      return { copied: true, method: "utility" };
    }
  }

  if (osc52Write && copyWithOsc52(text, osc52Write)) {
    return { copied: true, method: "osc52" };
  }

  return { copied: false, method: null };
};

export type {
  ClipboardCommand,
  ClipboardMethod,
  ClipboardResult,
  CopyToClipboardOptions,
};
export { copyToClipboard, getClipboardCommands, MAX_OSC52_TEXT_BYTES };
