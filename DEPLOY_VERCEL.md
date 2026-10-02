# Deploy na Vercel

1. Suba esta pasta para um repositório no GitHub.
2. Na Vercel: Add New → Project → importe o repositório (mantenha as configurações sugeridas).
3. Em Settings → Environment Variables, adicione:
   - SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY (valores no arquivo .env)
   - SKALE_API_KEY (chave da SkalePay)
   - ORDERS_API_SECRET (senha interna dos pedidos, enviada no chat)
4. Faça o Redeploy. Webhook SkalePay: https://SEU-DOMINIO/api/public/pix-webhook
