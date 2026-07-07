# Pendências conhecidas — Dashboard Salto para o Dólar

Documento para retomar os consertos em uma nova sessão do Claude. Cada item traz
sintoma, causa raiz (com a evidência de como foi diagnosticada), o que já foi
feito e o que falta. Última atualização: 2026-07-07.

Contexto do projeto: Next.js 16 (App Router, Turbopack), deploy na Vercel
(projeto `dash-clarisse`, produção em https://dash-clarisse.vercel.app). Dados
vêm direto da API da Meta (Graph v21.0) — o cache Supabase está **desligado de
propósito** (envs comentadas no `.env`; código é tolerante à ausência, ver
`src/lib/supabase/server.ts`).

---

## 1. Vídeos dos criativos não tocam no dashboard

**Sintoma:** na tela Criativos, anúncios de vídeo mostram só o thumbnail
estático. O `<video>` nunca renderiza porque `videoUrl` chega `null`.

**Causa raiz (confirmada por teste na API):** o `META_ACCESS_TOKEN` foi gerado
pelo usuário **José Henrique**, que tem as permissões certas
(`pages_read_engagement`, `pages_show_list` — ambas granted), mas **não tem
acesso à página do Salto para o Dólar** (page id `1243500929151910`).
`GET /me/accounts` com o token lista 14 páginas e a do Salto não está entre
elas. Por isso `GET /{video_id}?fields=source` responde:

```
(#10) Application does not have permission for this action
```

Os insights funcionam porque pertencem à conta de anúncios
(`act_157462522621038`), não à página. O vídeo pertence à página.

**Paliativo já no ar:** quando `tipo === 'vídeo'` e `videoUrl == null`, o
preview mostra um play "Assistir no Instagram ↗" usando o `permalinkUrl`
(ver `MediaPreview` em `src/app/dashboard/criativo/AnaliseCriativos.tsx`).

**Conserto definitivo (fora do código):**
1. Um admin do BM onde a página está: Configurações do negócio → Contas →
   Páginas → Salto para o Dólar → Pessoas → adicionar **José Henrique** com
   acesso de **Conteúdo**. (Se a página estiver no BM da Clarisse, ela faz
   isso — ou adiciona o José Henrique direto em Configurações da página →
   Acesso à página.)
2. Gerar um `META_ACCESS_TOKEN` **novo** com o login do José Henrique,
   marcando a página Salto para o Dólar na tela de autorização (a seleção de
   páginas fica gravada no token no momento da criação — o token atual não
   passa a ver a página sozinho).
3. Atualizar `META_ACCESS_TOKEN` no `.env` local **e** na Vercel
   (Settings → Environment Variables → Redeploy).

**Como verificar que resolveu:**
```bash
TOKEN=<token novo>
# a página 1243500929151910 deve aparecer aqui:
curl -s "https://graph.facebook.com/v21.0/me/accounts?fields=id,name&access_token=$TOKEN"
# e este call deve devolver "source" em vez de erro #10
# (pegar um video_id em act_157462522621038/ads?fields=creative{video_id}):
curl -s "https://graph.facebook.com/v21.0/<video_id>?fields=source&access_token=$TOKEN"
```
Nenhuma mudança de código é necessária — com `source` vindo, o `<video>` volta
sozinho e o fallback do Instagram some.

---

## 2. Vendas (compras/ROAS) por localização sempre zeradas

**Sintoma:** no mapa "Distribuição geográfica" (tela Tendências), selecionar
Compras ou ROAS deixa o mapa apagado, tudo zero.

**Causa raiz (confirmada por teste na API):** limitação da Meta, sem contorno.
Desde o iOS 14 a Meta **não divulga conversões de pixel por região** — com
`breakdowns=region`, estados como São Paulo vêm com spend/cliques/video_view
mas zero ações de compra, enquanto o nível de conta reporta 56 compras no
mesmo período. Não é bug do dashboard.

**Já no ar:** aviso no card do mapa quando a métrica é compras/ROAS e tudo é
zero, sugerindo usar Investimento ou CTR (que funcionam por estado).

**Melhoria possível (feature nova, não conserto):** vendas por localização
reais viriam do checkout — a Hubla tem endereço/CEP dos compradores
(`src/lib/gateway/hubla.ts` já integra faturamento). Cruzar compras da Hubla
com o mapa daria o dado que a Meta esconde.

---

## 3. `npm run dev` falha — "Another next dev server is already running"

**Sintoma:** ao rodar `npm run dev`, o Next acusa outro dev server ativo e
sai, mesmo sem nenhum rodando de verdade:

```
⨯ Another next dev server is already running.
- PID: <pid>
- Log: .next/dev/logs/next-development.log
Run kill <pid> to stop it.
```

**Causa raiz:** lock órfão em `.next/dev/lock` — fica para trás quando um dev
server anterior morre sem limpar (aconteceu nesta máquina quando o processo
foi morto durante os testes). O PID mostrado pode nem existir mais.

**Conserto:**
```bash
kill <pid> 2>/dev/null; rm -rf .next/dev
npm run dev
```
Se o erro persistir, `rm -rf .next` inteiro resolve (o build local se refaz).

**Nota sobre Node:** o Next 16 exige Node >= 20.9. Nesta máquina está o
v25.8.1 e funciona; se noutra máquina o `npm run dev` falhar com erro de
versão/sintaxe, atualizar o Node é o conserto.

---

## 4. Dashboard é público (sem autenticação)

**Sintoma/risco:** qualquer pessoa com o link `dash-clarisse.vercel.app` vê os
dados de tráfego da cliente. Hoje é aceitável (link só circula entre time e
cliente), mas é dívida.

**Contexto importante:** o `middleware.ts` que existia era um stub vazio de
auth e foi **removido** — o bundle Edge dele referenciava `__dirname` e
derrubava todas as rotas na Vercel (500 `MIDDLEWARE_INVOCATION_FAILED`).
Quando a auth entrar, criar como `proxy.ts` (convenção do Next 16) com
runtime Node, ou proteger via layout do dashboard. Não recriar o middleware
vazio.

**Caminho sugerido quando for a hora:** senha única simples (env var +
cookie) ou Supabase Auth (reativar as envs comentadas do `.env`).

---

## 5. Itens menores / dívidas

- **Modo escuro desligado:** `src/contexts/ThemeContext.tsx` força `light`
  (o tema creme do design system Salto). A variante escura oliva-negro já
  está pronta nos mapas DARK/LIGHT e no `globals.css`; religar = ler
  localStorage no useEffect e reexpor o toggle (Sidebar/Configurações).
- **Cron sem efeito:** `/api/cron/sync-meta` (6h diário, vercel.json) responde
  `skipped` enquanto o Supabase estiver desligado. Esperado, não é bug.
- **Fontes via CDN:** Fraunces (Google Fonts) e Satoshi (Fontshare) carregam
  por `<link>` no `src/app/layout.tsx`. NÃO mover para `@import url()` no
  `globals.css` — o parser CSS do Turbopack rejeita imports depois do
  `@import "tailwindcss"` expandido e derruba o dev server.
- **`framework: "nextjs"` no `vercel.json` é obrigatório:** o projeto na
  Vercel foi importado sem framework preset (`framework: null`) e sem essa
  linha todas as rotas respondem 404 NOT_FOUND mesmo com build verde.
  Alternativa definitiva: setar o preset no painel da Vercel
  (Settings → Build and Deployment → Framework Preset → Next.js).

---

## Prompt sugerido para retomar

> Leia docs/PENDENCIAS.md. Acabei de conseguir o token novo da Meta com acesso
> à página do Salto (item 1): troque o META_ACCESS_TOKEN no .env, rode os
> testes de verificação do item 1 e confirme que os vídeos voltaram na tela
> Criativos (local e produção — lembre de me pedir para atualizar a env na
> Vercel antes do redeploy). Aproveite e conserte o item 3 se o npm run dev
> reclamar de outro server rodando.
