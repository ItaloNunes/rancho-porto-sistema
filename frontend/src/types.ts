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

export interface QuadraZona {
  /** Presente quando o empreendimento tem quadras reais (ex.: Porto Franco): casa por igualdade com Lote.quadra. */
  quadra?: string | null;
  /** Presentes quando a zona representa uma faixa de números de lote (ex.: Rancho Texas). */
  lote_min?: number | null;
  lote_max?: number | null;
  /** Texto exibido no chip de filtro; se ausente, cai para "Quadra {quadra}". */
  label?: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CondominioDetalhe extends CondominioResumo {
  plan_w?: number | null;
  plan_h?: number | null;
  plan_minx?: number | null;
  plan_miny?: number | null;
  plan_decor?: PlanoDecoracao | null;
  /** Quando preenchido, a planta é a imagem real (ver plan_quadras) em vez do modo polígono-por-lote. */
  plan_image_url?: string | null;
  /** Zonas clicáveis aproximadas por quadra — só usado quando plan_image_url está preenchido. */
  plan_quadras?: QuadraZona[] | null;
  base_precos_em?: string | null;
  lotes: Lote[];
}
