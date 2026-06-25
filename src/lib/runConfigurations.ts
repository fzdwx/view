export interface RunEnvironmentVariable {
  readonly key: string;
  readonly value: string;
}

export interface RunConfiguration {
  readonly id: string;
  readonly projectPath: string;
  readonly sourceId: string;
  readonly label: string;
  readonly command: string;
  readonly args: string;
  readonly cwd: string | null;
  readonly env: readonly RunEnvironmentVariable[];
  readonly updatedAt: number;
}

export interface RunConfigurationInput {
  readonly projectPath: string;
  readonly sourceId: string;
  readonly label: string;
  readonly command: string;
  readonly args?: string;
  readonly cwd?: string | null;
  readonly env?: readonly RunEnvironmentVariable[];
}

const runConfigurationsStorageKey = "view.run-configurations.v1";
export const runConfigurationsChangedEvent = "view:run-configurations-changed";

export interface RunConfigurationsChangedEventDetail {
  readonly projectPath: string;
}

export function loadRunConfigurations(projectPath: string): readonly RunConfiguration[] {
  if (typeof localStorage === "undefined") {
    return [];
  }

  try {
    return normalizeRunConfigurations(
      JSON.parse(localStorage.getItem(runConfigurationsStorageKey) ?? "[]"),
      projectPath,
    );
  } catch {
    return [];
  }
}

export function saveRunConfigurations(
  projectPath: string,
  configurations: readonly RunConfiguration[],
): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  let existing: readonly RunConfiguration[] = [];
  try {
    existing = normalizeRunConfigurations(
      JSON.parse(localStorage.getItem(runConfigurationsStorageKey) ?? "[]"),
    );
  } catch {
    existing = [];
  }
  existing = existing.filter(
    (configuration) => configuration.projectPath !== projectPath,
  );
  localStorage.setItem(
    runConfigurationsStorageKey,
    JSON.stringify([...existing, ...configurations]),
  );
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<RunConfigurationsChangedEventDetail>(
      runConfigurationsChangedEvent,
      { detail: { projectPath } },
    ),
  );
}

export function upsertRunConfiguration(
  configurations: readonly RunConfiguration[],
  input: RunConfigurationInput,
  now = Date.now(),
): {
  readonly configuration: RunConfiguration;
  readonly configurations: readonly RunConfiguration[];
} {
  const existing = configurations.find(
    (configuration) =>
      configuration.projectPath === input.projectPath &&
      configuration.sourceId === input.sourceId,
  );
  const configuration: RunConfiguration = {
    id: existing?.id ?? runConfigurationId(input.projectPath, input.sourceId),
    projectPath: input.projectPath,
    sourceId: input.sourceId,
    label: input.label.trim() || input.command,
    command: input.command.trim(),
    args: input.args?.trim() ?? existing?.args ?? "",
    cwd: input.cwd?.trim() || null,
    env: normalizeRunEnv(input.env ?? existing?.env ?? []),
    updatedAt: now,
  };
  const nextConfigurations = [
    configuration,
    ...configurations.filter((entry) => entry.id !== configuration.id),
  ];
  return { configuration, configurations: nextConfigurations };
}

export function updateRunConfiguration(
  configurations: readonly RunConfiguration[],
  patch: RunConfiguration,
): readonly RunConfiguration[] {
  return [
    { ...patch, env: normalizeRunEnv(patch.env), updatedAt: Date.now() },
    ...configurations.filter((configuration) => configuration.id !== patch.id),
  ];
}

export function runConfigurationCommand(configuration: RunConfiguration): string {
  const command = configuration.command.trim();
  const args = configuration.args.trim();
  return args ? `${command} ${args}` : command;
}

export function runConfigurationEnvRecord(
  configuration: RunConfiguration,
): Record<string, string> {
  return Object.fromEntries(
    normalizeRunEnv(configuration.env).map((entry) => [entry.key, entry.value]),
  );
}

export function parseRunEnvText(text: string): readonly RunEnvironmentVariable[] {
  return normalizeRunEnv(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const equalsIndex = line.indexOf("=");
        if (equalsIndex <= 0) {
          return null;
        }
        return {
          key: line.slice(0, equalsIndex).trim(),
          value: line.slice(equalsIndex + 1),
        };
      })
      .filter((entry): entry is RunEnvironmentVariable => Boolean(entry)),
  );
}

export function formatRunEnvText(
  env: readonly RunEnvironmentVariable[],
): string {
  return normalizeRunEnv(env)
    .map((entry) => `${entry.key}=${entry.value}`)
    .join("\n");
}

function normalizeRunConfigurations(
  value: unknown,
  projectPath?: string,
): readonly RunConfiguration[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry): RunConfiguration[] => {
    if (!isRecord(entry)) {
      return [];
    }
    if (
      typeof entry.id !== "string" ||
      typeof entry.projectPath !== "string" ||
      typeof entry.sourceId !== "string" ||
      typeof entry.command !== "string"
    ) {
      return [];
    }
    if (projectPath && entry.projectPath !== projectPath) {
      return [];
    }

    return [
      {
        id: entry.id,
        projectPath: entry.projectPath,
        sourceId: entry.sourceId,
        label: typeof entry.label === "string" ? entry.label : entry.command,
        command: entry.command,
        args: typeof entry.args === "string" ? entry.args : "",
        cwd: typeof entry.cwd === "string" && entry.cwd.trim() ? entry.cwd : null,
        env: normalizeRunEnv(Array.isArray(entry.env) ? entry.env : []),
        updatedAt:
          typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
            ? entry.updatedAt
            : 0,
      },
    ];
  });
}

function normalizeRunEnv(value: readonly unknown[]): readonly RunEnvironmentVariable[] {
  const seen = new Set<string>();
  const env: RunEnvironmentVariable[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.key !== "string") {
      continue;
    }
    const key = entry.key.trim();
    if (!isValidEnvKey(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    env.push({
      key,
      value: typeof entry.value === "string" ? entry.value : "",
    });
  }
  return env;
}

function isValidEnvKey(key: string): boolean {
  return key.length > 0 && !key.includes("=") && !key.includes("\0");
}

function runConfigurationId(projectPath: string, sourceId: string): string {
  return `run:${stableHash(projectPath)}:${stableHash(sourceId)}`;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
