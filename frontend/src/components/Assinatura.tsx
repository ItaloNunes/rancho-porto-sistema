/** Assinatura discreta do desenvolvedor no rodapé (25/11) -- mesma do
 * catálogo (Home/Condominio): texto pequeno, quase transparente, sem clique. */
export default function Assinatura({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-[10px] text-ink-soft/40 tracking-wide py-4 select-none ${className}`}>
      italonunesdev@proton.me
    </p>
  );
}
