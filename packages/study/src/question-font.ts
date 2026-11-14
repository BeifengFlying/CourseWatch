import type { Frame } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createContext, Script } from 'node:vm';

export interface QuestionFontMap { ranges: number[][]; characters: Record<string, string>; }
interface FontFace { ranges: number[][]; source: string | null; }
const failure = () => new Error('题干或选项使用替换字体，但未能完整还原，已暂停；未调用模型或提交，请在官网核对');
const vendor = new URL(import.meta.url.endsWith('.ts') ? '../../../third_party/chaoxing-ai-assistant/vendor/font/' : '../../../../../third_party/chaoxing-ai-assistant/vendor/font/', import.meta.url);
let runtime: ReturnType<typeof createContext> | undefined;
let bundledTable: Record<string, number> | undefined;
const fonts = new Map<string, unknown>();

// Use the pinned Photopea Typr (MIT) already distributed with the upstream
// assistant. Only these local files run; page scripts/font bytes never run as
// JavaScript. The upstream decoder's glyph-path/MD5 convention is retained.
function fontRuntime() {
  if (!runtime) {
    const context = createContext({ TextDecoder }, { codeGeneration: { strings: false, wasm: false } });
    const source = ['Typr.js', 'Typr.U.js'].map(name => readFileSync(new URL(name, vendor), 'utf8')).join('\n');
    new Script('var window = globalThis;\n' + source, { filename: 'pinned-Typr.js' }).runInContext(context, { timeout: 1500 });
    runtime = context;
  }
  return runtime;
}

/** Missing glyphs use system fallback text; present but unmapped glyphs fail. */
export function decodeQuestionFont(bytes: Uint8Array, codes: number[], table?: Record<string, number>): Record<string, string> {
  try {
    if (bytes.length > 4 * 1024 * 1024 || codes.length > 24000) throw failure();
    const context = fontRuntime(), key = createHash('sha256').update(bytes).digest('hex');
    context.inputBytes = bytes;
    context.inputCodes = codes;
    context.inputFont = fonts.get(key);
    const result = new Script(`(() => {
      const font = inputFont || Typr.parse(Uint8Array.from(inputBytes))[0];
      if (!font || !font.cmap || !font.head) throw new Error('Unsupported font');
      return {font, shapes: inputCodes.map(code => {
        const glyph = Typr.U.codeToGlyph(font, code);
        return [code, glyph ? JSON.stringify(Typr.U.glyphToPath(font, glyph)) : null];
      })};
    })()`).runInContext(context, { timeout: 1500 }) as {font: unknown; shapes: [number, string | null][]};
    delete context.inputBytes; delete context.inputCodes; delete context.inputFont;
    if (!fonts.has(key)) {
      if (fonts.size >= 8) fonts.delete(fonts.keys().next().value!);
      fonts.set(key, result.font);
    }
    const mappings = table || (bundledTable ??= JSON.parse(readFileSync(new URL('table.json', vendor), 'utf8')));
    const characters: Record<string, string> = {};
    for (const [code, path] of result.shapes) {
      if (path === null) { characters[String(code)] = String.fromCodePoint(code); continue; }
      const target = Number(mappings[createHash('md5').update(path).digest('hex').slice(24)]);
      if (!Number.isInteger(target) || target <= 0 || target > 0x10ffff || target >= 0xd800 && target <= 0xdfff) throw failure();
      characters[String(code)] = String.fromCodePoint(target);
    }
    return characters;
  } catch { throw failure(); }
  finally { if (runtime) { delete runtime.inputBytes; delete runtime.inputCodes; delete runtime.inputFont; } }
}

// Read fonts actually used by question text. No DOM text, classes, saved
// answers or platform handlers are modified, so repeated validation is stable.
export async function readQuestionFontMaps(frame: Frame, selector: string, table?: Record<string, number>): Promise<QuestionFontMap[]> {
  const snapshot = await frame.evaluate(selector => {
    const roots = [...document.querySelectorAll(selector)].filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden'
      && !n.parentElement?.closest(selector) && !n.closest('.ans-videoquiz,.video-question,.quiz-overlay,[data-video-quiz],[data-video-quiz-root],.tkTopic'));
    const needed = new Set<number>();
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent || parent.closest('script,style,noscript,template,[hidden],[aria-hidden=true]:not(ul.Zy_ulTop)') || !parent.getClientRects().length || getComputedStyle(parent).visibility === 'hidden' || getComputedStyle(parent).fontSize === '0px') continue;
        let hidden = false;
        for (let element: Element | null = parent; element; element = element.parentElement) {
          if (getComputedStyle(element).opacity === '0') { hidden = true; break; }
        }
        if (hidden) continue;
        if (!/(?:^|,)\s*["']?font-cxsecret["']?\s*(?:,|$)/i.test(getComputedStyle(parent).fontFamily)) continue;
        for (const char of node.textContent || '') if (/[\u3400-\u9fff\ue000-\ufaff]/.test(char)) needed.add(char.codePointAt(0)!);
      }
    }
    if (!needed.size) return { faces: [], codes: [] };
    const faces: { ranges: number[][]; source: string | null }[] = [], seen = new Set<CSSStyleSheet>();
    function sheet(value: CSSStyleSheet) {
      if (seen.has(value) || value.disabled || value.media.mediaText && !matchMedia(value.media.mediaText).matches) return;
      seen.add(value);
      try { rules(value.cssRules); } catch { /* Unreadable secret resources fail below. */ }
    }
    function rules(values: CSSRuleList) {
      for (const rule of values) {
        if (rule instanceof CSSFontFaceRule) {
          const family = rule.style.fontFamily.replace(/["']/g, '').trim().toLowerCase();
          if (family !== 'font-cxsecret') continue;
          const ranges = (rule.style.getPropertyValue('unicode-range') || 'U+0-10FFFF').split(',').map(part => {
            const match = part.trim().match(/^U\+([a-f\d?]+)(?:-([a-f\d]+))?$/i);
            return match ? [parseInt(match[1].replace(/\?/g, '0'), 16), parseInt((match[2] || match[1]).replace(/\?/g, 'f'), 16)] : [];
          }).filter(range => range.length === 2);
          const source = rule.style.getPropertyValue('src').match(/url\(\s*(["']?)data:[^,]*;base64,([A-Za-z\d+/=\s]+)\1\s*\)/i)?.[2].replace(/\s/g, '') || null;
          faces.push({ ranges, source });
        } else if (rule instanceof CSSImportRule) {
          if (rule.styleSheet && (!rule.media.mediaText || matchMedia(rule.media.mediaText).matches)) sheet(rule.styleSheet);
        } else if ('cssRules' in rule) {
          if (rule instanceof CSSMediaRule && !matchMedia(rule.conditionText).matches) continue;
          if (rule instanceof CSSSupportsRule && !CSS.supports(rule.conditionText)) continue;
          rules((rule as CSSGroupingRule).cssRules);
        }
      }
    }
    for (const value of document.styleSheets) sheet(value);
    return { faces, codes: [...needed] };
  }, selector);
  if (!snapshot.codes.length) return [];
  const faces: FontFace[] = snapshot.faces;
  if (!faces.length) throw failure();
  const characters = new Map<FontFace, Record<string, string>>();
  for (const face of faces) {
    const codes = snapshot.codes.filter(code => face.ranges.some(([from, to]) => code >= from && code <= to));
    if (!codes.length) continue;
    if (!face.source || face.source.length > 6 * 1024 * 1024 || codes.some(code => new Set(faces.filter(f => f.ranges.some(([from,to]) => code >= from && code <= to)).map(f => f.source)).size !== 1)) throw failure();
    characters.set(face, decodeQuestionFont(Buffer.from(face.source, 'base64'), codes, table));
  }
  return faces.map(face => ({ranges: face.ranges, characters: characters.get(face) || {}}));
}
