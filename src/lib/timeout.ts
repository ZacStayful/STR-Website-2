/**
 * Resolves with `fallback` when `promise` has not settled within `ms`. The
 * original promise keeps running (so a slow provider still fills its cache
 * for the next caller); only this caller stops waiting. A rejected promise
 * also resolves to the fallback so callers can treat both the same way.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T | (() => T)): Promise<T> {
  const fb = () => (typeof fallback === 'function' ? (fallback as () => T)() : fallback);
  return new Promise<T>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(fb());
    }, ms);
    promise.then(
      (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(fb());
      },
    );
  });
}
