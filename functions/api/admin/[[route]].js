// Staff-only API.  URL: /api/admin/<me|stats|health|orders|order|action>   Every request must carry a valid staff login token.
import { guard, json, readJson, run, Fail } from '../../_lib/http.js';
import { requireStaff } from '../../_lib/admin-auth.js';
import * as A from '../../_lib/admin.js';
export async function onRequest({ request, env, params }) {
  const bad = guard(request, env); if (bad) return bad;
  const route = [].concat(params.route || []).join('/'), url = new URL(request.url), post = request.method === 'POST';
  if (request.method !== 'GET' && !post) return json(405, { error: 'Method not allowed.' });
  return run(async () => {
    const staff = await requireStaff(request, env, route === 'action' ? 'read' : 'read');   // 'action' re-checks write rights per action below
    switch (route) {
      case 'me': return json(200, A.me(staff, env));
      case 'health': return json(200, await A.health(env));
      case 'stats': return json(200, await A.stats(env, url.searchParams.get('days')));
      case 'orders': return json(200, await A.listOrders(env, url.searchParams));
      case 'order': return json(200, await A.orderDetail(env, staff, url.searchParams.get('id'), url.searchParams.get('reveal') === '1'));
      case 'action': if (!post) throw new Fail(405, 'Method not allowed.'); return json(200, await A.action(env, staff, await readJson(request)));
      default: throw new Fail(404, 'Not found.');
    }
  });
}
