export type GameCode = "pokemon" | "one_piece" | "yugioh" | "mtg";

export type GameAdapter = {
  code: GameCode;
  displayName: string;
  adapterKey: string;
  enabled: boolean;
  collectionEnabled: boolean;
  normalizeVariant: (raw: string | null | undefined) => string;
  normalizeCondition: (raw: string | null | undefined) => string;
  buildProductIdentity: (input: {
    canonicalName: string;
    setCode?: string | null;
    cardNumber?: string | null;
    rarity?: string | null;
    variantKey?: string | null;
  }) => string;
};
