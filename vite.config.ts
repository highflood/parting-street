import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const root = import.meta.dirname;

// 진입점을 나눠 둔다. 줄 서기 페이지(index.html)는 three.js를 불러오지 않는다.
// M2에서 3D 거리를 street.html로 추가한다.
export default defineConfig({
  server: { port: 5174 },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        host: resolve(root, 'host.html'),
        privacy: resolve(root, 'privacy.html'),
      },
    },
  },
});
