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
import PainelClientes from "./pages/painel/PainelClientes";
import PainelCorretores from "./pages/painel/PainelCorretores";
import PainelPropostas from "./pages/painel/PainelPropostas";
import PainelReservas from "./pages/painel/PainelReservas";
import PainelLotes from "./pages/painel/PainelLotes";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/condominios/:slug" element={<Condominio />} />
          <Route path="/login" element={<Login />} />
          <Route path="/definir-senha" element={<DefinirSenha />} />

          <Route
            path="/painel"
            element={
              <RequireAuth>
                <PainelLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="clientes" replace />} />
            <Route path="clientes" element={<PainelClientes />} />
            <Route path="propostas" element={<PainelPropostas />} />
            <Route path="reservas" element={<PainelReservas />} />
            <Route path="lotes" element={<PainelLotes />} />
            <Route
              path="corretores"
              element={
                <RequireAuth adminOnly>
                  <PainelCorretores />
                </RequireAuth>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
