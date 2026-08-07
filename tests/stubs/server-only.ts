/**
 * Test stub for the `server-only` package.
 *
 * `server-only` throws unless the bundler resolves its "react-server"
 * condition, which Vitest's Node resolver does not apply. Aliasing it to this
 * empty module lets server modules be unit-tested directly. The real guard
 * still applies in the Next.js build, which is where it matters.
 */
export {};
