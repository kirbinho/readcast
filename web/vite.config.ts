import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

/**
 * Sicherheitsregeln fürs Laden. GitHub Pages kann keine Header setzen, deshalb als Meta-Tag.
 * Skripte nur von der App selbst, Verbindungen nur zum Worker. Nur im Build, weil der Dev-Server Inline-Skripte braucht.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'readcast-csp',
    apply: 'build',
    transformIndexHtml() {
      const api = process.env.VITE_API_URL ? new URL(process.env.VITE_API_URL).origin : "'self'";
      const policy = [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' https://fonts.googleapis.com",
        'font-src https://fonts.gstatic.com',
        "img-src 'self' https: data:",
        `connect-src ${api}`,
        "manifest-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; ');
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }];
    },
  };
}

// Auf GitHub Pages liegt die App unter /<repository>/
export default defineConfig({
  base: process.env.READCAST_BASE ?? '/',
  plugins: [preact(), contentSecurityPolicy()],
  build: { target: 'es2022' },
});
