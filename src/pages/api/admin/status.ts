import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  return new Response(
    JSON.stringify({
      ok: true,
      user: {
        id: '12345678',
        login: 'jyocancook-admin',
        name: 'JyoCanCook Admin',
      },
      localDev: true,
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
