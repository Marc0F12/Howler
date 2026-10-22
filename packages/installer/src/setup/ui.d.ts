// Archivos que esbuild mete dentro del instalador como texto o como bytes.
declare module '*.html' { const text: string; export default text; }
declare module '*.css' { const text: string; export default text; }
declare module '*.txt' { const text: string; export default text; }
declare module '*.woff2' { const bytes: Uint8Array; export default bytes; }
declare module '*.png' { const bytes: Uint8Array; export default bytes; }
declare module '*/LICENSE' { const text: string; export default text; }
