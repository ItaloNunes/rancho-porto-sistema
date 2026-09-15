// Espelha backend/app/usuarios.py::DOMINIO_LOGIN — tem que ser IDÊNTICO nos
// dois lados. Login de corretor agora é por "usuário" (ex.: italo.nunes),
// não por e-mail; o Supabase Auth por baixo continua exigindo um e-mail, e
// esse domínio fabricado é só isso — a pessoa nunca vê nem digita.
export const DOMINIO_LOGIN = "corretor.login";

export function emailInterno(usuario: string): string {
  return `${usuario.trim().toLowerCase()}@${DOMINIO_LOGIN}`;
}
