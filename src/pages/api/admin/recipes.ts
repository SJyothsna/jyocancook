import type { APIRoute } from 'astro';
import { recipes } from '../../../lib/data';

export const GET: APIRoute = async () => {
  return new Response(
    JSON.stringify({
      data: recipes,
      sha: 'local-dev-sha',
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json;charset=utf-8',
        'cache-control': 'no-store',
      },
    }
  );
};
