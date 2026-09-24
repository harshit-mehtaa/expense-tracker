/**
 * Executing user-supplied regular expressions without letting one hang the process.
 *
 * JS regexes backtrack, so a pattern like `^(a|aa)+$` can take effectively forever on a
 * short input (ReDoS), and V8 offers no per-regex timeout. Running the match inside a
 * `vm` script with `timeout` gets one: the watchdog interrupts the isolate even while
 * it is inside the (main-realm) RegExp engine. Verified on Node 20 in the backend image
 * and inside Vitest's worker threads.
 *
 * What this does NOT do: it bounds each call, it doesn't make the call asynchronous —
 * the event loop is still blocked for up to `timeoutMs`. Callers must also bound how
 * many calls they make (see categoryRuleService's time budget). And `vm` is not a
 * security sandbox; it is safe here only because the script is a constant — user input
 * reaches `new RegExp`, never code.
 */
import vm from 'node:vm';
import { AppError } from './AppError';

// Only `i`. `g`/`y` make `.test()` stateful via lastIndex; `u` rejects common escapes
// like `\-` that users type expecting them to work.
const FLAGS = 'i';

// `/swiggy/i` — someone pasting a JS regex literal. Deliberately narrow: UPI narrations
// are slash-delimited ("UPI/P2M/…/SWIGGY/"), so a bare `/swiggy/` is allowed, and so is
// `/upi/.*/gym` — its tail only LOOKS like flags. A literal has no unescaped `/` inside.
const REGEX_LITERAL_WITH_FLAGS = /^\/[^/]+\/[dgimsuyv]+$/;

const context = vm.createContext({});
const script = new vm.Script('__results = __texts.map((t) => __re.test(t));');

/** Validate and compile a pattern a user is saving. Throws a 400 AppError on rejection. */
export function compileUserPattern(pattern: string): RegExp {
  if (REGEX_LITERAL_WITH_FLAGS.test(pattern)) {
    throw AppError.badRequest(
      'Enter the pattern without the surrounding slashes and flags — matching is already case-insensitive',
    );
  }

  let re: RegExp;
  try {
    re = new RegExp(pattern, FLAGS);
  } catch (err) {
    // V8's SyntaxError already reads "Invalid regular expression: /…/i: <reason>".
    throw AppError.badRequest((err as Error).message);
  }

  // A typo guard (`.*`, `a*`), not a catch-all guard: `.` or `\w` still match every
  // non-empty description, and that's a legitimate "everything else" rule.
  // Testing '' directly is safe — no pattern backtracks catastrophically on empty input.
  if (re.test('')) {
    throw AppError.badRequest('This pattern matches empty text, so it would match every transaction');
  }

  return re;
}

/** Compile an already-stored pattern. Never throws: a pattern that no longer compiles → null. */
export function compileStoredPattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, FLAGS);
  } catch {
    return null;
  }
}

/**
 * Test `re` against every text within `timeoutMs`. Returns one boolean per text, or why
 * it couldn't: 'timeout' (the watchdog fired) or 'error' (anything else). Never throws —
 * a bad rule must not take down the request.
 */
export function testAllWithTimeout(
  re: RegExp,
  texts: string[],
  timeoutMs: number,
): boolean[] | 'timeout' | 'error' {
  context.__re = re;
  context.__texts = texts;
  let results: boolean[] | 'timeout' | 'error';
  try {
    script.runInContext(context, { timeout: timeoutMs });
    // The array was created in the vm realm — copy it into this one.
    results = Array.from(context.__results as boolean[]);
  } catch (err) {
    results = (err as NodeJS.ErrnoException).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? 'timeout' : 'error';
  }
  // Don't keep the last batch of descriptions alive on the module-level context.
  delete context.__re;
  delete context.__texts;
  delete context.__results;
  return results;
}
