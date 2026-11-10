/**
 * A tiny arithmetic expression language for animated elements. No `eval`, no property access, no loops:
 * numbers, names from the environment, + - * / % ^, comparisons, parentheses and a fixed set of functions.
 * Angles are in DEGREES (sin(90) = 1) because rotations and arcs are written in degrees.
 *
 *   =-120 + value / max * 240          =cx + r * cos(i * 30)          =if(value > 80, 1, 0.4)
 *
 * Functions: sin cos tan abs min max pow sqrt floor ceil round clamp(x,a,b) mix(a,b,t) step(edge,x) mod(a,b) if(c,a,b)
 * Names: pi, plus whatever the caller passes (params, i, n, t).
 */

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };
type Ast =
	| { t: 'num'; v: number }
	| { t: 'id'; v: string }
	| { t: 'un'; op: string; a: Ast }
	| { t: 'bin'; op: string; a: Ast; b: Ast }
	| { t: 'call'; f: string; args: Ast[] };

const FUNCS: Record<string, (...a: number[]) => number> = {
	sin: (d) => Math.sin((d * Math.PI) / 180),
	cos: (d) => Math.cos((d * Math.PI) / 180),
	tan: (d) => Math.tan((d * Math.PI) / 180),
	abs: Math.abs,
	min: Math.min,
	max: Math.max,
	pow: Math.pow,
	sqrt: Math.sqrt,
	floor: Math.floor,
	ceil: Math.ceil,
	round: Math.round,
	clamp: (x, a, b) => Math.min(Math.max(x, a), b),
	mix: (a, b, t) => a + (b - a) * t,
	step: (e, x) => (x >= e ? 1 : 0),
	mod: (a, b) => (b === 0 ? 0 : ((a % b) + b) % b),
	if: (c, a, b) => (c ? a : b),
	// eased 0..1 progress: ease((t - start) / seconds). The curve is the house ease-out (fast, then settling).
	ease: (x) => { const u = Math.min(1, Math.max(0, x)); return u >= 1 ? 1 : 1 - Math.pow(2, -10 * u); },
	smooth: (x) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); },
};
export const FUNCTION_NAMES = Object.keys(FUNCS);
const CONSTS: Record<string, number> = { pi: Math.PI };
/** Own properties only: `'constructor' in {}` is true, and an expression must never reach inherited members. */
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function tokenize(src: string): Tok[] {
	const out: Tok[] = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
		if (/[0-9.]/.test(c)) {
			let j = i;
			while (j < src.length && /[0-9.]/.test(src[j])) j++;
			const v = Number(src.slice(i, j));
			if (!Number.isFinite(v)) throw new Error(`bad number "${src.slice(i, j)}"`);
			out.push({ k: 'num', v });
			i = j;
			continue;
		}
		if (/[a-zA-Z_]/.test(c)) {
			let j = i;
			while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
			out.push({ k: 'id', v: src.slice(i, j) });
			i = j;
			continue;
		}
		const two = src.slice(i, i + 2);
		if (['<=', '>=', '==', '!='].includes(two)) { out.push({ k: 'op', v: two }); i += 2; continue; }
		if ('+-*/%^(),<>'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
		throw new Error(`unexpected "${c}"`);
	}
	return out;
}

const PREC: Record<string, number> = { '<': 1, '>': 1, '<=': 1, '>=': 1, '==': 1, '!=': 1, '+': 2, '-': 2, '*': 3, '/': 3, '%': 3, '^': 5 };

function parse(src: string): Ast {
	const toks = tokenize(src);
	let p = 0;
	const peek = () => toks[p];
	const next = () => toks[p++];
	const expectOp = (v: string) => {
		const t = next();
		if (!t || t.k !== 'op' || t.v !== v) throw new Error(`expected "${v}"`);
	};
	function primary(): Ast {
		const t = next();
		if (!t) throw new Error('unexpected end');
		if (t.k === 'num') return { t: 'num', v: t.v };
		if (t.k === 'id') {
			const n = peek();
			if (n && n.k === 'op' && n.v === '(') {
				next();
				const args: Ast[] = [];
				if (!(peek() && peek().k === 'op' && (peek() as { v: string }).v === ')')) {
					for (;;) {
						args.push(expr(0));
						const s = peek();
						if (s && s.k === 'op' && s.v === ',') { next(); continue; }
						break;
					}
				}
				expectOp(')');
				if (!own(FUNCS, t.v)) throw new Error(`unknown function ${t.v}()`);
				return { t: 'call', f: t.v, args };
			}
			return { t: 'id', v: t.v };
		}
		if (t.v === '(') { const e = expr(0); expectOp(')'); return e; }
		if (t.v === '-' || t.v === '+') return { t: 'un', op: t.v, a: expr(4) };
		throw new Error(`unexpected "${t.v}"`);
	}
	function expr(minPrec: number): Ast {
		let left = primary();
		for (;;) {
			const t = peek();
			if (!t || t.k !== 'op' || !own(PREC, t.v) || PREC[t.v] < minPrec) break;
			next();
			const prec = PREC[t.v];
			const right = expr(t.v === '^' ? prec : prec + 1);
			left = { t: 'bin', op: t.v, a: left, b: right };
		}
		return left;
	}
	const ast = expr(0);
	if (p < toks.length) throw new Error(`unexpected "${(toks[p] as { v: string | number }).v}"`);
	return ast;
}

const cache = new Map<string, Ast>();
const compile = (src: string): Ast => {
	let a = cache.get(src);
	if (!a) {
		a = parse(src);
		if (cache.size > 2000) cache.clear();
		cache.set(src, a);
	}
	return a;
};

function run(a: Ast, env: Record<string, number>): number {
	switch (a.t) {
		case 'num': return a.v;
		case 'id': {
			if (own(env, a.v)) return env[a.v];
			if (own(CONSTS, a.v)) return CONSTS[a.v];
			throw new Error(`unknown name "${a.v}"`);
		}
		case 'un': return a.op === '-' ? -run(a.a, env) : run(a.a, env);
		case 'call': return FUNCS[a.f](...a.args.map((x) => run(x, env)));
		case 'bin': {
			const x = run(a.a, env);
			const y = run(a.b, env);
			switch (a.op) {
				case '+': return x + y;
				case '-': return x - y;
				case '*': return x * y;
				case '/': return y === 0 ? 0 : x / y;
				case '%': return y === 0 ? 0 : x % y;
				case '^': return Math.pow(x, y);
				case '<': return x < y ? 1 : 0;
				case '>': return x > y ? 1 : 0;
				case '<=': return x <= y ? 1 : 0;
				case '>=': return x >= y ? 1 : 0;
				case '==': return x === y ? 1 : 0;
				default: return x !== y ? 1 : 0;
			}
		}
	}
}

/** Evaluate an expression string (without the leading "="). Throws on any problem. */
export const evalExpr = (src: string, env: Record<string, number>): number => run(compile(src), env);

/** Names an expression uses that are not functions or constants (to check them against the declared parameters). */
export function exprNames(src: string): string[] {
	const out = new Set<string>();
	const walk = (a: Ast) => {
		if (a.t === 'id' && !own(CONSTS, a.v)) out.add(a.v);
		else if (a.t === 'un') walk(a.a);
		else if (a.t === 'bin') { walk(a.a); walk(a.b); }
		else if (a.t === 'call') a.args.forEach(walk);
	};
	walk(compile(src));
	return [...out];
}
