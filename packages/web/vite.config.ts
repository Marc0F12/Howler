import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // En desarrollo la API la sirve el servidor de Howler; Vite solo recarga la web.
    proxy: { '/api': 'http://localhost:8420' },
  },
});
