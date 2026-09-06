export type LoteStatus = "disponivel" | "reservado" | "vendido";

export interface CondominioResumo {
  id: string;
  slug: string;
  nome: string;
  incorporadora?: string | null;
  cidade?: string | null;
  segmento?: string | null;
  descricao?: string | null;
  logo_url?: string | null;
  hero_image_url?: string | null;
  total_lotes: number;
  total_disponiveis: number;
}

export interface PlanoDecoracao {
  river?: number[][];
  lagoon?: { cx: number; cy: number; rx: number; ry: number };
  entranceRoad?: { x: number; y: number; w: number; h: number };
  roundabout1?: { cx: number; cy: number; r: number };
  roundabout2?: { cx: number; cy: number; r: number };
}

export interface Lote {
  id: string;
  condominio_id: string;
  quadra: string;
  lote_numero: number;
  identificador: string;
  tamanho_m2: number;
  valor_total?: number | null;
  entrada?: number | null;
  entrega?: number | null;
  parcela_mensal?: number | null;
  qtd_parcelas?: number | null;
  prazo_entrega_meses?: number | null;
  status: LoteStatus;
  poligono: number[][];
  foto_url?: string | null;
}

export interface CondominioDetalhe extends CondominioResumo {
  plan_w?: number | null;
  plan_h?: number | null;
  plan_minx?: number | null;
  plan_miny?: number | null;
  plan_decor?: PlanoDecoracao | null;
  base_precos_em?: string | null;
  lotes: Lote[];
}
