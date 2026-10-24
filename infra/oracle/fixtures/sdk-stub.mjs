// Public synthetic fixture only. No database, secrets, mail, ATS or filesystem.
import { createServer } from 'node:http';
createServer((request, response) => {
  const path = new URL(request.url, 'http://fixture.invalid').pathname;
  const route = path === '/jobs' ? 'stub-jobs' : path === '/auth/v1/health' ? 'stub-auth-health'
    : path === '/api/jobs/search' ? 'stub-maintenance' : 'stub-not-found';
  const status = route === 'stub-maintenance' ? 503 : route === 'stub-not-found' ? 404 : 200;
  response.writeHead(status, { 'Content-Type': path === '/jobs' ? 'text/html' : 'application/json',
    'X-Upstream-Route': route, 'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate' });
  response.end(path === '/jobs' ? '<html><body><h1>Find your next contract</h1></body></html>'
    : JSON.stringify({ route, path }));
}).listen(8081, '0.0.0.0');
