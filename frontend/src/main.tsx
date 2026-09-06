import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./styles/index.css";
import Home from "./pages/Home";
import Condominio from "./pages/Condominio";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/condominios/:slug" element={<Condominio />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
