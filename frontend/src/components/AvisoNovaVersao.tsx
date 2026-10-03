import { useEffect, useState } from "react";

/** Quando sai uma versão nova do sistema, quem está com o painel aberto
 * continuava vendo a antiga até apertar Ctrl+F5 (caso real de 03/10: o
 * botão "abrir" do Financeiro não aparecia). Confere a cada 5 minutos (e
 * quando a aba volta a ficar visível) se o arquivo principal do site mudou
 * e mostra uma faixa pra atualizar. */
const INTERVALO_MS = 5 * 60 * 1000;

function scriptAtual(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return s ? new URL(s.src, location.href).pathname : null;
}

export default function AvisoNovaVersao() {
  const [nova, setNova] = useState(false);

  useEffect(() => {
    const atual = scriptAtual();
    if (!atual) return; // ambiente de desenvolvimento
    let parado = false;
    async function conferir() {
      try {
        const html = await (await fetch(`/?v=${Date.now()}`, { cache: "no-store" })).text();
        const m = html.match(/\/assets\/index-[\w-]+\.js/);
        if (!parado && m && m[0] !== atual) setNova(true);
      } catch {
        // sem internet agora -- tenta de novo no próximo ciclo
      }
    }
    const t = setInterval(conferir, INTERVALO_MS);
    const onVisivel = () => document.visibilityState === "visible" && conferir();
    document.addEventListener("visibilitychange", onVisivel);
    return () => {
      parado = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisivel);
    };
  }, []);

  if (!nova) return null;
  return (
    <div role="status" className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 z-[60] rounded-lg shadow-xl bg-primary text-white text-sm">
      <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <span>Saiu uma versão nova do sistema.</span>
        <button className="rounded bg-white/15 hover:bg-white/25 px-3 py-1 font-semibold" onClick={() => location.reload()}>
          Atualizar agora
        </button>
      </div>
    </div>
  );
}
