/**
 * リテラルな \uXXXX エスケープシーケンスを実際の Unicode 文字にデコードする。
 * LLM が MCP ツール引数で二重エスケープした Unicode を修正するために使用。
 */
export function unescapeUnicode(str: string): string {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}
