const ADJECTIVES = ["Swift", "Bold", "Clever", "Brave", "Lucky", "Sneaky", "Mighty", "Chill"];
const NOUNS = ["Fox", "Bear", "Wolf", "Hawk", "Lynx", "Otter", "Raven", "Moose"];

export function generateName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${adj}${noun}${num}`;
}
