import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  build: {
    rollupOptions: {
      input: {
        index: 'src/index.ts',
        sw: 'src/sw.ts',
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: '[name].[hash].chunk.js',
        assetFileNames: assetInfo => {
          const name = assetInfo.name ?? '';
          if (name.endsWith('.css')) return 'index.css';
          return '[name].[ext]';
        },
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
    // Sourcemap 会导致输出源文件（如 dist/index.ts），这里关闭以保持扩展目录干净
    sourcemap: false,
    minify: mode === 'production',
    target: 'esnext',
  },
}));

