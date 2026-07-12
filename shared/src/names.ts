const ADJECTIVES = [
  "Turbo", "Rusty", "Sneaky", "Blazing", "Wobbly", "Grumpy", "Slick", "Nitro",
  "Feral", "Dizzy", "Rowdy", "Crispy", "Mad", "Lucky", "Sleepy", "Spicy",
  "Chrome", "Boosted", "Drifty", "Petty", "Rapid", "Cranky", "Shiny", "Loose",
];

const NOUNS = [
  "Badger", "Comet", "Piston", "Bumper", "Falcon", "Walrus", "Cabbie", "Gasket",
  "Mongoose", "Wombat", "Turbine", "Raccoon", "Viper", "Donut", "Muffler", "Otter",
  "Camshaft", "Pigeon", "Spoiler", "Ferret", "Dynamo", "Possum", "Clutch", "Hornet",
];

export function generateBotName(taken: Set<string>, rand: () => number = Math.random): string {
  const pick = (a: string[]) => a[Math.floor(rand() * a.length)];
  for (let i = 0; i < 50; i++) {
    const name = pick(ADJECTIVES) + pick(NOUNS);
    if (!taken.has(name)) return name;
  }
  const base = pick(ADJECTIVES) + pick(NOUNS);
  let n = 2;
  while (taken.has(base + n)) n++;
  return base + n;
}
