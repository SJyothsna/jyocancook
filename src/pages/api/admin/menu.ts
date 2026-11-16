import type { APIRoute } from 'astro';
import menu from '../../../../config/menu.json';

export const GET: APIRoute = async () => {
  return new Response(
    JSON.stringify({
      data: menu,
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
