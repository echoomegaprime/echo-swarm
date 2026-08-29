import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("visible chat exposes purpose, Fusion, and voice controls", () => {
  const composer = readFileSync(join(root, "src/components/swarm/composer.tsx"), "utf8");
  for (const purpose of ["Brainstorm", "Review", "Validate", "Certify"]) {
    assert.match(composer, new RegExp(`PURPOSE_META\\[item\\]\\.label|${purpose}`));
  }
  assert.match(composer, /Fusion \{fusionEnabled \? "on" : "off"\}/);
  assert.match(composer, /startVoiceInput/);
  assert.match(composer, /Read fused output/);
  assert.match(composer, /source: "fusion"/);
  assert.match(composer, /getFusionResult/);
});

test("voice playback resets visible state on completion and failure", () => {
  const voice = readFileSync(join(root, "src/lib/swarm/voice.ts"), "utf8");
  const thread = readFileSync(join(root, "src/components/swarm/thread.tsx"), "utf8");
  const composer = readFileSync(join(root, "src/components/swarm/composer.tsx"), "utf8");
  assert.match(voice, /utterance\.onend = \(\) => \{[\s\S]{0,100}notifySpeechStopped\(\)/u);
  assert.match(voice, /utterance\.onerror = \(\) => \{[\s\S]{0,100}notifySpeechStopped\(\)/u);
  assert.match(voice, /let activeUtterance: SpeechSynthesisUtterance \| undefined/u);
  assert.match(
    voice,
    /utterance\.onend = \(\) => \{[\s\S]{0,100}activeUtterance !== utterance[\s\S]{0,100}activeUtterance = undefined/u,
  );
  assert.match(
    voice,
    /export function stopSpeaking[\s\S]{0,300}activeUtterance = undefined;[\s\S]{0,100}speechSynthesis\.cancel\(\)/u,
  );
  assert.match(thread, /onEnd: \(\) => setSpeaking\(false\)/u);
  assert.match(thread, /onError: \(\) => setSpeaking\(false\)/u);
  assert.match(thread, /onSpeechStopped\(\(\) => setSpeaking\(false\)\)/u);
  assert.match(thread, />Thinking<\/p>/u);
  assert.match(voice, /recognition\.onend = null/u);
  assert.match(voice, /if \(ended\) return/u);
  assert.doesNotMatch(voice, /recognition\.abort\(\)/u);
  assert.match(composer, /budget: \{ max_calls: 120, max_cost_usd: 5, max_wall_s: 420 \}/u);
  assert.match(
    composer,
    /aria-label="Stop"[\s\S]{0,600}stopVoiceRef\.current\?\.\(\);[\s\S]{0,200}stopVoiceRef\.current = null/u,
  );
});

test("Fusion server actions require the verified same-site session middleware", () => {
  const actions = readFileSync(join(root, "src/lib/swarm/actions.ts"), "utf8");
  for (const action of [
    "getFusionHealth",
    "startFusionRun",
    "getFusionResult",
    "resumeFusionRun",
  ]) {
    assert.match(
      actions,
      new RegExp(
        `export const ${action} = createServerFn\\([\\s\\S]*?\\n  \\.middleware\\(\\[authMiddleware\\]\\)`,
      ),
      `${action} must remain behind authMiddleware`,
    );
  }
});
