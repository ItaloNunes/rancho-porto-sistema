import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import "./styles/index.css";
import Home from "./pages/Home";
import Condominio from "./pages/Condominio";
import Login from "./pages/Login";
import DefinirSenha from "./pages/DefinirSenha";
import { AuthProvider } from "./lib/auth";
import RequireAuth from "./components/RequireAuth";
import PainelLayout from "./pages/painel/PainelLayout";
import PainelCorretores from "./pages/painel/PainelCorretores";
import PainelPropostas from "./pages/painel/PainelPropostas";
import PainelReservas from "./pages/painel/PainelReservas";
import PainelDisponibilidade from "./pages/painel/PainelDisponibilidade";
import PainelLotes from "./pages/painel/PainelLotes";
import PainelPlantas from "./pages/painel/PainelPlantas";
import PainelAcompanhamento from "./pages/painel/PainelAcompanhamento";
import PainelVisaoGeral from "./pages/painel/PainelVisaoGeral";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/condominios/:slug" element={<Condominio />} />
          <Route path="/login" element={<Login />} />
          <Route path="/definir-senha" element={<DefinirSenha />} />
          {/* Qualificação de leads (link público + upload de documentos) saiu
              de circulação em set/2026 — rota removida, mas o componente
              QualificacaoPublica.tsx e o router do backend continuam no
              projeto, só não estão mais acessíveis. */}

          <Route
            path="/painel"
            element={
              <RequireAuth>
                <PainelLayout />
              </RequireAuth>
            }
          >
            {/* Cadastro de Cliente e Qualificações saíram da navegação pelo
                mesmo motivo — PainelClientes.tsx e PainelQualificacoes.tsx
                continuam no projeto, só desroteados. */}
            <Route index element={<Navigate to="reservas" replace />} />
            <Route path="propostas" element={<PainelPropostas />} />
            <Route path="reservas" element={<PainelReservas />} />
            <Route path="disponibilidade" element={<PainelDisponibilidade />} />
            <Route
              path="lotes"
              element={
                <RequireAuth adminOnly>
                  <PainelLotes />
                </RequireAuth>
              }
            />
            <Route
              path="visao-geral"
              element={
                <RequireAuth adminOnly>
                  <PainelVisaoGeral />
                </RequireAuth>
              }
            />
            <Route
              path="acompanhamento"
              element={
                <RequireAuth adminOnly>
                  <PainelAcompanhamento />
                </RequireAuth>
              }
            />
            <Route
              path="corretores"
              element={
                <RequireAuth adminOnly>
                  <PainelCorretores />
                </RequireAuth>
              }
            />
            <Route
              path="plantas"
              element={
                <RequireAuth adminOnly>
                  <PainelPlantas />
                </RequireAuth>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
