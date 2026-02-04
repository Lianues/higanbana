// Environment / URLs
//
// NOTE: 不使用 `new URL('.', import.meta.url)`，Vite 会把它错误重写成指向 `/index.ts` 的绝对路径并把源文件输出到 dist。
export const extensionBase = String(import.meta.url).replace(/[^/]*$/, '');

export const swUrl = `${extensionBase}sw.js`;

