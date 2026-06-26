export interface EditorModuleSpecifier {
  readonly specifier: string;
  readonly from: number;
  readonly to: number;
}

const STRING_LITERAL_PATTERN = /(["'`])((?:\\.|(?!\1).)*)\1/g;

export function moduleSpecifierAtLine(
  lineText: string,
  lineFrom: number,
  position: number,
): EditorModuleSpecifier | null {
  const column = Math.max(0, Math.min(lineText.length, position - lineFrom));
  STRING_LITERAL_PATTERN.lastIndex = 0;

  for (;;) {
    const match = STRING_LITERAL_PATTERN.exec(lineText);
    if (!match) {
      return null;
    }

    const literalStart = match.index;
    const specifierStart = literalStart + 1;
    const specifierEnd = specifierStart + match[2].length;
    if (column < specifierStart || column > specifierEnd) {
      continue;
    }
    if (!isImportSpecifierContext(lineText.slice(0, literalStart))) {
      continue;
    }

    return {
      specifier: match[2],
      from: lineFrom + specifierStart,
      to: lineFrom + specifierEnd,
    };
  }
}

function isImportSpecifierContext(prefix: string): boolean {
  const compact = prefix.trimEnd();
  return (
    /\bfrom\s*$/.test(compact) ||
    /\bimport\s*(?:\(\s*)?$/.test(compact) ||
    /\brequire\s*\(\s*$/.test(compact)
  );
}
