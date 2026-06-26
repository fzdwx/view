import { describe, expect, test } from "bun:test";
import {
  formatRunEnvText,
  parseRunEnvText,
  recordRunConfigurationLaunch,
  runConfigurationCommand,
  runConfigurationEnvRecord,
  runConfigurationTabIdentity,
  upsertRunConfiguration,
} from "./runConfigurations";

describe("runConfigurations", () => {
  test("upserts a persisted run target by project and source id", () => {
    const first = upsertRunConfiguration([], {
      projectPath: "/repo",
      sourceId: "go:test:TestThing",
      label: "Run TestThing",
      command: "go test ./pkg -run '^TestThing$'",
      cwd: "/repo",
    }, 1);
    const second = upsertRunConfiguration(first.configurations, {
      projectPath: "/repo",
      sourceId: "go:test:TestThing",
      label: "Run TestThing",
      command: "go test ./pkg -run '^TestThing$'",
      args: "-count=1",
      cwd: "/repo",
      env: [{ key: "VIEW_ENV", value: "test" }],
    }, 2);

    expect(second.configurations).toHaveLength(1);
    expect(second.configuration.id).toBe(first.configuration.id);
    expect(runConfigurationCommand(second.configuration)).toBe(
      "go test ./pkg -run '^TestThing$' -count=1",
    );
    expect(runConfigurationEnvRecord(second.configuration)).toEqual({
      VIEW_ENV: "test",
    });
    expect(second.configuration.singleInstance).toBe(true);
    expect(runConfigurationTabIdentity(second.configuration)).toBe(
      second.configuration.id,
    );
  });

  test("parses and formats environment variables", () => {
    const env = parseRunEnvText("FOO=bar\nEMPTY=\ninvalid\nFOO=ignored\n");

    expect(env).toEqual([
      { key: "FOO", value: "bar" },
      { key: "EMPTY", value: "" },
    ]);
    expect(formatRunEnvText(env)).toBe("FOO=bar\nEMPTY=");
  });

  test("records launch history and supports multi-instance configs", () => {
    const { configuration, configurations } = upsertRunConfiguration([], {
      projectPath: "/repo",
      sourceId: "custom:dev",
      label: "Dev",
      command: "bun run dev",
      singleInstance: false,
    }, 1);

    const launched = recordRunConfigurationLaunch(
      configurations,
      configuration.id,
      42,
    );

    expect(runConfigurationTabIdentity(configuration)).toBeUndefined();
    expect(launched[0].lastRunAt).toBe(42);
    expect(launched[0].runCount).toBe(1);
  });
});
