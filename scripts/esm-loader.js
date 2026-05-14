// ESM loader for running React-app engine files in Node.js.
// The engine imports use extension-less specifiers (e.g. './constants') which
// are valid for webpack/CRA but not for raw Node.js ESM. This loader retries
// with a '.js' suffix when Node reports ERR_MODULE_NOT_FOUND.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (
      err.code === 'ERR_MODULE_NOT_FOUND' &&
      !specifier.endsWith('.js') &&
      (specifier.startsWith('./') || specifier.startsWith('../'))
    ) {
      return nextResolve(specifier + '.js', context);
    }
    throw err;
  }
}
