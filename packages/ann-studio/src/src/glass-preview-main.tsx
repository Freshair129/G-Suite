import { createRoot } from "react-dom/client";
import GlassWorkbenchPreview from "./glass/GlassWorkbenchPreview";

const root = document.getElementById("root");
if (!root) throw new Error("Glass UI preview root missing");
createRoot(root).render(<GlassWorkbenchPreview />);
