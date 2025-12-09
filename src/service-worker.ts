import { build, files, version } from '$service-worker';

const CACHE_NAME = `kb-suite-${version}`;
const ASSETS = new Set([...build, ...files]);

const addAssetsToCache = async () => {
	const cache = await caches.open(CACHE_NAME);
	await cache.addAll([...ASSETS]);
};

self.addEventListener('install', (event) => {
	event.waitUntil(addAssetsToCache());
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((keys) =>
			Promise.all(
				keys
					.filter((key) => key !== CACHE_NAME)
					.map((key) => caches.delete(key))
			)
		)
	);
	self.clients.claim();
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	const sameOrigin = url.origin === self.location.origin;
	if (!sameOrigin) return;

	const isAsset = ASSETS.has(url.pathname);
	if (!isAsset) return;

	event.respondWith(
		caches.open(CACHE_NAME).then(async (cache) => {
			const cached = await cache.match(request);
			if (cached) return cached;

			const response = await fetch(request);
			if (response.ok) {
				cache.put(request, response.clone());
			}
			return response;
		})
	);
});
