import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import "./styles/high-contrast.css";
import "./styles/shell.css";
import "./styles/message.css";
import "./styles/markdown.css";
import "./styles/agent.css";
import "./styles/settings.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
