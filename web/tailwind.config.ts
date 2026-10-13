import type { Config } from 'tailwindcss';
export default { content: ['./src/**/*.{ts,tsx}'], theme: { extend: { colors: { monad: '#836EF9', ink: '#09090b' }, fontFamily: { mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] } } }, plugins: [] } satisfies Config;
