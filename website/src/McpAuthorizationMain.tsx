import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { McpAuthorizationPage } from "./pages/McpAuthorizationPage.js";
import "./styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("The MCP sign-in page is missing its root element.");
createRoot(root).render(
  <StrictMode>
    <McpAuthorizationPage />
  </StrictMode>,
);
