import { LOCK_COLORS } from "../game/schema.ts";

export const ANALYSIS_PROMPT = `You are the scout for an escape-room game that is built from photos of a real room.
You get four photos, one per wall, in the order North, East, South, West. Each photo is preceded by its wall letter.
Later steps will build puzzles from what you report, so a wrong detail makes the game impossible. Report only what you can clearly see. When in doubt, leave it out.

For each wall, list at most 8 objects a player could click on:
- Prefer large, distinct, easy-to-name things: furniture, doors, windows, shelves, posters, lamps, plants, boxes.
- Skip tiny, blurry, cut-off or heavily overlapping things, and skip people.
- label: 1-3 words, in English.
- box_2d: tight bounding box as [ymin, xmin, ymax, xmax], integers 0-1000 relative to that photo.
- description: one sentence a narrator would say when the player looks at it.
- confidence: 0-1, how sure you are of both the label and the box.
- can_hide: true if a small item could plausibly be hidden behind, under or inside it.
- can_open: true if it opens and closes, like a drawer, cabinet, wardrobe or box.
- is_door: true only for a door a person could leave the room through.

For each object, list facts a puzzle could rest on. Only include a fact when a careful person looking at the photo would get exactly the same answer:
- kind "count": a group of 2 to 9 clearly separate, fully visible items of one type on or in this object. value is the number as a digit. Say exactly what was counted, including colour if that is the distinction ("blue books on the middle shelf"). Never count things that are stacked, partly hidden, or more than 9.
- kind "color_order": 2 to 5 same-type items lined up in an obvious left-to-right order, each a clearly different colour. value is the colours left to right, comma-separated, using only: ${LOCK_COLORS.join(", ")}.
- kind "text": one printed word of 3 to 8 letters that is large and perfectly legible on this object. value is the word in capitals, letters only.
statement is one full English sentence stating the fact, including the value.
Most objects have no facts. That is expected.

Also list "sensitive" regions that should be blurred before the photo is shared: faces, photos of people, ID cards, documents or mail with readable personal details, screens showing personal content. Give box_2d and a short reason. If there are none, return an empty list.

Return all four walls.`;
