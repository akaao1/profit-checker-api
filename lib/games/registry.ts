import type { GameAdapter, GameCode } from "./types";

const normalize = (value: string | null | undefined) =>
  String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/[\\s\\u3000]+/g, " ");

const pokemon: GameAdapter = {
  code: "pokemon",
  displayName: "Pokemon",
  adapterKey: "pokemon",
  enabled: true,
  collectionEnabled: true,
  normalizeVariant: (raw) => normalize(raw) || "NORMAL",
  normalizeCondition: (raw) => normalize(raw).toUpperCase() || "A",
  buildProductIdentity: ({ canonicalName, setCode, cardNumber, rarity, variantKey }) =>
    ["pokemon", canonicalName, setCode, cardNumber, rarity, variantKey || "NORMAL"].map(normalize).join("|"),
};

const disabled = (code: GameCode, displayName: string, adapterKey: string): GameAdapter => ({
  code,
  displayName,
  adapterKey,
  enabled: false,
  collectionEnabled: false,
  normalizeVariant: (raw) => normalize(raw) || "NORMAL",
  normalizeCondition: (raw) => normalize(raw) || "UNKNOWN",
  buildProductIdentity: ({ canonicalName, setCode, cardNumber, rarity, variantKey }) =>
    [code, canonicalName, setCode, cardNumber, rarity, variantKey || "NORMAL"].map(normalize).join("|"),
});

export const GAME_REGISTRY: Record<GameCode, GameAdapter> = {
  pokemon,
  one_piece: disabled("one_piece", "ONE PIECE", "one_piece"),
  yugioh: disabled("yugioh", "Yu-Gi-Oh!", "yugioh"),
  mtg: disabled("mtg", "Magic: The Gathering", "mtg"),
};

export const getGameAdapter = (code: string | null | undefined) =>
  GAME_REGISTRY[(code || "pokemon") as GameCode] ?? GAME_REGISTRY.pokemon;
