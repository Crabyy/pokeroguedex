// A tiny static evaluator for TypeScript data files.
//
// PokéRogue's game data is written as TypeScript object literals, enum references
// and builder chains (`new AttackMove(...).attr(...).target(...)`). Instead of
// regex-scraping (which breaks whenever formatting changes) we parse the source
// with the TypeScript compiler API and evaluate the *data-shaped* parts of it.
// Anything that isn't plain data (functions, class references, calls) is kept as
// a symbolic marker so callers can still inspect it.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** An identifier we could not resolve to a value (usually a class or function name). */
export class Ref {
  constructor(name) {
    this.name = name;
  }
}

/** `new Name(...args)` */
export class New {
  constructor(cls, args) {
    this.cls = cls;
    this.args = args;
  }
}

/** A call. `target` is set for method calls (`target.method(...args)`), `fn` for bare calls. */
export class Call {
  constructor({ fn, target, method, args }) {
    this.fn = fn;
    this.target = target;
    this.method = method;
    this.args = args;
  }
}

/** An arrow function / function expression — opaque. */
export class Fn {}

/** Something the evaluator does not model (conditional expressions, etc.). */
export class Unknown {
  constructor(kind) {
    this.kind = kind;
  }
}

/** `a.b(...).c(...)` → `{ base: <a>, calls: [{name:"b", args}, {name:"c", args}] }` */
export function flattenChain(value) {
  const calls = [];
  let cur = value;
  while (cur instanceof Call && cur.target !== undefined) {
    calls.unshift({ name: cur.method, args: cur.args });
    cur = cur.target;
  }
  return { base: cur, calls };
}

const IN_PROGRESS = Symbol("in-progress");

export class TsProject {
  /** @param {string} srcDir absolute path to the game's `src/` directory */
  constructor(srcDir) {
    this.srcDir = srcDir;
    /** rel path → { sf, consts: Map<name, node> } */
    this.files = new Map();
    /** enum name → { node, file, value? } */
    this.enumDecls = new Map();
    /** exported const name → [{ node, file }] */
    this.globalConsts = new Map();
    /** cache for evaluated top-level consts: `${file}::${name}` → value */
    this.constCache = new Map();
    this.enumCache = new Map();
    this.reverseEnumCache = new Map();
    this.indexAll();
  }

  indexAll() {
    const walk = dir => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) this.indexFile(full);
      }
    };
    walk(this.srcDir);
  }

  indexFile(full) {
    const rel = path.relative(this.srcDir, full).replaceAll("\\", "/");
    const sf = ts.createSourceFile(rel, readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const consts = new Map();
    for (const stmt of sf.statements) {
      if (ts.isEnumDeclaration(stmt)) {
        const name = stmt.name.text;
        // Prefer the canonical `src/enums/` definition if a name is declared twice.
        if (!this.enumDecls.has(name) || rel.startsWith("enums/")) this.enumDecls.set(name, { node: stmt, file: rel });
      } else if (ts.isVariableStatement(stmt)) {
        const exported = stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
        for (const decl of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
          consts.set(decl.name.text, decl.initializer);
          if (exported) {
            const list = this.globalConsts.get(decl.name.text) ?? [];
            list.push({ node: decl.initializer, file: rel });
            this.globalConsts.set(decl.name.text, list);
          }
        }
      }
    }
    this.files.set(rel, { sf, consts });
  }

  /** @returns {ts.SourceFile} */
  sourceFile(rel) {
    const entry = this.files.get(rel);
    if (!entry) throw new Error(`Source file not found: src/${rel}`);
    return entry.sf;
  }

  /** Lists indexed files under a directory prefix (e.g. "data/balance/biomes/"). */
  filesUnder(prefix) {
    return [...this.files.keys()].filter(f => f.startsWith(prefix)).sort();
  }

  // ---------------------------------------------------------------- enums

  /** @returns {Record<string, number|string>} member name → value */
  enumValues(name) {
    if (this.enumCache.has(name)) return this.enumCache.get(name);
    const decl = this.enumDecls.get(name);
    if (!decl) {
      // Some "enums" are `export const X = { A: 0, ... } as const` objects (e.g. BiomeId).
      const objs = this.globalConsts.get(name)?.filter(d => d.file.startsWith("enums/") || this.globalConsts.get(name).length === 1);
      if (objs?.length !== 1) return undefined;
      const value = this.evalConstNode(objs[0].node, objs[0].file, name);
      if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Ref) return undefined;
      this.enumCache.set(name, value);
      return value;
    }
    const values = {};
    this.enumCache.set(name, values); // allow self references while evaluating
    let next = 0;
    for (const member of decl.node.members) {
      const key = member.name.getText(decl.node.getSourceFile()).replace(/^["']|["']$/g, "");
      let value;
      if (member.initializer) {
        value = this.evaluate(member.initializer, decl.file, { enumScope: values });
      } else {
        value = next;
      }
      values[key] = value;
      if (typeof value === "number") next = value + 1;
    }
    return values;
  }

  /** value → member name */
  enumName(enumName, value) {
    let rev = this.reverseEnumCache.get(enumName);
    if (!rev) {
      rev = new Map();
      for (const [k, v] of Object.entries(this.enumValues(enumName) ?? {})) if (!rev.has(v)) rev.set(v, k);
      this.reverseEnumCache.set(enumName, rev);
    }
    return rev.get(typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value);
  }

  // --------------------------------------------------------------- consts

  /** Evaluates a top-level const by name, looking in `file` first, then exported globals. */
  resolveConst(name, file) {
    const local = this.files.get(file)?.consts.get(name);
    if (local) return this.evalConstNode(local, file, name);
    const globals = this.globalConsts.get(name);
    if (globals?.length === 1) return this.evalConstNode(globals[0].node, globals[0].file, name);
    return undefined;
  }

  evalConstNode(node, file, name) {
    const key = `${file}::${name}`;
    const cached = this.constCache.get(key);
    if (cached === IN_PROGRESS) return new Ref(name);
    if (this.constCache.has(key)) return cached;
    this.constCache.set(key, IN_PROGRESS);
    let value;
    try {
      value = this.evaluate(node, file);
    } catch {
      value = new Unknown("error");
    }
    this.constCache.set(key, value);
    return value;
  }

  /** Evaluates an exported/top-level const in a specific file. */
  constIn(file, name) {
    const node = this.files.get(file)?.consts.get(name);
    if (!node) throw new Error(`const ${name} not found in src/${file}`);
    return this.evalConstNode(node, file, name);
  }

  // ------------------------------------------------------------ evaluator

  /**
   * Evaluates an expression node into plain data (plus marker objects).
   * @param {ts.Node} node
   * @param {string} file relative file path, used for identifier resolution
   */
  evaluate(node, file, scope = {}) {
    const ev = n => this.evaluate(n, file, scope);
    const K = ts.SyntaxKind;

    switch (node.kind) {
      case K.NumericLiteral:
        return Number(node.text);
      case K.StringLiteral:
      case K.NoSubstitutionTemplateLiteral:
        return node.text;
      case K.TemplateExpression: {
        let out = node.head.text;
        for (const span of node.templateSpans) out += String(ev(span.expression)) + span.literal.text;
        return out;
      }
      case K.TrueKeyword:
        return true;
      case K.FalseKeyword:
        return false;
      case K.NullKeyword:
        return null;
      case K.UndefinedKeyword:
        return undefined;
      case K.ParenthesizedExpression:
      case K.AsExpression:
      case K.SatisfiesExpression:
      case K.TypeAssertionExpression:
      case K.NonNullExpression:
        return ev(node.expression);
      case K.PrefixUnaryExpression: {
        const v = ev(node.operand);
        if (typeof v !== "number" && typeof v !== "boolean") return new Unknown("prefix");
        switch (node.operator) {
          case K.MinusToken:
            return -v;
          case K.PlusToken:
            return +v;
          case K.TildeToken:
            return ~v;
          case K.ExclamationToken:
            return !v;
        }
        return new Unknown("prefix");
      }
      case K.BinaryExpression: {
        const l = ev(node.left);
        const r = ev(node.right);
        const bothNum = typeof l === "number" && typeof r === "number";
        switch (node.operatorToken.kind) {
          case K.PlusToken:
            return bothNum || typeof l === "string" || typeof r === "string" ? l + r : new Unknown("binary");
          case K.MinusToken:
            return bothNum ? l - r : new Unknown("binary");
          case K.AsteriskToken:
            return bothNum ? l * r : new Unknown("binary");
          case K.SlashToken:
            return bothNum ? l / r : new Unknown("binary");
          case K.LessThanLessThanToken:
            return bothNum ? l << r : new Unknown("binary");
          case K.BarToken:
            return bothNum ? l | r : new Unknown("binary");
          case K.AmpersandToken:
            return bothNum ? l & r : new Unknown("binary");
          case K.QuestionQuestionToken:
            return l ?? r;
        }
        return new Unknown("binary");
      }
      case K.ArrayLiteralExpression: {
        const out = [];
        for (const el of node.elements) {
          if (ts.isSpreadElement(el)) {
            const v = ev(el.expression);
            if (Array.isArray(v)) out.push(...v);
          } else {
            out.push(ev(el));
          }
        }
        return out;
      }
      case K.ObjectLiteralExpression: {
        const out = {};
        for (const prop of node.properties) {
          if (ts.isPropertyAssignment(prop)) {
            out[this.propertyKey(prop.name, file, scope)] = ev(prop.initializer);
          } else if (ts.isShorthandPropertyAssignment(prop)) {
            out[prop.name.text] = ev(prop.name);
          } else if (ts.isSpreadAssignment(prop)) {
            const v = ev(prop.expression);
            if (v && typeof v === "object") Object.assign(out, v);
          } else if (ts.isMethodDeclaration(prop) || ts.isGetAccessorDeclaration(prop)) {
            out[this.propertyKey(prop.name, file, scope)] = new Fn();
          }
        }
        return out;
      }
      case K.Identifier: {
        const name = node.text;
        if (name === "undefined") return undefined;
        if (scope.enumScope && Object.hasOwn(scope.enumScope, name)) return scope.enumScope[name];
        const c = this.resolveConst(name, file);
        if (c !== undefined) return c;
        const e = this.enumValues(name);
        if (e !== undefined) return e;
        return new Ref(name);
      }
      case K.PropertyAccessExpression: {
        const base = ev(node.expression);
        const prop = node.name.text;
        if (base instanceof Ref) return new Ref(`${base.name}.${prop}`);
        if (base && typeof base === "object" && !(base instanceof Unknown) && Object.hasOwn(base, prop)) return base[prop];
        if (Array.isArray(base) && prop === "length") return base.length;
        return new Ref(node.getText());
      }
      case K.ElementAccessExpression: {
        const base = ev(node.expression);
        const idx = ev(node.argumentExpression);
        if (base && typeof base === "object" && (typeof idx === "string" || typeof idx === "number")) return base[idx];
        return new Unknown("element");
      }
      case K.NewExpression:
        return new New(node.expression.getText(), (node.arguments ?? []).map(ev));
      case K.CallExpression: {
        const args = node.arguments.map(ev);
        const callee = node.expression;
        if (ts.isPropertyAccessExpression(callee)) {
          return new Call({ target: ev(callee.expression), method: callee.name.text, args });
        }
        return new Call({ fn: callee.getText(), args });
      }
      case K.ArrowFunction:
      case K.FunctionExpression:
        return new Fn();
      default:
        return new Unknown(K[node.kind]);
    }
  }

  propertyKey(nameNode, file, scope) {
    if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) return nameNode.text;
    if (ts.isComputedPropertyName(nameNode)) return String(this.evaluate(nameNode.expression, file, scope));
    return nameNode.getText();
  }
}

/** Depth-first search for nodes matching `predicate`. */
export function findNodes(root, predicate) {
  const out = [];
  const visit = node => {
    if (predicate(node)) out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return out;
}

export { ts };
