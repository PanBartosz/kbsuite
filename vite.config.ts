import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		// allow any host header (behind reverse proxies) without hardcoding domains
		allowedHosts: true
	},
	preview: {
		allowedHosts: true
	}
});
