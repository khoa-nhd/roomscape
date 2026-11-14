import type { GameDraft } from "../lib/game/schema.ts";

/**
 * Hand-written room used to build the engine before the AI pipeline exists.
 * The four walls are placeholder illustrations in /public/rooms/demo.
 * One puzzle per template, chained so that every step is required.
 */
export const demoRoom: GameDraft = {
  id: "demo",
  title: "The Study on Orion Street",
  theme: "detective",
  difficulty: 2,
  intro:
    "You wake up in an unfamiliar bedroom. The door is shut, and its keypad is dark. " +
    "Whoever locked you in left in a hurry: the room is full of things they forgot to hide.",
  outro: "The keypad chirps, the bolt slides back, and cool air rushes in from the hallway. You're out.",
  walls: [
    {
      id: "N",
      imageUrl: "/rooms/demo/n.svg",
      hotspots: [
        {
          id: "bookshelf",
          label: "Bookshelf",
          bbox: [0.125, 0.222, 0.325, 0.556],
          description: "A tall bookshelf. The middle shelf is packed with blue, red and green spines.",
        },
        {
          id: "door",
          label: "Door",
          bbox: [0.6875, 0.244, 0.225, 0.533],
          description: "A heavy door with an electronic keypad beside it.",
        },
      ],
    },
    {
      id: "E",
      imageUrl: "/rooms/demo/e.svg",
      hotspots: [
        {
          id: "drawer",
          label: "Desk drawer",
          bbox: [0.4375, 0.578, 0.175, 0.122],
          description: "A desk drawer with three coloured dials where the handle should be.",
        },
        {
          id: "poster",
          label: "Poster",
          bbox: [0.6875, 0.167, 0.1875, 0.422],
          description: "A star chart. Seven dots are joined into a hunter, with one word printed underneath.",
        },
        {
          id: "lamp",
          label: "Desk lamp",
          bbox: [0.2, 0.34, 0.1, 0.2],
          description: "A desk lamp. It still works, which is more than can be said for the door.",
        },
      ],
    },
    {
      id: "S",
      imageUrl: "/rooms/demo/s.svg",
      hotspots: [
        {
          id: "bed",
          label: "Bed",
          bbox: [0.156, 0.467, 0.625, 0.31],
          description: "A neatly made bed. The pillows are lined up along the headboard, each a different colour.",
        },
        {
          id: "nightstand",
          label: "Nightstand",
          bbox: [0.8125, 0.6, 0.125, 0.178],
          description: "A nightstand with a five-letter combination lock on its door.",
        },
      ],
    },
    {
      id: "W",
      imageUrl: "/rooms/demo/w.svg",
      hotspots: [
        {
          id: "window",
          label: "Window",
          bbox: [0.094, 0.167, 0.2625, 0.422],
          description: "Painted shut. Night outside, and a long way down.",
        },
        {
          id: "plant",
          label: "Potted plant",
          bbox: [0.39, 0.44, 0.11, 0.34],
          description: "A potted plant. The soil looks freshly disturbed.",
        },
        {
          id: "cabinet",
          label: "Cabinet",
          bbox: [0.594, 0.422, 0.225, 0.356],
          description: "A wooden cabinet with a small brass keyhole.",
        },
        {
          id: "frames",
          label: "Picture frames",
          bbox: [0.6, 0.14, 0.27, 0.24],
          description: "Picture frames hang above the cabinet, slightly crooked.",
        },
      ],
    },
  ],
  items: [
    { id: "brass_key", name: "Brass key", icon: "🗝️", description: "Small, old, and still gritty with soil." },
    {
      id: "dial",
      name: "Missing dial",
      icon: "⚙️",
      description: "A coloured dial that has been pulled off something. A note is taped to it: \"Left to right, the way you sleep.\"",
    },
    { id: "keycard", name: "Keycard", icon: "💳", description: "A blank white access card." },
    { id: "battery", name: "Battery pack", icon: "🔋", description: "Fully charged. Something in this room is missing it." },
  ],
  exitPuzzleId: "p_door",
  puzzles: [
    {
      id: "p_plant",
      template: "hidden_item",
      hotspotId: "plant",
      requires: { items: [], solved: [] },
      clue: "The soil has been dug up recently.",
      blockedText: "Nothing here yet.",
      solvedText: "You push your fingers into the soil and pull out a small brass key.",
      grounding: { hotspotIds: ["plant"], fact: "There is a potted plant on the west wall." },
      grants: { items: ["brass_key"] },
      hints: [
        "Not everything in this room sits in plain sight.",
        "Something on the west wall has been disturbed recently.",
        "Click the potted plant to dig in the soil.",
      ],
    },
    {
      id: "p_cabinet",
      template: "use_item",
      hotspotId: "cabinet",
      requires: { items: ["brass_key"], solved: [] },
      clue: "It needs a key.",
      blockedText: "The cabinet is locked. The keyhole is small and brass.",
      solvedText: "The brass key turns. Inside the cabinet is a single coloured dial with a note taped to it.",
      grounding: { hotspotIds: ["cabinet"], fact: "There is a cabinet on the west wall." },
      grants: { items: ["dial"] },
      hints: [
        "You are carrying something that opens something.",
        "The key is brass. So is one keyhole in this room.",
        "Select the brass key in your inventory, then click the cabinet.",
      ],
    },
    {
      id: "p_drawer",
      template: "color_seq",
      hotspotId: "drawer",
      requires: { items: ["dial"], solved: [] },
      lock: { kind: "colors", answer: "red,yellow,blue" },
      clue: "Three dials. \"Left to right, the way you sleep.\"",
      blockedText: "The drawer has three dial posts, but one dial is missing. It won't turn without it.",
      solvedText: "The dials click into place and the drawer slides open. A white keycard is inside.",
      grounding: { hotspotIds: ["bed"], fact: "The pillows on the bed are red, yellow, blue from left to right." },
      grants: { items: ["keycard"] },
      hints: [
        "The note talks about where you sleep.",
        "Look at the bed on the south wall. What is lined up on it, and in what colours?",
        "Set the dials to the pillow colours from left to right: red, yellow, blue.",
      ],
    },
    {
      id: "p_nightstand",
      template: "text_cipher",
      hotspotId: "nightstand",
      requires: { items: [], solved: [] },
      lock: { kind: "letters", answer: "ORION" },
      clue: "Five letters. Scratched above the lock: \"Name the hunter.\"",
      blockedText: "Nothing here yet.",
      solvedText: "The lock springs open. Inside the nightstand is a battery pack.",
      grounding: { hotspotIds: ["poster"], fact: "The poster on the east wall has the word ORION printed on it." },
      grants: { items: ["battery"] },
      hints: [
        "A hunter is watching you from one of the walls.",
        "The star chart on the east wall has a word printed on it.",
        "Enter ORION.",
      ],
    },
    {
      id: "p_door",
      template: "count_code",
      hotspotId: "door",
      requires: { items: ["keycard", "battery"], solved: [] },
      lock: { kind: "digits", answer: "532" },
      clue: "Three digits. A sticker on the keypad reads: \"Blue books. Pillows. Frames.\"",
      blockedText: "The keypad is dead. It has an empty battery bay and a slot for a card.",
      solvedText: "The keypad lights up green.",
      grounding: {
        hotspotIds: ["bookshelf", "bed", "frames"],
        fact: "There are 5 blue books on the shelf, 3 pillows on the bed and 2 picture frames.",
      },
      grants: { items: [] },
      hints: [
        "The sticker is a list of things to count.",
        "Count the blue books on the north wall, the pillows on the south wall and the frames on the west wall.",
        "Enter 532.",
      ],
    },
  ],
};
