const ADJECTIVES = ["Swift", "Bold", "Clever", "Brave", "Lucky", "Sneaky", "Mighty", "Chill"];
const NOUNS = ["Fox", "Bear", "Wolf", "Hawk", "Lynx", "Otter", "Raven", "Moose"];

/** Generates a random display name in the form `<Adjective><Noun><0-999>`. */
export function generateName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${adj}${noun}${num}`;
}
