interface TerminalEnvironment {
  CI?: string;
  FORCE_COLOR?: string;
  NO_COLOR?: string;
  TERM?: string;
}

interface ResolveTerminalCapabilitiesOptions {
  columns?: number;
  env: TerminalEnvironment;
  isTTY: boolean;
}

interface TerminalCapabilities {
  color: boolean;
  columns: number | null;
  unicode: boolean;
}

const isEnabledEnvironmentFlag = (value: string | undefined): boolean => {
  if (value === undefined) {
    return false;
  }

  const normalizedValue = value.trim().toLowerCase();
  return (
    normalizedValue !== "" &&
    normalizedValue !== "0" &&
    normalizedValue !== "false"
  );
};

const hasNoColorPreference = (value: string | undefined): boolean =>
  value !== undefined;

const normalizeTerminalColumns = (
  columns: number | undefined
): number | null =>
  columns !== undefined && Number.isFinite(columns) && columns > 0
    ? Math.floor(columns)
    : null;

const resolveTerminalCapabilities = ({
  columns,
  env,
  isTTY,
}: ResolveTerminalCapabilitiesOptions): TerminalCapabilities => {
  const isCi = isEnabledEnvironmentFlag(env.CI);
  const isDumbTerminal = env.TERM?.trim().toLowerCase() === "dumb";
  const unicode = isTTY && !isCi && !isDumbTerminal;
  const forceColor = isEnabledEnvironmentFlag(env.FORCE_COLOR);
  const color = !hasNoColorPreference(env.NO_COLOR) && (forceColor || unicode);

  return {
    color,
    columns: normalizeTerminalColumns(columns),
    unicode,
  };
};

export type {
  ResolveTerminalCapabilitiesOptions,
  TerminalCapabilities,
  TerminalEnvironment,
};
export { resolveTerminalCapabilities };
