export type PaperSheetSubjectTheme = {
  id: string;
  color: string;
  accent: string;
  light: string;
  border: string;
  darkColor: string;
  darkAccent: string;
  darkLight: string;
  darkBorder: string;
};

export type PaperSheetSubjectTag = {
  key: string;
  label: string;
};

type SubjectKeywordRule = {
  key: string;
  patterns: string[];
};

const CANONICAL_SUBJECT_LABELS: Record<string, string> = {
  art: "Art",
  biology: "Biology",
  business: "Business",
  chemistry: "Chemistry",
  computer_science: "Computer Science",
  design: "Design",
  economics: "Economics",
  english: "English",
  geography: "Geography",
  general: "General",
  history: "History",
  languages: "Languages",
  mathematics: "Mathematics",
  music: "Music",
  physical_education: "Physical Education",
  physics: "Physics",
  politics: "Politics",
  psychology: "Psychology",
  religious_studies: "Religious Studies",
  science: "Science",
  sociology: "Sociology",
};

const SUBJECT_ALIASES: Record<string, string> = {
  bio: "biology",
  biological_science: "biology",
  biological_sciences: "biology",
  business_studies: "business",
  chem: "chemistry",
  computing: "computer_science",
  computer_science: "computer_science",
  cs: "computer_science",
  double_science: "science",
  econ: "economics",
  english_language: "english",
  english_literature: "english",
  french: "languages",
  german: "languages",
  maths: "mathematics",
  math: "mathematics",
  pe: "physical_education",
  phys: "physics",
  religious_education: "religious_studies",
  re: "religious_studies",
  spanish: "languages",
  triple_science: "science",
};

const SUBJECT_KEYWORD_RULES: SubjectKeywordRule[] = [
  {
    key: "computer_science",
    patterns: ["computer_science", "computing", "programming", "coding"],
  },
  { key: "biology", patterns: ["biology", "biological"] },
  { key: "chemistry", patterns: ["chemistry", "chemical"] },
  {
    key: "physical_education",
    patterns: ["physical_education", "sport", "fitness"],
  },
  { key: "physics", patterns: ["physics", "physical"] },
  { key: "mathematics", patterns: ["mathematics", "maths", "math"] },
  { key: "english", patterns: ["english"] },
  { key: "history", patterns: ["history"] },
  { key: "geography", patterns: ["geography"] },
  { key: "economics", patterns: ["economics", "economic"] },
  { key: "business", patterns: ["business"] },
  { key: "psychology", patterns: ["psychology", "psychological"] },
  { key: "sociology", patterns: ["sociology", "sociological"] },
  {
    key: "religious_studies",
    patterns: ["religious_studies", "religion", "theology"],
  },
  { key: "politics", patterns: ["politics", "government"] },
  { key: "languages", patterns: ["language", "french", "spanish", "german"] },
  { key: "design", patterns: ["design", "technology", "engineering"] },
  { key: "art", patterns: ["art"] },
  { key: "music", patterns: ["music"] },
  { key: "science", patterns: ["science"] },
];

export const PAPER_SHEET_SUBJECT_PALETTE: readonly PaperSheetSubjectTheme[] = [
  {
    id: "apple-blue",
    color: "#0057D9",
    accent: "#007AFF",
    light: "#EAF4FF",
    border: "#A7D2FF",
    darkColor: "#7CC2FF",
    darkAccent: "#0A84FF",
    darkLight: "#102E4F",
    darkBorder: "#1F5D9C",
  },
  {
    id: "apple-green",
    color: "#167A2F",
    accent: "#34C759",
    light: "#EAF8EE",
    border: "#A9E7B8",
    darkColor: "#8EF0A7",
    darkAccent: "#30D158",
    darkLight: "#12381E",
    darkBorder: "#2F7E43",
  },
  {
    id: "apple-purple",
    color: "#7A2FB0",
    accent: "#AF52DE",
    light: "#F6EBFB",
    border: "#DDB5F4",
    darkColor: "#E1B7FF",
    darkAccent: "#BF5AF2",
    darkLight: "#35194A",
    darkBorder: "#75419A",
  },
  {
    id: "apple-indigo",
    color: "#3F3BB5",
    accent: "#5856D6",
    light: "#EEEEFF",
    border: "#C1C0F6",
    darkColor: "#B7B6FF",
    darkAccent: "#5E5CE6",
    darkLight: "#232252",
    darkBorder: "#5452B8",
  },
  {
    id: "apple-teal",
    color: "#137D91",
    accent: "#30B0C7",
    light: "#E7F8FB",
    border: "#A9E5EF",
    darkColor: "#9DEEFF",
    darkAccent: "#40C8E0",
    darkLight: "#123943",
    darkBorder: "#2E8394",
  },
  {
    id: "apple-mint",
    color: "#007E78",
    accent: "#00C7BE",
    light: "#E5FAF8",
    border: "#A6EDE9",
    darkColor: "#A6FFF9",
    darkAccent: "#63E6E2",
    darkLight: "#0D3D3A",
    darkBorder: "#348F8A",
  },
  {
    id: "apple-pink",
    color: "#C71945",
    accent: "#FF2D55",
    light: "#FFF0F4",
    border: "#FFB3C4",
    darkColor: "#FFB3C4",
    darkAccent: "#FF375F",
    darkLight: "#4A1123",
    darkBorder: "#A4334D",
  },
  {
    id: "apple-red",
    color: "#C92A22",
    accent: "#FF3B30",
    light: "#FFF0EF",
    border: "#FFB0AB",
    darkColor: "#FFB0AB",
    darkAccent: "#FF453A",
    darkLight: "#4A1714",
    darkBorder: "#9F3832",
  },
  {
    id: "apple-orange",
    color: "#A65D00",
    accent: "#FF9500",
    light: "#FFF5E5",
    border: "#FFD093",
    darkColor: "#FFD08A",
    darkAccent: "#FF9F0A",
    darkLight: "#442B0A",
    darkBorder: "#9A681D",
  },
  {
    id: "apple-yellow",
    color: "#7A6500",
    accent: "#FFCC00",
    light: "#FFF9DB",
    border: "#FFE680",
    darkColor: "#FFE680",
    darkAccent: "#FFD60A",
    darkLight: "#3A3307",
    darkBorder: "#8A7817",
  },
  {
    id: "apple-gray",
    color: "#5C5C64",
    accent: "#8E8E93",
    light: "#F2F2F7",
    border: "#C7C7CC",
    darkColor: "#D1D1D6",
    darkAccent: "#98989D",
    darkLight: "#2C2C2E",
    darkBorder: "#636366",
  },
] as const;

const PALETTE_BY_ID = new Map(
  PAPER_SHEET_SUBJECT_PALETTE.map((theme) => [theme.id, theme]),
);

const SUBJECT_PALETTE_ID_BY_KEY: Record<string, string> = {
  art: "apple-pink",
  biology: "apple-green",
  business: "apple-yellow",
  chemistry: "apple-purple",
  computer_science: "apple-gray",
  design: "apple-teal",
  economics: "apple-yellow",
  english: "apple-pink",
  geography: "apple-teal",
  general: "apple-gray",
  history: "apple-orange",
  languages: "apple-red",
  mathematics: "apple-blue",
  music: "apple-pink",
  physical_education: "apple-red",
  physics: "apple-indigo",
  politics: "apple-red",
  psychology: "apple-mint",
  religious_studies: "apple-orange",
  science: "apple-mint",
  sociology: "apple-mint",
};

function slugifySubjectKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function resolveCanonicalSubjectLabel(key: string): string | null {
  return CANONICAL_SUBJECT_LABELS[key] ?? null;
}

function requirePalette(id: string): PaperSheetSubjectTheme {
  const palette = PALETTE_BY_ID.get(id);
  if (palette) {
    return palette;
  }
  return PAPER_SHEET_SUBJECT_PALETTE[0];
}

export function normalizePaperSheetSubjectKey(value: string): string {
  const slug = slugifySubjectKey(value);
  if (slug.length === 0) {
    return "general";
  }
  const exactAlias = SUBJECT_ALIASES[slug];
  if (exactAlias) {
    return exactAlias;
  }
  for (const rule of SUBJECT_KEYWORD_RULES) {
    for (const pattern of rule.patterns) {
      if (slug.includes(pattern)) {
        return rule.key;
      }
    }
  }
  return slug;
}

export function buildPaperSheetSubjectTag(label: string): PaperSheetSubjectTag {
  const trimmed = label.trim();
  const key = normalizePaperSheetSubjectKey(trimmed);
  return {
    key,
    label:
      resolveCanonicalSubjectLabel(key) ??
      (trimmed.length > 0 ? trimmed : titleCase(key)),
  };
}

export function resolvePaperSheetSubjectTheme(subject: {
  key?: string | null;
  label?: string | null;
}): PaperSheetSubjectTheme {
  const normalizedKey = normalizePaperSheetSubjectKey(
    subject.key ?? subject.label ?? "general",
  );
  const paletteId = SUBJECT_PALETTE_ID_BY_KEY[normalizedKey];
  if (paletteId) {
    return requirePalette(paletteId);
  }
  const fallbackIndex =
    hashString(normalizedKey) % PAPER_SHEET_SUBJECT_PALETTE.length;
  return (
    PAPER_SHEET_SUBJECT_PALETTE[fallbackIndex] ?? PAPER_SHEET_SUBJECT_PALETTE[0]
  );
}

export function resolvePaperSheetSubjectLabel(subject: {
  key?: string | null;
  label?: string | null;
}): string {
  const normalizedKey = normalizePaperSheetSubjectKey(
    subject.key ?? subject.label ?? "general",
  );
  const canonicalLabel = resolveCanonicalSubjectLabel(normalizedKey);
  if (canonicalLabel) {
    return canonicalLabel;
  }
  const label = subject.label?.trim();
  if (label && label.length > 0) {
    return label;
  }
  return titleCase(normalizedKey);
}

export function applyPaperSheetSubjectTheme<
  T extends {
    subject: string;
    title?: string | null;
    subtitle?: string | null;
    level?: string | null;
    color: string;
    accent: string;
    light: string;
    border: string;
  },
>(sheet: T): T {
  const subjectCue = [sheet.subject, sheet.title, sheet.subtitle, sheet.level]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0)
    .join(" ");
  const theme = resolvePaperSheetSubjectTheme({ label: subjectCue });
  if (
    sheet.color === theme.color &&
    sheet.accent === theme.accent &&
    sheet.light === theme.light &&
    sheet.border === theme.border
  ) {
    return sheet;
  }
  return {
    ...sheet,
    color: theme.color,
    accent: theme.accent,
    light: theme.light,
    border: theme.border,
  };
}
