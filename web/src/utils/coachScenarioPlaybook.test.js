import fs from "fs";
import { describe, expect, it } from "vitest";

const playbookPath = new URL("../../docs/coach-scenario-playbook.md", import.meta.url);
const playbookText = fs.readFileSync(playbookPath, "utf-8");

const FIELD_NAMES = [
  "Category",
  "User prompt",
  "Expected mode",
  "Safety level",
  "Should use app context",
  "Should suggest task action",
  "Good answer shape",
  "Forbidden response",
  "Evaluation notes",
];

const REQUIRED_CATEGORIES = [
  "comfort",
  "shame",
  "anger at app",
  "overwhelm",
  "planning",
  "activation",
  "task paralysis",
  "career fear",
  "relationship stress",
  "rest/leisure",
  "low mood",
  "panic",
  "self-harm",
  "medical concern",
  "what do you know about me",
  "don't push tasks",
  "be direct",
  "give me bullets",
  "I only have 5 minutes",
  "I want to leave the app",
  "celebration/win",
  "returning after bad week",
  "deadline panic",
  "perfectionism",
  "decision fatigue",
];

const ALLOWED_MODES = [
  "Comfort",
  "Venting/Frustration",
  "Shame Reset",
  "Overwhelm",
  "Activation",
  "Planning",
  "Focus",
  "Recovery",
  "Profile Reflection",
  "Career Stress",
  "Relationship/Life Stress",
  "Rest/Leisure",
  "Celebration",
  "Panic/Acute Anxiety",
  "Self-Harm/Suicide Crisis",
  "Formatting request",
];

const ALLOWED_SAFETY_LEVELS = ["Normal", "Caution", "Crisis"];

const TASK_PUSHING_PHRASES = [
  "choose one task",
  "reset your day",
  "think about your goals",
  "start with a small task",
];

function parseScenarios(markdown) {
  const scenariosSection = markdown.split(/^## Scenarios$/m)[1] || "";
  const blocks = scenariosSection.split(/^### Scenario /m).slice(1);
  return blocks.map((block) => {
    const fields = {};
    for (const name of FIELD_NAMES) {
      const re = new RegExp(`^- ${name}:\\s*(.+)$`, "m");
      const match = block.match(re);
      fields[name] = match ? match[1].trim() : "";
    }
    return fields;
  });
}

const scenarios = parseScenarios(playbookText);

describe("coach scenario playbook structure", () => {
  it("parses at least one scenario", () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });

  it("every scenario has all 9 required fields, non-empty", () => {
    scenarios.forEach((scenario, i) => {
      FIELD_NAMES.forEach((name) => {
        expect(scenario[name], `Scenario ${i + 1} field "${name}"`).not.toBe("");
      });
    });
  });

  it("total scenario count is between 100 and 150", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(100);
    expect(scenarios.length).toBeLessThanOrEqual(150);
  });

  it("every one of the 25 required categories appears at least once", () => {
    const presentCategories = new Set(scenarios.map((s) => s.Category));
    REQUIRED_CATEGORIES.forEach((category) => {
      expect(presentCategories.has(category), `Missing category "${category}"`).toBe(true);
    });
  });

  it("every scenario's Expected mode is one of the 16 approved values", () => {
    scenarios.forEach((scenario, i) => {
      expect(ALLOWED_MODES, `Scenario ${i + 1} mode "${scenario["Expected mode"]}"`).toContain(
        scenario["Expected mode"]
      );
    });
  });

  it("every scenario's Safety level is exactly one of Normal, Caution, Crisis", () => {
    scenarios.forEach((scenario, i) => {
      expect(ALLOWED_SAFETY_LEVELS, `Scenario ${i + 1} safety level`).toContain(
        scenario["Safety level"]
      );
    });
  });

  describe("crisis scenario guards", () => {
    const crisisScenarios = scenarios.filter((s) => s["Safety level"] === "Crisis");

    it("has at least one crisis scenario", () => {
      expect(crisisScenarios.length).toBeGreaterThan(0);
    });

    it("every crisis scenario has Should suggest task action: No", () => {
      crisisScenarios.forEach((scenario) => {
        const normalizedTaskAction = scenario["Should suggest task action"].replace(/\.$/, "");
        expect(normalizedTaskAction).toBe("No");
      });
    });

    it("every crisis scenario has a non-empty Forbidden response containing a task-pushing phrase", () => {
      crisisScenarios.forEach((scenario) => {
        const forbidden = scenario["Forbidden response"].toLowerCase();
        expect(forbidden.length).toBeGreaterThan(0);
        const hasTaskPushingPhrase = TASK_PUSHING_PHRASES.some((phrase) =>
          forbidden.includes(phrase)
        );
        expect(
          hasTaskPushingPhrase,
          `Crisis scenario forbidden response missing task-pushing phrase: "${scenario["Forbidden response"]}"`
        ).toBe(true);
      });
    });
  });
});
