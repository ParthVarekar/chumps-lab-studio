import http from 'node:http';
import type { AddressInfo } from 'node:net';
import handler from 'serve-handler';

/**
 * Serves a project folder over HTTP (with Range support, which video seeking needs) so renders can
 * read footage in place instead of Remotion copying it into the bundle.
 */
export const startMediaServer = async (root: string, port = 0) => {
	const server = http.createServer((req, res) => {
		res.setHeader('Access-Control-Allow-Origin', '*');
		void handler(req, res, { public: root, directoryListing: false, etag: true, cleanUrls: false });
	});
	await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
	const { port: actual } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${actual}/`,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
};
