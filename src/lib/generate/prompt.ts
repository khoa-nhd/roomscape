import { TEMPLATES } from "../game/schema.ts";
import { exitObject, PUZZLE_RANGE, usableFacts, type RoomInput } from "./plan.ts";

const THEME_VOICE = {
  detective: "a noir detective mystery: dry, observant, a little wry",
  horror: "eerie and tense, never gory or graphic",
  scifi: "a sealed space-station cabin: calm computer voices, failing systems",
} as const;

/** The design brief. Text only: the room was already read from the photos and checked by its owner. */
export function buildPrompt(input: RoomInput, rejected?: string[]): string {
  const { analysis, settings } = input;
  const [min, max] = PUZZLE_RANGE[settings.difficulty];
  const exit = exitObject(analysis);
  const flags = (o: (typeof analysis.objects)[number]) =>
    [o.canHide && "can hide things", o.canOpen && "opens", o.isDoor && "door"].filter(Boolean).join(", ") || "-";

  const objects = analysis.objects
    .map((o) => `${o.id} | wall ${o.wall} | ${o.label} | ${o.description || "-"} | ${flags(o)}`)
    .join("\n");
  const facts = usableFacts(analysis)
    .map((f) => `${f.id} | on ${f.objectId} | ${f.kind} | value: ${f.value} | ${f.statement}`)
    .join("\n");

  return `You design point-and-click escape rooms set inside a player's REAL room. The room below was read from photos and every fact was checked by the person who lives there.

Tone: ${THEME_VOICE[settings.theme]}.
Write in plain, simple English. Many players are not native speakers.

OBJECTS (id | wall | label | description | notes)
${objects}

CONFIRMED FACTS (id | object | kind | value | sentence)
${facts || "(none)"}
The value is what the owner confirmed. If the sentence disagrees with the value, trust the value.

Design ${min} to ${max} puzzles, listed in the order a player would solve them.

Puzzle templates:
- count_code: a number lock. Uses 1 to 4 "count" facts. The code is their values in the order you list them in factIds. The clue must say what to count and in which order, and must not contain any number.
- color_seq: a colour lock. Uses exactly one "color_order" fact. The clue points to where the colours can be seen, without naming the colours.
- text_cipher: a letter lock. Uses exactly one "text" fact. The clue leads the player to the word, without writing the word.
- math_code: a number lock the player has to work out. Uses 2 or 3 "count" facts. The game multiplies the first two values and adds the third, and writes that rule on the lock itself. Your clue is one short sentence of atmosphere only: no numbers, no rule.
- direction_lock: a compass lock. Uses no facts. Put 3 or 4 object ids in "objectIds": the answer is the wall each one is on, in that order. Choose objects on at least two different walls, whose labels no other object shares. The game writes the rule on the lock. Your clue is one short sentence of atmosphere only.
- uv_code: a number lock whose code is written in invisible ink. Uses no facts: the game makes the code. Put exactly one object id in "objectIds": a different object, where the writing is hidden. It must come "after" an earlier puzzle whose reward is a UV torch (name that reward "UV torch"). The player selects the torch and looks at that object to read the code. Your clue is one short sentence of atmosphere only.
- hidden_item: no facts, no lock. The player searches the object and finds the reward.
- use_item: no facts, no lock. The player uses an item from an earlier puzzle on the object.

Rules:
1. The last puzzle is the exit and must sit on object ${exit.id} (${exit.label}).
2. Every puzzle sits on a different object. Use only object ids from the list.
3. Prefer puzzles that make the player think: when the room allows it, include one math_code and one direction_lock. Use each fact at most once, and use as many confirmed facts as fit. Never invent a fact, a number, a colour or a word.
4. Where you can, put a lock on a different object from the one where its fact is seen (count the books to open the drawer).
5. "after" lists the numbers (1 = first puzzle) of earlier puzzles that must be finished first. Every puzzle except the last must appear in the "after" of a later puzzle.
6. Every puzzle except the last gives a reward item: a short name, one emoji, one sentence. The item should make sense for the puzzle that needs it. The last puzzle has no reward.
7. clue: at most two sentences, never contains the answer. blockedText: what the player reads when they try too early. solvedText: what happens when it is solved. hint1: a gentle nudge. hint2: says where to look, still without the answer.
8. descriptions: one short sentence in the tone above for every object. Do not reveal answers and do not contradict the facts.
9. title: 2 to 5 words. intro: 2 or 3 sentences on why the player is locked in. outro: 1 or 2 sentences.
${rejected?.length ? `\nYour previous design was rejected by the solver. Fix these problems:\n${rejected.map((r) => `- ${r}`).join("\n")}\n` : ""}`;
}

const S = { type: "STRING" };
export const PROPOSAL_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: S,
    intro: S,
    outro: S,
    puzzles: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          objectId: S,
          template: { type: "STRING", enum: [...TEMPLATES] },
          factIds: { type: "ARRAY", items: S },
          objectIds: { type: "ARRAY", items: S, nullable: true },
          after: { type: "ARRAY", items: { type: "INTEGER" } },
          reward: {
            type: "OBJECT",
            nullable: true,
            properties: { name: S, icon: S, description: S },
            required: ["name", "icon", "description"],
          },
          clue: S,
          blockedText: S,
          solvedText: S,
          hint1: S,
          hint2: S,
        },
        required: ["objectId", "template", "factIds", "after", "clue", "blockedText", "solvedText", "hint1", "hint2"],
      },
    },
    descriptions: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { objectId: S, text: S }, required: ["objectId", "text"] },
    },
  },
  required: ["title", "intro", "outro", "puzzles", "descriptions"],
};
