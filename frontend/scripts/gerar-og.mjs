// Gera, pós-build, uma página estática por empreendimento com meta tags Open
// Graph/Twitter Card corretas (título, descrição, foto) — pra quando alguém
// compartilha o link do catálogo no WhatsApp aparecer uma prévia de verdade
// em vez do link "pelado". Isso não dá pra fazer só com React: o WhatsApp (e
// Facebook, Instagram, etc.) não executa JavaScript ao gerar a prévia, só lê
// o HTML puro — então o <title>/meta que o React troca depois de montar nunca
// chega a ser visto por eles.
//
// Cada arquivo gerado é uma cópia do dist/index.html final (mesmos scripts/CSS
// já com hash), só com o <head> trocado — então quem realmente clicar no link
// recebe o app funcionando normalmente, só quem faz o scraping de prévia é
// que vê a versão estática. O roteamento pra esses arquivos é feito no
// vercel.json (rewrite de /condominios/<slug> pra /og/<slug>.html).
//
// Busca os dados (nome, descrição, foto) na API pública em tempo de build —
// se a API estiver fora do ar nesse momento, o build principal não é afetado:
// só a geração da prévia é pulada (fica valendo o og gerado no build anterior,
// se a Vercel reaproveitar o output, ou nenhum, caindo de volta pro
// comportamento padrão do index.html).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");
const API_URL = process.env.VITE_API_URL || "https://rancho-porto-sistema.onrender.com";
const SITE_URL = process.env.SITE_URL || "https://rancho-porto-frontend.vercel.app";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** WhatsApp/Facebook não resolvem URL relativa em og:image — precisa ser
 * absoluta. A API em produção já devolve URL absoluta (storage do Supabase),
 * mas isso cobre qualquer valor relativo (ex.: rodando contra o mock local). */
function absolutizar(url) {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `${SITE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function main() {
  const indexPath = path.join(DIST, "index.html");
  if (!fs.existsSync(indexPath)) {
    console.warn("[og] dist/index.html não existe (build não rodou?) — pulando geração de prévias.");
    return;
  }
  const baseHtml = fs.readFileSync(indexPath, "utf8");

  let condos = [];
  try {
    const resp = await fetch(`${API_URL}/condominios`, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    condos = await resp.json();
  } catch (err) {
    console.warn(`[og] não consegui buscar ${API_URL}/condominios (${err.message}) — build segue sem gerar prévias novas.`);
    return;
  }

  if (!Array.isArray(condos) || condos.length === 0) {
    console.warn("[og] API não retornou nenhum empreendimento — nada pra gerar.");
    return;
  }

  const outDir = path.join(DIST, "og");
  fs.mkdirSync(outDir, { recursive: true });

  for (const c of condos) {
    if (!c.slug) continue;
    const titulo = `${c.nome} | Castel Construções e Incorporações`;
    const descricao = c.descricao || [c.segmento, c.cidade].filter(Boolean).join(" · ") || "Catálogo de lotes";
    const imagem = absolutizar(c.hero_image_url) || absolutizar(c.logo_url) || `${SITE_URL}/brand/castel-logo.png`;
    const url = `${SITE_URL}/condominios/${c.slug}`;

    const metaTags = `
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(titulo)}" />
    <meta property="og:description" content="${escapeHtml(descricao)}" />
    <meta property="og:image" content="${escapeHtml(imagem)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(titulo)}" />
    <meta name="twitter:description" content="${escapeHtml(descricao)}" />
    <meta name="twitter:image" content="${escapeHtml(imagem)}" />
  </head>`;

    let html = baseHtml.replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(titulo)}</title>`);
    html = html.replace("</head>", metaTags);

    fs.writeFileSync(path.join(outDir, `${c.slug}.html`), html);
    console.log(`[og] gerado dist/og/${c.slug}.html`);
  }
}

main();
